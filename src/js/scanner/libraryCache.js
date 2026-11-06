// Biblioteca · Caché de la biblioteca en disco.

import { isNativeDiskPath, isTauriRuntime } from './fileUtils.js';
import { getPlayCount, state } from '../state.js';
import { METADATA_PARSER_VERSION } from './lyricsCache.js';
import { enqueueDbWrite } from './dbQueue.js';

let saveLibraryCacheTimer = null;
let saveLibraryCachePromise = null;
let saveLibraryCacheResolvers = [];

/** true si alguna llamada pendiente autoriza que la biblioteca guardada se reduzca mucho (escaneo real) */
let pendingAllowShrink = false;
/** true si alguna llamada pendiente exige un guardado completo (el único que puede borrar pistas que ya no están) */
let pendingFullSave = false;

/**
 * Última versión guardada de cada pista (ruta → firma). Con ella los guardados normales envían solo las
 * pistas que cambiaron (unos milisegundos) en vez de reescribir toda la biblioteca (segundos con decenas de miles).
 */
const savedSignatures = new Map();

/** Datos de una pista tal como se guardan en la base de datos. */
function buildTrackPayload(song) {
  return {
    path: song.file.path,
    name: song.file.name,
    directoryPath: song.file.directoryPath || null,
    relativePath: song.file.webkitRelativePath || '',
    size: song.file.size || 0,
    lastModified: song.file.lastModified || 0,
    metadataParserVersion: song.metadataParserVersion || METADATA_PARSER_VERSION,
    title: song.title,
    artist: song.artist,
    album: song.album,
    trackNumber: song.trackNumber ?? null,
    coverUrl: song.coverPath === 'none'
      ? 'none'
      : (song.coverPath || (isNativeDiskPath(song.coverUrl) ? song.coverUrl : null)),
    duration: song.duration || 0,
    sampleRate: song.sampleRate ?? null,
    channels: song.channels ?? null,
    bitDepth: song.bitDepth ?? null,
    codec: song.codec || null,
    genre: song.genre || null,
    replayGainDb: song.replayGainDb ?? null,
    isFavorite: song.isFavorite,
    // La base de datos también guarda estos dos datos: hay que enviarlos siempre, si no se pisan con 0 / vacío
    playCount: getPlayCount(song),
    favoriteAddedAt: Number.isFinite(Number(song.favoriteAddedAt)) && Number(song.favoriteAddedAt) > 0
      ? Math.trunc(Number(song.favoriteAddedAt))
      : null,
    unavailable: Boolean(song.unavailable),
    metadataLoaded: Boolean(song.metadataLoaded)
  };
}

/**
 * Guarda la biblioteca en SQLite.
 * - Completo (full / allowShrink / primer guardado de la sesión): envía todas las pistas y borra las que ya no están.
 * - Parcial (lo normal): envía solo las pistas cuya firma cambió desde el último guardado.
 */
async function flushNativeLibraryCacheToDisk({ allowShrink = false, full = false } = {}) {
  if (!isTauriRuntime()) return true;
  try {
    const nativeSongs = state.localMusicFiles.filter(song => song.file?.isNativeFile && song.file.path);
    const payloads = nativeSongs.map(buildTrackPayload);
    const signatures = payloads.map(track => JSON.stringify(track));
    const doFull = full || allowShrink || savedSignatures.size === 0;

    let songs = nativeSongs;
    let tracks = payloads;
    if (!doFull) {
      songs = [];
      tracks = [];
      for (let i = 0; i < payloads.length; i += 1) {
        if (savedSignatures.get(payloads[i].path) !== signatures[i]) {
          songs.push(nativeSongs[i]);
          tracks.push(payloads[i]);
        }
      }
      if (tracks.length === 0) return true; // nada cambió: no hay que tocar el disco
    }

    const coverPaths = await window.__TAURI__.core.invoke('save_cached_music_library', {
      tracks,
      allowShrink,
      partial: !doFull
    });
    if (doFull) savedSignatures.clear();
    songs.forEach((song, index) => {
      if (coverPaths[index]) {
        song.coverPath = coverPaths[index];
      } else if (!song.coverPath) {
        song.coverPath = 'none';
      }
      // La firma guardada es la de lo enviado (con la carátula resultante). Si la canción cambió mientras
      // se guardaba, la firma no coincidirá y se reenviará en el siguiente guardado.
      const fresh = buildTrackPayload(song);
      savedSignatures.set(tracks[index].path, JSON.stringify({ ...tracks[index], coverUrl: fresh.coverUrl }));
    });
    window.dispatchEvent(new Event('pn-library-cache-updated'));
    return true;
  } catch (error) {
    console.error('No se pudo guardar la caché de la biblioteca:', error);
    return false;
  }
}

/**
 * Pide guardar la biblioteca. Los guardados se ejecutan de uno en uno (cola única de la base de datos).
 * options.full: guardado completo (hace falta cuando se borran o reubican archivos).
 * options.allowShrink: además autoriza que la biblioteca guardada se reduzca mucho (solo tras un escaneo real).
 */
export function saveNativeLibraryCache(immediate = false, options = {}) {
  if (!isTauriRuntime()) return Promise.resolve(true);
  if (options && options.allowShrink) pendingAllowShrink = true;
  if (options && (options.full || options.allowShrink)) pendingFullSave = true;

  const runFlush = () => {
    const flags = { allowShrink: pendingAllowShrink, full: pendingFullSave };
    pendingAllowShrink = false;
    pendingFullSave = false;
    return enqueueDbWrite(() => flushNativeLibraryCacheToDisk(flags));
  };

  if (immediate) {
    window.clearTimeout(saveLibraryCacheTimer);
    saveLibraryCacheTimer = null;
    const pendingResolvers = saveLibraryCacheResolvers.splice(0);
    return runFlush().then(result => {
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
  window.clearTimeout(saveLibraryCacheTimer);
  saveLibraryCacheTimer = window.setTimeout(() => {
    saveLibraryCacheTimer = null;
    const pendingResolvers = saveLibraryCacheResolvers.splice(0);
    saveLibraryCachePromise = null;
    void runFlush().then(result => {
      pendingResolvers.forEach(resolve => resolve(result));
    });
  }, 900);
  return saveLibraryCachePromise;
}
