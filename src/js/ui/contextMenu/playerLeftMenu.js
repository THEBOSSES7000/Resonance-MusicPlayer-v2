// UI · Menú contextual del bloque izquierdo del reproductor.

import { state } from '../../state.js';
import { addToQueue, playNextInQueue } from '../../audioPlayer.js';
import { getFavoriteActionLabel, toggleFavoriteForSelection } from '../favorites.js';
import { openPlaylistPicker } from '../playlistPicker.js';
import { showSongDetails } from '../songDetails.js';
import { navigateToView } from '../navigation.js';
import { artistsFromCredit } from '../libraryEntities.js';

/** Menú contextual del bloque izquierdo del reproductor. */
export function buildPlayerLeftContextItems(target, items) {
  if (state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]) {
    const song = state.activeQueue[state.currentTrackIndex];
    items.push({
      label: 'Reproducir a continuación',
      icon: 'ph ph-skip-forward',
      action: () => playNextInQueue(song)
    });
    items.push({
      label: 'Agregar a la cola',
      icon: 'ph ph-queue',
      action: () => addToQueue(song)
    });
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
    items.push({ type: 'separator' });
    items.push({
      label: 'Ver detalles de la canción',
      icon: 'ph ph-info',
      action: () => showSongDetails(song)
    });
    items.push({
      label: 'Ir al artista',
      icon: 'ph ph-user',
      action: () => navigateToView('artist', { artistName: artistsFromCredit(song.artist)[0] || song.artist })
    });
  }
  return items;
}
