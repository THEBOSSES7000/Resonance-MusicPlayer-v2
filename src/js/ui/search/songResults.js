// UI · Resultados de búsqueda: pestaña «Canciones» (paginada, con delegación de eventos).

import { uiVars } from '../sharedState.js';
import { formatTime, state } from '../../state.js';
import { searchResultsContent } from '../dom.js';
import { getFavoriteActionLabel, toggleFavoriteForSelection } from '../favorites.js';
import { handleSongSelectionClick } from '../selection.js';
import { getSearchPlayBehavior, playSongFromContext, playSongReplacingCurrent } from '../songCards.js';
import { bindListSongCover, formatListRowIndexHtml } from '../covers.js';
import { escapeHtml } from '../uiUtils.js';
import { updateQueuePositionIndicator } from '../queueHistory.js';
import { updatePlaylistRowTitleMarquee } from '../playback.js';
import { isPlaybackPaused } from '../../audioPlayer.js';

/** Resultados de búsqueda de la pestaña «Canciones». */
export function renderSongSearchResults(append, previousVisibleCount, q, displayQuery) {
    if (!append) {
      uiVars.renderedSearchSongsList = state.localMusicFiles.filter(s =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)) ||
        (s.album && s.album.toLowerCase().includes(q))
      );
    }
    const matches = uiVars.renderedSearchSongsList;

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-music-notes"></i>
          <h3>No se encontraron canciones</h3>
          <p>No hay canciones que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
    const isSearchContextActive = state.activeContextId === 'search_songs';

    let body = searchResultsContent.querySelector('#search-tracks-body');
    if (!append || !body) {
      const container = document.createElement('div');
      container.className = 'playlist-table-container';
      container.style.padding = '0';

      container.innerHTML = `
        <div class="playlist-table-header">
          <div class="col-index">#</div>
          <div class="col-title">Título</div>
          <div class="col-album">Álbum</div>
          <div class="col-date">Fecha en que se agregó</div>
          <div class="col-duration"><i class="ph ph-clock"></i></div>
        </div>
        <div class="playlist-table-body" id="search-tracks-body"></div>
      `;

      body = container.querySelector('#search-tracks-body');

      // Delegación única de eventos en #search-tracks-body
      body.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const row = target?.closest('.playlist-table-row');
        if (!row) return;
        const idx = Number(row.dataset.trackIdx);
        const song = uiVars.renderedSearchSongsList[idx];
        if (!song) return;

        if (target.closest('.row-fav-btn')) {
          e.stopPropagation();
          void toggleFavoriteForSelection(song, row);
          return;
        }
        if (handleSongSelectionClick(row, e)) return;
        const behavior = getSearchPlayBehavior();
        if (behavior === 'replace_queue') {
          playSongFromContext(
            uiVars.renderedSearchSongsList,
            idx,
            `Búsqueda: ${state.searchQuery}`,
            'search_songs'
          );
        } else {
          playSongReplacingCurrent(song, `Búsqueda: ${state.searchQuery}`);
        }
      });

      searchResultsContent.appendChild(container);
    }

    const visibleSlice = matches.slice(0, uiVars.searchVisibleCount);
    const startIdx = append ? Math.min(previousVisibleCount, visibleSlice.length) : 0;

    for (let idx = startIdx; idx < visibleSlice.length; idx++) {
      const song = visibleSlice[idx];
      const row = document.createElement('div');
      row.className = 'playlist-table-row';
      row.dataset.songId = song.id;
      row.dataset.trackIdx = idx;

      const isCurrent = currentSong && currentSong.id === song.id;
      if (isCurrent && isSearchContextActive) {
        row.classList.add('is-active');
      } else if (isCurrent) {
        row.classList.add('is-playing-elsewhere');
      }

      const thumbHtml = `<img class="row-thumb-img" draggable="false" alt="" width="40" height="40" />`;

      const indexHtml = formatListRowIndexHtml({
        isCurrent,
        isActiveSource: isSearchContextActive,
        displayNumber: idx + 1
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
        <div class="row-date">${escapeHtml(song.addedDate || "Reciente")}</div>
        <div class="row-duration-box">
          <span>${Number.isFinite(song.duration) && song.duration > 0 ? formatTime(song.duration) : '--:--'}</span>
          <button class="row-fav-btn ${song.isFavorite ? 'active' : ''}" title="${getFavoriteActionLabel(song.isFavorite)}">
            <i class="${song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
          </button>
        </div>
      `;

      updateQueuePositionIndicator(row, song);
      body.appendChild(row);
      const lazyThumb = row.querySelector('.row-thumb-img');
      if (lazyThumb) bindListSongCover(lazyThumb, song);
      updatePlaylistRowTitleMarquee(row, Boolean(isCurrent && !isPlaybackPaused()));
    }
}
