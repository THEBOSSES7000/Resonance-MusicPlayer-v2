// UI · Filtros de listas, enlaces de álbum/artista y eventos de ventana y modo foco.

import { albumsFilterBar, albumsFilterCount, albumsFilterPopover, albumsFilterTrigger, btnCollectionOptions, collectionOptionsMenu, collectionOptionsWrap, currentAlbumLink, customContextMenu, playlistHeroAuthor, tracksFilterArtist, tracksFilterBar, tracksFilterField, tracksFilterPopover, tracksFilterTrigger } from '../dom.js';
import { setFilterPopoverOpen, syncFilterTriggerState } from '../trackFilters.js';
import { albumsMinTrackCount, blockAlbumsBelowTrackFilter, setAlbumsMinTrackCount, setBlockAlbumsBelowTrackFilter } from '../init.js';
import { artistsFromCredit, invalidateLibraryEntityCaches, syncPlayerAlbumLinkState } from '../libraryEntities.js';
import { renderGrids } from '../homeGrids.js';
import { state } from '../../state.js';
import { navigateToView } from '../navigation.js';
import { uiVars } from '../sharedState.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { renderPlaylistsUI } from '../collections.js';
import { handleLyricsFocusModeActivity, scheduleLyricsFocusMode } from '../lyricsDock.js';
import { renderPlaylistsHubUI } from '../folderPlaylistViews.js';
import { updatePlaylistRowTitleMarquee } from '../playback.js';
import { isPlaybackPaused } from '../../audioPlayer.js';
import { closeDiscordRpcContextMenu, openDiscordRpcContextMenu } from '../../discordRpc.js';
import { closeCustomContextMenu, handleCustomContextMenu } from '../contextMenu.js';

/** Filtros de listas, enlaces de álbum/artista y eventos de ventana y teclado de modo foco. */
export function bindFilterAndWindowEvents() {
  const filterPopovers = [
    [tracksFilterTrigger, tracksFilterPopover, tracksFilterBar],
    [albumsFilterTrigger, albumsFilterPopover, albumsFilterBar]
  ];
  filterPopovers.forEach(([trigger, popover]) => {
    trigger?.addEventListener('click', event => {
      event.stopPropagation();
      setFilterPopoverOpen(trigger, popover, popover.hidden);
    });
  });

  localStorage.removeItem('pn_folders_dynamic_filter');
  localStorage.removeItem('pn_playlists_dynamic_filter');

  if (albumsFilterCount) {
    albumsFilterCount.value = String(albumsMinTrackCount);
    syncFilterTriggerState(albumsFilterTrigger, albumsMinTrackCount > 0);
    albumsFilterCount.addEventListener('change', () => {
      setAlbumsMinTrackCount(Number(albumsFilterCount.value) || 0);
      localStorage.setItem('pn_albums_min_tracks', String(albumsMinTrackCount));
      syncFilterTriggerState(albumsFilterTrigger, albumsMinTrackCount > 0);
      syncPlayerAlbumLinkState();
      renderGrids();
    });
  }
  const albumsFilterLock = document.getElementById('albums-filter-lock');
  if (albumsFilterLock) {
    albumsFilterLock.checked = blockAlbumsBelowTrackFilter;
    albumsFilterLock.addEventListener('change', () => {
      setBlockAlbumsBelowTrackFilter(albumsFilterLock.checked);
      localStorage.setItem('pn_albums_block_below_filter', String(blockAlbumsBelowTrackFilter));
      syncPlayerAlbumLinkState();
      renderGrids();
    });
  }

  currentAlbumLink?.addEventListener('click', () => {
    const currentSong = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
    const albumTitle = String(currentSong?.album || '').trim();
    const artistName = artistsFromCredit(currentSong?.artist)[0] || '';
    if (albumTitle && artistName) navigateToView('album-detail', { artistName, albumTitle });
  });

  playlistHeroAuthor?.addEventListener('click', () => {
    if (state.currentView === 'album-detail') {
      navigateToView('artist', { artistName: state.albumArtistName || state.artistName });
    }
  });

  const updateTrackFilter = () => {
    const field = tracksFilterField?.value || 'all';
    uiVars.activeTrackFilter = {
      field,
      value: field === 'artist' ? (tracksFilterArtist?.value || '').trim() : ''
    };
    if (tracksFilterArtist) tracksFilterArtist.hidden = field !== 'artist';
    syncFilterTriggerState(tracksFilterTrigger, field !== 'all');
    renderPlaylistDetailView();
    renderPlaylistsUI();
  };
  tracksFilterField?.addEventListener('change', updateTrackFilter);
  tracksFilterArtist?.addEventListener('input', updateTrackFilter);
  document.getElementById('tracks-filter-clear')?.addEventListener('click', () => {
    if (tracksFilterField) tracksFilterField.value = 'all';
    if (tracksFilterArtist) {
      tracksFilterArtist.value = '';
      tracksFilterArtist.hidden = true;
    }
    uiVars.activeTrackFilter = { field: 'all', value: '' };
    syncFilterTriggerState(tracksFilterTrigger, false);
    renderPlaylistDetailView();
    renderPlaylistsUI();
  });

  document.addEventListener('mousemove', handleLyricsFocusModeActivity, { passive: true });
  document.addEventListener('keydown', handleLyricsFocusModeActivity);
  document.addEventListener('pn-lyrics-focus-settings-changed', scheduleLyricsFocusMode);
  window.addEventListener('pn-library-cache-updated', () => {
    invalidateLibraryEntityCaches();
    if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
  });
  window.addEventListener('pn-library-cache-cleared', () => {
    invalidateLibraryEntityCaches();
    if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
  });

  window.addEventListener('resize', () => {
    const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
    document.querySelectorAll('.playlist-table-row').forEach(row => {
      updatePlaylistRowTitleMarquee(
        row,
        Boolean(currentSong && Number(row.dataset.songId) === currentSong.id && !isPlaybackPaused())
      );
    });
  });

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeDiscordRpcContextMenu();
    if (e.target.closest('#btn-open-settings')) {
      closeCustomContextMenu();
      openDiscordRpcContextMenu(e.clientX, e.clientY);
      return;
    }
    handleCustomContextMenu(e);
  });

  document.addEventListener('click', (e) => {
    filterPopovers.forEach(([trigger, popover, wrapper]) => {
      if (!wrapper?.contains(e.target)) setFilterPopoverOpen(trigger, popover, false);
    });
    if (!customContextMenu.contains(e.target)) {
      closeCustomContextMenu();
    }
    if (collectionOptionsWrap && !collectionOptionsWrap.contains(e.target)) {
      collectionOptionsMenu.hidden = true;
      btnCollectionOptions.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    filterPopovers.forEach(([trigger, popover]) => setFilterPopoverOpen(trigger, popover, false));
  });
}
