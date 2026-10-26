// UI · Datos de playlists: canciones, fechas de agregado, portadas y modo dinámico.

import { state } from '../state.js';
import { matchesTrackFilter } from './trackFilters.js';
import { favoriteStorageKey } from './favorites.js';
import { uiVars } from './sharedState.js';
import { modalCoverPicker, modalCoverPreview, modalImportRowContainer, playlistModalOverlay, smartPlaylistSettings, smartPlaylistToggle } from './dom.js';

import { escapeHtml } from './uiUtils.js';
export function getSmartPlaylistSongs(playlist) {
  const smartFilter = playlist?.smartFilter;
  if (!smartFilter) return [];
  const filters = Array.isArray(smartFilter.filters)
    ? smartFilter.filters
    : [smartFilter];
  const operator = smartFilter.operator === 'or' ? 'or' : 'and';
  return state.localMusicFiles.filter(song => operator === 'or'
    ? filters.some(filter => matchesTrackFilter(song, filter))
    : filters.every(filter => matchesTrackFilter(song, filter))
  );
}

export function getPlaylistSongs(playlist) {
  return playlist?.smartFilter ? getSmartPlaylistSongs(playlist) : (playlist?.songs || []);
}

export function getPlaylistAddedTimestamp(song) {
  if (!song) return 0;
  const direct = Number(song.playlistAddedAt);
  if (Number.isFinite(direct) && direct > 0) return direct;
  if (typeof song.addedDate === 'string' && song.addedDate.trim()) {
    const parsed = Date.parse(song.addedDate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Number(song.file?.lastModified || song.lastModified) || 0;
}

export function formatPlaylistAddedDate(song) {
  const ts = getPlaylistAddedTimestamp(song);
  if (!ts) return song?.addedDate || '—';
  try {
    return new Date(ts).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (_) {
    return song?.addedDate || '—';
  }
}

export function stampSongForPlaylist(song, at = Date.now()) {
  if (!song) return song;
  if (Number(song.playlistAddedAt) > 0) return song;
  return { ...song, playlistAddedAt: at };
}

export function readFavoriteAddedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem('pn_favorites_added_at') || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_) {
    return {};
  }
}

export function writeFavoriteAddedMap(map) {
  try {
    localStorage.setItem('pn_favorites_added_at', JSON.stringify(map || {}));
  } catch (error) {
    console.warn('No se pudo guardar fechas de favoritos:', error);
  }
}

/** Migra favoritos viejos: asigna timestamps según el orden guardado en pn_favorites_keys. */
export function ensureFavoriteAddedTimestamps() {
  let keys = [];
  try {
    keys = JSON.parse(localStorage.getItem('pn_favorites_keys') || '[]');
  } catch (_) {
    keys = [];
  }
  if (!Array.isArray(keys) || keys.length === 0) return;
  const map = readFavoriteAddedMap();
  let changed = false;
  const base = Date.now();
  keys.forEach((key, index) => {
    if (!key || Number(map[key]) > 0) return;
    // Los primeros de la lista se consideran agregados antes
    map[key] = base - (keys.length - index) * 1000;
    changed = true;
  });
  if (changed) writeFavoriteAddedMap(map);
}

export function getFavoriteAddedTimestamp(song) {
  if (!song) return 0;
  const direct = Number(song.favoriteAddedAt);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const key = favoriteStorageKey(song);
  if (!key) return 0;
  const fromMap = Number(readFavoriteAddedMap()[key]);
  return Number.isFinite(fromMap) && fromMap > 0 ? fromMap : 0;
}

export function formatFavoriteAddedDate(song) {
  const ts = getFavoriteAddedTimestamp(song);
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (_) {
    return '—';
  }
}

function applyFavoriteAddedTimestampToSong(song, timestamp) {
  if (!song || !(Number(timestamp) > 0)) return;
  song.favoriteAddedAt = Number(timestamp);
}

export function clearTempPlaylistCover() {
  if (uiVars.tempCoverFile && uiVars.tempModalCoverUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(uiVars.tempModalCoverUrl);
  }
  uiVars.tempCoverFile = null;
  uiVars.tempModalCoverUrl = null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('No se pudo leer la imagen de portada.'));
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen de portada.'));
    reader.readAsDataURL(file);
  });
}

export async function persistPlaylistCover(playlistId) {
  if (!uiVars.tempCoverFile) return uiVars.tempModalCoverUrl;
  const tauriCore = window.__TAURI__?.core;
  if (typeof tauriCore?.invoke === 'function' && typeof tauriCore.convertFileSrc === 'function') {
    const extensionsByMime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif'
    };
    const fileExtension = uiVars.tempCoverFile.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    const extension = extensionsByMime[uiVars.tempCoverFile.type] || fileExtension;
    if (!extension || !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
      throw new Error('Formato de imagen no válido. Usa JPG, PNG, WEBP o GIF.');
    }
    const imageData = Array.from(new Uint8Array(await uiVars.tempCoverFile.arrayBuffer()));
    const savedPath = await tauriCore.invoke('save_playlist_cover', {
      playlistId: String(playlistId),
      imageData,
      extension
    });
    return tauriCore.convertFileSrc(savedPath);
  }
  return fileToDataUrl(uiVars.tempCoverFile);
}

export function setPlaylistModalDynamicMode(isDynamic) {
  playlistModalOverlay.dataset.mode = isDynamic ? 'smart' : 'manual';
  smartPlaylistToggle?.setAttribute('aria-pressed', String(isDynamic));
  smartPlaylistToggle?.classList.toggle('active', isDynamic);
  smartPlaylistSettings.hidden = !isDynamic;
  // Portada también en playlists dinámicas
  if (modalCoverPicker) modalCoverPicker.style.display = '';
  modalImportRowContainer.style.display = state.editingPlaylistId === null && !isDynamic ? 'flex' : 'none';
  if (isDynamic) {
    document.getElementById('btn-find-imported-songs').hidden = true;
  }
  if (uiVars.tempModalCoverUrl) {
    modalCoverPreview.innerHTML = `<img src="${escapeHtml(uiVars.tempModalCoverUrl)}" class="modal-preview-img" alt="Cover" />`;
  } else if (isDynamic) {
    modalCoverPreview.innerHTML = '<i class="ph ph-lightning"></i>';
  } else {
    modalCoverPreview.innerHTML = '<i class="ph ph-music-notes"></i>';
  }
}
