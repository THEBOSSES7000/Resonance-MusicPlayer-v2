// Biblioteca · Carga de la biblioteca desde caché e inicialización.

import { getPlayCount, hydratePlaylists, hydrateQueueAndHistory, playCountKey, rebuildSongsIndex, state } from '../state.js';
import { initializePlaybackSession, playFromContext, renderFoldersUI, renderGrids, renderHistoryUI, renderPlaylistsHubUI, renderPlaylistsUI, renderQueue, showConfirmDialog, updateFavoritesCount } from '../ui.js';
import { applyFavoriteAddedAt, ensureStableIdsForLibrary, songIsFavorite } from './songIdentity.js';
import { METADATA_PARSER_VERSION } from './lyricsCache.js';
import { renderDirectories } from '../settings.js';
import { scannerVars } from './sharedState.js';
import { isTauriRuntime } from './fileUtils.js';
import { configureMusicWatcher, refreshNativeMusicLibrary } from './libraryRefresh.js';

async function loadCachedNativeLibrary(cachedTracksInput = null) {
  let directories = [];
  try {
    directories = await window.__TAURI__.core.invoke('get_music_directories');
    if (!Array.isArray(directories)) directories = [];
  } catch (error) {
    console.error('get_music_directories falló; se carga la caché igual:', error);
    directories = [];
  }
  const cachedTracks = cachedTracksInput || await window.__TAURI__.core.invoke('get_cached_music_library');
  if (!Array.isArray(cachedTracks) || cachedTracks.length === 0) {
    state.localMusicFiles = state.localMusicFiles || [];
    state.nativeMusicDirectories = directories;
    rebuildSongsIndex();
    renderGrids();
    return;
  }
  const favoriteKeys = new Set(JSON.parse(localStorage.getItem('pn_favorites_keys') || '[]'));
  state.nativeMusicDirectories = directories.map(directory => ({
    ...directory,
    count: cachedTracks.filter(track => track.directoryPath === directory.path).length
  }));
  const trackCounts = new Map();
  const savedFolders = new Map((state.configuredFolders || []).map(folder => [folder.name, folder]));
  state.localMusicFiles = cachedTracks.map((cachedTrack, id) => {
    const file = {
      name: cachedTrack.name,
      path: cachedTrack.path,
      directoryPath: cachedTrack.directoryPath,
      webkitRelativePath: cachedTrack.relativePath,
      size: cachedTrack.size,
      lastModified: cachedTrack.lastModified,
      isNativeFile: true
    };
    trackCounts.set(file.directoryPath, (trackCounts.get(file.directoryPath) || 0) + 1);
    const songKey = playCountKey(cachedTrack) || `${cachedTrack.title}:::${cachedTrack.artist}`;
    const resolvedCoverPath = (() => {
      const raw = cachedTrack.coverPath || cachedTrack.coverUrl || null;
      if (raw === 'none') return 'none';
      if (!raw || typeof raw !== 'string') return null;
      if (raw.startsWith('blob:') || raw.startsWith('data:')) return null;
      if (raw.startsWith('http://') || raw.startsWith('https://') || raw.includes('asset.localhost')) return null;
      return raw;
    })();

    return {
      id: id + 1,
      title: cachedTrack.title || '',
      artist: cachedTrack.artist || 'Desconocido',
      album: cachedTrack.album || '',
      trackNumber: cachedTrack.trackNumber || null,
      duration: cachedTrack.duration || 0,
      replayGainDb: cachedTrack.replayGainDb ?? null,
      file,
      coverPath: resolvedCoverPath,
      coverUrl: null,
      lyrics: null,
      lyricsLoaded: false,
      sampleRate: cachedTrack.sampleRate ?? null,
      channels: cachedTrack.channels ?? null,
      bitDepth: cachedTrack.bitDepth ?? null,
      codec: cachedTrack.codec ?? null,
      genre: cachedTrack.genre ?? null,
      techLoaded: Boolean(
        cachedTrack.sampleRate ||
        cachedTrack.bitDepth ||
        cachedTrack.codec ||
        cachedTrack.channels
      ),
      folderName: (file.webkitRelativePath || '').split('/')[1] || directories.find(dir => dir.path === file.directoryPath)?.name || 'Música',
      audioUrl: null,
      playCount: (songKey && state.playCounts[songKey]) || getPlayCount(cachedTrack) || 0,
      addedDate: new Date(file.lastModified || Date.now()).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }),
      isFavorite: songIsFavorite({ title: cachedTrack.title, artist: cachedTrack.artist, file: { path: cachedTrack.path } }, favoriteKeys) || Boolean(cachedTrack.isFavorite),
      metadataParserVersion: cachedTrack.metadataParserVersion || null,
      unavailable: Boolean(cachedTrack.unavailable),
      metadataLoaded: cachedTrack.metadataParserVersion === METADATA_PARSER_VERSION
    };
  });
  state.localMusicFiles.forEach(applyFavoriteAddedAt);
  ensureStableIdsForLibrary();
  state.nativeMusicDirectories = state.nativeMusicDirectories.map(directory => ({
    ...directory,
    count: trackCounts.get(directory.path) || 0
  }));
  const folderGroups = new Map();
  state.localMusicFiles.forEach(song => {
    if (!folderGroups.has(song.folderName)) folderGroups.set(song.folderName, []);
    folderGroups.get(song.folderName).push(song);
  });
  state.configuredFolders = Array.from(folderGroups.entries()).map(([name, songs], index) => ({
    ...(savedFolders.get(name) || {}),
    id: savedFolders.get(name)?.id || index + 1,
    name,
    count: songs.length,
    description: savedFolders.get(name)?.description || 'Carpeta local de música'
  }));
  localStorage.setItem('pn_folders_info', JSON.stringify(state.configuredFolders));
  rebuildSongsIndex();
  hydratePlaylists();
  hydrateQueueAndHistory();
  renderDirectories();
  renderGrids();
  renderQueue();
  renderHistoryUI();
  renderPlaylistsUI();
  if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
  updateFavoritesCount();
  renderFoldersUI();
  if (
    scannerVars.hasInitializedPlaybackSession &&
    localStorage.getItem('pn_restore_playback_session') !== 'false' &&
    state.activeQueue.length === 0 &&
    state.localMusicFiles.length > 0
  ) {
    playFromContext(state.localMusicFiles.slice(0, 25), 0, 'Recién agregadas', false);
  }
}

export async function initializeMusicLibrary() {
  if (!isTauriRuntime()) {
    await initializePlaybackSession();
    scannerVars.hasInitializedPlaybackSession = true;
    return;
  }
  try {
    const scanOnStartup = localStorage.getItem('pn_scan_music_on_startup') !== 'false';
    let cachedTracks = [];
    try {
      cachedTracks = await window.__TAURI__.core.invoke('get_cached_music_library');
      if (!Array.isArray(cachedTracks)) cachedTracks = [];
    } catch (cacheError) {
      console.error('No se pudo leer library.json de caché:', cacheError);
      cachedTracks = [];
    }
    const needsMetadataUpgrade = cachedTracks.some(
      track => track.metadataParserVersion !== METADATA_PARSER_VERSION
    );
    const hadCachedTracks = cachedTracks.length > 0;
    // 1) Pintar UI de inmediato con la caché (no esperar el escaneo completo)
    if (hadCachedTracks) {
      await loadCachedNativeLibrary(cachedTracks);
    }
    await initializePlaybackSession();
    scannerVars.hasInitializedPlaybackSession = true;

    // 2) Escaneo / upgrade en segundo plano para no congelar clics ni el menú
    const shouldRescan = scanOnStartup || needsMetadataUpgrade || !hadCachedTracks;
    if (shouldRescan) {
      const rescanPromise = refreshNativeMusicLibrary(false, {
        skipRenderIfUnchanged: hadCachedTracks && !needsMetadataUpgrade
      });
      if (!hadCachedTracks) {
        // Sin caché hay que esperar al menos el primer escaneo
        await rescanPromise;
      } else {
        void rescanPromise.catch(error => {
          console.error('Escaneo en segundo plano falló:', error);
        });
      }
    }
  } catch (error) {
    console.error('No se pudo inicializar la biblioteca:', error);
    try {
      await showConfirmDialog({
        title: 'No se pudo cargar la biblioteca',
        message: 'No fue posible cargar la biblioteca guardada. Intenta escanear las carpetas desde Configuración.',
        confirmText: 'Entendido',
        showCancel: false
      });
    } catch (dialogError) {
      console.error('No se pudo mostrar el diálogo de error:', dialogError);
    }
  } finally {
    try {
      await configureMusicWatcher();
    } catch (watcherError) {
      console.error('configureMusicWatcher:', watcherError);
    }
  }
}
