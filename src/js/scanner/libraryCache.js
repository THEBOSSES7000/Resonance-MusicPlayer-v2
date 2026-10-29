// Biblioteca · Caché de la biblioteca en disco.

import { isNativeDiskPath, isTauriRuntime } from './fileUtils.js';
import { state } from '../state.js';
import { METADATA_PARSER_VERSION } from './lyricsCache.js';

let saveLibraryCacheTimer = null;

let saveLibraryCachePromise = null;

let saveLibraryCacheResolvers = [];

async function flushNativeLibraryCacheToDisk() {
  if (!isTauriRuntime()) return true;
  try {
    const nativeSongs = state.localMusicFiles
      .filter(song => song.file?.isNativeFile && song.file.path);
    const tracks = nativeSongs.map(song => ({
      path: song.file.path,
      name: song.file.name,
      directoryPath: song.file.directoryPath,
      relativePath: song.file.webkitRelativePath || '',
      size: song.file.size || 0,
      lastModified: song.file.lastModified || 0,
      metadataParserVersion: METADATA_PARSER_VERSION,
      title: song.title,
      artist: song.artist,
      album: song.album,
      trackNumber: song.trackNumber,
      coverUrl: song.coverPath === 'none'
        ? 'none'
        : (song.coverPath || (isNativeDiskPath(song.coverUrl) ? song.coverUrl : null)),
      duration: song.duration,
      sampleRate: song.sampleRate,
      channels: song.channels,
      bitDepth: song.bitDepth,
      codec: song.codec,
      genre: song.genre || null,
      replayGainDb: song.replayGainDb,
      isFavorite: song.isFavorite,
      unavailable: Boolean(song.unavailable),
      metadataLoaded: Boolean(song.metadataLoaded)
    }));
    const coverPaths = await window.__TAURI__.core.invoke('save_cached_music_library', { tracks });
    nativeSongs.forEach((song, index) => {
      if (coverPaths[index]) {
        song.coverPath = coverPaths[index];
      } else if (!song.coverPath) {
        song.coverPath = 'none';
      }
    });
    window.dispatchEvent(new Event('pn-library-cache-updated'));
    return true;
  } catch (error) {
    console.error('No se pudo guardar la caché de la biblioteca:', error);
    const status = document.getElementById('library-cache-status');
    if (status) status.textContent = 'No se pudo guardar la caché de la biblioteca.';
    return false;
  }
}

/**
 * Guarda la caché nativa en disco.
 * Por defecto agrupa (debounce de 900 ms) múltiples llamadas seguidas (ej. lotes ReplayGain o clicks en Favoritos)
 * para no clonar ni enviar miles de objetos por IPC en cada evento individual.
 */
export function saveNativeLibraryCache(immediate = false) {
  if (!isTauriRuntime()) return Promise.resolve(true);

  if (immediate) {
    if (saveLibraryCacheTimer !== null) {
      clearTimeout(saveLibraryCacheTimer);
      saveLibraryCacheTimer = null;
    }
    const pendingResolvers = saveLibraryCacheResolvers.splice(0);
    return flushNativeLibraryCacheToDisk().then(result => {
      pendingResolvers.forEach(resolve => resolve(result));
      saveLibraryCachePromise = null;
      return result;
    });
  }

  if (!saveLibraryCachePromise) {
    saveLibraryCachePromise = new Promise(resolve => {
      saveLibraryCacheResolvers.push(resolve);
    });
  }

  if (saveLibraryCacheTimer !== null) {
    clearTimeout(saveLibraryCacheTimer);
  }
  saveLibraryCacheTimer = setTimeout(() => {
    saveLibraryCacheTimer = null;
    const pendingResolvers = saveLibraryCacheResolvers.splice(0);
    saveLibraryCachePromise = null;
    void flushNativeLibraryCacheToDisk().then(result => {
      pendingResolvers.forEach(resolve => resolve(result));
    });
  }, 900);

  return saveLibraryCachePromise;
}
