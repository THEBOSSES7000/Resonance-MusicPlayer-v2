// UI · Menú contextual de una canción (tarjeta o fila de tabla).

import { persistPlaylists, state } from '../../state.js';
import { getSelectedSongs, getSongForSelectableElement, removeSongsFromCurrentPlaylist } from '../selection.js';
import { playSongReplacingCurrent } from '../songCards.js';
import { addToQueue, loadSong, playNextInQueue, removeFromQueue, resolveManualAutoPlay } from '../../audioPlayer.js';
import { addSongsToQueue, renderQueue } from '../queueHistory.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { showConfirmDialog } from '../uiUtils.js';
import { getFavoriteActionLabel, getFavoriteActionLabelForSongs, toggleFavoriteForSelection } from '../favorites.js';
import { showSongDetails } from '../songDetails.js';
import { navigateToView } from '../navigation.js';
import { artistsFromCredit } from '../libraryEntities.js';
import { openPlaylistPicker } from '../playlistPicker.js';
import { createDeleteSongFileContextItem } from './songActions.js';

/** Menú contextual de una canción (tarjeta o fila de tabla). */
export function buildSongContextItems(target, items) {
  const isRow = !!target.closest('.playlist-table-row');
  const cardOrRow = target.closest('.song-card') || target.closest('.playlist-table-row');
  const currentPlaylist = isRow && state.currentView === 'playlist'
    ? state.playlists.find(item => item.id === state.currentPlaylistId)
    : null;
  const song = getSongForSelectableElement(cardOrRow);
  const rowIdx = isRow ? Number(cardOrRow.dataset.trackIdx) : -1;

  if (song) {
    // Menú contextual específico de la vista completa de cola
    if (state.currentView === 'queue-detail' && isRow) {
      const isHist = cardOrRow?.dataset?.queueHistory === '1';
      const qIdx = Number(cardOrRow?.dataset?.queueIdx ?? cardOrRow?.dataset?.sourceTrackIdx);
      if (isHist) {
        items.push({
          label: 'Volver a reproducir',
          icon: 'ph ph-play',
          action: () => playSongReplacingCurrent(song, state.activeQueueTitle || 'Cola')
        });
        items.push({
          label: 'Agregar a la cola',
          icon: 'ph ph-queue',
          action: () => addToQueue(song)
        });
      } else if (Number.isInteger(qIdx) && qIdx >= 0 && qIdx < state.activeQueue.length) {
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
              void renderPlaylistDetailView();
            }
          });
        }
        items.push({
          label: 'Quitar de la cola',
          icon: 'ph ph-x',
          action: () => {
            removeFromQueue(qIdx);
            void renderPlaylistDetailView();
          }
        });
        const itemsBelowCount = state.activeQueue.length - (qIdx + 1);
        items.push({
          label: 'Borrar canciones por debajo',
          icon: 'ph ph-trash-simple',
          disabled: itemsBelowCount <= 0,
          action: async () => {
            if (itemsBelowCount <= 0) return;
            const proceed = await showConfirmDialog({
              title: '¿Borrar canciones por debajo?',
              message: `Se eliminarán ${itemsBelowCount} canciones por debajo de "${song.title}" en la cola.`,
              confirmText: 'Borrar',
              cancelText: 'Cancelar'
            });
            if (proceed) {
              state.activeQueue = state.activeQueue.slice(0, qIdx + 1);
              renderQueue();
              void renderPlaylistDetailView();
            }
          }
        });
      }
      items.push({ type: 'separator' });
      items.push({
        label: getFavoriteActionLabel(song.isFavorite),
        icon: song.isFavorite ? 'ph ph-heart-break' : 'ph ph-heart',
        action: () => { void toggleFavoriteForSelection(song, cardOrRow); }
      });
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
    } else {
    const selectedSongs = getSelectedSongs(cardOrRow, song);
    if (selectedSongs.length > 1) {
      items.push({
        label: `Reproducir ${selectedSongs.length} canciones a continuación`,
        icon: 'ph ph-skip-forward',
        action: () => addSongsToQueue(selectedSongs, true)
      });
      items.push({
        label: `Agregar ${selectedSongs.length} canciones a la cola`,
        icon: 'ph ph-queue',
        action: () => addSongsToQueue(selectedSongs, false)
      });
    } else {
      items.push({
        label: 'Reproducir ahora',
        icon: 'ph ph-play',
        action: () => cardOrRow.click()
      });
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
    }

    if (selectedSongs.length === 1 && isRow && state.trackSortMode === 'custom' &&
        (state.currentView !== 'playlist' || state.playlistTrackDragReorderEnabled) &&
        state.currentView !== 'all-music' && state.currentView !== 'folder-detail' && state.currentView !== 'search' && state.currentView !== 'artist') {
      const isFav = state.currentView === 'favorites';
      const playlist = state.playlists.find(p => p.id === state.currentPlaylistId);
      const targetList = isFav ? state.localMusicFiles.filter(s => s.isFavorite) : (playlist?.songs || []);

      if (targetList.length > 1) {
        items.push({ type: 'separator' });
        items.push({
          label: 'Subir de posición',
          icon: 'ph ph-arrow-up',
          disabled: rowIdx <= 0,
          action: () => {
            if (rowIdx > 0) {
              if (isFav) {
                const liked = state.localMusicFiles.filter(s => s.isFavorite);
                const [moved] = liked.splice(rowIdx, 1);
                liked.splice(rowIdx - 1, 0, moved);
                const nonLiked = state.localMusicFiles.filter(s => !s.isFavorite);
                state.localMusicFiles = [...liked, ...nonLiked];
                const favKeys = liked.map(s => `${s.title}:::${s.artist}`);
                localStorage.setItem('pn_favorites_keys', JSON.stringify(favKeys));
                renderPlaylistDetailView();
              } else if (playlist) {
                const [moved] = playlist.songs.splice(rowIdx, 1);
                playlist.songs.splice(rowIdx - 1, 0, moved);
                persistPlaylists();
              }
              renderPlaylistDetailView();
            }
          }
        });
        items.push({
          label: 'Bajar de posición',
          icon: 'ph ph-arrow-down',
          disabled: rowIdx >= targetList.length - 1,
          action: () => {
            if (rowIdx < targetList.length - 1) {
              if (isFav) {
                const liked = state.localMusicFiles.filter(s => s.isFavorite);
                const [moved] = liked.splice(rowIdx, 1);
                liked.splice(rowIdx + 1, 0, moved);
                const nonLiked = state.localMusicFiles.filter(s => !s.isFavorite);
                state.localMusicFiles = [...liked, ...nonLiked];
                const favKeys = liked.map(s => `${s.title}:::${s.artist}`);
                localStorage.setItem('pn_favorites_keys', JSON.stringify(favKeys));
                renderPlaylistDetailView();
              } else if (playlist) {
                const [moved] = playlist.songs.splice(rowIdx, 1);
                playlist.songs.splice(rowIdx + 1, 0, moved);
                persistPlaylists();
              }
              renderPlaylistDetailView();
            }
          }
        });
        items.push({
          label: 'Mover al inicio',
          icon: 'ph ph-arrow-line-up',
          disabled: rowIdx <= 0,
          action: () => {
            if (rowIdx > 0) {
              if (isFav) {
                const liked = state.localMusicFiles.filter(s => s.isFavorite);
                const [moved] = liked.splice(rowIdx, 1);
                liked.unshift(moved);
                const nonLiked = state.localMusicFiles.filter(s => !s.isFavorite);
                state.localMusicFiles = [...liked, ...nonLiked];
                const favKeys = liked.map(s => `${s.title}:::${s.artist}`);
                localStorage.setItem('pn_favorites_keys', JSON.stringify(favKeys));
                renderPlaylistDetailView();
              } else if (playlist) {
                const [moved] = playlist.songs.splice(rowIdx, 1);
                playlist.songs.unshift(moved);
                persistPlaylists();
              }
              renderPlaylistDetailView();
            }
          }
        });
        items.push({
          label: 'Mover al final',
          icon: 'ph ph-arrow-line-down',
          disabled: rowIdx >= targetList.length - 1,
          action: () => {
            if (rowIdx < targetList.length - 1) {
              if (isFav) {
                const liked = state.localMusicFiles.filter(s => s.isFavorite);
                const [moved] = liked.splice(rowIdx, 1);
                liked.push(moved);
                const nonLiked = state.localMusicFiles.filter(s => !s.isFavorite);
                state.localMusicFiles = [...liked, ...nonLiked];
                const favKeys = liked.map(s => `${s.title}:::${s.artist}`);
                localStorage.setItem('pn_favorites_keys', JSON.stringify(favKeys));
              } else if (playlist) {
                const [moved] = playlist.songs.splice(rowIdx, 1);
                playlist.songs.push(moved);
                persistPlaylists();
              }
              renderPlaylistDetailView();
            }
          }
        });
      }
    }

    const playlist = currentPlaylist;
    if (isRow && playlist && !playlist.smartFilter) {
      items.push({ type: 'separator' });
      const selectedForRemove = selectedSongs.length > 1 ? selectedSongs : [song];
      items.push({
        label: selectedForRemove.length > 1
          ? `Quitar ${selectedForRemove.length} canciones de esta playlist`
          : 'Quitar de esta playlist',
        icon: 'ph ph-music-notes-minus',
        action: () => { void removeSongsFromCurrentPlaylist(selectedForRemove); }
      });
    }

    items.push({ type: 'separator' });
    items.push({
      label: getFavoriteActionLabelForSongs(selectedSongs),
      icon: selectedSongs.every(selectedSong => selectedSong.isFavorite) ? 'ph ph-heart-break' : 'ph ph-heart',
      action: () => { void toggleFavoriteForSelection(song, cardOrRow); }
    });
    items.push({
      label: 'Agregar a playlist',
      icon: 'ph ph-playlist',
      action: () => openPlaylistPicker(selectedSongs)
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
    items.push({ type: 'separator' });
    items.push(createDeleteSongFileContextItem(song));
    } // fin else no-queue-detail
  }
  return items;
}
