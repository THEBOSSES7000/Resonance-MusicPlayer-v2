// UI · Menú contextual de un elemento de la cola.

import { state } from '../../state.js';
import { addToQueue, loadSong, removeFromQueue, resolveManualAutoPlay } from '../../audioPlayer.js';
import { renderQueue } from '../queueHistory.js';
import { showConfirmDialog } from '../uiUtils.js';
import { getFavoriteActionLabel, toggleFavoriteForSelection } from '../favorites.js';
import { openPlaylistPicker } from '../playlistPicker.js';
import { showSongDetails } from '../songDetails.js';
import { navigateToView } from '../navigation.js';
import { artistsFromCredit } from '../libraryEntities.js';
import { createDeleteSongFileContextItem } from './songActions.js';

/** Menú contextual de un elemento de la cola. */
export function buildQueueItemContextItems(target, items) {
  const qItem = target.closest('.queue-item');
  const songId = qItem.dataset.songId;
  const song = state.songsById?.get?.(String(songId))
    || (qItem.dataset.queueIdx !== undefined ? state.activeQueue[Number(qItem.dataset.queueIdx)] : null)
    || state.localMusicFiles.find(s => String(s.id) === String(songId));

  const isUpcoming = qItem.dataset.queueIdx !== undefined;
  const isHistory = qItem.dataset.historyIdx !== undefined;

  if (song) {
    if (isUpcoming) {
      const qIdx = Number(qItem.dataset.queueIdx);
      items.push({
        label: 'Reproducir ahora',
        icon: 'ph ph-play',
        action: () => loadSong(qIdx, resolveManualAutoPlay(true))
      });
      if (qIdx > state.currentTrackIndex + 1) {
        items.push({
          label: 'Reproducir a continuación',
          icon: 'ph ph-arrow-line-up',
          action: () => {
            const item = state.activeQueue.splice(qIdx, 1)[0];
            item.isEnqueuedNext = true;
            let insertIdx = state.currentTrackIndex + 1;
            while (insertIdx < state.activeQueue.length && state.activeQueue[insertIdx].isEnqueuedNext) {
              insertIdx++;
            }
            state.activeQueue.splice(insertIdx, 0, item);
            renderQueue();
          }
        });
      }
      items.push({
        label: 'Quitar de la cola',
        icon: 'ph ph-x',
        action: () => removeFromQueue(qIdx)
      });

      const itemsBelowCount = state.activeQueue.length - (qIdx + 1);
      items.push({
        label: 'Borrar canciones por debajo',
        icon: 'ph ph-trash-simple',
        disabled: itemsBelowCount <= 0,
        action: async () => {
          if (itemsBelowCount <= 0) return;
          const proceed = await showConfirmDialog({
            title: "¿Borrar canciones por debajo?",
            message: `Se eliminarán ${itemsBelowCount} canciones que están por debajo de "${song.title}" en la cola. ¿Deseas continuar?`,
            confirmText: "Borrar",
            cancelText: "Cancelar"
          });
          if (proceed) {
            state.activeQueue = state.activeQueue.slice(0, qIdx + 1);
            renderQueue();
          }
        }
      });
    } else if (isHistory) {
      items.push({
        label: 'Volver a reproducir',
        icon: 'ph ph-play',
        action: () => qItem.click()
      });
      items.push({
        label: 'Agregar a la cola',
        icon: 'ph ph-queue',
        action: () => addToQueue(song)
      });
    }

    items.push({ type: 'separator' });

    items.push({
      label: getFavoriteActionLabel(song.isFavorite),
      icon: song.isFavorite ? 'ph ph-heart-break' : 'ph ph-heart',
      action: () => { void toggleFavoriteForSelection(song); }
    });

    items.push({
      label: 'Agregar a playlist',
      icon: 'ph ph-playlist',
      action: () => openPlaylistPicker([song])
    });
    items.push({
      label: 'Ver detalles',
      icon: 'ph ph-info',
      action: () => showSongDetails(song)
    });
    items.push({
      label: 'Ir al artista',
      icon: 'ph ph-user',
      action: () => navigateToView('artist', { artistName: artistsFromCredit(song.artist)[0] || song.artist })
    });
    items.push({ type: 'separator' });
    items.push(createDeleteSongFileContextItem(song));
  }
  return items;
}
