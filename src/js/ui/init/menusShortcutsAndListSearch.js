// UI · Menú de colección, atajos de teclado, navegación atrás y búsqueda local en listas.

import { btnCollectionOptions, btnNavBack, collectionOptionsMenu, detailsCoverBox, folderDescModal, songDetailsModal } from '../dom.js';
import { persistPlaylists, state } from '../../state.js';
import { openFolderDescModal } from '../modals.js';
import { closeProfileEditor, openProfileEditor, refreshCurrentProfile } from '../profileEditor.js';
import { appendCollectionToQueue, exportCollectionM3U8, getCollectionForOptions, playCollectionShuffled, renderPlaylistsUI } from '../collections.js';
import { openMissingSongsResolver } from '../m3uImport.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { closeCustomContextMenu } from '../contextMenu.js';
import { toggleExpandedCover } from '../nowPlayingFs.js';
import { clearTempPlaylistCover, setPlaylistModalDynamicMode } from '../playlistData.js';
import { clearContainerCovers } from '../covers.js';
import { uiVars } from '../sharedState.js';
import { closeMetadataMatchModal, closeMetadataTextSearch } from '../songDetails.js';
import { navigateToView } from '../navigation.js';
import { setSidebarPlaylistDragReorderEnabled, sidebarPlaylistDragReorderEnabled } from '../init.js';
import { updateSidebarPlaylistReorderToggle } from '../dragReorder.js';

let listSearchDebounceTimer = null;

/** Menú de opciones de colección, atajos de teclado, navegación atrás y búsqueda local en listas. */
export function bindMenusShortcutsAndListSearch() {

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
      setSidebarPlaylistDragReorderEnabled(!sidebarPlaylistDragReorderEnabled);
      localStorage.setItem('pn_sidebar_playlist_drag_reorder', String(sidebarPlaylistDragReorderEnabled));
      updateSidebarPlaylistReorderToggle();
      renderPlaylistsUI();
    });
    updateSidebarPlaylistReorderToggle();
  }
}
