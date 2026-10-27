// UI · Interacciones de playlists, filas de canciones, cola, cuadrículas y carruseles.

import { albumsGrid, artistsGrid, exploreGrid, playlistTracksBody, playlistsContainer, queueItemsContainer, recentGrid } from '../dom.js';
import { state } from '../../state.js';
import { cleanupDragState, draggedPlaylistId, draggedQueueIndex, reorderPinnedPlaylists, reorderTrackRows } from '../dragReorder.js';
import { uiVars } from '../sharedState.js';
import { toggleFavoriteForSelection } from '../favorites.js';
import { handleSongSelectionClick } from '../selection.js';
import { playSongFromContext } from '../songCards.js';
import { renderQueue } from '../queueHistory.js';

/** Interacciones de playlists, filas de canciones, cola, cuadrículas y carruseles. */
export function bindListInteractions() {

  if (playlistsContainer) {
    playlistsContainer.addEventListener('dragover', (e) => {
      if (state.playlistSortMode === 'custom' && draggedPlaylistId !== null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });

    playlistsContainer.addEventListener('drop', (e) => {
      if (state.playlistSortMode === 'custom' && draggedPlaylistId !== null) {
        if (e.target === playlistsContainer) {
          e.preventDefault();
          reorderPinnedPlaylists(draggedPlaylistId);
        }
      }
      cleanupDragState();
    });
  }

  if (playlistTracksBody) {
    if (!uiVars.playlistTracksBodyListenersBound) {
    uiVars.playlistTracksBodyListenersBound = true;
  try { window.__pnEnsureMusicColumnHandles?.(); } catch (_) {};
    playlistTracksBody.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest('.playlist-table-row');
      if (!row) return;

      const favoriteButton = target.closest('.row-fav-btn');
      if (favoriteButton) {
        event.stopPropagation();
        const favIdx = Number(row.dataset.trackIdx);
        const favSong = Number.isInteger(favIdx) ? uiVars.renderedTrackList[favIdx] : null;
        if (favSong) void toggleFavoriteForSelection(favSong, row);
        return;
      }
      if (uiVars.isDragging || handleSongSelectionClick(row, event)) return;
      if (state.currentView === 'folder-detail') {
        const currentFolder = state.configuredFolders.find(folder => folder.id === state.currentFolderId);
        if (currentFolder) currentFolder.lastPlayed = Date.now();
      }

      // Resolver índice: path de la fila > id único > trackIdx
      let clickedIdx = Number(row.dataset.trackIdx);
      const pathKey = String(row.dataset.songPath || '').replace(/\\/g, '/').toLowerCase();
      if (pathKey) {
        const byPath = uiVars.renderedTrackList.findIndex(s => {
          const p = String(s?.file?.path || s?.path || '').replace(/\\/g, '/').toLowerCase();
          return p && p === pathKey;
        });
        if (byPath >= 0) clickedIdx = byPath;
      } else if (row.dataset.songId) {
        const id = String(row.dataset.songId);
        const hits = [];
        for (let n = 0; n < uiVars.renderedTrackList.length; n++) {
          if (uiVars.renderedTrackList[n] && String(uiVars.renderedTrackList[n].id) === id) hits.push(n);
        }
        if (hits.length === 1) clickedIdx = hits[0];
      }

      if (!Number.isInteger(clickedIdx) || clickedIdx < 0 || clickedIdx >= uiVars.renderedTrackList.length) return;
      if (!uiVars.renderedTrackList[clickedIdx]) return;

      playSongFromContext(
        uiVars.renderedTrackList,
        clickedIdx,
        uiVars.renderedTrackContextTitle,
        uiVars.renderedTrackContextId
      );
    });

    playlistTracksBody.addEventListener('dragstart', event => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest('.playlist-table-row[draggable="true"]');
      if (!row) return;
      // Evitar drag nativo de imagen/enlace dentro de la fila
      if (target && (target.tagName === 'IMG' || target.closest('a[href]'))) {
        // Continuar: la fila es el source; forzar move más abajo
      }
      let idx = Number(row.dataset.sourceTrackIdx);
      if (!Number.isInteger(idx) || idx < 0) {
        // Fallback: índice visible en el DOM
        const rows = [...playlistTracksBody.querySelectorAll('.playlist-table-row')];
        idx = rows.indexOf(row);
      }
      if (!Number.isInteger(idx) || idx < 0) {
        uiVars.draggedTrackIndex = null;
        return;
      }
      uiVars.draggedTrackIndex = idx;
      uiVars.isDragging = true;
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(uiVars.draggedTrackIndex));
        event.dataTransfer.setData('application/x-resonance-track', String(uiVars.draggedTrackIndex));
      } catch (_) {}
      requestAnimationFrame(() => row.classList.add('table-dragging'));
    });

    playlistTracksBody.addEventListener('dragover', (e) => {
      if (uiVars.draggedTrackIndex === null) return;
      if (state.trackSortMode !== 'custom') return;
      if (state.currentView === 'playlist' && !state.playlistTrackDragReorderEnabled) return;
      if (state.currentView !== 'favorites' && state.currentView !== 'playlist') return;
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest('.playlist-table-row');
      playlistTracksBody.querySelectorAll('.table-drag-over').forEach(item => {
        if (item !== row) item.classList.remove('table-drag-over');
      });
      if (row && Number(row.dataset.sourceTrackIdx) !== uiVars.draggedTrackIndex) {
        row.classList.add('table-drag-over');
      }
    });

    playlistTracksBody.addEventListener('dragleave', event => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest('.playlist-table-row');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      if (event.clientX <= rect.left || event.clientX >= rect.right ||
          event.clientY <= rect.top || event.clientY >= rect.bottom) {
        row.classList.remove('table-drag-over');
      }
    });

    playlistTracksBody.addEventListener('drop', (e) => {
      if (uiVars.draggedTrackIndex === null) {
        cleanupDragState();
        return;
      }
      if (state.trackSortMode !== 'custom') {
        cleanupDragState();
        return;
      }
      if (state.currentView === 'playlist' && !state.playlistTrackDragReorderEnabled) {
        cleanupDragState();
        return;
      }
      if (state.currentView !== 'favorites' && state.currentView !== 'playlist') {
        cleanupDragState();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const target = e.target instanceof Element ? e.target : null;
      const row = target?.closest('.playlist-table-row');
      reorderTrackRows(row, e);
      cleanupDragState();
    });

    playlistTracksBody.addEventListener('dragend', cleanupDragState);
    } // playlistTracksBodyListenersBound: registrar listeners una sola vez
  }

  if (queueItemsContainer) {
    queueItemsContainer.addEventListener('dragover', (e) => {
      if (draggedQueueIndex === null) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}

      const over = (e.target instanceof Element ? e.target : null)?.closest?.('.queue-item');
      document.querySelectorAll('.queue-item.queue-drag-over').forEach(q => {
        if (q !== over) q.classList.remove('queue-drag-over');
      });
      if (over && Number(over.dataset.queueIdx) !== draggedQueueIndex) {
        over.classList.add('queue-drag-over');
      }
    });

    queueItemsContainer.addEventListener('drop', (e) => {
      if (draggedQueueIndex === null) return;
      e.preventDefault();
      e.stopPropagation();

      const from = draggedQueueIndex;
      const over = (e.target instanceof Element ? e.target : null)?.closest?.('.queue-item');
      let to;
      if (over) {
        to = Number(over.dataset.queueIdx);
        if (!Number.isInteger(to)) {
          cleanupDragState();
          return;
        }
        const rect = over.getBoundingClientRect();
        // Mitad inferior → insertar después
        if (e.clientY > rect.top + rect.height / 2) to += 1;
        if (from < to) to -= 1;
      } else {
        // Soltar en el vacío del contenedor → al final de la cola visible
        to = state.activeQueue.length - 1;
      }
      to = Math.max(0, Math.min(state.activeQueue.length - 1, to));
      if (from !== to) {
        const itemToMove = state.activeQueue[from];
        state.activeQueue.splice(from, 1);
        state.activeQueue.splice(to, 0, itemToMove);
        // Ajustar índice de reproducción si hace falta
        if (state.currentTrackIndex === from) {
          state.currentTrackIndex = to;
        } else if (from < state.currentTrackIndex && to >= state.currentTrackIndex) {
          state.currentTrackIndex -= 1;
        } else if (from > state.currentTrackIndex && to <= state.currentTrackIndex) {
          state.currentTrackIndex += 1;
        }
      }
      cleanupDragState();
      renderQueue();
    });
  }

  [recentGrid, artistsGrid, exploreGrid, albumsGrid].forEach(container => {
    if (!container) return;
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  });

  const btnRecentPrev = document.getElementById('btn-recent-prev');
  const btnRecentNext = document.getElementById('btn-recent-next');
  const btnExplorePrev = document.getElementById('btn-explore-prev');
  const btnExploreNext = document.getElementById('btn-explore-next');
  const btnArtistsPrev = document.getElementById('btn-artists-prev');
  const btnArtistsNext = document.getElementById('btn-artists-next');
  const btnAlbumsPrev = document.getElementById('btn-albums-prev');
  const btnAlbumsNext = document.getElementById('btn-albums-next');

  if (btnRecentPrev && btnRecentNext && recentGrid) {
    btnRecentPrev.addEventListener('click', () => {
      recentGrid.scrollBy({ left: -380, behavior: 'smooth' });
    });
    btnRecentNext.addEventListener('click', () => {
      recentGrid.scrollBy({ left: 380, behavior: 'smooth' });
    });
  }

  if (btnExplorePrev && btnExploreNext && exploreGrid) {
    btnExplorePrev.addEventListener('click', () => {
      exploreGrid.scrollBy({ left: -380, behavior: 'smooth' });
    });
    btnExploreNext.addEventListener('click', () => {
      exploreGrid.scrollBy({ left: 380, behavior: 'smooth' });
    });
  }

  if (btnArtistsPrev && btnArtistsNext && artistsGrid) {
    btnArtistsPrev.addEventListener('click', () => {
      artistsGrid.scrollBy({ left: -380, behavior: 'smooth' });
    });
    btnArtistsNext.addEventListener('click', () => {
      artistsGrid.scrollBy({ left: 380, behavior: 'smooth' });
    });
  }

  if (btnAlbumsPrev && btnAlbumsNext && albumsGrid) {
    btnAlbumsPrev.addEventListener('click', () => {
      albumsGrid.scrollBy({ left: -380, behavior: 'smooth' });
    });
    btnAlbumsNext.addEventListener('click', () => {
      albumsGrid.scrollBy({ left: 380, behavior: 'smooth' });
    });
  }
}
