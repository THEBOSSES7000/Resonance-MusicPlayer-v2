// UI · Orden de canciones, carpetas y playlists (modos y dirección persistidos).

import { state } from '../state.js';
import { currentTrackSortLabel, trackSortMenu } from './dom.js';

/** none | global | per_view | per_item — ordenamiento de listas */
export function getSortPersistMode() {
  const mode = localStorage.getItem('pn_sort_persist_mode') || 'global';
  return ['none', 'global', 'per_view', 'per_item'].includes(mode) ? mode : 'global';
}

/** Dirección de orden: al re-elegir la misma opción se invierte (asc ↔ desc). */
export function defaultTrackSortDir(mode) {
  if (mode === 'title' || mode === 'track' || mode === 'custom' || mode === 'name') return 'asc';
  return 'desc';
}

function getTrackSortDirStorageKey() {
  if (state.currentView === 'artist') return 'pn_sort_dir_artist';
  if (state.currentView === 'album-detail') return 'pn_sort_dir_album';
  if (state.currentView === 'all-music') return 'pn_sort_dir_music';
  if (state.currentView === 'folder-detail') return 'pn_sort_dir_folder';
  if (state.currentView === 'playlist' || state.currentView === 'favorites') return 'pn_sort_dir_playlist';
  return 'pn_sort_dir_tracks';
}

export function ensureTrackSortDirState() {
  const key = getTrackSortDirStorageKey();
  const saved = localStorage.getItem(key);
  if (state.currentView === 'artist') {
    if (state.artistSortDir !== 'asc' && state.artistSortDir !== 'desc') {
      state.artistSortDir = (saved === 'asc' || saved === 'desc') ? saved : defaultTrackSortDir(state.artistSortMode);
    }
  } else if (state.currentView === 'album-detail') {
    if (state.albumSortDir !== 'asc' && state.albumSortDir !== 'desc') {
      state.albumSortDir = (saved === 'asc' || saved === 'desc') ? saved : defaultTrackSortDir(state.albumSortMode);
    }
  } else if (state.trackSortDir !== 'asc' && state.trackSortDir !== 'desc') {
    state.trackSortDir = (saved === 'asc' || saved === 'desc') ? saved : defaultTrackSortDir(state.trackSortMode);
  }
}

function getActiveTrackSortDir() {
  ensureTrackSortDirState();
  if (state.currentView === 'artist') return state.artistSortDir === 'asc' ? 'asc' : 'desc';
  if (state.currentView === 'album-detail') return state.albumSortDir === 'asc' ? 'asc' : 'desc';
  return state.trackSortDir === 'asc' ? 'asc' : 'desc';
}

export function persistActiveTrackSortDir(dir) {
  const d = dir === 'asc' ? 'asc' : 'desc';
  localStorage.setItem(getTrackSortDirStorageKey(), d);
  if (state.currentView === 'artist') state.artistSortDir = d;
  else if (state.currentView === 'album-detail') state.albumSortDir = d;
  else state.trackSortDir = d;
}

export function trackSortMul() {
  return getActiveTrackSortDir() === 'asc' ? 1 : -1;
}

function getActiveTrackSortModeName() {
  if (state.currentView === 'artist') return state.artistSortMode || 'plays';
  if (state.currentView === 'album-detail') return state.albumSortMode || 'track';
  return state.trackSortMode || 'title';
}

function isTrackSortDirInverted() {
  return getActiveTrackSortDir() !== defaultTrackSortDir(getActiveTrackSortModeName());
}

/** Muestra flecha junto al texto de "Ordenar por" si el orden está invertido. */
export function updateTrackSortLabelUI(baseText) {
  if (!currentTrackSortLabel) return;
  ensureTrackSortDirState();
  let text = String(baseText || '').trim();
  if (!text) {
    text = String(currentTrackSortLabel.getAttribute('data-base-label') || currentTrackSortLabel.textContent || '').trim();
  }
  // Quitar iconos/flechas previas del texto
  text = text.replace(/\s*[↑↓⇅].*$/u, '').trim();
  currentTrackSortLabel.setAttribute('data-base-label', text);
  currentTrackSortLabel.replaceChildren();
  currentTrackSortLabel.append(document.createTextNode(text));
  if (isTrackSortDirInverted()) {
    const dir = getActiveTrackSortDir();
    const icon = document.createElement('i');
    icon.className = dir === 'asc' ? 'ph ph-arrow-up' : 'ph ph-arrow-down';
    icon.setAttribute('aria-hidden', 'true');
    icon.style.marginLeft = '0.35em';
    icon.style.fontSize = '0.95em';
    icon.style.opacity = '0.9';
    currentTrackSortLabel.appendChild(icon);
    currentTrackSortLabel.title = dir === 'asc'
      ? 'Orden invertido (ascendente)'
      : 'Orden invertido (descendente)';
    currentTrackSortLabel.dataset.sortInverted = 'true';
  } else {
    currentTrackSortLabel.title = '';
    currentTrackSortLabel.dataset.sortInverted = 'false';
  }
  // Marcar opción activa del menú
  trackSortMenu?.querySelectorAll('.sort-option').forEach(opt => {
    const isActive = opt.classList.contains('active');
    let mark = opt.querySelector('.sort-dir-mark');
    if (isActive && isTrackSortDirInverted()) {
      if (!mark) {
        mark = document.createElement('i');
        mark.className = 'sort-dir-mark ph ' + (getActiveTrackSortDir() === 'asc' ? 'ph-arrow-up' : 'ph-arrow-down');
        mark.style.marginLeft = '0.4em';
        opt.appendChild(mark);
      } else {
        mark.className = 'sort-dir-mark ph ' + (getActiveTrackSortDir() === 'asc' ? 'ph-arrow-up' : 'ph-arrow-down');
      }
    } else if (mark) {
      mark.remove();
    }
  });
}

function getTrackSortStorageKey(mode = getSortPersistMode()) {
  if (mode === 'global') return 'pn_sort_tracks_global';
  if (mode === 'per_item' && state.currentView === 'playlist' && state.currentPlaylistId != null) {
    return `pn_sort_tracks_playlist_${encodeURIComponent(String(state.currentPlaylistId))}`;
  }
  if (mode === 'per_item' && state.currentView === 'folder-detail' && state.currentFolderId != null) {
    return `pn_sort_tracks_folder_${encodeURIComponent(String(state.currentFolderId))}`;
  }
  if (state.currentView === 'favorites') return 'pn_sort_tracks_favorites';
  if (state.currentView === 'playlist') return 'pn_sort_tracks_playlist';
  if (state.currentView === 'folder-detail') return 'pn_sort_tracks_folder';
  return 'pn_sort_tracks_music';
}

export function persistTrackSortMode(mode) {
  const persist = getSortPersistMode();
  if (persist === 'none') return;
  localStorage.setItem(getTrackSortStorageKey(persist), mode);
}

export function loadTrackSortModeForView() {
  const persist = getSortPersistMode();
  if (persist === 'none') return;
  const saved = localStorage.getItem(getTrackSortStorageKey(persist));
  if (saved) {
    state.trackSortMode = saved;
    return;
  }
  if (persist === 'per_item') {
    const sharedSaved = localStorage.getItem(getTrackSortStorageKey('per_view'));
    if (sharedSaved) {
      state.trackSortMode = sharedSaved;
    } else if (state.currentView === 'playlist' || state.currentView === 'folder-detail') {
      state.trackSortMode = 'custom';
    }
  }
}

export function persistFolderSortMode(mode) {
  if (getSortPersistMode() === 'none') return;
  localStorage.setItem('pn_sort_folders', mode);
}

export function loadFolderSortMode() {
  if (getSortPersistMode() === 'none') return;
  const saved = localStorage.getItem('pn_sort_folders');
  if (saved) state.folderSortMode = saved;
}

export function persistPlaylistsViewSortMode(mode) {
  if (getSortPersistMode() === 'none') return;
  localStorage.setItem('pn_sort_playlists_hub', mode);
}

export function loadPlaylistsViewSortMode() {
  if (getSortPersistMode() === 'none') return;
  const saved = localStorage.getItem('pn_sort_playlists_hub');
  if (saved) state.playlistsViewSortMode = saved;
}

export function persistSidebarPlaylistSortMode(mode) {
  if (getSortPersistMode() === 'none') return;
  localStorage.setItem('pn_sort_mode', mode);
}
