// UI · Búsqueda incremental en la biblioteca local.

import { state } from '../state.js';

let indexedLibrary = null;
let lastQuery = '';
let lastMatches = [];

export function invalidateLibrarySongSearch() {
  indexedLibrary = null;
  lastQuery = '';
  lastMatches = [];
}

function songMatchesQuery(song, query) {
  return [song.title, song.artist, song.album]
    .some(value => String(value || '').toLocaleLowerCase().includes(query));
}

export function searchLibrarySongs(query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    lastQuery = '';
    lastMatches = [];
    indexedLibrary = state.localMusicFiles;
    return lastMatches;
  }

  const songs = state.localMusicFiles;
  const canNarrowPreviousResults = indexedLibrary === songs &&
    lastQuery.length > 0 &&
    normalizedQuery.startsWith(lastQuery);
  const candidates = canNarrowPreviousResults ? lastMatches : songs;
  if (indexedLibrary === songs && normalizedQuery === lastQuery) {
    return lastMatches;
  }

  lastMatches = candidates.filter(song => songMatchesQuery(song, normalizedQuery));
  indexedLibrary = songs;
  lastQuery = normalizedQuery;
  return lastMatches;
}
