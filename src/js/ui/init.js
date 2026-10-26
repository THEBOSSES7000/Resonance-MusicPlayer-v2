// UI · Inicialización de la interfaz: enlaza todos los eventos (initUI).

import { closeLyricsView, getNowPlayingFsLayout, openLyricsView, setNowPlayingFullscreen, toggleExpandedCover, toggleNowPlayingFullscreen } from './nowPlayingFs.js';
import { albumsFilterBar, albumsFilterCount, albumsFilterPopover, albumsFilterTrigger, albumsGrid, allAlbumsGrid, artistBioToggle, artistLoadMoreButton, artistsGrid, btnAddPlaylist, btnCloseDetailsBtn, btnCloseFolderModal, btnCloseLyrics, btnClosePlaylistModal, btnCloseSongDetails, btnCollapseCover, btnCollectionOptions, btnCreatePlaylistHub, btnDetailsEditTrack, btnDetailsSearchLyrics, btnFetchTrackMetadata, btnImportPlaylistFile, btnLayoutOverlay, btnLayoutStandard, btnLyrics, btnNavBack, btnOpenAlbums, btnOpenFavorites, btnPlayAllFavorites, btnSaveFolderDesc, btnSavePlaylist, btnShuffleFavorites, btnSortFolders, btnSortPlaylists, btnSortPlaylistsView, btnSortTracks, btnToggleHistory, btnToggleTrackReorder, collectionOptionsMenu, collectionOptionsWrap, currentAlbumLink, currentFolderSortLabel, currentPlaylistsViewSortLabel, customContextMenu, detailsCoverBox, exploreGrid, folderDescInput, folderDescModal, folderSortMenu, historyCaret, m3uImportStatus, mainContent, metadataMatchClose, metadataMatchList, metadataMatchModal, metadataSearchAlbum, metadataSearchArtist, metadataSearchSubmit, metadataSearchTitle, metadataTextSearchClose, metadataTextSearchModal, modalCoverPicker, modalCoverPreview, navBtnFolders, navBtnHome, navBtnMusic, navBtnPlaylists, playerCoverBox, playerFavBtn, playlistDescInput, playlistFileImportInput, playlistHeroAuthor, playlistHeroDesc, playlistImageInput, playlistModalHeading, playlistModalOverlay, playlistTitleInput, playlistTracksBody, playlistsContainer, playlistsViewSortMenu, profileEditorModal, profileEditorPhotoInput, profileEditorStatus, queueHeaderTitle, queueHistoryList, queueItemsContainer, recentGrid, searchInput, searchSuggestions, smartPlaylistAddFilter, smartPlaylistFilters, smartPlaylistLogic, smartPlaylistToggle, songDetailsModal, sortDropdownMenu, trackMetadataSearchMenu, trackSortMenu, tracksFilterArtist, tracksFilterBar, tracksFilterField, tracksFilterPopover, tracksFilterTrigger } from './dom.js';
import { closeCustomContextMenu, handleCustomContextMenu } from './contextMenu.js';
import { handleLyricsFocusModeActivity, scheduleLyricsFocusMode, syncLyricsDockVolumeFromMain } from './lyricsDock.js';
import { defaultTrackSortDir, ensureTrackSortDirState, getSortPersistMode, loadFolderSortMode, loadPlaylistsViewSortMode, loadTrackSortModeForView, persistActiveTrackSortDir, persistFolderSortMode, persistPlaylistsViewSortMode, persistSidebarPlaylistSortMode, persistTrackSortMode, updateTrackSortLabelUI } from './sorting.js';
import { audio, getPlaybackPosition, isPlaybackPaused, setShuffleEnabled, shuffleArray, togglePlay } from '../audioPlayer.js';
import { persistPlaylists, state } from '../state.js';
import { stopLyricsActiveRowAnimation, updateActiveRowFill, updateSyncedLyricsProgress } from './lyricsRender.js';
import { SEARCH_PAGE_SIZE, uiVars } from './sharedState.js';
import { ARTIST_TRACK_PAGE_SIZE, renderPlaylistDetailView } from './playlistDetail.js';
import { closeProfileEditor, openProfileEditor, prepareProfilePhoto, refreshCurrentProfile, saveProfileEditor, setProfileEditorPhoto } from './profileEditor.js';
import { setFilterPopoverOpen, syncFilterTriggerState } from './trackFilters.js';
import { albumContextId, artistContextId, artistsFromCredit, invalidateLibraryEntityCaches, matchingAlbumSongs, matchingArtistSongs, syncPlayerAlbumLinkState } from './libraryEntities.js';
import { renderAllAlbumsUI, renderGrids } from './homeGrids.js';
import { navigateToView } from './navigation.js';
import { appendCollectionToQueue, exportCollectionM3U8, getCollectionForOptions, playCollectionShuffled, renderPlaylistsUI } from './collections.js';
import { renderFoldersUI, renderPlaylistsHubUI } from './folderPlaylistViews.js';
import { playFromContext, updatePlaylistRowTitleMarquee } from './playback.js';
import { closeDiscordRpcContextMenu, openDiscordRpcContextMenu } from '../discordRpc.js';
import { openFolderDescModal } from './modals.js';
import { createUnresolvedM3USong, isConfidentM3UMatch, openMissingSongsResolver, parseM3UEntries, rankM3UCandidates } from './m3uImport.js';
import { clearTempPlaylistCover, getSmartPlaylistSongs, persistPlaylistCover, setPlaylistModalDynamicMode, stampSongForPlaylist } from './playlistData.js';
import { clearContainerCovers } from './covers.js';
import { applyMetadataMatch, closeMetadataMatchModal, closeMetadataTextSearch, loadMetadataMatchCover, renderMetadataMatchDetails, searchMetadataByText, searchTrackMetadata, trackMetadataMatches } from './songDetails.js';
import { cleanupDragState, draggedPlaylistId, draggedQueueIndex, reorderPinnedPlaylists, reorderTrackRows, updateSidebarPlaylistReorderToggle, updateTrackReorderToggle } from './dragReorder.js';
import { hideSearchSuggestions, openSearchResults, renderSearchResultsContent, renderSearchSuggestions } from './search.js';
import { getFavoritesDisplayName, toggleFavoriteForSelection } from './favorites.js';
import { handleSongSelectionClick } from './selection.js';
import { playSongFromContext } from './songCards.js';
import { renderQueue } from './queueHistory.js';
import { addSmartPlaylistFilterRow, readSmartPlaylistFilters, setSmartPlaylistFilterOperator, setSmartPlaylistFilters, syncSmartPlaylistFilterRowInputs, updateSmartPlaylistFilterRemoveButtons } from './smartPlaylists.js';
import { escapeHtml, showConfirmDialog } from './uiUtils.js';
import { openLyricsSearch, openTrackEditor } from '../lyrics.js';

let listSearchDebounceTimer = null;

export let sidebarPlaylistDragReorderEnabled = localStorage.getItem('pn_sidebar_playlist_drag_reorder') !== 'false';

export let queueDetailShowHistory = localStorage.getItem('pn_queue_detail_show_history') === 'true';

export let albumsMinTrackCount = ['0', '3', '4', '5', '6'].includes(localStorage.getItem('pn_albums_min_tracks') || '0')
  ? Number(localStorage.getItem('pn_albums_min_tracks') || 0)
  : 0;

export let blockAlbumsBelowTrackFilter = localStorage.getItem('pn_albums_block_below_filter') !== 'false';

let searchInputDebounceTimer = null;

let lyricsPlaybackListenersInitialized = false;

export function initUI() {
  // Solo restaurar preferencia de layout; no activar pantalla completa al arrancar
  try {
    document.body.classList.remove('now-playing-fs');
    const layout = getNowPlayingFsLayout();
    document.body.classList.toggle('np-fs-swapped', layout === 'swapped');
    document.body.classList.toggle('np-fs-centered', layout === 'centered');
  } catch (_) {}
  // Cerrar menú contextual de pantalla completa al clicar fuera
  document.addEventListener('pointerdown', (e) => {
    try {
      if (!customContextMenu || !customContextMenu.classList.contains('open')) return;
      if (e.target && customContextMenu.contains(e.target)) return;
      if (e.target?.closest?.('#lyrics-focus-more-btn')) return;
      closeCustomContextMenu();
    } catch (_) {}
  }, true);

  // Volumen en pantalla completa (Now Playing FS)
  const npFsVol = document.getElementById('np-fs-volume-range');
  const mainVol = document.getElementById('volume-range');
  npFsVol?.addEventListener('input', () => {
    if (!mainVol) return;
    mainVol.value = npFsVol.value;
    mainVol.dispatchEvent(new Event('input', { bubbles: true }));
    syncLyricsDockVolumeFromMain();
  });
  document.getElementById('np-fs-volume-mute')?.addEventListener('click', () => {
    const muteBtn = document.getElementById('player-mute-btn') || document.getElementById('btn-mute');
    if (muteBtn) muteBtn.click();
    else if (mainVol) {
      const cur = Number(mainVol.value) || 0;
      if (cur > 0) {
        mainVol.dataset.prevVolume = String(cur);
        mainVol.value = '0';
      } else {
        mainVol.value = mainVol.dataset.prevVolume || '80';
      }
      mainVol.dispatchEvent(new Event('input', { bubbles: true }));
    }
    syncLyricsDockVolumeFromMain();
  });
  mainVol?.addEventListener('input', () => syncLyricsDockVolumeFromMain());



    window.addEventListener('pn-sort-persist-mode-changed', () => {
    loadTrackSortModeForView();
    loadFolderSortMode();
    loadPlaylistsViewSortMode();
  });

  if (!lyricsPlaybackListenersInitialized) {
    lyricsPlaybackListenersInitialized = true;
    audio.addEventListener('play', () => {
      if (state.isLyricsOpen) {
        updateSyncedLyricsProgress(getPlaybackPosition());
      }
    });
    audio.addEventListener('pause', () => {
      updateActiveRowFill(getPlaybackPosition());
      stopLyricsActiveRowAnimation();
    });
  }

  artistLoadMoreButton?.addEventListener('click', () => {
    if (state.currentView !== 'artist' || uiVars.isLoadingMoreTrackRows) return;
    const previousVisibleCount = uiVars.detailVisibleCount;
    uiVars.detailVisibleCount += ARTIST_TRACK_PAGE_SIZE;
    uiVars.isLoadingMoreTrackRows = true;
    void renderPlaylistDetailView({ append: true, previousVisibleCount })
      .catch(error => console.error('No se pudieron cargar más canciones del artista:', error))
      .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
  });

  document.getElementById('profile-editor-close')?.addEventListener('click', closeProfileEditor);
  document.getElementById('profile-editor-cancel')?.addEventListener('click', closeProfileEditor);
  document.getElementById('profile-editor-save')?.addEventListener('click', saveProfileEditor);
  document.getElementById('profile-editor-photo-pick')?.addEventListener('click', () => profileEditorPhotoInput?.click());
  document.getElementById('profile-editor-photo-remove')?.addEventListener('click', () => {
    uiVars.profileEditorPhotoData = null;
    setProfileEditorPhoto(null);
  });
  profileEditorPhotoInput?.addEventListener('change', async () => {
    const file = profileEditorPhotoInput.files?.[0];
    if (!file) return;
    profileEditorStatus.hidden = true;
    try {
      uiVars.profileEditorPhotoData = await prepareProfilePhoto(file);
      setProfileEditorPhoto(uiVars.profileEditorPhotoData);
    } catch (error) {
      profileEditorStatus.textContent = error.message || 'No se pudo procesar la imagen.';
      profileEditorStatus.hidden = false;
    }
  });
  profileEditorModal?.addEventListener('click', event => {
    if (event.target === profileEditorModal) event.stopPropagation();
  });
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
      albumsMinTrackCount = Number(albumsFilterCount.value) || 0;
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
      blockAlbumsBelowTrackFilter = albumsFilterLock.checked;
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

  if (btnCollectionOptions && collectionOptionsMenu) {
    btnCollectionOptions.addEventListener('click', event => {
      event.stopPropagation();
      collectionOptionsMenu.hidden = !collectionOptionsMenu.hidden;
      btnCollectionOptions.setAttribute('aria-expanded', String(!collectionOptionsMenu.hidden));
    });

    collectionOptionsMenu.addEventListener('click', event => {
      const actionButton = event.target.closest('[data-collection-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.collectionAction;
      collectionOptionsMenu.hidden = true;
      btnCollectionOptions.setAttribute('aria-expanded', 'false');
      if (action === 'edit-profile') {
        if (state.currentView === 'folder-detail') {
          const folder = state.configuredFolders.find(item => item.id === state.currentFolderId);
          if (folder) openFolderDescModal(folder);
        } else {
          openProfileEditor();
        }
        return;
      }
      if (action === 'refresh-profile') {
        void refreshCurrentProfile();
        return;
      }
      const collection = getCollectionForOptions();
      if (!collection) return;
      if (action === 'export') exportCollectionM3U8(collection);
      else if (action === 'find-missing' && state.currentView === 'playlist') {
        const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);
        if (playlist) {
          openMissingSongsResolver(playlist.songs || [], songs => {
            playlist.songs = songs;
            persistPlaylists();
            void renderPlaylistDetailView();
            renderPlaylistsUI();
          });
        }
      }
      else if (action === 'shuffle' && collection.songs.length) playCollectionShuffled(collection);
      else if (action === 'queue' && collection.songs.length) appendCollectionToQueue(collection);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // 1) Menú contextual
    closeCustomContextMenu();

    // 2) Portada expandida
    if (state.isCoverExpanded) {
      toggleExpandedCover(false);
      return;
    }

    // 3) Modales abiertos (solo Esc / cruz; no click afuera)
    const openOverlay = document.querySelector(
      '.modal-overlay.open, #playlist-modal-overlay.open, #confirm-modal-overlay.open'
    );
    if (openOverlay) {
      // Confirm ya maneja Escape con capture; evitar doble acción
      if (openOverlay.id === 'confirm-modal-overlay') return;

      e.preventDefault();

      if (openOverlay.id === 'playlist-modal-overlay') {
        openOverlay.classList.remove('open');
        state.editingPlaylistId = null;
        clearTempPlaylistCover();
        setPlaylistModalDynamicMode(false);
        return;
      }
      if (openOverlay.id === 'folder-desc-modal' || openOverlay === folderDescModal) {
        openOverlay.classList.remove('open');
        state.editingFolderId = null;
        return;
      }
      if (openOverlay.id === 'song-details-modal' || openOverlay === songDetailsModal) {
        openOverlay.classList.remove('open');
        clearContainerCovers(detailsCoverBox);
        uiVars.songDetailsTarget = null;
        return;
      }
      if (openOverlay.id === 'profile-editor-modal') {
        try { closeProfileEditor(); } catch (_) { openOverlay.classList.remove('open'); }
        return;
      }
      if (openOverlay.id === 'metadata-match-modal') {
        try { closeMetadataMatchModal(); } catch (_) { openOverlay.classList.remove('open'); }
        return;
      }
      if (openOverlay.id === 'metadata-text-search-modal') {
        try { closeMetadataTextSearch(); } catch (_) { openOverlay.classList.remove('open'); }
        return;
      }
      // multi-playlist / missing-songs / track-edit / lyrics-search: buscar botón cerrar
      const closeBtn = openOverlay.querySelector(
        '.btn-modal-close, [data-close-modal], .btn-close-modal, #btn-close-playlist-modal'
      );
      if (closeBtn) {
        closeBtn.click();
        return;
      }
      openOverlay.classList.remove('open');
      return;
    }
  });

  // Botón Atrás
  if (btnNavBack) {
    btnNavBack.addEventListener('click', () => {
      if (state.viewHistory.length > 0) {
        const prev = state.viewHistory.pop();
        navigateToView(prev.view, {
          playlistId: prev.playlistId,
          folderId: prev.folderId,
          artistName: prev.artistName,
          albumTitle: prev.albumTitle,
          albumArtistName: prev.albumArtistName
        }, false);
      } else {
        navigateToView('home', null, false);
      }
    });
  }

  // Buscador con debounce de 180ms para evitar saturar el hilo principal en bibliotecas grandes
  
  const listLocalSearchInput = document.getElementById('list-local-search-input');
  if (listLocalSearchInput) {
    listLocalSearchInput.setAttribute('autocomplete', 'off');
    listLocalSearchInput.addEventListener('input', () => {
      const raw = listLocalSearchInput.value;
      if (listSearchDebounceTimer !== null) window.clearTimeout(listSearchDebounceTimer);
      listSearchDebounceTimer = window.setTimeout(() => {
        listSearchDebounceTimer = null;
        uiVars.listSearchQuery = raw.trim();
        // Re-render lista actual sin cambiar de vista
        if (typeof renderPlaylistDetailView === 'function') {
          try { void renderPlaylistDetailView(); } catch (_) {}
        }
      }, 150);
    });
    listLocalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        listLocalSearchInput.value = '';
        uiVars.listSearchQuery = '';
        try { void renderPlaylistDetailView(); } catch (_) {}
      }
    });
  }

  
  const btnSidebarPlaylistReorder = document.getElementById('btn-toggle-sidebar-playlist-reorder');
  if (btnSidebarPlaylistReorder) {
    btnSidebarPlaylistReorder.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebarPlaylistDragReorderEnabled = !sidebarPlaylistDragReorderEnabled;
      localStorage.setItem('pn_sidebar_playlist_drag_reorder', String(sidebarPlaylistDragReorderEnabled));
      updateSidebarPlaylistReorderToggle();
      renderPlaylistsUI();
    });
    updateSidebarPlaylistReorderToggle();
  }

  if (searchInput) {
    // Evitar el desplegable nativo "Información guardada" de WebView2/Chromium
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('autocorrect', 'off');
    searchInput.setAttribute('autocapitalize', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    searchInput.setAttribute('data-1p-ignore', 'true');
    searchInput.setAttribute('data-lpignore', 'true');
    searchInput.setAttribute('data-form-type', 'other');
    // Nombre único para que el navegador no reutilice historial de otros campos
    if (!searchInput.name || searchInput.name === 'q' || searchInput.name === 'search') {
      searchInput.name = 'resonance-song-search';
    }
    searchInput.addEventListener('focus', () => {
      // Reforzar en cada foco (WebView2 a veces ignora el atributo estático)
      searchInput.setAttribute('autocomplete', 'off');
      if (!searchInput.value.trim()) hideSearchSuggestions();
    });
    searchInput.addEventListener('input', () => {
      const rawValue = searchInput.value;
      state.searchQuery = rawValue.trim();
      if (searchInputDebounceTimer !== null) {
        window.clearTimeout(searchInputDebounceTimer);
      }
      searchInputDebounceTimer = window.setTimeout(() => {
        searchInputDebounceTimer = null;
        if (state.currentView === 'search') {
          hideSearchSuggestions();
          uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
          renderSearchResultsContent();
        } else {
          renderSearchSuggestions(rawValue);
        }
      }, 180);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (searchInputDebounceTimer !== null) {
          window.clearTimeout(searchInputDebounceTimer);
          searchInputDebounceTimer = null;
        }
        const q = searchInput.value.trim();
        if (!q) return;
        openSearchResults(q);
      }
    });

    searchInput.addEventListener('blur', event => {
      if (searchSuggestions?.contains(event.relatedTarget)) return;
      window.setTimeout(() => {
        if (!searchSuggestions?.contains(document.activeElement)) hideSearchSuggestions();
      }, 120);
    });
  }

  // Píldoras de búsqueda (Canciones, Playlists, Carpetas, Cola de reproducción)
  document.querySelectorAll('.search-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.search-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.searchTab = pill.dataset.tab;
      uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
      renderSearchResultsContent();
    });
  });

  // Renderiza el siguiente bloque de filas, búsqueda o álbumes solo al acercarse al final.
  if (mainContent) {
    mainContent.addEventListener('scroll', () => {
      const scrollPos = mainContent.scrollTop + mainContent.clientHeight;
      const scrollMax = mainContent.scrollHeight;
      if (scrollMax - scrollPos >= 280 || uiVars.isLoadingMoreTrackRows) return;

      if (state.currentView === 'search' && (state.searchTab === 'songs' || state.searchTab === 'queue')) {
        const listLength = state.searchTab === 'songs'
          ? uiVars.renderedSearchSongsList.length
          : uiVars.renderedSearchQueueList.length;
        if (uiVars.searchVisibleCount >= listLength) return;
        const previousVisibleCount = uiVars.searchVisibleCount;
        uiVars.searchVisibleCount += SEARCH_PAGE_SIZE;
        uiVars.isLoadingMoreTrackRows = true;
        try {
          renderSearchResultsContent({ append: true, previousVisibleCount });
        } finally {
          uiVars.isLoadingMoreTrackRows = false;
        }
        return;
      }

      if (state.currentView === 'albums') {
        const renderedCount = allAlbumsGrid?.querySelectorAll('.library-album-card').length || 0;
        if (renderedCount < uiVars.albumGridVisibleCount) return;
        const previousVisibleCount = uiVars.albumGridVisibleCount;
        uiVars.albumGridVisibleCount += 50;
        uiVars.isLoadingMoreTrackRows = true;
        try {
          renderAllAlbumsUI({ append: true, previousVisibleCount });
        } finally {
          uiVars.isLoadingMoreTrackRows = false;
        }
        return;
      }

      if (!['all-music', 'playlist', 'favorites', 'folder-detail', 'album-detail'].includes(state.currentView)) {
        return;
      }
      // No comparar filas DOM vs visibleCount: MAX_DOM_TRACK_ROWS (~120) deja
      // renderedCount fijo y bloqueaba el scroll infinito al superar ~150.
      const previousVisibleCount = state.currentView === 'all-music'
        ? state.musicVisibleCount
        : uiVars.detailVisibleCount;
      const totalInList = Array.isArray(uiVars.renderedTrackList) ? uiVars.renderedTrackList.length : 0;
      if (totalInList > 0 && previousVisibleCount >= totalInList) return;
      if (state.currentView === 'all-music') state.musicVisibleCount += 50;
      else uiVars.detailVisibleCount += 50;
      uiVars.isLoadingMoreTrackRows = true;
      void renderPlaylistDetailView({ append: true, previousVisibleCount })
        .catch(error => console.error('No se pudieron cargar más canciones de la lista:', error))
        .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
    }, { passive: true });
  }

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

  btnOpenAlbums?.addEventListener('click', () => navigateToView('albums'));

  if (playerCoverBox) {
    playerCoverBox.addEventListener('click', (e) => {
      if (e.button === 0) {
        toggleExpandedCover();
      }
    });
  }

  if (btnCollapseCover) {
    btnCollapseCover.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpandedCover(false);
    });
  }

  // Navegación Sidebar
  navBtnHome.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToView('home');
  });

  if (navBtnMusic) {
    navBtnMusic.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('all-music');
    });
  }

  if (navBtnFolders) {
    navBtnFolders.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('folders');
    });
  }

  if (navBtnPlaylists) {
    navBtnPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('playlists-hub');
    });
  }

  btnOpenFavorites.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToView('favorites');
  });

  artistBioToggle?.addEventListener('click', () => {
    const expanded = playlistHeroDesc.classList.toggle('is-expanded');
    artistBioToggle.textContent = expanded ? 'Leer menos' : 'Leer más';
    artistBioToggle.setAttribute('aria-expanded', String(expanded));
  });

  btnPlayAllFavorites.addEventListener('click', () => {
    let songs = [];
    const isArtist = state.currentView === 'artist';
    const isAlbum = state.currentView === 'album-detail';
    let title = getFavoritesDisplayName();
    let ctx = 'favorites';
    if (state.currentView === 'favorites') {
      songs = state.localMusicFiles.filter(s => s.isFavorite);
    } else if (state.currentView === 'all-music') {
      songs = [...state.localMusicFiles];
      title = "Música";
      ctx = 'all_music';
    } else if (state.currentView === 'folder-detail') {
      const currentFolder = state.configuredFolders.find(f => f.id === state.currentFolderId);
      if (currentFolder) {
        songs = state.localMusicFiles.filter(s => s.folderName === currentFolder.name);
        title = currentFolder.name;
        ctx = 'folder_' + currentFolder.id;
        currentFolder.lastPlayed = Date.now();
      }
    } else if (state.currentView === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (pl) {
        songs = pl.songs || [];
        title = pl.title;
        ctx = 'playlist_' + pl.id;
      }
    } else if (state.currentView === 'artist') {
      songs = matchingArtistSongs(state.artistName);
      title = state.artistName;
      ctx = artistContextId(state.artistName);
    } else if (state.currentView === 'album-detail') {
      songs = matchingAlbumSongs(state.albumArtistName, state.albumTitle);
      title = `${state.albumTitle} — ${state.albumArtistName}`;
      ctx = albumContextId(state.albumArtistName, state.albumTitle);
    } else if (state.currentView === 'queue-detail') {
      songs = [...(state.activeQueue || [])];
      title = state.activeQueueTitle || 'Cola de reproducción';
      ctx = state.activeContextId || 'queue_detail';
    }
    if (isArtist && state.artistSortMode === 'plays') {
      songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    } else if (isArtist && state.artistSortMode === 'date') {
      songs.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
    } else if (isAlbum && state.albumSortMode === 'plays') {
      songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    } else if (isAlbum && state.albumSortMode === 'date') {
      songs.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
    } else if (isAlbum && state.albumSortMode === 'track') {
      songs.sort((a, b) => {
        const trackA = Number(a.trackNumber) || Number.MAX_SAFE_INTEGER;
        const trackB = Number(b.trackNumber) || Number.MAX_SAFE_INTEGER;
        return trackA - trackB;
      });
    }
    if (['favorites', 'all-music', 'folder-detail', 'playlist'].includes(state.currentView)) {
      const collection = getCollectionForOptions();
      if (collection) {
        songs = collection.songs;
        title = collection.title;
        ctx = collection.contextId;
      }
    }
    if (songs.length > 0) {
      if (state.currentView === 'queue-detail') {
        const idx = Math.max(0, state.currentTrackIndex >= 0 ? state.currentTrackIndex : 0);
        if (state.currentTrackIndex >= 0) {
          togglePlay();
        } else {
          playFromContext(songs, 0, title, true, ctx, false, true);
        }
      } else if (state.activeContextId === ctx && state.currentTrackIndex !== -1) {
        togglePlay();
      } else {
        playFromContext(songs, 0, title, true, ctx, true);
      }
    }
  });

  btnShuffleFavorites.addEventListener('click', () => {
    let songs = [];
    let title = getFavoritesDisplayName();
    let ctx = 'favorites';
    if (state.currentView === 'favorites') {
      songs = state.localMusicFiles.filter(s => s.isFavorite);
    } else if (state.currentView === 'all-music') {
      songs = [...state.localMusicFiles];
      title = "Música";
      ctx = 'all_music';
    } else if (state.currentView === 'folder-detail') {
      const currentFolder = state.configuredFolders.find(f => f.id === state.currentFolderId);
      if (currentFolder) {
        songs = state.localMusicFiles.filter(s => s.folderName === currentFolder.name);
        title = currentFolder.name;
        ctx = 'folder_' + currentFolder.id;
        currentFolder.lastPlayed = Date.now();
      }
    } else if (state.currentView === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (pl) {
        songs = pl.songs || [];
        title = pl.title;
        ctx = 'playlist_' + pl.id;
      }
    } else if (state.currentView === 'artist') {
      songs = matchingArtistSongs(state.artistName);
      title = state.artistName;
      ctx = artistContextId(state.artistName);
    } else if (state.currentView === 'album-detail') {
      songs = matchingAlbumSongs(state.albumArtistName, state.albumTitle);
      title = `${state.albumTitle} — ${state.albumArtistName}`;
      ctx = albumContextId(state.albumArtistName, state.albumTitle);
    } else if (state.currentView === 'queue-detail') {
      songs = [...(state.activeQueue || [])];
      title = state.activeQueueTitle || 'Cola de reproducción';
      ctx = state.activeContextId || 'queue_detail';
    }
    if (['favorites', 'all-music', 'folder-detail', 'playlist'].includes(state.currentView)) {
      const collection = getCollectionForOptions();
      if (collection) {
        songs = collection.songs;
        title = collection.title;
        ctx = collection.contextId;
      }
    }

    if (songs.length > 0) {
      setShuffleEnabled(true);

      const randIdx = Math.floor(Math.random() * songs.length);
      const firstSong = songs[randIdx];

      const remaining = songs.filter((_, i) => i !== randIdx);
      const shuffledRemaining = shuffleArray(remaining);

      const shuffledQueue = [firstSong, ...shuffledRemaining];
      playFromContext(shuffledQueue, 0, title, true, ctx);
    }
  });

  playerFavBtn.addEventListener('click', () => {
    if (state.currentTrackIndex === -1 || !state.activeQueue[state.currentTrackIndex]) return;
    const song = state.activeQueue[state.currentTrackIndex];
    void toggleFavoriteForSelection(song);
  });

  const appLayout = document.getElementById('app-layout');
  const btnToggleQueue = document.getElementById('btn-toggle-queue');
  const btnCloseQueue = document.getElementById('btn-close-queue');

  function toggleQueue() {
    state.isQueueOpen = !state.isQueueOpen;
    appLayout.classList.toggle('queue-hidden', !state.isQueueOpen);
    btnToggleQueue.classList.toggle('active-toggle', state.isQueueOpen);
  }

  btnToggleQueue.addEventListener('click', toggleQueue);
  btnCloseQueue.addEventListener('click', toggleQueue);

  btnToggleHistory.addEventListener('click', () => {
    state.isHistoryOpen = !state.isHistoryOpen;
    queueHistoryList.classList.toggle('open', state.isHistoryOpen);
    historyCaret.className = state.isHistoryOpen ? "ph ph-caret-down" : "ph ph-caret-right";
  });

  btnLyrics.addEventListener('click', () => {
    if (state.isLyricsOpen) closeLyricsView();
    else {
      setNowPlayingFullscreen(false);
      openLyricsView();
    }
  });

  document.getElementById('btn-now-playing-fs')?.addEventListener('click', () => {
    toggleNowPlayingFullscreen();
  });


  btnCloseLyrics.addEventListener('click', closeLyricsView);

  btnAddPlaylist.addEventListener('click', () => {
    state.editingPlaylistId = null;
    clearTempPlaylistCover();
    uiVars.tempImportedSongs = [];
    uiVars.tempImportedPlaylistHasM3U = false;
    playlistModalHeading.textContent = 'Crear playlist';
    modalCoverPreview.innerHTML = `<i class="ph ph-music-notes"></i>`;
    playlistTitleInput.value = `Mi playlist n.° ${state.playlists.length + 1}`;
    playlistDescInput.value = '';
    m3uImportStatus.style.display = "none";
    setSmartPlaylistFilters([{ field: 'date', value: '' }], 'and');
    document.getElementById('btn-find-imported-songs').hidden = true;
    setPlaylistModalDynamicMode(false);
    playlistModalOverlay.classList.add('open');
  });

  if (btnCreatePlaylistHub) {
    btnCreatePlaylistHub.addEventListener('click', () => {
      btnAddPlaylist.click();
    });
  }
  smartPlaylistToggle?.addEventListener('click', () => {
    setPlaylistModalDynamicMode(smartPlaylistToggle.getAttribute('aria-pressed') !== 'true');
  });
  smartPlaylistFilters?.addEventListener('change', event => {
    if (!event.target.matches('.smart-playlist-filter-field')) return;
    const row = event.target.closest('.smart-playlist-filter-row');
    syncSmartPlaylistFilterRowInputs(row, event.target.value, '');
  });
  smartPlaylistFilters?.addEventListener('click', event => {
    const removeButton = event.target.closest('.smart-playlist-remove-filter');
    if (!removeButton || smartPlaylistFilters.querySelectorAll('.smart-playlist-filter-row').length <= 1) return;
    removeButton.closest('.smart-playlist-filter-row').remove();
    updateSmartPlaylistFilterRemoveButtons();
  });
  smartPlaylistAddFilter?.addEventListener('click', () => {
    addSmartPlaylistFilterRow({ field: 'date', value: '' });
  });
  smartPlaylistLogic?.addEventListener('click', () => {
    setSmartPlaylistFilterOperator(smartPlaylistLogic.dataset.operator === 'and' ? 'or' : 'and');
  });

  // Alternadores de diseño del Hub
  if (btnLayoutStandard && btnLayoutOverlay) {
    if (state.playlistsViewLayout === 'overlay') {
      btnLayoutOverlay.classList.add('active');
      btnLayoutStandard.classList.remove('active');
    }

    btnLayoutStandard.addEventListener('click', () => {
      state.playlistsViewLayout = 'standard';
      localStorage.setItem('pn_playlists_layout', 'standard');
      btnLayoutStandard.classList.add('active');
      btnLayoutOverlay.classList.remove('active');
      renderPlaylistsHubUI();
    });

    btnLayoutOverlay.addEventListener('click', () => {
      state.playlistsViewLayout = 'overlay';
      localStorage.setItem('pn_playlists_layout', 'overlay');
      btnLayoutOverlay.classList.add('active');
      btnLayoutStandard.classList.remove('active');
      renderPlaylistsHubUI();
    });
  }

  btnClosePlaylistModal.addEventListener('click', () => {
    playlistModalOverlay.classList.remove('open');
    state.editingPlaylistId = null;
    clearTempPlaylistCover();
    setPlaylistModalDynamicMode(false);
  });

  // No cerrar al click fuera; solo Esc o botón X
  playlistModalOverlay.addEventListener('click', (e) => {
    if (e.target === playlistModalOverlay) e.stopPropagation();
  });

  // Modal descripción carpeta
  if (btnCloseFolderModal) {
    btnCloseFolderModal.addEventListener('click', () => {
      folderDescModal.classList.remove('open');
      state.editingFolderId = null;
    });
  }

  if (folderDescModal) {
    folderDescModal.addEventListener('click', (e) => {
      if (e.target === folderDescModal) {
        e.stopPropagation();
      }
    });
  }

  if (btnSaveFolderDesc) {
    btnSaveFolderDesc.addEventListener('click', () => {
      if (state.editingFolderId !== null) {
        const folder = state.configuredFolders.find(f => f.id === state.editingFolderId);
        if (folder) {
          folder.description = folderDescInput.value.trim();
          const descs = JSON.parse(localStorage.getItem('pn_folder_descs') || '{}');
          descs[folder.name] = folder.description;
          localStorage.setItem('pn_folder_descs', JSON.stringify(descs));
          localStorage.setItem('pn_folders_info', JSON.stringify(state.configuredFolders));
          renderFoldersUI();
          if (state.currentView === 'folder-detail' && state.currentFolderId === folder.id) {
            renderPlaylistDetailView();
          }
        }
      }
      folderDescModal.classList.remove('open');
      state.editingFolderId = null;
    });
  }

  modalCoverPicker.addEventListener('click', () => {
    playlistImageInput.click();
  });

  playlistImageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) {
      if (uiVars.tempCoverFile && uiVars.tempModalCoverUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(uiVars.tempModalCoverUrl);
      }
      uiVars.tempCoverFile = file;
      uiVars.tempModalCoverUrl = URL.createObjectURL(file);
      modalCoverPreview.innerHTML = `<img src="${escapeHtml(uiVars.tempModalCoverUrl)}" class="modal-preview-img" alt="Cover" />`;
    }
  });

  btnImportPlaylistFile.addEventListener('click', () => {
    playlistFileImportInput.click();
  });

  playlistFileImportInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const entries = parseM3UEntries(ev.target.result);
      uiVars.tempImportedPlaylistHasM3U = true;
      let automaticallyLocated = 0;
      uiVars.tempImportedSongs = entries.map(entry => {
        const ranked = rankM3UCandidates(entry);
        const best = ranked[0];
        if (best && isConfidentM3UMatch(entry, ranked)) {
          automaticallyLocated++;
          return best.song;
        }
        return createUnresolvedM3USong(entry);
      });
      const cleanFileName = file.name.substring(0, file.name.lastIndexOf('.'));
      if (cleanFileName) playlistTitleInput.value = cleanFileName;

      const unresolvedCount = uiVars.tempImportedSongs.filter(song => song.isUnresolvedM3U).length;
      m3uImportStatus.textContent = `${automaticallyLocated} canciones asociadas, ${unresolvedCount} por confirmar`;
      m3uImportStatus.style.display = "inline";
      document.getElementById('btn-find-imported-songs').hidden = unresolvedCount === 0;
      if (unresolvedCount) {
        openMissingSongsResolver(uiVars.tempImportedSongs, songs => {
          uiVars.tempImportedSongs = songs;
          const remaining = uiVars.tempImportedSongs.filter(song => song.isUnresolvedM3U).length;
          m3uImportStatus.textContent = `${uiVars.tempImportedSongs.length - remaining} canciones asociadas, ${remaining} sin ubicar`;
          document.getElementById('btn-find-imported-songs').hidden = remaining === 0;
        }, false);
      }
    };
    reader.readAsText(file);
    playlistFileImportInput.value = '';
  });

  document.getElementById('btn-find-imported-songs').addEventListener('click', () => {
    if (!uiVars.tempImportedPlaylistHasM3U) return;
    openMissingSongsResolver(uiVars.tempImportedSongs, songs => {
      uiVars.tempImportedSongs = songs;
      const remaining = uiVars.tempImportedSongs.filter(song => song.isUnresolvedM3U).length;
      m3uImportStatus.textContent = `${uiVars.tempImportedSongs.length - remaining} canciones asociadas, ${remaining} sin ubicar`;
      document.getElementById('btn-find-imported-songs').hidden = remaining === 0;
    });
  });

  btnSavePlaylist.addEventListener('click', async () => {
    const title = playlistTitleInput.value.trim() || `Mi playlist n.° ${state.playlists.length + 1}`;
    const desc = playlistDescInput.value.trim();
    const isSmartPlaylist = playlistModalOverlay.dataset.mode === 'smart';
    const smartFilter = isSmartPlaylist
      ? {
        filters: readSmartPlaylistFilters(),
        operator: smartPlaylistLogic?.dataset.operator === 'or' ? 'or' : 'and'
      }
      : null;

    const playlistId = state.editingPlaylistId ?? Date.now();
    btnSavePlaylist.disabled = true;
    try {
      const coverUrl = await persistPlaylistCover(playlistId);
      if (state.editingPlaylistId !== null) {
        const existingPl = state.playlists.find(p => p.id === state.editingPlaylistId);
        if (existingPl) {
          const wasSmartPlaylist = Boolean(existingPl.smartFilter);
          existingPl.title = title;
          existingPl.description = desc;
          if (isSmartPlaylist) {
            existingPl.smartFilter = smartFilter;
            existingPl.songs = [];
            if (coverUrl) existingPl.coverUrl = coverUrl;
          } else {
            if (wasSmartPlaylist) existingPl.songs = getSmartPlaylistSongs(existingPl);
            delete existingPl.smartFilter;
            delete existingPl.viewFilter;
            existingPl.coverUrl = coverUrl;
          }
        }
        state.editingPlaylistId = null;
      } else {
        const newPlaylist = {
          id: playlistId,
          title,
          description: desc,
          coverUrl,
          songs: isSmartPlaylist ? [] : uiVars.tempImportedSongs.map((song, index) => (
            song?.playlistAddedAt ? song : stampSongForPlaylist(song, Date.now() + index)
          )),
          createdAt: Date.now(),
          isPinned: true
        };
        if (isSmartPlaylist) newPlaylist.smartFilter = smartFilter;
        state.playlists.push(newPlaylist);
      }

      uiVars.tempImportedSongs = [];
      persistPlaylists();
      renderPlaylistsUI();
      if (state.currentView === 'playlists-hub') {
        renderPlaylistsHubUI();
      }
      if (state.currentView === 'playlist') {
        renderPlaylistDetailView();
      }
      playlistModalOverlay.classList.remove('open');
      clearTempPlaylistCover();
      setPlaylistModalDynamicMode(false);
    } catch (error) {
      console.error('No se pudo guardar la portada de la playlist:', error);
      await showConfirmDialog({
        title: 'No se pudo guardar la playlist',
        message: error instanceof Error ? error.message : 'Ocurrió un error inesperado al guardar la portada.',
        confirmText: 'Entendido',
        showCancel: false
      });
    } finally {
      btnSavePlaylist.disabled = false;
    }
  });

  btnSortPlaylists.addEventListener('click', (e) => {
    e.stopPropagation();
    sortDropdownMenu.classList.toggle('open');
  });

  
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
      queueDetailShowHistory = !queueDetailShowHistory;
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

  btnCloseSongDetails.addEventListener('click', () => {
    songDetailsModal.classList.remove('open');
    clearContainerCovers(detailsCoverBox);
    uiVars.songDetailsTarget = null;
  });
  btnCloseDetailsBtn.addEventListener('click', () => {
    songDetailsModal.classList.remove('open');
    clearContainerCovers(detailsCoverBox);
    uiVars.songDetailsTarget = null;
  });
  btnDetailsSearchLyrics.addEventListener('click', () => {
    if (uiVars.songDetailsTarget) openLyricsSearch(uiVars.songDetailsTarget);
  });
  btnDetailsEditTrack.addEventListener('click', () => {
    if (uiVars.songDetailsTarget) openTrackEditor(uiVars.songDetailsTarget);
  });
  btnFetchTrackMetadata?.addEventListener('click', event => {
    event.stopPropagation();
    const isOpen = !trackMetadataSearchMenu.hidden;
    trackMetadataSearchMenu.hidden = isOpen;
    btnFetchTrackMetadata.setAttribute('aria-expanded', String(!isOpen));
  });
  trackMetadataSearchMenu?.addEventListener('click', event => {
    const option = event.target.closest('[data-metadata-search]');
    if (option) void searchTrackMetadata(option.dataset.metadataSearch);
  });
  metadataMatchList?.addEventListener('click', event => {
    const card = event.target.closest('[data-match-index]');
    if (!card) return;
    const index = Number(card.dataset.matchIndex);
    const match = trackMetadataMatches[index];
    if (!match) return;

    if (event.target.closest('[data-metadata-expand]')) {
      const button = event.target.closest('[data-metadata-expand]');
      const details = card.querySelector('[data-metadata-details]');
      const isExpanded = !details.hidden;
      details.hidden = isExpanded;
      button.setAttribute('aria-expanded', String(!isExpanded));
      if (!isExpanded) {
        renderMetadataMatchDetails(card, match);
        void loadMetadataMatchCover(card, match);
      }
      return;
    }
    if (event.target.closest('[data-metadata-copy-all]')) {
      void applyMetadataMatch(index);
      return;
    }
    const singleFieldButton = event.target.closest('[data-metadata-copy-field]');
    if (singleFieldButton) {
      void applyMetadataMatch(index, [singleFieldButton.dataset.metadataCopyField]);
      return;
    }
    if (event.target.closest('[data-metadata-copy-selected]')) {
      const fields = [...card.querySelectorAll('[data-metadata-field]:checked')]
        .map(input => input.dataset.metadataField);
      if (fields.length) void applyMetadataMatch(index, fields);
    }
  });
  metadataMatchClose?.addEventListener('click', closeMetadataMatchModal);
  metadataMatchModal?.addEventListener('click', event => {
    if (event.target === metadataMatchModal) event.stopPropagation();
  });
  metadataTextSearchClose?.addEventListener('click', closeMetadataTextSearch);
  metadataTextSearchModal?.addEventListener('click', event => {
    if (event.target === metadataTextSearchModal) event.stopPropagation();
  });
  metadataSearchSubmit?.addEventListener('click', () => {
    void searchMetadataByText(
      metadataSearchTitle.value,
      metadataSearchArtist.value,
      metadataSearchAlbum.value
    );
  });
  [metadataSearchTitle, metadataSearchArtist, metadataSearchAlbum].forEach(input => {
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        metadataSearchSubmit?.click();
      }
    });
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.metadata-search-wrap')) return;
    if (trackMetadataSearchMenu) trackMetadataSearchMenu.hidden = true;
    btnFetchTrackMetadata?.setAttribute('aria-expanded', 'false');
  });
  songDetailsModal.addEventListener('click', (e) => {
    if (e.target === songDetailsModal) e.stopPropagation();
  });
}
