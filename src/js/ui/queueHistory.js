// UI · Cola de reproducción e historial.

import { state } from '../state.js';
import { escapeHtml, getSoundWaveHTML, showConfirmDialog } from './uiUtils.js';
import { playFromContext } from './playback.js';
import { addToQueue, isPlaybackPaused, loadSong, playNextInQueue, resolveManualAutoPlay } from '../audioPlayer.js';
import { getSongForSelectableElement } from './selection.js';
import { historyCountEl, queueHeaderTitle, queueHistoryList, queueItemsContainer, queueNowPlaying } from './dom.js';
import { bindListSongCover, clearContainerCovers } from './covers.js';
import { resolveCoverUrl } from '../scanner.js';
import { pnStartPointerDrag } from './dragReorder.js';
import { uiVars } from './sharedState.js';
import { renderPlaylistDetailView } from './playlistDetail.js';

export async function addSongsToQueue(songs, addNext, contextTitle = 'Cola de reproducción', contextId = 'queue') {
  const alreadyQueued = song => state.activeQueue.some(queuedSong =>
    queuedSong.id === song.id || (queuedSong.title === song.title && queuedSong.artist === song.artist)
  );
  const duplicates = songs.filter(alreadyQueued);
  let songsToAdd = songs;

  if (duplicates.length > 0) {
    const choice = await showConfirmDialog({
      title: 'Canciones que ya están en la cola',
      message: `${duplicates.length} de las canciones seleccionadas ya están en la cola. ¿Quieres agregarlas de nuevo o solo agregar las que faltan?`,
      confirmText: 'Agregar todas',
      alternateText: 'Omitir las repetidas',
      cancelText: 'Cancelar'
    });

    if (choice === false) return;
    if (choice === 'alternate') songsToAdd = songs.filter(song => !alreadyQueued(song));
  }

  if (songsToAdd.length > 0 && (state.activeQueue.length === 0 || state.currentTrackIndex === -1)) {
    const queue = songsToAdd.map((song, index) => {
      // Object.create evita clonar todo el objeto song (lyrics, covers, promesas)
      const entry = Object.create(song);
      entry.isEnqueuedNext = addNext && index > 0;
      return entry;
    });
    playFromContext(queue, 0, contextTitle, true, contextId, true);
    return;
  }

  for (const song of songsToAdd) {
    if (addNext) await playNextInQueue(song, true);
    else await addToQueue(song, true);
  }
}

function getQueuePosition(song) {
  if (state.currentTrackIndex < 0) return null;
  const queueIndex = state.activeQueue.findIndex((queuedSong, index) =>
    index > state.currentTrackIndex &&
    queuedSong.isEnqueuedNext === true &&
    (queuedSong.id === song.id || (queuedSong.title === song.title && queuedSong.artist === song.artist))
  );
  return queueIndex === -1 ? null : queueIndex - state.currentTrackIndex;
}

export function updateQueuePositionIndicator(element, song) {
  const existingBadge = element.querySelector('.queue-position-indicator');
  const position = getQueuePosition(song);
  if (!position) {
    existingBadge?.remove();
    return;
  }

  const badge = existingBadge || document.createElement('span');
  badge.className = 'queue-position-indicator';
  badge.title = `Se reproducirá en ${position}${position === 1 ? 'canción' : 'canciones'}`;
  badge.setAttribute('aria-label', badge.title);
  badge.innerHTML = `<i class="ph ph-skip-forward" aria-hidden="true"></i><span>${position}</span>`;

  const badgeContainer = element.classList.contains('song-card')
    ? element.querySelector('.card-img-wrap')
    : element.querySelector('.row-thumb-box');
  if (badgeContainer && !existingBadge) badgeContainer.appendChild(badge);
}

function refreshQueuePositionIndicators() {
  document.querySelectorAll('.song-card, .playlist-table-row').forEach(element => {
    const song = getSongForSelectableElement(element);
    if (song) updateQueuePositionIndicator(element, song);
  });
}

export function renderHistoryUI() {
  if (!queueHistoryList || !historyCountEl) return;

  if (state.playbackHistory.length > 50) {
    state.playbackHistory.length = 50;
  }

  historyCountEl.textContent = state.playbackHistory.length;
  clearContainerCovers(queueHistoryList);

  if (state.playbackHistory.length === 0) {
    queueHistoryList.innerHTML = `<div class="empty-queue-msg" style="padding: 0.5rem 0.2rem;">No hay canciones reproducidas aún</div>`;
    return;
  }

  queueHistoryList.innerHTML = '';
  state.playbackHistory.forEach((song, hIdx) => {
    const item = document.createElement('div');
    item.className = 'queue-item queue-history-item';
    item.dataset.songId = song.id;
    item.dataset.historyIdx = hIdx;

    const thumbHtml = `<img class="queue-thumb-img" alt="" width="36" height="36" draggable="false" />`;

    item.innerHTML = `
      <div class="queue-item-meta">
        <div class="queue-item-icon">${thumbHtml}</div>
        <div class="queue-item-info">
          <h5>${escapeHtml(song.title)}</h5>
          <span>${escapeHtml(song.artist)}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      const queueIdx = state.activeQueue.indexOf(song);
      if (queueIdx !== -1) {
        loadSong(queueIdx, resolveManualAutoPlay(true), true);
      } else {
        state.activeQueue.splice(state.currentTrackIndex, 0, song);
        loadSong(state.currentTrackIndex, resolveManualAutoPlay(true), true);
      }
    });

    queueHistoryList.appendChild(item);
    const historyImg = item.querySelector('.queue-thumb-img');
    if (historyImg) bindListSongCover(historyImg, song);
  });
}

export function renderQueue(
) {
  refreshQueuePositionIndicators();
  clearContainerCovers(queueNowPlaying);
  clearContainerCovers(queueItemsContainer);

  if (state.activeQueue.length === 0 || state.currentTrackIndex === -1) {
    queueNowPlaying.innerHTML = `<div class="empty-queue-msg">Ninguna canción en reproducción</div>`;
    queueItemsContainer.innerHTML = `<div class="empty-queue-msg">La cola está vacía</div>`;
    renderHistoryUI();
    return;
  }

  if (queueHeaderTitle) {
    queueHeaderTitle.textContent = `Cola (${state.activeQueueTitle})`;
  }

  const current = state.activeQueue[state.currentTrackIndex];
  const currentCoverUrl = resolveCoverUrl(current);
  const coverHtml = currentCoverUrl
    ? `<img src="${escapeHtml(currentCoverUrl)}" alt="${escapeHtml(current.title)}" class="queue-cover-img" />`
    : `<i class="ph ph-waveform"></i>`;

  queueNowPlaying.innerHTML = `
    <div class="now-playing-left">
      <div class="now-playing-cover-box">${coverHtml}</div>
      <div class="now-playing-meta">
        <h5>${escapeHtml(current.title)}</h5>
        <p>${escapeHtml(current.artist)}</p>
      </div>
    </div>
    <div class="now-playing-wave-wrap">
      ${getSoundWaveHTML(isPlaybackPaused())}
    </div>
  `;
  queueNowPlaying.dataset.songId = current.id;

  renderHistoryUI();

  queueItemsContainer.innerHTML = '';
  const upcomingSongs = [];
  for (let i = state.currentTrackIndex + 1; i < state.activeQueue.length; i++) {
    upcomingSongs.push({ song: state.activeQueue[i], idx: i });
  }

  if (upcomingSongs.length === 0) {
    queueItemsContainer.innerHTML = `<div class="empty-queue-msg">No hay más canciones a continuación</div>`;
    return;
  }

  const visibleSongs = upcomingSongs.slice(0, state.queueVisibleCount);

  visibleSongs.forEach(({ song, idx }) => {
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.dataset.songId = song.id;
    item.dataset.queueIdx = idx;

    item.draggable = false;
    item.style.cursor = 'grab';
    item.addEventListener('pointerdown', (e) => {
      pnStartPointerDrag(e, { type: 'queue', fromIndex: idx, el: item });
    });

    const thumbHtml = `<img class="queue-thumb-img" alt="" width="36" height="36" draggable="false" />`;

    const badgeHtml = song.isEnqueuedNext
      ? `<div class="queue-item-badge" title="En cola para reproducir a continuación"><i class="ph-fill ph-queue"></i></div>`
      : ``;

    item.innerHTML = `
      <div class="queue-item-meta">
        <div class="queue-item-icon">${thumbHtml}</div>
        <div class="queue-item-info">
          <h5>${escapeHtml(song.title)}</h5>
          <span>${escapeHtml(song.artist)}</span>
        </div>
      </div>
      ${badgeHtml}
    `;

    item.addEventListener('click', (e) => {
      if (uiVars.isDragging) {
        e.preventDefault();
        return;
      }
      loadSong(idx, resolveManualAutoPlay(true));
    });

    queueItemsContainer.appendChild(item);
    const queueImg = item.querySelector('.queue-thumb-img');
    if (queueImg) bindListSongCover(queueImg, song);
  });

  if (upcomingSongs.length > state.queueVisibleCount) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'btn-load-more-queue';
    const remainingCount = upcomingSongs.length - state.queueVisibleCount;
    loadMoreBtn.innerHTML = `<i class="ph ph-plus-circle"></i> Cargar más (${remainingCount} restantes)`;
    loadMoreBtn.addEventListener('click', () => {
      state.queueVisibleCount += 25;
      renderQueue();
    });
    queueItemsContainer.appendChild(loadMoreBtn);
  }
  // Mantener la vista completa de cola sincronizada (ocultar ya reproducidas)
  if (state.currentView === 'queue-detail') {
    try { void renderPlaylistDetailView(); } catch (_) {}
  }
}
