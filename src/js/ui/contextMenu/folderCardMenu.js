// UI · Menú contextual de una tarjeta de carpeta.

import { state } from '../../state.js';
import { navigateToView } from '../navigation.js';
import { getCollectionQueueContextItems, renderPlaylistsUI } from '../collections.js';
import { openFolderDescModal } from '../modals.js';

/** Menú contextual de una tarjeta de carpeta. */
export function buildFolderCardContextItems(target, items, folderCard) {
  const fId = Number(folderCard.dataset.id);
  const folder = state.configuredFolders.find(f => f.id === fId);
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
    items.push({
      label: 'Editar descripción',
      icon: 'ph ph-pencil-simple',
      action: () => openFolderDescModal(folder)
    });
    const isPinned = (state.quickAccess || []).some(entry =>
      entry.type === 'folder' && entry.name === folder.name
    );
    items.push({ type: 'separator' });
    items.push({
      label: isPinned ? 'Quitar de acceso directo' : 'Fijar en acceso directo',
      icon: isPinned ? 'ph ph-push-pin-slash' : 'ph ph-push-pin',
      action: () => {
        state.quickAccess = Array.isArray(state.quickAccess) ? state.quickAccess : [];
        state.quickAccess = isPinned
          ? state.quickAccess.filter(entry => entry.type !== 'folder' || entry.name !== folder.name)
          : [...state.quickAccess, { type: 'folder', name: folder.name }];
        localStorage.setItem('pn_quick_access', JSON.stringify(state.quickAccess));
        renderPlaylistsUI();
      }
    });
  }
  return items;
}
