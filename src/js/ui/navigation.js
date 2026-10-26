// UI · Navegación entre vistas y liberación de memoria de vistas ocultas.

import { SEARCH_PAGE_SIZE, uiVars } from './sharedState.js';
import { state } from '../state.js';
import { albumsView, allAlbumsGrid, artistAlbumsGrid, artistRelatedGrid, btnNavBack, btnOpenFavorites, foldersGrid, foldersView, homeView, mainContent, navBtnFolders, navBtnHome, navBtnMusic, navBtnPlaylists, playlistTracksBody, playlistView, playlistsGrid, playlistsView, searchResultsContent, searchView } from './dom.js';
import { clearContainerCovers } from './covers.js';
import { isAlbumNavigationBlocked } from './libraryEntities.js';
import { clearSongSelection } from './selection.js';
import { syncTrackFilterContext } from './trackFilters.js';
import { hideSearchSuggestions, renderSearchResultsContent } from './search.js';
import { syncPlayingUI } from './playback.js';
import { isPlaybackPaused } from '../audioPlayer.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { renderFoldersUI, renderPlaylistsHubUI } from './folderPlaylistViews.js';
import { renderAllAlbumsUI } from './homeGrids.js';

const VIEW_HISTORY_LIMIT = 40;

/**
 * Limpieza de vistas ocultas para liberar memoria DOM y referencias en cierres léxicos
 */
function purgeHiddenViewsMemory(targetView) {
  const isDetailTarget = ['all-music', 'favorites', 'playlist', 'folder-detail', 'artist', 'album-detail'].includes(targetView);

  // Letras: el tope lo aplica trackLoadedLyricsInRam (scanner). No purgar todo al navegar
  // para no forzar re-lectura desde disco en cada cambio de vista.

  if (!isDetailTarget) {
    uiVars.renderedTrackList = [];
    uiVars.renderedTrackContextId = null;
    uiVars.renderedTrackContextTitle = '';
    uiVars.detailVisibleContextKey = '';
    uiVars.detailVisibleCount = 50;
    state.musicVisibleCount = 50;
    if (playlistTracksBody) {
      clearContainerCovers(playlistTracksBody);
      playlistTracksBody.replaceChildren();
    }
    if (artistAlbumsGrid) {
      clearContainerCovers(artistAlbumsGrid);
      artistAlbumsGrid.replaceChildren();
    }
    if (artistRelatedGrid) {
      artistRelatedGrid.replaceChildren();
    }
  } else if (targetView !== 'artist') {
    if (artistAlbumsGrid) {
      clearContainerCovers(artistAlbumsGrid);
      artistAlbumsGrid.replaceChildren();
    }
    if (artistRelatedGrid) {
      artistRelatedGrid.replaceChildren();
    }
  }

  if (targetView !== 'search') {
    uiVars.renderedSearchSongsList = [];
    uiVars.renderedSearchQueueList = [];
    uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
    if (searchResultsContent) {
      clearContainerCovers(searchResultsContent);
      searchResultsContent.replaceChildren();
    }
  }

  if (targetView !== 'albums' && allAlbumsGrid) {
    clearContainerCovers(allAlbumsGrid);
    allAlbumsGrid.replaceChildren();
    uiVars.albumGridVisibleCount = 50;
  }

  if (targetView !== 'folders' && foldersGrid) {
    clearContainerCovers(foldersGrid);
    foldersGrid.replaceChildren();
  }

  if (targetView !== 'playlists-hub' && playlistsGrid) {
    clearContainerCovers(playlistsGrid);
    playlistsGrid.replaceChildren();
  }
}

/**
 * Gestor unificado de navegación
 */
export function navigateToView(targetView, meta = null, pushHistory = true) {
  if (targetView === 'album-detail' && isAlbumNavigationBlocked(meta?.artistName, meta?.albumTitle)) return;
  clearSongSelection();
  document.body.classList.toggle('queue-detail-view', targetView === 'queue-detail');
  if (pushHistory && (
    state.currentView !== targetView ||
    (targetView === 'artist' && state.artistName !== meta?.artistName) ||
    (targetView === 'album-detail' && (
      state.albumTitle !== meta?.albumTitle || state.artistName !== meta?.artistName
    ))
  )) {
    state.viewHistory.push({
      view: state.currentView,
      playlistId: state.currentPlaylistId,
      folderId: state.currentFolderId,
      artistName: state.artistName,
      albumTitle: state.albumTitle,
      albumArtistName: state.albumArtistName
    });
    if (state.viewHistory.length > VIEW_HISTORY_LIMIT) {
      state.viewHistory.splice(0, state.viewHistory.length - VIEW_HISTORY_LIMIT);
    }
  }

  state.currentView = targetView;
  if (meta && meta.playlistId !== undefined) state.currentPlaylistId = meta.playlistId;
  if (meta && meta.folderId !== undefined) state.currentFolderId = meta.folderId;
  syncTrackFilterContext();
  if (targetView === 'artist') {
    const nextArtistName = String(meta?.artistName || '').trim();
    state.artistName = nextArtistName;
  } else if (targetView === 'album-detail') {
    state.artistName = String(meta?.artistName || state.artistName || '').trim();
    state.albumArtistName = state.artistName;
    state.albumTitle = String(meta?.albumTitle || '').trim();
  }

  if (btnNavBack) {
    btnNavBack.style.display = targetView === 'home' ? 'none' : 'flex';
  }
  if (targetView !== 'search') hideSearchSuggestions();

  purgeHiddenViewsMemory(targetView);

  homeView.style.display = 'none';
  if (foldersView) foldersView.style.display = 'none';
  if (albumsView) albumsView.style.display = 'none';
  if (playlistsView) playlistsView.style.display = 'none';
  if (searchView) searchView.style.display = 'none';
  playlistView.style.display = 'none';

  navBtnHome.classList.remove('active');
  if (navBtnMusic) navBtnMusic.classList.remove('active');
  if (navBtnFolders) navBtnFolders.classList.remove('active');
  if (navBtnPlaylists) navBtnPlaylists.classList.remove('active');
  btnOpenFavorites.classList.remove('active');

  if (targetView === 'home') {
    homeView.style.display = 'flex';
    navBtnHome.classList.add('active');
    syncPlayingUI(!isPlaybackPaused());
  } else if (targetView === 'all-music') {
    playlistView.style.display = 'flex';
    if (navBtnMusic) navBtnMusic.classList.add('active');
    state.musicVisibleCount = 50;
    renderPlaylistDetailView();
  } else if (targetView === 'folders') {
    if (foldersView) foldersView.style.display = 'flex';
    if (navBtnFolders) navBtnFolders.classList.add('active');
    renderFoldersUI();
  } else if (targetView === 'albums') {
    if (albumsView) albumsView.style.display = 'flex';
    renderAllAlbumsUI();
  } else if (targetView === 'playlists-hub') {
    if (playlistsView) playlistsView.style.display = 'flex';
    if (navBtnPlaylists) navBtnPlaylists.classList.add('active');
    renderPlaylistsHubUI();
  } else if (targetView === 'queue-detail') {
    playlistView.style.display = 'flex';
    document.body.classList.add('queue-detail-view');
    renderPlaylistDetailView();
  } else if (targetView === 'favorites') {
    playlistView.style.display = 'flex';
    btnOpenFavorites.classList.add('active');
    renderPlaylistDetailView();
  } else if (targetView === 'search') {
    if (searchView) searchView.style.display = 'flex';
    renderSearchResultsContent();
  } else if (targetView === 'playlist' || targetView === 'folder-detail' || targetView === 'artist' || targetView === 'album-detail') {
    playlistView.style.display = 'flex';
    if (targetView === 'folder-detail' && navBtnFolders) navBtnFolders.classList.add('active');
    renderPlaylistDetailView();
  }

  if (document.documentElement.classList.contains('pn-smooth-transitions') &&
      !document.documentElement.classList.contains('pn-disable-animations') &&
      mainContent) {
    mainContent.classList.remove('pn-view-transition');
    void mainContent.offsetWidth;
    mainContent.classList.add('pn-view-transition');
    window.setTimeout(() => mainContent.classList.remove('pn-view-transition'), 280);
  }
}
