// Biblioteca · Caché de letras en memoria.

import { state } from '../state.js';

export const METADATA_PARSER_VERSION = 3;

/** Cola FIFO para mantener en RAM solo las letras de las últimas N pistas consultadas/reproducidas */
export const loadedLyricsSongs = [];

const MAX_CACHED_LYRICS_IN_RAM = 10;

export function trackLoadedLyricsInRam(song) {
  if (!song || !song.lyrics) return;
  const existingIdx = loadedLyricsSongs.indexOf(song);
  if (existingIdx !== -1) loadedLyricsSongs.splice(existingIdx, 1);
  loadedLyricsSongs.push(song);

  const currentPlaying = state.currentTrackIndex >= 0
    ? state.activeQueue[state.currentTrackIndex]
    : null;

  while (loadedLyricsSongs.length > MAX_CACHED_LYRICS_IN_RAM) {
    const oldest = loadedLyricsSongs.shift();
    if (!oldest) break;
    if (oldest === currentPlaying || oldest === song) {
      loadedLyricsSongs.push(oldest);
      if (loadedLyricsSongs.length <= MAX_CACHED_LYRICS_IN_RAM + 1) break;
      continue;
    }
    oldest.lyrics = null;
    oldest.lyricsLoaded = false;
  }
}
