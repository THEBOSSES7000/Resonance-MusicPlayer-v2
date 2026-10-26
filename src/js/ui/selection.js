// UI · Selección múltiple de canciones y barra de selección.

import { persistPlaylists, state } from '../state.js';
import { showConfirmDialog } from './uiUtils.js';
import { songsMatch } from './favorites.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { uiVars } from './sharedState.js';

let songSelectionAnchor = null;

export function clearSongSelection() {
  document.querySelectorAll('.song-card.is-multi-selected, .playlist-table-row.is-multi-selected')
    .forEach(element => element.classList.remove('is-multi-selected'));
  songSelectionAnchor = null;
  updateSelectionBar();
}

function getMultiSelectedSongs() {
  return [...document.querySelectorAll('.song-card.is-multi-selected, .playlist-table-row.is-multi-selected')]
    .map(getSongForSelectableElement)
    .filter(Boolean);
}

export function updateSelectionBar() {
  ensureSelectionBar();
  const bar = document.getElementById('song-selection-bar');
  if (!bar) return;

  const selectedEls = [...document.querySelectorAll('.song-card.is-multi-selected, .playlist-table-row.is-multi-selected')];
  const count = selectedEls.length;
  if (count === 0) {
    bar.hidden = true;
    document.body.classList.remove('has-song-selection');
    return;
  }

  const containers = new Set(
    selectedEls.map(el => el.closest('.playlist-table-body, .grid-cards, .search-results, #playlist-tracks-body')).filter(Boolean)
  );
  let total = 0;
  containers.forEach(container => {
    total += container.querySelectorAll('.song-card, .playlist-table-row').length;
  });
  if (total < count) total = count;

  const countEl = document.getElementById('song-selection-count-text');
  if (countEl) {
    countEl.textContent = total > count
      ? `${count} de ${total} seleccionadas`
      : `${count} seleccionada${count === 1 ? '' : 's'}`;
  }
  bar.hidden = false;
  document.body.classList.add('has-song-selection');
}

let selectionBarEscapeBound = false;

function ensureSelectionBar() {
  let bar = document.getElementById('song-selection-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'song-selection-bar';
    bar.className = 'song-selection-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = `
      <span class="song-selection-count" id="song-selection-count-text">0 seleccionadas</span>
      <button type="button" class="song-selection-clear" id="btn-clear-song-selection" title="Deseleccionar todo" aria-label="Deseleccionar todo">
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    `;
    // Preferir el área principal de contenido para anclarlo visualmente al menú
    const host = document.querySelector('.main-content') || document.body;
    host.appendChild(bar);
    bar.querySelector('#btn-clear-song-selection')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearSongSelection();
    });
  }

  if (!selectionBarEscapeBound) {
    selectionBarEscapeBound = true;
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element) {
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      }
      const selected = document.querySelector('.song-card.is-multi-selected, .playlist-table-row.is-multi-selected');
      if (!selected) return;
      event.preventDefault();
      clearSongSelection();
    });
  }
}

export async function removeSongsFromCurrentPlaylist(songs) {
  if (!Array.isArray(songs) || songs.length === 0) return;
  if (state.currentView !== 'playlist') return;
  const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);
  if (!playlist || playlist.smartFilter) return;

  const title = playlist.title || 'esta playlist';
  const proceed = await showConfirmDialog({
    title: songs.length > 1 ? '¿Quitar canciones de la playlist?' : '¿Quitar canción de la playlist?',
    message: songs.length > 1
      ? `Se quitarán ${songs.length} canciones de «${title}». ¿Deseas continuar?`
      : `Se quitará «${songs[0]?.title || 'esta canción'}» de «${title}». ¿Deseas continuar?`,
    confirmText: 'Quitar',
    cancelText: 'Cancelar'
  });
  if (!proceed) return;

  const before = Array.isArray(playlist.songs) ? playlist.songs : [];
  playlist.songs = before.filter(track => !songs.some(selected => songsMatch(track, selected)));
  persistPlaylists();
  clearSongSelection();
  renderPlaylistDetailView();
  updateSelectionBar();
}

export function handleSongSelectionClick(element, event) {
  const isMultiSelect = event.ctrlKey || event.metaKey || event.shiftKey;
  if (!isMultiSelect) {
    clearSongSelection();
    return false;
  }

  event.preventDefault();
  const container = element.closest('.playlist-table-body, .grid-cards');
  const siblings = container
    ? [...container.querySelectorAll('.song-card, .playlist-table-row')]
    : [element];

  if (event.shiftKey && songSelectionAnchor?.isConnected && songSelectionAnchor.parentElement === container) {
    const anchorIndex = siblings.indexOf(songSelectionAnchor);
    const targetIndex = siblings.indexOf(element);
    if (!event.ctrlKey && !event.metaKey) clearSongSelection();
    if (anchorIndex !== -1 && targetIndex !== -1) {
      siblings.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        .forEach(item => item.classList.add('is-multi-selected'));
    } else {
      element.classList.add('is-multi-selected');
    }
  } else if (event.ctrlKey || event.metaKey) {
    element.classList.toggle('is-multi-selected');
  } else {
    clearSongSelection();
    element.classList.add('is-multi-selected');
  }

  songSelectionAnchor = element;
  updateSelectionBar();
  return true;
}

/** Búsqueda O(1) prioritaria en state.songsById */
export function getSongForSelectableElement(element) {
  if (!element) return null;
  const rawId = element.dataset.id || element.dataset.songId;
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const strId = String(rawId);
  const numId = Number(rawId);

  if (state.songsById && typeof state.songsById.get === 'function') {
    const byStr = state.songsById.get(strId);
    if (byStr) return byStr;
    if (!Number.isNaN(numId)) {
      const byNum = state.songsById.get(numId);
      if (byNum) return byNum;
    }
  }

  const trackIdx = Number(element.dataset.trackIdx);
  if (Number.isInteger(trackIdx) && trackIdx >= 0) {
    if (state.currentView === 'search') {
      const candidate = state.searchTab === 'queue'
        ? state.activeQueue[trackIdx]
        : uiVars.renderedSearchSongsList[trackIdx];
      if (candidate && String(candidate.id) === strId) return candidate;
    } else if (uiVars.renderedTrackList[trackIdx] && String(uiVars.renderedTrackList[trackIdx].id) === strId) {
      return uiVars.renderedTrackList[trackIdx];
    }
  }

  const foundLocal = state.localMusicFiles.find(song => String(song.id) === strId);
  if (foundLocal) {
    if (state.songsById && typeof state.songsById.set === 'function') {
      state.songsById.set(strId, foundLocal);
    }
    return foundLocal;
  }

  const foundQueue = state.activeQueue.find(song => String(song.id) === strId);
  if (foundQueue) return foundQueue;

  for (let i = 0; i < state.playlists.length; i++) {
    const plSongs = state.playlists[i]?.songs;
    if (!Array.isArray(plSongs)) continue;
    const foundPl = plSongs.find(song => String(song.id) === strId);
    if (foundPl) return foundPl;
  }
  return null;
}

export function getSelectedSongs(clickedElement, clickedSong) {
  if (!clickedElement.classList.contains('is-multi-selected')) return [clickedSong];
  const selectedElements = [...document.querySelectorAll(
    '.song-card.is-multi-selected, .playlist-table-row.is-multi-selected'
  )];
  return selectedElements.map(getSongForSelectableElement).filter(Boolean);
}
