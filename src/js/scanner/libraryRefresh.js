// Biblioteca · Actualización de la biblioteca y vigilancia de carpetas.

import { getFallbackMetadata, isTauriRuntime } from './fileUtils.js';
import { clearCoverUrlCache, rebuildSongsIndex, state } from '../state.js';
import { renderFoldersUI, renderGrids, renderHistoryUI, renderPlaylistDetailView, renderQueue, renderSearchResultsContent, showConfirmDialog } from '../ui.js';
import { loadSongMetadata } from './loadSongMetadata.js';
import { saveNativeLibraryCache } from './libraryCache.js';
import { scannerVars } from './sharedState.js';
import { activeLibraryScan, beginLibraryScan, finishLibraryScan, hideScanProgress, updateScanProgress } from './scanProgress.js';
import { loadedLyricsSongs } from './lyricsCache.js';
import { renderDirectories } from '../settings.js';
import { processAudioFiles } from './processFiles.js';

export async function configureMusicWatcher() {
  if (!isTauriRuntime()) return;
  const enabled = localStorage.getItem('pn_watch_music_directories') === 'true';
  try {
    await window.__TAURI__.core.invoke('configure_music_watcher', { enabled });
  } catch (error) {
    console.error('No se pudo configurar el monitoreo de carpetas:', error);
    const toggle = document.getElementById('watch-music-directories');
    if (toggle) toggle.checked = false;
    localStorage.setItem('pn_watch_music_directories', 'false');
    const status = document.getElementById('library-cache-status');
    if (status) status.textContent = 'No se pudo activar el monitoreo de carpetas.';
  }
}

export async function refreshLibraryMetadata() {
  if (state.localMusicFiles.length === 0) {
    await showConfirmDialog({
      title: 'Biblioteca vacía',
      message: 'Primero escanea una carpeta de música para refrescar sus carátulas y metadatos.',
      confirmText: 'Entendido',
      showCancel: false
    });
    return;
  }
  try {
    clearCoverUrlCache();
    const metadataErrors = await loadSongMetadata(state.localMusicFiles, 'Refrescando carátulas y metadatos');
    rebuildSongsIndex();
    const cacheSaved = await saveNativeLibraryCache(true);
    renderGrids();
    renderQueue();
    renderFoldersUI();
    if (['favorites', 'playlist', 'all-music', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
      await renderPlaylistDetailView();
    }
    const status = document.getElementById('library-cache-status');
    if (status) {
      const refreshSummary = metadataErrors
        ? `Actualización terminada: ${metadataErrors} canción(es) no se pudieron leer.`
        : 'Carátulas y metadatos actualizados.';
      status.textContent = cacheSaved ? refreshSummary : `${refreshSummary} No se guardó la caché en disco.`;
    }
    window.dispatchEvent(new Event('pn-library-cache-updated'));
    scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 6000);
  } catch (error) {
    console.error('No se pudieron refrescar los metadatos de la biblioteca:', error);
    await showConfirmDialog({
      title: 'No se pudieron refrescar los metadatos',
      message: 'Ocurrió un error al releer las canciones. Revisa la consola para más detalles.',
      confirmText: 'Entendido',
      showCancel: false
    });
  }
}

export function clearCachedMetadataFromMemory() {
  loadedLyricsSongs.length = 0;
  clearCoverUrlCache();

  const songs = new Set([
    ...state.localMusicFiles,
    ...state.playlists.flatMap(playlist => playlist.songs || []),
    ...state.activeQueue,
    ...state.playbackHistory
  ]);
  songs.forEach(song => {
    if (song.coverUrl?.startsWith('blob:')) URL.revokeObjectURL(song.coverUrl);
    if (song.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(song.audioUrl);
    const fallback = song.file ? getFallbackMetadata(song.file) : { title: song.title, artist: song.artist };
    song.title = fallback.title;
    song.artist = fallback.artist;
    song.album = '';
    song.trackNumber = null;
    song.coverUrl = null;
    song.coverPath = null;
    song.audioUrl = null;
    song.lyrics = null;
    song.lyricsLoaded = false;
    song.techLoaded = false;
    song.sampleRate = null;
    song.channels = null;
    song.bitDepth = null;
    song.codec = null;
    song.replayGainDb = null;
    song.metadataLoaded = false;
  });
  renderGrids();
  renderQueue();
  renderHistoryUI();
  renderFoldersUI();
  if (state.currentView === 'search') renderSearchResultsContent();
  else if (['favorites', 'playlist', 'all-music', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
    void renderPlaylistDetailView().catch(error => {
      console.error('No se pudo actualizar la vista al limpiar la caché:', error);
    });
  }
  window.dispatchEvent(new Event('pn-library-cache-cleared'));
  window.dispatchEvent(new Event('pn-library-cache-updated'));
}

export async function refreshNativeMusicLibrary(configureWatcher = true, options = {}) {
  const scan = beginLibraryScan();
  try {
    return await refreshNativeMusicLibraryInternal(configureWatcher, options);
  } finally {
    finishLibraryScan(scan);
  }
}

async function refreshNativeMusicLibraryInternal(configureWatcher = true, options = {}) {
  updateScanProgress({ label: 'Buscando canciones en las carpetas guardadas', indeterminate: true });
  try {
    const library = await window.__TAURI__.core.invoke('scan_music_library');
    if (activeLibraryScan?.cancelled) return;
    const trackCounts = new Map();
    library.files.forEach(file => {
      trackCounts.set(file.directoryPath, (trackCounts.get(file.directoryPath) || 0) + 1);
    });
    state.nativeMusicDirectories = library.directories.map(directory => ({
      ...directory,
      count: trackCounts.get(directory.path) || 0
    }));
    const previousCount = state.localMusicFiles.length;
    const normalizePath = value => String(value || '').replace(/\\/g, '/').toLowerCase();
    const selectedPaths = new Set(library.files.map(file => normalizePath(file.path)));
    // Solo filtrar pistas que ya no están en disco cuando el escaneo SÍ encontró archivos.
    // Si el escaneo vuelve vacío (carpeta offline, permiso, ruta rota), NO vaciar la biblioteca.
    if (library.files.length > 0) {
      state.localMusicFiles = state.localMusicFiles.filter(song =>
        song.file?.path && selectedPaths.has(normalizePath(song.file.path))
      );
    }
    const removedAny = state.localMusicFiles.length !== previousCount;

    if (library.files.length === 0) {
      console.warn(
        '[Resonance] scan_music_library devolvió 0 archivos. Se conserva la biblioteca actual.',
        { directories: library.directories?.length || 0, inMemory: state.localMusicFiles.length }
      );
      // Nunca sobrescribir library.json con [] si todavía hay pistas en memoria
      if (state.localMusicFiles.length === 0) {
        // Realmente no hay nada: carpetas vacías o sin configurar
        state.configuredFolders = state.configuredFolders || [];
        rebuildSongsIndex();
        renderDirectories();
        renderGrids();
        renderQueue();
        renderHistoryUI();
        renderFoldersUI();
      } else {
        renderDirectories();
        renderGrids();
      }
      if (configureWatcher) await configureMusicWatcher();
      hideScanProgress();
      return;
    }

    const files = library.files.map(file => ({
      ...file,
      lastModified: file.lastModified || 0,
      size: file.size || 0,
      webkitRelativePath: file.relativePath,
      isNativeFile: true
    }));
    await processAudioFiles(files, 'Música', {
      onlyNewOrChanged: true,
      removedAny,
      skipRenderIfUnchanged: Boolean(options.skipRenderIfUnchanged)
    });
    if (configureWatcher) await configureMusicWatcher();
  } catch (error) {
    if (activeLibraryScan?.cancelled) return;
    console.error('No se pudieron cargar las carpetas de música guardadas:', error);
    updateScanProgress({ label: 'No se pudieron leer las carpetas guardadas', complete: true });
    scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 8000);
    await showConfirmDialog({
      title: "No se pudo cargar la biblioteca",
      message: "No se pudieron leer las carpetas de música guardadas. Revisa que sigan disponibles y vuelve a intentarlo.",
      confirmText: "Entendido",
      showCancel: false
    });
  }
}

export async function addNativeMusicDirectory() {
  try {
    const directory = await window.__TAURI__.core.invoke('add_music_directory');
    if (directory) await refreshNativeMusicLibrary();
  } catch (error) {
    console.error('No se pudo agregar la carpeta de música:', error);
    await showConfirmDialog({
      title: "No se pudo agregar la carpeta",
      message: "No se pudo guardar el acceso a la carpeta seleccionada.",
      confirmText: "Entendido",
      showCancel: false
    });
  }
}
