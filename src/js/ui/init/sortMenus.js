// UI · Orden y reordenado de pistas, carpetas y playlists.

import { btnSortFolders, btnSortPlaylists, btnSortPlaylistsView, btnSortTracks, btnToggleTrackReorder, currentFolderSortLabel, currentPlaylistsViewSortLabel, folderSortMenu, playlistsViewSortMenu, queueHeaderTitle, sortDropdownMenu, trackSortMenu } from '../dom.js';
import { navigateToView } from '../navigation.js';
import { queueDetailShowHistory, setQueueDetailShowHistory } from '../init.js';
import { state } from '../../state.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { cleanupDragState, updateSidebarPlaylistReorderToggle, updateTrackReorderToggle } from '../dragReorder.js';
import { defaultTrackSortDir, ensureTrackSortDirState, getSortPersistMode, persistActiveTrackSortDir, persistFolderSortMode, persistPlaylistsViewSortMode, persistSidebarPlaylistSortMode, persistTrackSortMode, updateTrackSortLabelUI } from '../sorting.js';
import { renderPlaylistsUI } from '../collections.js';
import { renderFoldersUI, renderPlaylistsHubUI } from '../folderPlaylistViews.js';

/** Orden y reordenado de pistas, carpetas y playlists. */
export function bindSortMenus() {

  
  if (queueHeaderTitle) {
    queueHeaderTitle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateToView('queue-detail');
    });
  }

  
  const btnToggleQueueHistory = document.getElementById('btn-toggle-queue-history');
  if (btnToggleQueueHistory) {
    btnToggleQueueHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      setQueueDetailShowHistory(!queueDetailShowHistory);
      localStorage.setItem('pn_queue_detail_show_history', String(queueDetailShowHistory));
      if (state.currentView === 'queue-detail') {
        void renderPlaylistDetailView();
      }
    });
  }

  btnToggleTrackReorder?.addEventListener('click', event => {
    event.stopPropagation();
    if (state.currentView === 'queue-detail') {
      state.queueTrackDragReorderEnabled = !state.queueTrackDragReorderEnabled;
      localStorage.setItem('pn_queue_track_drag_reorder', String(state.queueTrackDragReorderEnabled));
    } else {
      state.playlistTrackDragReorderEnabled = !state.playlistTrackDragReorderEnabled;
      localStorage.setItem('pn_playlist_track_drag_reorder', String(state.playlistTrackDragReorderEnabled));
    }
    cleanupDragState();
    updateTrackReorderToggle();
    void renderPlaylistDetailView();
  });

  document.addEventListener('click', (e) => {
    if (!sortDropdownMenu.contains(e.target) && e.target !== btnSortPlaylists) {
      sortDropdownMenu.classList.remove('open');
    }
    if (trackSortMenu && !trackSortMenu.contains(e.target) && e.target !== btnSortTracks) {
      trackSortMenu.classList.remove('open');
    }
    if (folderSortMenu && !folderSortMenu.contains(e.target) && e.target !== btnSortFolders) {
      folderSortMenu.classList.remove('open');
    }
    if (playlistsViewSortMenu && !playlistsViewSortMenu.contains(e.target) && e.target !== btnSortPlaylistsView) {
      playlistsViewSortMenu.classList.remove('open');
    }
  });

  sortDropdownMenu.querySelectorAll('.sort-option').forEach(btn => {
    btn.addEventListener('click', () => {
      sortDropdownMenu.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.playlistSortMode = btn.dataset.sort;
      persistSidebarPlaylistSortMode(state.playlistSortMode);
      updateSidebarPlaylistReorderToggle();
      renderPlaylistsUI();
      sortDropdownMenu.classList.remove('open');
    });
  });

  if (btnSortTracks && trackSortMenu) {
    btnSortTracks.addEventListener('click', (e) => {
      e.stopPropagation();
      trackSortMenu.classList.toggle('open');
    });

    trackSortMenu.querySelectorAll('.sort-option').forEach(btn => {
      btn.addEventListener('click', () => {
        trackSortMenu.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ensureTrackSortDirState();
        const nextMode = btn.dataset.sort;

        if (state.currentView === 'artist') {
          const mode = nextMode === 'date' ? 'date' : 'plays';
          if (mode === state.artistSortMode) {
            state.artistSortDir = state.artistSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.artistSortMode = mode;
            state.artistSortDir = defaultTrackSortDir(mode);
          }
          persistActiveTrackSortDir(state.artistSortDir);
          if (getSortPersistMode() !== 'none') {
            localStorage.setItem('pn_sort_tracks_artist', state.artistSortMode);
          }
        } else if (state.currentView === 'album-detail') {
          const mode = ['track', 'plays', 'date'].includes(nextMode) ? nextMode : 'track';
          if (mode === state.albumSortMode) {
            state.albumSortDir = state.albumSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.albumSortMode = mode;
            state.albumSortDir = defaultTrackSortDir(mode);
          }
          persistActiveTrackSortDir(state.albumSortDir);
          if (getSortPersistMode() !== 'none') {
            localStorage.setItem('pn_sort_album', state.albumSortMode);
          }
        } else {
          if (nextMode === state.trackSortMode) {
            state.trackSortDir = state.trackSortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.trackSortMode = nextMode;
            state.trackSortDir = defaultTrackSortDir(nextMode);
          }
          persistActiveTrackSortDir(state.trackSortDir);
          persistTrackSortMode(state.trackSortMode);
        }
        const labelBase = btn.textContent;
        void Promise.resolve(renderPlaylistDetailView()).finally(() => {
          updateTrackSortLabelUI(labelBase);
        });
        trackSortMenu.classList.remove('open');
      });
    });
  }

  // Ordenamiento de carpetas
  if (btnSortFolders && folderSortMenu) {
    btnSortFolders.addEventListener('click', (e) => {
      e.stopPropagation();
      folderSortMenu.classList.toggle('open');
    });

    folderSortMenu.querySelectorAll('.sort-option').forEach(btn => {
      btn.addEventListener('click', () => {
        folderSortMenu.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.folderSortMode = btn.dataset.sort;
        persistFolderSortMode(state.folderSortMode);
        if (currentFolderSortLabel) {
          currentFolderSortLabel.textContent = btn.textContent;
        }
        renderFoldersUI();
        folderSortMenu.classList.remove('open');
      });
    });
  }

  // Ordenamiento del Hub de Playlists
  if (btnSortPlaylistsView && playlistsViewSortMenu) {
    btnSortPlaylistsView.addEventListener('click', (e) => {
      e.stopPropagation();
      playlistsViewSortMenu.classList.toggle('open');
    });

    playlistsViewSortMenu.querySelectorAll('.sort-option').forEach(btn => {
      btn.addEventListener('click', () => {
        playlistsViewSortMenu.querySelectorAll('.sort-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.playlistsViewSortMode = btn.dataset.sort;
        persistPlaylistsViewSortMode(state.playlistsViewSortMode);
        if (currentPlaylistsViewSortLabel) {
          currentPlaylistsViewSortLabel.textContent = btn.textContent;
        }
        renderPlaylistsHubUI();
        playlistsViewSortMenu.classList.remove('open');
      });
    });
  }
}
