// UI · Cola, historial, letras y modales de playlists/carpetas con importación y guardado.

import { persistPlaylists, state } from '../../state.js';
import { btnAddPlaylist, btnCloseFolderModal, btnCloseLyrics, btnClosePlaylistModal, btnCreatePlaylistHub, btnImportPlaylistFile, btnLayoutOverlay, btnLayoutStandard, btnLyrics, btnSaveFolderDesc, btnSavePlaylist, btnSortPlaylists, btnToggleHistory, folderDescInput, folderDescModal, historyCaret, m3uImportStatus, modalCoverPicker, modalCoverPreview, playlistDescInput, playlistFileImportInput, playlistImageInput, playlistModalHeading, playlistModalOverlay, playlistTitleInput, queueHistoryList, smartPlaylistAddFilter, smartPlaylistFilters, smartPlaylistLogic, smartPlaylistToggle, sortDropdownMenu } from '../dom.js';
import { closeLyricsView, openLyricsView, setNowPlayingFullscreen, toggleNowPlayingFullscreen } from '../nowPlayingFs.js';
import { clearTempPlaylistCover, getSmartPlaylistSongs, persistPlaylistCover, setPlaylistModalDynamicMode, stampSongForPlaylist } from '../playlistData.js';
import { uiVars } from '../sharedState.js';
import { addSmartPlaylistFilterRow, readSmartPlaylistFilters, setSmartPlaylistFilterOperator, setSmartPlaylistFilters, syncSmartPlaylistFilterRowInputs, updateSmartPlaylistFilterRemoveButtons } from '../smartPlaylists.js';
import { renderFoldersUI, renderPlaylistsHubUI } from '../folderPlaylistViews.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { escapeHtml, showConfirmDialog } from '../uiUtils.js';
import { createUnresolvedM3USong, findM3ULibraryMatch, isConfidentM3UMatch, openMissingSongsResolver, parseM3UPlaylist, rankM3UCandidates } from '../m3uImport.js';
import { renderPlaylistsUI } from '../collections.js';

/** Cola, historial, letras, y modales de playlists/carpetas con importación y guardado. */
export function bindPlaylistModals() {

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
    uiVars.tempImportedPlaylistMetadata = null;
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

  const applyM3UImport = (contents, name, path = '') => {
    const imported = parseM3UPlaylist(contents, name.replace(/\.[^.]+$/, ''));
    const entries = imported.entries;
    uiVars.tempImportedPlaylistMetadata = imported;
    uiVars.tempImportedPlaylistHasM3U = true;
    let automaticallyLocated = 0;
    uiVars.tempImportedSongs = entries.map(entry => {
      const exact = findM3ULibraryMatch(entry, path);
      if (exact) {
        automaticallyLocated++;
        return exact;
      }
      const ranked = rankM3UCandidates(entry);
      const best = ranked[0];
      if (best && isConfidentM3UMatch(entry, ranked)) {
        automaticallyLocated++;
        return best.song;
      }
      return createUnresolvedM3USong(entry);
    });
    playlistTitleInput.value = imported.name || name.replace(/\.[^.]+$/, '');
    playlistDescInput.value = imported.description || '';
    clearTempPlaylistCover();
    if (imported.cover) {
      uiVars.tempModalCoverUrl = imported.cover;
      modalCoverPreview.innerHTML = `<img src="${escapeHtml(imported.cover)}" class="modal-preview-img" alt="Cover" />`;
    } else {
      modalCoverPreview.innerHTML = '<i class="ph ph-music-notes"></i>';
    }
    const unresolvedCount = uiVars.tempImportedSongs.filter(song => song.isUnresolvedM3U).length;
    m3uImportStatus.textContent = `${automaticallyLocated} canciones asociadas, ${unresolvedCount} por confirmar`;
    m3uImportStatus.style.display = 'inline';
    document.getElementById('btn-find-imported-songs').hidden = unresolvedCount === 0;
    if (unresolvedCount) {
      openMissingSongsResolver(uiVars.tempImportedSongs, songs => {
        uiVars.tempImportedSongs = songs;
        const remaining = songs.filter(song => song.isUnresolvedM3U).length;
        m3uImportStatus.textContent = `${songs.length - remaining} canciones asociadas, ${remaining} sin ubicar`;
        document.getElementById('btn-find-imported-songs').hidden = remaining === 0;
      }, false);
    }
  };

  btnImportPlaylistFile.addEventListener('click', async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') {
      try {
        const selected = await invoke('load_m3u8_file');
        if (selected) applyM3UImport(selected.contents, selected.name, selected.path);
      } catch (error) {
        console.error('No se pudo importar la playlist M3U8:', error);
        await showConfirmDialog({
          title: 'No se pudo importar',
          message: error instanceof Error ? error.message : 'Ocurrió un error al leer el archivo.',
          confirmText: 'Entendido',
          showCancel: false
        });
      }
      return;
    }
    playlistFileImportInput.click();
  });

  playlistFileImportInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      applyM3UImport(ev.target.result, file.name);
    };
    reader.onerror = () => {
      void showConfirmDialog({
        title: 'No se pudo importar',
        message: reader.error?.message || 'No se pudo leer el archivo de playlist.',
        confirmText: 'Entendido',
        showCancel: false
      });
    };
    reader.readAsText(file);
    playlistFileImportInput.value = '';
  });

  playlistModalOverlay.addEventListener('dragover', event => {
    if ([...(event.dataTransfer?.items || [])].some(item =>
      item.kind === 'file' && /\.(?:m3u8?|pls)$/i.test(item.getAsFile()?.name || '')
    )) event.preventDefault();
  });
  playlistModalOverlay.addEventListener('drop', event => {
    const file = [...(event.dataTransfer?.files || [])].find(item => /\.(?:m3u8?|pls)$/i.test(item.name));
    if (!file) return;
    event.preventDefault();
    const reader = new FileReader();
    reader.onload = loadEvent => applyM3UImport(loadEvent.target.result, file.name);
    reader.onerror = () => {
      void showConfirmDialog({
        title: 'No se pudo importar',
        message: 'No se pudo leer el archivo de playlist arrastrado.',
        confirmText: 'Entendido',
        showCancel: false
      });
    };
    reader.readAsText(file);
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
    const desc = uiVars.tempImportedPlaylistMetadata
      ? playlistDescInput.value
      : playlistDescInput.value.trim();
    const isSmartPlaylist = playlistModalOverlay.dataset.mode === 'smart';
    const smartFilter = isSmartPlaylist
      ? {
        filters: readSmartPlaylistFilters(),
        operator: smartPlaylistLogic?.dataset.operator === 'or' ? 'or' : 'and'
      }
      : null;

    const importedId = uiVars.tempImportedPlaylistMetadata?.id;
    const playlistId = state.editingPlaylistId ?? importedId ?? Date.now();
    btnSavePlaylist.disabled = true;
    try {
      const coverUrl = await persistPlaylistCover(playlistId);
      const existingId = state.editingPlaylistId ?? (importedId == null ? null : playlistId);
      const existingPl = existingId == null
        ? null
        : state.playlists.find(p => String(p.id) === String(existingId));
      if (existingPl) {
        const wasSmartPlaylist = Boolean(existingPl.smartFilter);
        existingPl.title = title;
        existingPl.description = desc;
        if (isSmartPlaylist) {
          existingPl.smartFilter = smartFilter;
          existingPl.songs = [];
          if (coverUrl) existingPl.coverUrl = coverUrl;
        } else {
          if (importedId != null && state.editingPlaylistId == null) {
            existingPl.songs = uiVars.tempImportedSongs.map((song, index) => (
              song?.playlistAddedAt ? song : stampSongForPlaylist(song, Date.now() + index)
            ));
          } else if (wasSmartPlaylist) {
            existingPl.songs = getSmartPlaylistSongs(existingPl);
          }
          delete existingPl.smartFilter;
          delete existingPl.viewFilter;
          existingPl.coverUrl = coverUrl || null;
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
      uiVars.tempImportedPlaylistMetadata = null;
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
      console.error('No se pudo guardar la playlist:', error);
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
}
