// UI · Resultados de búsqueda: pestaña «Playlists».

import { state } from '../../state.js';
import { searchResultsContent } from '../dom.js';
import { getPlaylistSongs } from '../playlistData.js';
import { escapeHtml, getSoundWaveHTML } from '../uiUtils.js';
import { isPlaybackPaused, togglePlay } from '../../audioPlayer.js';
import { bindLazyCover } from '../covers.js';
import { playFromContext } from '../playback.js';
import { navigateToView } from '../navigation.js';

/** Resultados de búsqueda de la pestaña «Playlists». */
export function renderPlaylistSearchResults(q, displayQuery) {
    const matches = state.playlists.filter(p =>
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-playlist"></i>
          <h3>No se encontraron listas de reproducción</h3>
          <p>No hay playlists que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'playlists-grid';

    const isOverlay = state.playlistsViewLayout === 'overlay';

    matches.forEach(pl => {
      const card = document.createElement('div');
      card.className = `playlist-grid-card ${isOverlay ? 'design-overlay' : 'design-standard'}`;
      card.dataset.id = pl.id;

      const playlistSongs = getPlaylistSongs(pl);
      const songsCount = playlistSongs.length;
      const isPinned = pl.isPinned !== false;
      const pinBadge = isPinned ? `<div class="card-pin-badge" title="Fijada en acceso directo"><i class="ph-fill ph-push-pin"></i></div>` : '';

      const isThisPlaylistPlaying = state.activeContextId === ('playlist_' + pl.id);
      if (isThisPlaylistPlaying) card.classList.add('is-playing-origin');

      if (isOverlay) {
        const coverHtml = pl.coverUrl
          ? `<img class="overlay-bg-img" alt="${escapeHtml(pl.title)}" />`
          : `<div class="overlay-bg-placeholder"><i class="ph ph-playlist"></i></div>`;

        card.innerHTML = `
          ${pinBadge}
          ${coverHtml}
          <button class="card-play-hover" title="Reproducir playlist"><i class="ph-fill ph-play"></i></button>
          <div class="overlay-content-box">
            <div class="playlist-card-title-row">
              <h4>${escapeHtml(pl.title)}</h4>
              ${pl.smartFilter ? '<i class="ph ph-lightning smart-playlist-badge" title="Playlist dinámica" aria-label="Playlist dinámica"></i>' : ''}
              <div class="playlist-hub-soundwave-wrap">
                ${isThisPlaylistPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
              </div>
            </div>
            <p>${escapeHtml(pl.description || (pl.smartFilter ? "Playlist dinámica" : "Lista de reproducción"))}</p>
            <span class="playlist-grid-count">${songsCount} canciones</span>
          </div>
        `;
      } else {
        const coverHtml = pl.coverUrl
          ? `<img alt="${escapeHtml(pl.title)}" />`
          : `<i class="ph ph-playlist cover-placeholder-icon"></i>`;

        card.innerHTML = `
          ${pinBadge}
          <div class="playlist-card-cover-wrap">
            ${coverHtml}
            <button class="card-play-hover" title="Reproducir playlist"><i class="ph-fill ph-play"></i></button>
          </div>
          <div class="playlist-card-title-row">
            <h4>${escapeHtml(pl.title)}</h4>
            ${pl.smartFilter ? '<i class="ph ph-lightning smart-playlist-badge" title="Playlist dinámica" aria-label="Playlist dinámica"></i>' : ''}
            <div class="playlist-hub-soundwave-wrap">
              ${isThisPlaylistPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
            </div>
          </div>
          <p>${escapeHtml(pl.description || (pl.smartFilter ? "Playlist dinámica" : "Lista de reproducción"))}</p>
          <span class="playlist-grid-count">${songsCount} canciones</span>
        `;
      }

      if (pl.coverUrl) {
        const plImg = card.querySelector('img');
        if (plImg) bindLazyCover(plImg, pl.coverUrl, pl.title);
      }

      card.querySelector('.card-play-hover').addEventListener('click', (e) => {
        e.stopPropagation();
        if (playlistSongs.length > 0) {
          const contextId = 'playlist_' + pl.id;
          if (state.activeContextId === contextId && state.currentTrackIndex !== -1) {
            togglePlay();
          } else {
            playFromContext(playlistSongs, 0, pl.title, true, contextId, true);
          }
        }
      });

      card.addEventListener('click', () => {
        navigateToView('playlist', { playlistId: pl.id });
      });

      grid.appendChild(card);
    });

    searchResultsContent.appendChild(grid);
}
