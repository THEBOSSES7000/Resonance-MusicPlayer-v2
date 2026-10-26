// Biblioteca · Carga de metadatos de una canción.

import { activeLibraryScan, hideScanProgress, updateScanProgress } from './scanProgress.js';
import { scannerVars } from './sharedState.js';
import { getPlayCount, reindexSong } from '../state.js';
import { applyFavoriteAddedAt, songIsFavorite } from './songIdentity.js';
import { METADATA_PARSER_VERSION } from './lyricsCache.js';
import { getFallbackMetadata } from './fileUtils.js';
import { extractMetadata } from './extractMetadata.js';

export async function loadSongMetadata(songs, label = 'Escaneando música') {
  if (songs.length === 0) {
    hideScanProgress();
    return 0;
  }

  clearTimeout(scannerVars.hideScanProgressTimer);
  updateScanProgress({ label: `${label}: preparando ${songs.length} canciones`, total: songs.length, indeterminate: true });
  let completed = 0;
  let failed = 0;
  const savedFavorites = new Set(JSON.parse(localStorage.getItem('pn_favorites_keys') || '[]'));

  const applyMetadataToSong = (song, metadata, fallback, isNative = false) => {
    song.title = metadata.title || fallback.title;
    song.artist = metadata.artist || fallback.artist;
    song.album = metadata.album || '';
    if (Number.isFinite(metadata.duration) && metadata.duration > 0) {
      song.duration = metadata.duration;
    }
    song.trackNumber = metadata.trackNumber || null;
    // Marcar 'none' cuando un archivo nativo ya fue escaneado y no tiene carátula incrustada
    song.coverPath = metadata.coverPath || (isNative && !metadata.coverUrl ? 'none' : null);

    const nextCover = metadata.coverUrl || null;
    if (song.coverUrl?.startsWith?.('blob:') && song.coverUrl !== nextCover) {
      try { URL.revokeObjectURL(song.coverUrl); } catch (_) {}
    }
    song.coverUrl = nextCover;
    song.audioUrl = null;
    song.lyrics = null;
    song.lyricsLoaded = false;
    song.sampleRate = metadata.sampleRate ?? null;
    song.channels = metadata.channels ?? null;
    song.bitDepth = metadata.bitDepth ?? null;
    song.codec = metadata.codec ?? null;
    if (metadata.genre) song.genre = metadata.genre;
    song.techLoaded = Boolean(song.sampleRate || song.bitDepth || song.codec);
    song.replayGainDb = metadata.replayGainDb ?? null;
    song.playCount = getPlayCount(song) || song.playCount || 0;
    song.isFavorite = songIsFavorite(song, savedFavorites);
    applyFavoriteAddedAt(song);
    song.metadataLoaded = true;
    song.metadataParserVersion = METADATA_PARSER_VERSION;
    reindexSong(song);
  };

  const nativeSongs = [];
  const webSongs = [];
  for (const song of songs) {
    if (song.file?.isNativeFile && song.file.path && window.__TAURI__?.core?.invoke) {
      nativeSongs.push(song);
    } else {
      webSongs.push(song);
    }
  }

  const BATCH_SIZE = 80;
  const pathKey = p => String(p || '').replace(/\\/g, '/').toLowerCase();

  // --- Nativo: lotes vía scan_files_metadata (rayon en Rust) ---
  for (let offset = 0; offset < nativeSongs.length; offset += BATCH_SIZE) {
    if (activeLibraryScan?.cancelled) break;
    const batch = nativeSongs.slice(offset, offset + BATCH_SIZE);
    const paths = batch.map(song => song.file.path);
    try {
      const results = await window.__TAURI__.core.invoke('scan_files_metadata', {
        paths,
        includeLyrics: false
      });
      const byPath = new Map();
      for (const result of results || []) {
        if (result?.path) byPath.set(pathKey(result.path), result);
      }
      for (const song of batch) {
        if (activeLibraryScan?.cancelled) break;
        const fallback = getFallbackMetadata(song.file);
        try {
          const result = byPath.get(pathKey(song.file.path));
          if (!result || result.error || !result.metadata) {
            throw new Error(result?.error || 'Sin metadatos');
          }
          const native = result.metadata;
          applyMetadataToSong(song, {
            title: native.title,
            artist: native.artist,
            album: native.album,
            trackNumber: native.trackNumber,
            duration: native.duration,
            sampleRate: native.sampleRate,
            channels: native.channels,
            bitDepth: native.bitDepth,
            codec: native.codec,
            genre: native.genre || null,
            replayGainDb: native.replayGainDb,
            coverPath: native.coverPath || 'none',
            coverUrl: null
          }, fallback, true);
        } catch (error) {
          failed++;
          song.metadataLoaded = true;
          console.warn(`No se pudieron leer los metadatos de ${song.file?.name || song.title}:`, error);
        } finally {
          completed++;
          updateScanProgress({
            label: `${label}: ${completed} de ${songs.length}${failed ? ` (${failed} con errores)` : ''}`,
            completed,
            total: songs.length
          });
        }
      }
    } catch (batchError) {
      console.warn('Fallo el lote de metadatos nativos; se reintenta uno a uno:', batchError);
      for (const song of batch) {
        if (activeLibraryScan?.cancelled) break;
        const fallback = getFallbackMetadata(song.file);
        try {
          const native = await window.__TAURI__.core.invoke('scan_file_metadata', {
            path: song.file.path,
            includeLyrics: false
          });
          applyMetadataToSong(song, {
            title: native.title,
            artist: native.artist,
            album: native.album,
            trackNumber: native.trackNumber,
            duration: native.duration,
            sampleRate: native.sampleRate,
            channels: native.channels,
            bitDepth: native.bitDepth,
            codec: native.codec,
            genre: native.genre || null,
            replayGainDb: native.replayGainDb,
            coverPath: native.coverPath || 'none',
            coverUrl: null
          }, fallback, true);
        } catch (error) {
          failed++;
          song.metadataLoaded = true;
          console.warn(`No se pudieron leer los metadatos de ${song.file?.name || song.title}:`, error);
        } finally {
          completed++;
          updateScanProgress({
            label: `${label}: ${completed} de ${songs.length}${failed ? ` (${failed} con errores)` : ''}`,
            completed,
            total: songs.length
          });
        }
      }
    }
  }

  // --- Web / File API: parsers JS con concurrencia limitada ---
  let nextWeb = 0;
  const webWorker = async () => {
    while (nextWeb < webSongs.length && !activeLibraryScan?.cancelled) {
      const song = webSongs[nextWeb++];
      try {
        const fallback = getFallbackMetadata(song.file);
        const metadata = await extractMetadata(song.file);
        applyMetadataToSong(song, {
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          trackNumber: metadata.trackNumber,
          duration: metadata.duration,
          sampleRate: metadata.sampleRate,
          channels: metadata.channels,
          bitDepth: metadata.bitDepth,
          codec: metadata.codec,
          genre: metadata.genre || null,
          replayGainDb: metadata.replayGainDb,
          coverPath: null,
          coverUrl: metadata.coverUrl || null
        }, fallback, false);
      } catch (error) {
        failed++;
        song.metadataLoaded = true;
        console.warn(`No se pudieron leer los metadatos de ${song.file?.name || song.title}:`, error);
      } finally {
        completed++;
        updateScanProgress({
          label: `${label}: ${completed} de ${songs.length}${failed ? ` (${failed} con errores)` : ''}`,
          completed,
          total: songs.length
        });
      }
    }
  };
  if (webSongs.length > 0) {
    await Promise.all(Array.from({ length: Math.min(4, webSongs.length) }, webWorker));
  }

  if (activeLibraryScan?.cancelled) {
    songs.forEach(song => {
      if (!song.metadataLoaded) song.metadataLoaded = true;
    });
  }
  return failed;
}
