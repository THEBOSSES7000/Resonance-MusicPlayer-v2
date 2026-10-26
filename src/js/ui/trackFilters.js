// UI · Filtros de canciones, calidad de audio y búsqueda dentro de listas.

import { state } from '../state.js';
import { uiVars } from './sharedState.js';
import { tracksFilterArtist, tracksFilterField, tracksFilterTrigger } from './dom.js';
import { normalizeSongPath } from './favorites.js';

let activeTrackFilterContextKey = null;

function trackFilterContextKey() {
  if (state.currentView === 'playlist') return `playlist:${state.currentPlaylistId}`;
  if (state.currentView === 'folder-detail') return `folder:${state.currentFolderId}`;
  if (state.currentView === 'queue-detail') return 'queue-detail';
  return state.currentView;
}

export function syncTrackFilterContext() {
  const contextKey = trackFilterContextKey();
  if (activeTrackFilterContextKey === contextKey) return;
  activeTrackFilterContextKey = contextKey;
  uiVars.activeTrackFilter = { field: 'all', value: '' };
  uiVars.listSearchQuery = '';
  const listSearchInput = document.getElementById('list-local-search-input');
  if (listSearchInput) listSearchInput.value = '';
  if (tracksFilterField) tracksFilterField.value = uiVars.activeTrackFilter.field;
  if (tracksFilterArtist) {
    tracksFilterArtist.value = '';
    tracksFilterArtist.hidden = uiVars.activeTrackFilter.field !== 'artist';
  }
  syncFilterTriggerState(tracksFilterTrigger, uiVars.activeTrackFilter.field !== 'all');
}

function getSongFileExtension(song) {
  const raw = song?.file?.name || song?.file?.path || song?.path || song?.name || '';
  const base = String(raw).split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function estimateBitrateKbps(song) {
  const size = Number(song?.file?.size || song?.size) || 0;
  const duration = Number(song?.duration) || 0;
  if (size <= 0 || duration <= 0) return 0;
  return (size * 8) / (duration * 1000);
}

function trackQuality(song) {
  if (!song) return 'unknown';
  const codec = String(song.codec || '').toLowerCase();
  const ext = getSongFileExtension(song);
  const sampleRate = Number(song.sampleRate) || 0;
  const bitDepth = Number(song.bitDepth) || 0;
  const kbps = estimateBitrateKbps(song);

  const losslessCodec = /(flac|wav(?:pack)?|alac|ape|aiff?|pcm|dsd|true\s*audio|wave)/;
  const lossyCodec = /(mp3|mpeg|aac|ogg|opus|vorbis|wma|mp4a)/;
  const losslessExt = /^(flac|wav|aiff?|ape|wv|dsf|dff|tak|tta)$/;
  const lossyExt = /^(mp3|aac|ogg|opus|wma|m4b)$/;

  let isLossless = false;
  let isLossy = false;

  if (/alac/.test(codec)) {
    isLossless = true;
  } else if (lossyCodec.test(codec)) {
    isLossy = true;
  } else if (losslessCodec.test(codec)) {
    isLossless = true;
  } else if (ext === 'm4a' || ext === 'mp4') {
    // m4a/mp4 sin ALAC explícito: se trata como comprimido (AAC)
    isLossy = true;
  } else if (losslessExt.test(ext)) {
    isLossless = true;
  } else if (lossyExt.test(ext)) {
    isLossy = true;
  }

  // Alta resolución: sample/bit conocidos, o bitrate alto en lossless (p.ej. 24/96 ~2000+ kbps)
  if (!isLossy && (sampleRate > 48000 || bitDepth > 16)) {
    return 'hires';
  }
  if (isLossless) {
    if (kbps >= 1500) return 'hires';
    return 'lossless';
  }
  if (isLossy) return 'lossy';
  // Desconocido: si el bitrate es muy alto, tratar como hires; si parece FLAC por tamaño, lossless
  if (kbps >= 1500 && (ext === 'flac' || losslessExt.test(ext))) return 'hires';
  if (losslessExt.test(ext)) return 'lossless';
  return 'unknown';
}

export function matchesTrackFilter(song, filter) {
  if (!filter || filter.field === 'all') return true;
  const duration = Number(song.duration) || 0;
  if (filter.field === 'date') {
    const modified = Number(song.file?.lastModified || song.lastModified) || 0;
    return modified > 0 && Date.now() - modified <= 30 * 24 * 60 * 60 * 1000;
  }
  if (filter.field === 'folder') {
    const target = String(filter.value || '').trim().toLowerCase();
    if (!target) return false;
    const songFolder = String(song.folderName || '').trim().toLowerCase();
    if (songFolder && songFolder === target) return true;
    const folder = (state.configuredFolders || []).find(
      item => String(item?.name || '').trim().toLowerCase() === target
    );
    if (folder?.path) {
      const songPath = normalizeSongPath(song);
      const folderPath = String(folder.path).replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
      if (songPath && folderPath && (songPath === folderPath || songPath.startsWith(folderPath + '/'))) {
        return true;
      }
    }
    // También aceptar coincidencia por segmento de ruta (webkitRelativePath / path)
    const rel = String(song.file?.webkitRelativePath || song.path || '').replace(/\\/g, '/').toLowerCase();
    if (rel && (rel.startsWith(target + '/') || rel.includes('/' + target + '/'))) return true;
    return false;
  }
  if (filter.field === 'quality-lossless') {
    const quality = trackQuality(song);
    return quality === 'lossless' || quality === 'hires';
  }
  if (filter.field === 'quality-hires') return trackQuality(song) === 'hires';
  if (filter.field === 'quality-lossy') return trackQuality(song) === 'lossy';
  if (filter.field === 'duration-short') return duration > 0 && duration < 180;
  if (filter.field === 'duration-medium') return duration >= 180 && duration <= 360;
  if (filter.field === 'duration-long') return duration > 360;
  if (filter.field === 'lyrics-synced') return song.lyrics?.isSynced === true;
  if (filter.field === 'artist') {
    const artist = String(song.artist || '').toLocaleLowerCase();
    return Boolean(filter.value) && artist.includes(String(filter.value).trim().toLocaleLowerCase());
  }
  if (filter.field === 'genre') {
    const genre = String(song.genre || '').toLocaleLowerCase();
    return Boolean(filter.value) && genre.includes(String(filter.value).trim().toLocaleLowerCase());
  }
  return true;
}

export function matchesListSearch(song, query = uiVars.listSearchQuery) {
  const q = String(query || '').trim().toLocaleLowerCase();
  if (!q) return true;
  if (!song) return false;
  const hay = [song.title, song.artist, song.album, song.albumArtist]
    .map(v => String(v || '').toLocaleLowerCase())
    .join(' ');
  return hay.includes(q);
}

export function setFilterPopoverOpen(trigger, popover, isOpen) {
  if (!trigger || !popover) return;
  popover.hidden = !isOpen;
  trigger.setAttribute('aria-expanded', String(isOpen));
}

export function syncFilterTriggerState(trigger, isActive) {
  trigger?.classList.toggle('has-active-filter', isActive);
  trigger?.setAttribute('aria-label', isActive ? 'Abrir filtros activos' : 'Abrir filtros');
}
