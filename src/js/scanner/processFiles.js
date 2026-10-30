import { compactSong } from './songMemory.js';
// Biblioteca · Procesamiento de archivos de audio y re-escaneo.

import { activeLibraryScan, beginLibraryScan, finishLibraryScan, hideScanProgress, updateScanProgress } from './scanProgress.js';
import { getPlayCount, rebuildSongsIndex, state } from '../state.js';
import { formatAddedDate, getFileKey, isTauriRuntime } from './fileUtils.js';
import { METADATA_PARSER_VERSION } from './lyricsCache.js';
import { applyFavoriteAddedAt, assignStableSongId, ensureStableIdsForLibrary, songIsFavorite } from './songIdentity.js';
import { scannerVars } from './sharedState.js';
import { loadSongMetadata } from './loadSongMetadata.js';
import { saveNativeLibraryCache } from './libraryCache.js';
import { renderDirectories } from '../settings.js';
import { playFromContext, renderFoldersUI, renderGrids, renderHistoryUI, renderPlaylistDetailView, renderPlaylistsHubUI, renderPlaylistsUI, renderQueue, renderSearchResultsContent, showConfirmDialog, updateFavoritesCount } from '../ui.js';
import { addNativeMusicDirectory, refreshNativeMusicLibrary } from './libraryRefresh.js';

export async function processAudioFiles(matchedFiles, baseFolderName, options = {}) {
  const scan = beginLibraryScan();
  try {
    return await processAudioFilesInternal(matchedFiles, baseFolderName, options);
  } finally {
    finishLibraryScan(scan);
  }
}

async function processAudioFilesInternal(matchedFiles, baseFolderName, options = {}) {
  matchedFiles.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

  const savedFavKeys = new Set(JSON.parse(localStorage.getItem('pn_favorites_keys') || '[]'));
  const savedFolderDescs = JSON.parse(localStorage.getItem('pn_folder_descs') || '{}');
  const scanOnlyNewMusic = options.onlyNewOrChanged !== false &&
    localStorage.getItem('pn_scan_only_new_music') !== 'false';
  const existingFiles = new Map(state.localMusicFiles.map(song => [getFileKey(song.file), song]));
  const pendingFiles = new Map();
  const songsToScan = [];
  const songsToScanSet = new Set();
  let addedSongsCount = 0;

  matchedFiles.forEach((file) => {
    let cleanName = file.name.substring(0, file.name.lastIndexOf('.'));
    let artist = "Desconocido";
    let title = cleanName;

    const sep = cleanName.includes(' - ') ? ' - ' :
                cleanName.includes(' – ') ? ' – ' :
                cleanName.includes(' — ') ? ' — ' : null;

    if (sep) {
      const parts = cleanName.split(sep);
      artist = parts[0].trim();
      title = parts.slice(1).join(sep).trim();
    }

    const fileKey = getFileKey(file);

    let folderName = baseFolderName || "Música";
    if (file.webkitRelativePath) {
      const relParts = file.webkitRelativePath.split('/');
      if (relParts.length > 2) {
        folderName = relParts[1];
      } else if (relParts.length === 2) {
        folderName = relParts[0];
      }
    }

    let song = existingFiles.get(fileKey) || pendingFiles.get(fileKey);
    const isUnchanged = song &&
      song.metadataLoaded &&
      song.metadataParserVersion === METADATA_PARSER_VERSION &&
      Number(song.file?.lastModified || 0) === Number(file.lastModified || 0) &&
      Number(song.file?.size || 0) === Number(file.size || 0);
    const shouldScanMetadata = scanOnlyNewMusic ? !isUnchanged : true;
    if (!song) {
      addedSongsCount++;
      song = {
        id: null,
        title,
        artist,
        album: "",
        file,
        folderName,
        // No crear URL.createObjectURL masivamente al escanear; resolveAudioUrl lo hace bajo demanda
        audioUrl: file.audioUrl || null,
        coverUrl: null,
        coverPath: null,
        lyrics: null,
        lyricsLoaded: false,
        metadataLoaded: false,
        metadataParserVersion: null,
        duration: 0,
        sampleRate: null,
        channels: null,
        bitDepth: null,
        codec: null,
        replayGainDb: null,
        playCount: 0,
        addedDate: formatAddedDate(file.lastModified),
        isFavorite: songIsFavorite({ title, artist, file }, savedFavKeys)
      };
      assignStableSongId(song);
      applyFavoriteAddedAt(song);
      song.playCount = getPlayCount(song);
      pendingFiles.set(fileKey, song);
      state.localMusicFiles.push(song);
    } else {
      if (file.isNativeFile) {
        if (song.audioUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(song.audioUrl);
          song.audioUrl = null;
        }
      } else if (song.file !== file && !file.audioUrl && typeof file?.slice === 'function') {
        if (song.audioUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(song.audioUrl);
          song.audioUrl = null;
        }
      } else if (file.audioUrl) {
        song.audioUrl = file.audioUrl;
      }
      song.file = file;
      song.folderName = folderName;
    }
    if (shouldScanMetadata && !songsToScanSet.has(song)) {
      songsToScanSet.add(song);
      songsToScan.push(song);
    }
  });

  const hasChanges = songsToScan.length > 0 || addedSongsCount > 0 || Boolean(options.removedAny);

  // Si fue un escaneo incremental en segundo plano al iniciar y no hubo ningún cambio en disco,
  // evitar re-serializar toda la biblioteca por IPC y evitar reconstruir todo el DOM por segunda vez.
  if (!hasChanges && options.skipRenderIfUnchanged) {
    updateScanProgress({
      label: 'Escaneo terminado: no hay canciones nuevas o modificadas',
      completed: 0,
      total: 0,
      complete: true
    });
    scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 3500);
    return;
  }

  const metadataErrors = await loadSongMetadata(songsToScan, 'Leyendo metadatos');
  for (const s of songsToScan) compactSong(s);
  state.localMusicFiles.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
  ensureStableIdsForLibrary();

  const folderMap = new Map();
  state.localMusicFiles.forEach(song => {
    const fn = song.folderName || "Música";
    if (!folderMap.has(fn)) {
      folderMap.set(fn, []);
    }
    folderMap.get(fn).push(song);
  });

  const existingFoldersMeta = new Map((state.configuredFolders || []).map(f => [f.name, f]));

  state.configuredFolders = Array.from(folderMap.entries()).map(([name, songs], index) => {
    const prev = existingFoldersMeta.get(name);
    return {
      id: prev ? prev.id : (index + 1),
      name: name,
      count: songs.length,
      description: savedFolderDescs[name] || prev?.description || "Carpeta local de música",
      createdAt: prev?.createdAt || songs[0]?.file?.lastModified || Date.now(),
      lastPlayed: prev?.lastPlayed || 0
    };
  });

  localStorage.setItem('pn_folders_info', JSON.stringify(state.configuredFolders));
  rebuildSongsIndex();
  if (hasChanges) {
    await saveNativeLibraryCache(true);
  }

  renderDirectories();
  renderGrids();
  renderQueue();
  renderHistoryUI();
  renderPlaylistsUI();
  if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
  updateFavoritesCount();
  renderFoldersUI();
  if (state.currentView === 'search') {
    renderSearchResultsContent();
  } else if (['favorites', 'playlist', 'all-music', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
    await renderPlaylistDetailView();
  }

  if (
    !activeLibraryScan?.cancelled &&
    scannerVars.hasInitializedPlaybackSession &&
    localStorage.getItem('pn_restore_playback_session') !== 'false' &&
    state.activeQueue.length === 0 &&
    state.localMusicFiles.length > 0
  ) {
    const initialRecent = state.localMusicFiles.slice(0, 25);
    playFromContext(initialRecent, 0, "Recién agregadas", false);
  }

  updateScanProgress({
    label: activeLibraryScan?.cancelled
      ? 'Escaneo detenido'
      : metadataErrors
      ? `Escaneo terminado: ${metadataErrors} canción(es) no se pudieron leer`
      : scanOnlyNewMusic && songsToScan.length === 0
        ? 'Escaneo terminado: no hay canciones nuevas o modificadas'
        : `Escaneo terminado: ${songsToScan.length} canciones listas`,
    completed: songsToScan.length,
    total: songsToScan.length
  });
  scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 6000);
}

export async function rescanConfiguredMusic() {
  const btn = document.getElementById('btn-quick-scan');
  const icon = btn?.querySelector('i');
  if (icon) icon.classList.add('spinning');

  try {
    if (isTauriRuntime()) {
      if (state.nativeMusicDirectories.length === 0) {
        await addNativeMusicDirectory();
        return;
      }
      await refreshNativeMusicLibrary();
      return;
    }

    if (!state.configuredFolders || state.configuredFolders.length === 0) {
      alert("No tienes ninguna carpeta de música configurada aún. Ve a Configuración para agregar una carpeta.");
      document.getElementById('btn-open-settings')?.click();
      return;
    }

    if (state.localMusicFiles && state.localMusicFiles.length > 0) {
      const songsToRefresh = state.localMusicFiles.filter(song => !song.metadataLoaded);
      const failures = await loadSongMetadata(songsToRefresh, 'Actualizando biblioteca');
      state.localMusicFiles.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
      ensureStableIdsForLibrary();
      renderGrids();
      renderQueue();
      renderHistoryUI();
      updateFavoritesCount();
      renderFoldersUI();
      if (state.currentView === 'search') {
        renderSearchResultsContent();
      } else if (['favorites', 'playlist', 'all-music', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
        await renderPlaylistDetailView();
      }
      updateScanProgress({
        label: failures
          ? `Biblioteca actualizada: ${failures} canción(es) no se pudieron leer`
          : songsToRefresh.length === 0
            ? 'Biblioteca actualizada: no hay canciones nuevas por procesar'
          : `Biblioteca actualizada: ${state.localMusicFiles.length} canciones listas`,
        completed: songsToRefresh.length,
        total: songsToRefresh.length
      });
      scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 6000);
    } else {
      document.getElementById('native-folder-input').click();
    }
  } catch (error) {
    console.error('No se pudo actualizar la biblioteca:', error);
    updateScanProgress({ label: 'No se pudo completar el escaneo', complete: true });
    scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 8000);
    await showConfirmDialog({
      title: "Error al escanear la música",
      message: "No se pudo completar la lectura de la biblioteca. Revisa la consola para ver más detalles.",
      confirmText: "Entendido",
      showCancel: false
    });
  } finally {
    if (icon) icon.classList.remove('spinning');
  }
}
