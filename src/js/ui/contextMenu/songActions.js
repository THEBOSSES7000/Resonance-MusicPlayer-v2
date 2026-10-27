// UI · Acciones comunes de menú contextual para canciones (reproducir, cola, favoritos, borrar archivo...).

import { showConfirmDialog } from '../uiUtils.js';
import { persistPlaylists, state } from '../../state.js';
import { addToQueue, loadSong, playNextInQueue, resolveManualAutoPlay, stopPlaybackForDeletedFile, togglePlay } from '../../audioPlayer.js';
import { getFavoriteActionLabelForSongs, normalizeSongPath, toggleFavoriteForSelection, updateFavIcon, updateFavoritesCount } from '../favorites.js';
import { artistsFromCredit, invalidateLibraryEntityCaches } from '../libraryEntities.js';
import { renderGrids } from '../homeGrids.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';
import { renderHistoryUI, renderQueue } from '../queueHistory.js';
import { renderFoldersUI } from '../folderPlaylistViews.js';
import { renderSearchResultsContent } from '../search.js';
import { playFromContext } from '../playback.js';
import { openPlaylistPicker } from '../playlistPicker.js';
import { exportCollectionM3U8 } from '../collections.js';
import { showSongDetails } from '../songDetails.js';
import { navigateToView } from '../navigation.js';

export function createDeleteSongFileContextItem(song) {
  return {
    label: 'Borrar archivo del dispositivo',
    icon: 'ph ph-trash',
    action: async () => {
      const filePath = song.file?.path;
      if (!filePath || !window.__TAURI__?.core?.invoke) {
        await showConfirmDialog({
          title: 'No se puede borrar este archivo',
          message: 'Solo se pueden borrar archivos de música de carpetas vinculadas desde la aplicación de escritorio.',
          confirmText: 'Entendido',
          showCancel: false
        });
        return;
      }

      const proceed = await showConfirmDialog({
        title: '¿Borrar archivo del dispositivo?',
        message: `Se borrará permanentemente "${song.file.name || song.title}" del disco y se quitará de la biblioteca, las playlists y la cola. Esta acción no se puede deshacer.`,
        confirmText: 'Borrar archivo',
        cancelText: 'Cancelar'
      });
      if (!proceed) return;

      try {
        await window.__TAURI__.core.invoke('delete_music_file', { path: filePath });
      } catch (error) {
        console.error('No se pudo borrar el archivo de música:', error);
        await showConfirmDialog({
          title: 'No se pudo borrar el archivo',
          message: `El archivo se conserva. ${String(error)}`,
          confirmText: 'Entendido',
          showCancel: false
        });
        return;
      }

      const matchesSong = candidate => {
        if (song.id != null && candidate.id === song.id) return true;
        const candidatePath = candidate.file?.path;
        return Boolean(candidatePath && candidatePath.toLocaleLowerCase() === filePath.toLocaleLowerCase());
      };
      const previousTrackIndex = state.currentTrackIndex;
      const currentSong = state.activeQueue[state.currentTrackIndex];
      const isCurrentSongDeleted = currentSong && matchesSong(currentSong);
      const removedBeforeCurrent = state.activeQueue
        .slice(0, Math.max(0, previousTrackIndex))
        .filter(matchesSong).length;
      state.activeQueue = state.activeQueue.filter(track => !matchesSong(track));
      let nextPlaybackError = null;

      if (isCurrentSongDeleted) {
        let nextTrackIndex = removedBeforeCurrent;
        if (nextTrackIndex >= state.activeQueue.length && state.repeatMode === 'all' && state.activeQueue.length > 0) {
          nextTrackIndex = 0;
        }
        if (nextTrackIndex < state.activeQueue.length) {
          state.currentTrackIndex = nextTrackIndex - 1;
          try {
            await loadSong(nextTrackIndex, resolveManualAutoPlay(true), false);
          } catch (error) {
            console.error('No se pudo continuar con la siguiente canción:', error);
            nextPlaybackError = error;
            stopPlaybackForDeletedFile();
            state.activeQueue = [];
            state.currentTrackIndex = -1;
            state.activeContextId = null;
          }
        } else {
          stopPlaybackForDeletedFile();
          state.activeQueue = [];
          state.currentTrackIndex = -1;
          state.activeContextId = null;
        }
      } else {
        if (state.currentTrackIndex !== -1) state.currentTrackIndex -= removedBeforeCurrent;
      }

      if (state.songsById?.delete) {
        if (song.id !== undefined && song.id !== null) {
          state.songsById.delete(String(song.id));
          state.songsById.delete(song.id);
        }
        const normalizedPath = normalizeSongPath(song);
        if (normalizedPath) state.songsById.delete(normalizedPath);
      }

      state.playbackHistory = state.playbackHistory.filter(track => !matchesSong(track));
      state.localMusicFiles = state.localMusicFiles.filter(track => !matchesSong(track));
      state.playlists.forEach(playlist => {
        playlist.songs = (playlist.songs || []).filter(track => !matchesSong(track));
      });
      invalidateLibraryEntityCaches();
      persistPlaylists();

      renderGrids();
      renderPlaylistDetailView();
      renderQueue();
      renderHistoryUI();
      renderFoldersUI();
      renderSearchResultsContent();
      updateFavoritesCount();
      updateFavIcon();
      window.dispatchEvent(new Event('pn-native-library-changed'));
      if (nextPlaybackError) {
        await showConfirmDialog({
          title: 'Archivo borrado, pero no se pudo continuar',
          message: `El archivo se borró correctamente, pero la siguiente canción no pudo reproducirse. ${String(nextPlaybackError)}`,
          confirmText: 'Entendido',
          showCancel: false
        });
      }
    }
  };
}

export function addSongContextActions(items, song, songs = [song]) {
  const contextId = `quick_song_${song.id}`;
  items.push({
    label: 'Reproducir ahora',
    icon: 'ph ph-play',
    action: () => {
      const currentSong = state.currentTrackIndex !== -1
        ? state.activeQueue[state.currentTrackIndex]
        : null;
      if (currentSong?.id === song.id && state.activeContextId === contextId) {
        togglePlay();
      } else {
        playFromContext([song], 0, song.title || 'Canción', true, contextId);
      }
    }
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
  items.push({ type: 'separator' });
  items.push({
    label: getFavoriteActionLabelForSongs(songs),
    icon: songs.every(selectedSong => selectedSong.isFavorite) ? 'ph ph-heart-break' : 'ph ph-heart',
    action: () => { void toggleFavoriteForSelection(song); }
  });
  items.push({
    label: 'Agregar a playlist',
    icon: 'ph ph-playlist',
    action: () => openPlaylistPicker(songs)
  });
  // Exportar .m3u8 solo tiene sentido con más de una canción
  if (songs.length > 1) {
    items.push({
      label: `Exportar ${songs.length} canciones (.m3u8)`,
      icon: 'ph ph-export',
      action: () => exportCollectionM3U8({
        title: 'Canciones seleccionadas',
        songs
      })
    });
  }
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
}
