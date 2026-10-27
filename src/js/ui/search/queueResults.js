// UI · Resultados de búsqueda: pestaña «Cola».

import { uiVars } from '../sharedState.js';
import { formatTime, state } from '../../state.js';
import { searchResultsContent } from '../dom.js';
import { getFavoriteActionLabel, toggleFavoriteForSelection } from '../favorites.js';
import { isPlaybackPaused, loadSong, resolveManualAutoPlay } from '../../audioPlayer.js';
import { bindListSongCover, formatListRowIndexHtml } from '../covers.js';
import { escapeHtml } from '../uiUtils.js';
import { updatePlaylistRowTitleMarquee } from '../playback.js';

/** Resultados de búsqueda de la pestaña «Cola». */
export function renderQueueSearchResults(append, previousVisibleCount, q, displayQuery) {
    if (!append) {
      uiVars.renderedSearchQueueList = state.activeQueue
        .map((s, idx) => ({ song: s, queueIndex: idx }))
        .filter(({ song }) =>
          (song.title && song.title.toLowerCase().includes(q)) ||
          (song.artist && song.artist.toLowerCase().includes(q)) ||
          (song.album && song.album.toLowerCase().includes(q))
        );
    }
    const matches = uiVars.renderedSearchQueueList;

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-queue"></i>
          <h3>Sin coincidencias en la cola</h3>
          <p>No se encontraron canciones en la cola activa que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    let body = searchResultsContent.querySelector('#search-queue-body');
    if (!append || !body) {
      const container = document.createElement('div');
      container.className = 'playlist-table-container';
      container.style.padding = '0';

      container.innerHTML = `
        <div class="playlist-table-header">
          <div class="col-index">#</div>
          <div class="col-title">Título</div>
          <div class="col-album">Álbum</div>
          <div class="col-date">Posición en cola</div>
          <div class="col-duration"><i class="ph ph-clock"></i></div>
        </div>
        <div class="playlist-table-body" id="search-queue-body"></div>
      `;

      body = container.querySelector('#search-queue-body');

      // Delegación en contenedor padre #search-queue-body
      body.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const row = target?.closest('.playlist-table-row');
        if (!row) return;
        const queueIndex = Number(row.dataset.trackIdx);
        const song = state.activeQueue[queueIndex];
        if (!song) return;

        if (target.closest('.row-fav-btn')) {
          e.stopPropagation();
          void toggleFavoriteForSelection(song, row);
          return;
        }
        loadSong(queueIndex, resolveManualAutoPlay(true));
      });

      searchResultsContent.appendChild(container);
    }

    const visibleSlice = matches.slice(0, uiVars.searchVisibleCount);
    const startIdx = append ? Math.min(previousVisibleCount, visibleSlice.length) : 0;

    for (let i = startIdx; i < visibleSlice.length; i++) {
      const { song, queueIndex } = visibleSlice[i];
      const row = document.createElement('div');
      row.className = 'playlist-table-row';
      row.dataset.songId = song.id;
      row.dataset.trackIdx = queueIndex;

      const isCurrent = state.currentTrackIndex === queueIndex;
      if (isCurrent) {
        row.classList.add('is-active');
      }

      const thumbHtml = `<img class="row-thumb-img" draggable="false" alt="" width="40" height="40" />`;

      const indexHtml = formatListRowIndexHtml({
        isCurrent,
        isActiveSource: true,
        displayNumber: queueIndex + 1
      });

      row.innerHTML = `
        <div class="row-index">${indexHtml}</div>
        <div class="row-title-box">
          <div class="row-thumb-box">${thumbHtml}</div>
          <div class="row-text-meta">
            <strong>${escapeHtml(song.title)}</strong>
            <span>${escapeHtml(song.artist || "Desconocido")}</span>
          </div>
        </div>
        <div class="row-album">${escapeHtml(song.album || "Sencillo")}</div>
        <div class="row-date">${isCurrent ? 'Sonando ahora' : `#${queueIndex + 1}`}</div>
        <div class="row-duration-box">
          <span>${Number.isFinite(song.duration) && song.duration > 0 ? formatTime(song.duration) : '--:--'}</span>
          <button class="row-fav-btn ${song.isFavorite ? 'active' : ''}" title="${getFavoriteActionLabel(song.isFavorite)}">
            <i class="${song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
          </button>
        </div>
      `;

      body.appendChild(row);
      const lazyThumb = row.querySelector('.row-thumb-img');
      if (lazyThumb) bindListSongCover(lazyThumb, song);
      updatePlaylistRowTitleMarquee(row, Boolean(isCurrent && !isPlaybackPaused()));
    }
}
