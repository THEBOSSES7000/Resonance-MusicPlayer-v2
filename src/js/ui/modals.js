// UI · Modales de edición de playlist y descripción de carpeta.

import { clearTempPlaylistCover, setPlaylistModalDynamicMode } from './playlistData.js';
import { state } from '../state.js';
import { uiVars } from './sharedState.js';
import { folderDescInput, folderDescModal, folderModalName, modalCoverPreview, modalImportRowContainer, playlistDescInput, playlistModalHeading, playlistModalOverlay, playlistTitleInput } from './dom.js';
import { setSmartPlaylistFilters } from './smartPlaylists.js';

import { escapeHtml } from './uiUtils.js';
export function openEditPlaylistModal(playlist) {
  if (!playlist) return;
  clearTempPlaylistCover();
  state.editingPlaylistId = playlist.id;
  uiVars.tempModalCoverUrl = playlist.coverUrl || null;
  uiVars.tempImportedSongs = playlist.songs || [];
  uiVars.tempImportedPlaylistHasM3U = false;
  document.getElementById('btn-find-imported-songs').hidden = true;

  playlistModalHeading.textContent = "Editar playlist";
  playlistTitleInput.value = playlist.title || "";
  playlistDescInput.value = playlist.description || "";
  const isSmartPlaylist = Boolean(playlist.smartFilter);
  setPlaylistModalDynamicMode(isSmartPlaylist);
  const savedSmartFilter = playlist.smartFilter || {};
  const savedSmartFilters = Array.isArray(savedSmartFilter.filters)
    ? savedSmartFilter.filters
    : [{ field: savedSmartFilter.field || 'date', value: savedSmartFilter.value || '' }];
  setSmartPlaylistFilters(savedSmartFilters, savedSmartFilter.operator);

  if (playlist.coverUrl) {
    modalCoverPreview.innerHTML = `<img src="${escapeHtml(playlist.coverUrl)}" class="modal-preview-img" alt="Cover" />`;
  } else {
    modalCoverPreview.innerHTML = `<i class="ph ph-music-notes"></i>`;
  }

  modalImportRowContainer.style.display = 'none';
  playlistModalOverlay.classList.add('open');
}

export function openFolderDescModal(folder) {
  if (!folder) return;
  state.editingFolderId = folder.id;
  folderModalName.textContent = folder.name;
  folderDescInput.value = folder.description || "";
  folderDescModal.classList.add('open');
}
