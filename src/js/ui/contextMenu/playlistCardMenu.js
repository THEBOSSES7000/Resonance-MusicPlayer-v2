// UI · Menú contextual de una tarjeta de playlist (hub o lateral).

import { persistPlaylists, state } from '../../state.js';
import { getPlaylistSongs, getSmartPlaylistSongs } from '../playlistData.js';
import { playFromContext } from '../playback.js';
import { showConfirmDialog } from '../uiUtils.js';
import { getCollectionQueueContextItems, renderPlaylistsUI } from '../collections.js';
import { openEditPlaylistModal } from '../modals.js';
import { renderPlaylistsHubUI } from '../folderPlaylistViews.js';
import { reorderPinnedPlaylists } from '../dragReorder.js';
import { navigateToView } from '../navigation.js';

/** Menú contextual de una tarjeta de playlist (hub o lateral). */
export function buildPlaylistCardContextItems(target, items, playlistHubCard, playlistCardLeft) {
  const el = playlistCardLeft || playlistHubCard;
  const plId = Number(el.dataset.id);
  const plIndex = Number(el.dataset.index);
  const playlist = state.playlists.find(p => p.id === plId);

  if (playlist) {
    const isPinned = playlist.isPinned !== false;
    const collection = {
      title: playlist.title,
      songs: playlist.smartFilter ? getSmartPlaylistSongs(playlist) : (playlist.songs || []),
      contextId: `playlist_${playlist.id}`
    };

    items.push({
      label: 'Reproducir playlist',
      icon: 'ph ph-play',
      action: () => {
        if (getPlaylistSongs(playlist).length > 0) {
          playFromContext(getPlaylistSongs(playlist), 0, playlist.title, true, 'playlist_' + playlist.id, true);
        } else {
          showConfirmDialog({
            title: "Playlist vacía",
            message: "Esta playlist no contiene canciones aún.",
            confirmText: "Aceptar",
            showCancel: false
          });
        }
      }
    });
    items.push(...getCollectionQueueContextItems(collection));
    items.push({
      label: 'Abrir playlist',
      icon: 'ph ph-folder-open',
      action: () => el.click()
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
        if (state.currentView === 'playlists-hub') {
          renderPlaylistsHubUI();
        }
      }
    });

    if (playlistCardLeft && state.playlistSortMode === 'custom') {
      const pinnedPlaylists = state.playlists.filter(p => p.isPinned !== false);
      items.push({ type: 'separator' });
      items.push({
        label: 'Subir de posición',
        icon: 'ph ph-arrow-up',
        disabled: plIndex <= 0,
        action: () => {
          if (plIndex > 0) {
            reorderPinnedPlaylists(plId, pinnedPlaylists[plIndex - 1].id);
          }
        }
      });
      items.push({
        label: 'Bajar de posición',
        icon: 'ph ph-arrow-down',
        disabled: plIndex >= pinnedPlaylists.length - 1,
        action: () => {
          if (plIndex < pinnedPlaylists.length - 1) {
            reorderPinnedPlaylists(plId, pinnedPlaylists[plIndex + 1].id, true);
          }
        }
      });
    }

    items.push({ type: 'separator' });
    items.push({
      label: 'Eliminar playlist',
      icon: 'ph ph-trash',
      action: async () => {
        const proceed = await showConfirmDialog({
          title: "¿Eliminar playlist?",
          message: `¿Estás seguro de que deseas eliminar permanentemente la lista "${playlist.title}"?`,
          confirmText: "Eliminar",
          cancelText: "Cancelar"
        });
        if (proceed) {
          state.playlists = state.playlists.filter(p => p.id !== plId);
          persistPlaylists();
          if (state.currentView === 'playlist' && state.currentPlaylistId === plId) {
            navigateToView('home');
          }
          renderPlaylistsUI();
          if (state.currentView === 'playlists-hub') {
            renderPlaylistsHubUI();
          }
        }
      }
    });
  }
  return items;
}
