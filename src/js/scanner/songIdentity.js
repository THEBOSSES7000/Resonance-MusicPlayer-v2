// Biblioteca · Identificadores estables de canciones y favoritos.

import { state } from '../state.js';

/** IDs estables: nunca se reasignan al reordenar la biblioteca. */
let nextSongId = 1;

export function assignStableSongId(song) {
  if (!song) return;
  if (song.id == null || song.id === '') {
    song.id = nextSongId++;
  } else if (typeof song.id === 'number' && song.id >= nextSongId) {
    nextSongId = song.id + 1;
  }
}

export function ensureStableIdsForLibrary() {
  let maxId = 0;
  for (const song of state.localMusicFiles) {
    if (typeof song.id === 'number' && song.id > maxId) maxId = song.id;
  }
  nextSongId = Math.max(nextSongId, maxId + 1);
  for (const song of state.localMusicFiles) {
    assignStableSongId(song);
  }
}

function normalizeFavoritePath(path) {
  return String(path || '').replace(/\\/g, '/').toLowerCase();
}

export function songIsFavorite(song, favoriteKeys) {
  if (!favoriteKeys || !favoriteKeys.size) return Boolean(song?.isFavorite);
  const path = song?.file?.path || song?.path;
  if (path && favoriteKeys.has(`path:${normalizeFavoritePath(path)}`)) return true;
  const legacy = `${song?.title || ''}:::${song?.artist || ''}`;
  return favoriteKeys.has(legacy) || Boolean(song?.isFavorite);
}

function favoriteKeyForSong(song) {
  const path = song?.file?.path || song?.path;
  if (path) return `path:${normalizeFavoritePath(path)}`;
  const title = (song?.title || '').trim();
  const artist = (song?.artist || '').trim();
  return title || artist ? `${title}:::${artist}` : '';
}

function readFavoriteAddedAtMap() {
  try {
    const raw = JSON.parse(localStorage.getItem('pn_favorites_added_at') || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

export function applyFavoriteAddedAt(song) {
  if (!song?.isFavorite) {
    if (song) delete song.favoriteAddedAt;
    return song;
  }
  const key = favoriteKeyForSong(song);
  const map = readFavoriteAddedAtMap();
  const ts = Number(map[key]) || Number(song.favoriteAddedAt) || 0;
  if (ts > 0) song.favoriteAddedAt = ts;
  return song;
}
