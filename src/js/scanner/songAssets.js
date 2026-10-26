// Biblioteca · Letras, carátulas y detalles técnicos bajo demanda.

import { trackLoadedLyricsInRam } from './lyricsCache.js';
import { parseLyricsText } from './lyricsParsing.js';
import { extractMetadata } from './extractMetadata.js';
import { getSongByIdOrPath, resolveCoverUrl } from '../state.js';

export async function ensureSongLyrics(song) {
  if (!song) return null;
  if (song.lyricsLoaded) {
    trackLoadedLyricsInRam(song);
    return song.lyrics || null;
  }
  if (song.lyrics) {
    song.lyricsLoaded = true;
    trackLoadedLyricsInRam(song);
    return song.lyrics;
  }

  try {
    if (song.file?.isNativeFile && song.file.path && window.__TAURI__?.core?.invoke) {
      const native = await window.__TAURI__.core.invoke('scan_file_metadata', {
        path: song.file.path,
        includeLyrics: true
      });
      if (native?.lyrics) {
        const parsed = parseLyricsText(native.lyrics);
        song.lyrics = parsed || { isSynced: false, lines: String(native.lyrics).split(/\r?\n/).filter(Boolean) };
      } else {
        song.lyrics = null;
      }
      if (!song.techLoaded && native) {
        song.sampleRate = native.sampleRate ?? null;
        song.channels = native.channels ?? null;
        song.bitDepth = native.bitDepth ?? null;
        song.codec = native.codec ?? null;
        if (native.genre) song.genre = native.genre;
        song.techLoaded = Boolean(song.sampleRate || song.bitDepth || song.codec);
        if (native.replayGainDb != null) song.replayGainDb = native.replayGainDb;
        song.techLoaded = true;
      }
    } else if (song.file && typeof song.file.slice === 'function') {
      const meta = await extractMetadata(song.file);
      if (meta.lyrics) song.lyrics = meta.lyrics;
      if (!song.techLoaded) {
        song.sampleRate = meta.sampleRate ?? null;
        song.channels = meta.channels ?? null;
        song.bitDepth = meta.bitDepth ?? null;
        song.codec = meta.codec ?? null;
        song.techLoaded = true;
      }
    }
  } catch (error) {
    console.warn('No se pudieron cargar las letras bajo demanda:', error);
  } finally {
    song.lyricsLoaded = true;
    trackLoadedLyricsInRam(song);
  }
  return song.lyrics || null;
}

/** Asegura la carátula solo si aún no fue resuelta ni marcada como inexistente ('none'). */
export async function ensureSongCover(song) {
  if (!song || song.coverPath === 'none') return null;
  const existing = resolveCoverUrl(song);
  if (existing) return existing;

  try {
    if (song.file?.isNativeFile && song.file.path && window.__TAURI__?.core?.invoke) {
      const native = await window.__TAURI__.core.invoke('scan_file_metadata', {
        path: song.file.path,
        includeLyrics: false
      });
      if (native?.coverPath) {
        song.coverPath = native.coverPath;
        song.coverUrl = null;
        const lib = getSongByIdOrPath(song.file.path);
        if (lib && lib !== song) {
          lib.coverPath = native.coverPath;
          lib.coverUrl = null;
        }
        return resolveCoverUrl(song);
      } else {
        // Marcar como 'none' para no volver a invocar scan_file_metadata en pistas sin portada
        song.coverPath = 'none';
        const lib = getSongByIdOrPath(song.file.path);
        if (lib && lib !== song) lib.coverPath = 'none';
      }
    } else if (song.file && typeof song.file.slice === 'function') {
      const meta = await extractMetadata(song.file);
      if (meta.coverUrl) {
        song.coverUrl = meta.coverUrl;
        return song.coverUrl;
      } else {
        song.coverPath = 'none';
      }
    }
  } catch (error) {
    console.warn('No se pudo asegurar la carátula:', error);
  }
  return resolveCoverUrl(song);
}

export async function ensureSongTechDetails(song) {
  if (!song || song.techLoaded) return song;
  try {
    if (song.file?.isNativeFile && song.file.path && window.__TAURI__?.core?.invoke) {
      const native = await window.__TAURI__.core.invoke('scan_file_metadata', {
        path: song.file.path,
        includeLyrics: false
      });
      if (native) {
        song.sampleRate = native.sampleRate ?? null;
        song.channels = native.channels ?? null;
        song.bitDepth = native.bitDepth ?? null;
        song.codec = native.codec ?? null;
        if (native.genre) song.genre = native.genre;
        song.techLoaded = Boolean(song.sampleRate || song.bitDepth || song.codec);
        if (native.replayGainDb != null) song.replayGainDb = native.replayGainDb;
      }
    } else if (song.file && typeof song.file.slice === 'function') {
      const meta = await extractMetadata(song.file);
      song.sampleRate = meta.sampleRate ?? null;
      song.channels = meta.channels ?? null;
      song.bitDepth = meta.bitDepth ?? null;
      song.codec = meta.codec ?? null;
    }
  } catch (error) {
    console.warn('No se pudieron cargar specs técnicas:', error);
  } finally {
    song.techLoaded = true;
  }
  return song;
}
