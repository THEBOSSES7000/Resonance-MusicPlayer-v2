// UI · Menú contextual de un elemento de acceso rápido.

import { state } from '../../state.js';
import { getCollectionExportContextItem, getCollectionQueueContextItems, renderPlaylistsUI, sameQuickSongReference } from '../collections.js';
import { playFromContext } from '../playback.js';
import { navigateToView } from '../navigation.js';
import { artistsFromCredit } from '../libraryEntities.js';

/** Menú contextual de un elemento de acceso rápido. */
export function buildQuickAccessContextItems(target, items, quickAccessItem) {
  const type = quickAccessItem.dataset.quickType;
  if (type === 'song') {
    const reference = JSON.parse(quickAccessItem.dataset.quickKey);
    const song = state.localMusicFiles.find(item => sameQuickSongReference(reference, item));
    if (song) {
      items.push({
        label: 'Reproducir canción',
        icon: 'ph ph-play',
        action: () => playFromContext([song], 0, song.title || 'Canción', true, `quick_song_${song.id}`)
      });
      items.push({
        label: 'Ir al artista',
        icon: 'ph ph-user',
        action: () => navigateToView('artist', { artistName: artistsFromCredit(song.artist)[0] || song.artist })
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Quitar de acceso directo',
        icon: 'ph ph-push-pin-slash',
        action: () => {
          state.quickAccess = (state.quickAccess || []).filter(entry =>
            entry.type !== 'song' || !sameQuickSongReference(entry, song)
          );
          localStorage.setItem('pn_quick_access', JSON.stringify(state.quickAccess));
          renderPlaylistsUI();
        }
      });
    }
  } else if (type === 'folder') {
    const folder = state.configuredFolders?.find(item => item.name === quickAccessItem.dataset.quickKey);
    if (folder) {
      const collection = {
        title: folder.name,
        songs: state.localMusicFiles.filter(song => song.folderName === folder.name),
        contextId: `folder_${folder.id}`
      };
      items.push({
        label: 'Abrir carpeta',
        icon: 'ph ph-folder-open',
        action: () => navigateToView('folder-detail', { folderId: folder.id })
      });
      items.push(...getCollectionQueueContextItems(collection));
      items.push(getCollectionExportContextItem(collection));
      items.push({ type: 'separator' });
      items.push({
        label: 'Quitar de acceso directo',
        icon: 'ph ph-push-pin-slash',
        action: () => {
          state.quickAccess = (state.quickAccess || []).filter(entry =>
            entry.type !== 'folder' || entry.name !== folder.name
          );
          localStorage.setItem('pn_quick_access', JSON.stringify(state.quickAccess));
          renderPlaylistsUI();
        }
      });
    }
  }
  return items;
}
