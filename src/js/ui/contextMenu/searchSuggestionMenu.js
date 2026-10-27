// UI · Menú contextual de una sugerencia de búsqueda.

import { persistPlaylists, state } from '../../state.js';
import { addSongContextActions } from './songActions.js';
import { navigateToView } from '../navigation.js';
import { getCollectionExportContextItem, getCollectionQueueContextItems, renderPlaylistsUI } from '../collections.js';
import { openEditPlaylistModal, openFolderDescModal } from '../modals.js';
import { togglePlay } from '../../audioPlayer.js';
import { getPlaylistSongs, getSmartPlaylistSongs } from '../playlistData.js';
import { playFromContext } from '../playback.js';
import { showConfirmDialog } from '../uiUtils.js';
import { renderPlaylistsHubUI } from '../folderPlaylistViews.js';

/** Menú contextual de una sugerencia de búsqueda. */
export function buildSearchSuggestionContextItems(target, items, searchSuggestion) {
  const type = searchSuggestion.dataset.quickType;
  const id = searchSuggestion.dataset.quickId;
  if (type === 'song') {
    const song = state.songsById?.get?.(String(id)) || state.localMusicFiles.find(item => String(item.id) === id);
    if (song) addSongContextActions(items, song);
  } else if (type === 'folder') {
    const folder = state.configuredFolders?.find(item => String(item.id) === id);
    if (folder) {
      const collection = {
        title: folder.name,
        songs: state.localMusicFiles.filter(song => song.folderName === folder.name),
        contextId: `folder_${folder.id}`
      };
      const isSaved = (state.quickAccess || []).some(entry =>
        entry.type === 'folder' && entry.name === folder.name
      );
      items.push({
        label: 'Abrir carpeta',
        icon: 'ph ph-folder-open',
        action: () => navigateToView('folder-detail', { folderId: folder.id })
      });
      items.push(...getCollectionQueueContextItems(collection));
      items.push(getCollectionExportContextItem(collection));
      items.push({ type: 'separator' });
      items.push({
        label: 'Editar descripción',
        icon: 'ph ph-pencil-simple',
        action: () => openFolderDescModal(folder)
      });
      items.push({ type: 'separator' });
      items.push({
        label: isSaved ? 'Quitar de acceso directo' : 'Agregar a acceso directo',
        icon: isSaved ? 'ph ph-push-pin-slash' : 'ph ph-push-pin',
        action: () => {
          state.quickAccess = Array.isArray(state.quickAccess) ? state.quickAccess : [];
          state.quickAccess = isSaved
            ? state.quickAccess.filter(entry => entry.type !== 'folder' || entry.name !== folder.name)
            : [...state.quickAccess, { type: 'folder', name: folder.name }];
          localStorage.setItem('pn_quick_access', JSON.stringify(state.quickAccess));
          renderPlaylistsUI();
        }
      });
    }
  } else if (type === 'playlist') {
    const playlist = state.playlists.find(item => String(item.id) === id);
    if (playlist) {
      const isPinned = playlist.isPinned !== false;
      items.push({
        label: 'Reproducir playlist',
        icon: 'ph ph-play',
        action: () => {
          const contextId = `playlist_${playlist.id}`;
          const currentSong = state.currentTrackIndex !== -1
            ? state.activeQueue[state.currentTrackIndex]
            : null;
          if (currentSong && state.activeContextId === contextId) {
            togglePlay();
          } else if (getPlaylistSongs(playlist).length) {
            playFromContext(getPlaylistSongs(playlist), 0, playlist.title, true, contextId, true);
          } else {
            showConfirmDialog({
              title: 'Playlist vacía',
              message: 'Esta playlist no contiene canciones aún.',
              confirmText: 'Aceptar',
              showCancel: false
            });
          }
        }
      });
      items.push(...getCollectionQueueContextItems({
        title: playlist.title,
        songs: playlist.smartFilter ? getSmartPlaylistSongs(playlist) : (playlist.songs || []),
        contextId: `playlist_${playlist.id}`
      }));
      items.push({ type: 'separator' });
      items.push({
        label: 'Abrir playlist',
        icon: 'ph ph-folder-open',
        action: () => navigateToView('playlist', { playlistId: playlist.id })
      });
      items.push({
        label: 'Editar playlist',
        icon: 'ph ph-pencil-simple',
        action: () => openEditPlaylistModal(playlist)
      });
      items.push({ type: 'separator' });
      items.push({
        label: isPinned ? 'Desfijar de acceso directo' : 'Fijar en acceso directo',
        icon: isPinned ? 'ph ph-push-pin-slash' : 'ph ph-push-pin',
        action: () => {
          playlist.isPinned = !isPinned;
          persistPlaylists();
          renderPlaylistsUI();
          if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
        }
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Eliminar playlist',
        icon: 'ph ph-trash',
        action: async () => {
          const proceed = await showConfirmDialog({
            title: '¿Eliminar playlist?',
            message: `¿Estás seguro de que deseas eliminar permanentemente la lista "${playlist.title}"?`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar'
          });
          if (!proceed) return;
          state.playlists = state.playlists.filter(item => item.id !== playlist.id);
          persistPlaylists();
          if (state.currentView === 'playlist' && state.currentPlaylistId === playlist.id) {
            navigateToView('home');
          }
          renderPlaylistsUI();
          if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
        }
      });
    }
  }
  return items;
}
