// UI · Tarjetas de canción y acciones de reproducción desde ellas.

import { getSongByIdOrPath, resolveSongRef, state } from '../state.js';
import { isPlaybackPaused, loadSong, resolveManualAutoPlay, togglePlay } from '../audioPlayer.js';
import { escapeHtml, getSoundWaveHTML } from './uiUtils.js';
import { bindLazyCover } from './covers.js';
import { handleSongSelectionClick } from './selection.js';
import { renderHistoryUI, renderQueue, updateQueuePositionIndicator } from './queueHistory.js';
import { ensureSongMetadata, playFromContext } from './playback.js';

export function createSongCard(song, onPlayCallback, contextType = "") {
  const card = document.createElement('div');
  card.className = 'song-card';
  card.dataset.id = song.id;
  card.dataset.context = contextType;

  const coverHtml = `
    <i class="ph ph-waveform cover-placeholder-icon"></i>
    <img alt="" class="song-cover-img" width="1" height="1" />
  `;

  const isCurrent = state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]?.id === song.id;
  const isExactOrigin = isCurrent && contextType === state.activeContextId;
  const isPlaying = isExactOrigin && !isPlaybackPaused();

  if (isExactOrigin) {
    card.classList.add('is-active');
  } else if (isCurrent) {
    card.classList.add('is-playing-elsewhere');
  }

  const soundwaveBadgeHtml = isExactOrigin 
    ? `<div class="card-soundwave-badge">${getSoundWaveHTML(!isPlaying)}</div>` 
    : ``;
  const favoriteBadgeHtml = song.isFavorite
    ? '<span class="card-favorite-badge" title="En favoritos" aria-label="En favoritos"><i class="ph-fill ph-heart" aria-hidden="true"></i></span>'
    : ''; // keep heart on cards

  card.innerHTML = `
    <div class="card-img-wrap${song.isFavorite ? ' has-favorite' : ''}">
      ${soundwaveBadgeHtml}
      ${coverHtml}${favoriteBadgeHtml}
      <button class="card-play-hover" title="Reproducir / Pausar">
        <i class="${isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'}"></i>
      </button>
    </div>
    <h4>${escapeHtml(song.title)}</h4>
    <p>${escapeHtml(song.artist)}</p>
  `;

  const coverImg = card.querySelector('.song-cover-img');
  const coverIcon = card.querySelector('.cover-placeholder-icon');
  if (coverImg) {
    bindLazyCover(coverImg, song);
    coverImg.addEventListener('load', () => {
      if (coverIcon) coverIcon.hidden = true;
    }, { once: true });
  }

  const playHoverBtn = card.querySelector('.card-play-hover');
  playHoverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playSongCard(song, contextType, onPlayCallback);
  });

  card.addEventListener('click', (e) => {
    if (handleSongSelectionClick(card, e)) return;
    playSongCard(song, contextType, onPlayCallback);
  });

  updateQueuePositionIndicator(card, song);

  if (!song.metadataLoaded) {
    ensureSongMetadata(song);
  }

  return card;
}

function playSongCard(song, contextType, onPlayCallback) {
  const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
  if (currentSong?.id === song.id && state.activeContextId === contextType) {
    togglePlay();
    return;
  }
  onPlayCallback();
}

/** Asegura un objeto de canción con path real de biblioteca (path/id).
 *  No usa título salvo último recurso y solo si el resultado tiene path. */
export function ensurePlayableSong(song) {
  if (!song) return song;
  const path = song.file?.path || song.path;
  if (path) {
    try {
      const byPath = getSongByIdOrPath(path);
      if (byPath) return byPath;
    } catch (_) {}
    return song;
  }
  if (song.id != null && song.id !== '') {
    try {
      const byId = getSongByIdOrPath(song.id);
      if (byId) return byId;
    } catch (_) {}
  }
  try {
    const byRef = resolveSongRef(song);
    if (byRef && (byRef.file?.path || byRef.path)) return byRef;
  } catch (_) {}
  return song;
}

export function getSearchPlayBehavior() {
  return localStorage.getItem('pn_search_play_behavior') === 'replace_queue'
    ? 'replace_queue'
    : 'replace_current';
}

/**
 * Reemplaza solo la canción actual por `song`.
 * La canción que estaba sonando pasa a "Reproducidas".
 * El resto de la cola se mantiene.
 */
export function playSongReplacingCurrent(song, contextTitle = 'Búsqueda') {
  const playable = ensurePlayableSong(song) || song;
  if (!playable) return;

  if (!Array.isArray(state.activeQueue) || state.activeQueue.length === 0 || state.currentTrackIndex < 0) {
    playFromContext([playable], 0, contextTitle, true, 'search_replace_current', false, true);
    return;
  }

  const idx = state.currentTrackIndex;
  const previous = state.activeQueue[idx];
  if (previous) {
    const prevPath = String(previous.file?.path || previous.path || '').toLowerCase();
    const nextPath = String(playable.file?.path || playable.path || '').toLowerCase();
    if (prevPath && nextPath && prevPath === nextPath) {
      togglePlay();
      return;
    }
    if (state.playbackHistory.length === 0 || state.playbackHistory[0] !== previous) {
      state.playbackHistory.unshift(previous);
      if (state.playbackHistory.length > 100) state.playbackHistory.length = 100;
    }
  }

  state.activeQueue[idx] = playable;
  // No vaciar historial ni rearmar toda la cola
  if (typeof loadSong === 'function') {
    loadSong(idx, resolveManualAutoPlay(true), false);
  }
  try { renderQueue(); } catch (_) {}
  try { renderHistoryUI(); } catch (_) {}
}

export function playSongFromContext(songs, index, title, contextId) {
  if (!Array.isArray(songs) || index < 0 || index >= songs.length) return;
  // Misma longitud/orden que la UI; cada slot con path de biblioteca si existe
  const queue = songs.map(s => ensurePlayableSong(s) || s);
  const selectedSong = ensurePlayableSong(songs[index]) || songs[index];
  if (!selectedSong) return;
  queue[index] = selectedSong;

  const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
  const sameContext = state.activeContextId === contextId;

  // Misma fila otra vez (sin shuffle) → play/pausa
  if (sameContext && !state.isShuffle && state.currentTrackIndex === index) {
    togglePlay();
    return;
  }
  if (sameContext && state.isShuffle && currentSong) {
    const a = String(currentSong.file?.path || currentSong.path || '').toLowerCase();
    const b = String(selectedSong.file?.path || selectedSong.path || '').toLowerCase();
    if (a && b && a === b) {
      togglePlay();
      return;
    }
  }
  playFromContext(queue, index, title, true, contextId);
}
