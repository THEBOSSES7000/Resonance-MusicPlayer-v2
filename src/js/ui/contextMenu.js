// UI · Menú contextual personalizado.

import { showConfirmDialog } from './uiUtils.js';
import { persistPlaylists, state } from '../state.js';
import { addToQueue, loadSong, playNextInQueue, removeFromQueue, resolveManualAutoPlay, stopPlaybackForDeletedFile, togglePlay } from '../audioPlayer.js';
import { getFavoriteActionLabel, getFavoriteActionLabelForSongs, getFavoritesDisplayName, normalizeSongPath, toggleFavoriteForSelection, updateFavIcon, updateFavoritesCount } from './favorites.js';
import { albumContextId, artistContextId, artistsFromCredit, invalidateLibraryEntityCaches, matchingAlbumSongs, matchingArtistSongs } from './libraryEntities.js';
import { renderGrids } from './homeGrids.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { addSongsToQueue, renderHistoryUI, renderQueue } from './queueHistory.js';
import { renderFoldersUI, renderPlaylistsHubUI } from './folderPlaylistViews.js';
import { renderSearchResultsContent } from './search.js';
import { playFromContext } from './playback.js';
import { openPlaylistPicker } from './playlistPicker.js';
import { exportCollectionM3U8, getArtistAlbumContextItems, getCollectionExportContextItem, getCollectionForOptions, getCollectionOptionContextItems, getCollectionQueueContextItems, renderPlaylistsUI, sameQuickSongReference } from './collections.js';
import { showSongDetails } from './songDetails.js';
import { navigateToView } from './navigation.js';
import { openEditPlaylistModal, openFolderDescModal } from './modals.js';
import { getPlaylistSongs, getSmartPlaylistSongs } from './playlistData.js';
import { reorderPinnedPlaylists } from './dragReorder.js';
import { btnOpenFavorites, btnPlayAllFavorites, customContextMenu } from './dom.js';
import { getSelectedSongs, getSongForSelectableElement, removeSongsFromCurrentPlaylist } from './selection.js';
import { playSongReplacingCurrent } from './songCards.js';

function createDeleteSongFileContextItem(song) {
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

function addSongContextActions(items, song, songs = [song]) {
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

export function handleCustomContextMenu(e) {
  const target = e.target;
  let items = [];

  const collectionSurface = target.closest('.playlist-hero-banner, .playlist-action-bar, .playlist-table-container');
  const searchSuggestion = target.closest('.search-suggestion[data-quick-type]');
  const quickAccessItem = target.closest('.quick-access-item');
  const folderCard = target.closest('.folder-card');
  const artistCard = target.closest('.library-artist-card');
  const albumCard = target.closest('.library-album-card');
  const playlistHubCard = target.closest('.playlist-grid-card');
  const playlistCardLeft = target.closest('.playlist-card-left');

  if (state.isCoverExpanded && target.closest('.expanded-cover-widget')) {
    const song = state.currentTrackIndex >= 0
      ? state.activeQueue[state.currentTrackIndex]
      : null;
    if (song) addSongContextActions(items, song);
  }
  else if (artistCard) {
    const artistName = artistCard.dataset.artistName;
    const collection = {
      title: artistName,
      artist: artistName,
      songs: matchingArtistSongs(artistName),
      contextId: artistContextId(artistName)
    };
    items = getArtistAlbumContextItems(collection, 'artist', true);
  }
  else if (albumCard) {
    const albumArtist = albumCard.dataset.albumArtist;
    const albumTitle = albumCard.dataset.albumTitle;
    const collection = {
      title: `${albumTitle} — ${albumArtist}`,
      artist: albumArtist,
      album: albumTitle,
      songs: matchingAlbumSongs(albumArtist, albumTitle),
      contextId: albumContextId(albumArtist, albumTitle)
    };
    items = getArtistAlbumContextItems(collection, 'album', true);
  }
  else if (collectionSurface && !target.closest('.playlist-table-row') &&
      (state.currentView === 'artist' || state.currentView === 'album-detail')) {
    const collection = getCollectionForOptions();
    if (collection) {
      if (state.currentView === 'artist') {
        collection.artist = state.artistName;
        items = getArtistAlbumContextItems(collection, 'artist');
      } else {
        collection.artist = state.albumArtistName;
        collection.album = state.albumTitle;
        items = getArtistAlbumContextItems(collection, 'album');
      }
    }
  }
  else if (collectionSurface && !target.closest('.playlist-table-row')) {
    items = getCollectionOptionContextItems();
  }
  else if (searchSuggestion) {
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
  }
  else if (quickAccessItem) {
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
  }
  else if (folderCard) {
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
  }
  else if (playlistCardLeft || playlistHubCard) {
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
  }
  else if (target.closest('.favorites-shortcut')) {
    const favorites = {
      title: getFavoritesDisplayName(),
      songs: state.localMusicFiles.filter(song => song.isFavorite),
      contextId: 'favorites'
    };
    items.push({
      label: 'Reproducir todo',
      icon: 'ph ph-play',
      action: () => btnPlayAllFavorites.click()
    });
    items.push(...getCollectionQueueContextItems(favorites));
    items.push(getCollectionExportContextItem(favorites));
    items.push({ type: 'separator' });
    items.push({
      label: `Abrir ${getFavoritesDisplayName()}`,
      icon: 'ph ph-heart',
      action: () => btnOpenFavorites.click()
    });
  }
  else if (target.closest('.player-left')) {
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
  }
  else if (target.closest('.queue-item')) {
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
  }
  else if (target.closest('.song-card') || target.closest('.playlist-table-row')) {
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
  }
  else {
    items.push({
      label: 'Ir a Inicio',
      icon: 'ph ph-house',
      action: () => navigateToView('home')
    });
    items.push({
      label: getFavoritesDisplayName(),
      icon: 'ph ph-heart',
      action: () => navigateToView('favorites')
    });
    items.push({ type: 'separator' });
    items.push({
      label: 'Configuración',
      icon: 'ph ph-gear',
      action: () => document.getElementById('btn-open-settings').click()
    });
  }

  renderContextMenu(e.clientX, e.clientY, items);
}

export function renderContextMenu(x, y, items) {
  customContextMenu.innerHTML = '';

  const estimatedW = 210;
  const subMenuEstimatedW = 190;
  const willOverflowRight = (x + estimatedW + subMenuEstimatedW) > window.innerWidth;

  items.forEach(item => {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      customContextMenu.appendChild(sep);
      return;
    }

    if (item.submenu) {
      const wrap = document.createElement('div');
      wrap.className = 'context-submenu-wrapper' + (willOverflowRight ? ' submenu-left' : '');

      const btn = document.createElement('button');
      btn.className = 'context-menu-item';

      if (willOverflowRight) {
        btn.innerHTML = `
          <i class="ph ph-caret-left" style="font-size: 0.8rem; color: var(--text-faint);"></i>
          <div class="context-menu-item-left" style="justify-content: flex-end;">
            <span>${item.label}</span>
            <i class="${item.icon}"></i>
          </div>
        `;
      } else {
        btn.innerHTML = `
          <div class="context-menu-item-left">
            <i class="${item.icon}"></i>
            <span>${item.label}</span>
          </div>
          <i class="ph ph-caret-right" style="font-size: 0.8rem; color: var(--text-faint);"></i>
        `;
      }

      const subMenuEl = document.createElement('div');
      subMenuEl.className = 'context-submenu';

      item.submenu.forEach(subItem => {
        if (subItem.type === 'separator') {
          const sSep = document.createElement('div');
          sSep.className = 'context-menu-separator';
          subMenuEl.appendChild(sSep);
          return;
        }

        const subBtn = document.createElement('button');
        subBtn.className = 'context-menu-item';
        subBtn.innerHTML = `
          <div class="context-menu-item-left">
            <i class="${subItem.icon}"></i>
            <span>${subItem.label}</span>
          </div>
        `;
        subBtn.addEventListener('click', () => {
          closeCustomContextMenu();
          if (subItem.action) subItem.action();
        });
        subMenuEl.appendChild(subBtn);
      });

      wrap.appendChild(btn);
      wrap.appendChild(subMenuEl);
      customContextMenu.appendChild(wrap);
    } else {
      const btn = document.createElement('button');
      btn.className = 'context-menu-item' + (item.disabled ? ' disabled' : '');
      btn.disabled = Boolean(item.disabled);
      btn.innerHTML = `
        <div class="context-menu-item-left">
          <i class="${item.icon}"></i>
          <span>${item.label}</span>
        </div>
      `;
      if (!item.disabled && item.action) {
        btn.addEventListener('click', () => {
          closeCustomContextMenu();
          item.action();
        });
      }
      customContextMenu.appendChild(btn);
    }
  });

  const estimatedH = items.length * 34;
  let posX = x;
  let posY = y;

  if (posX + estimatedW > window.innerWidth) posX = window.innerWidth - estimatedW - 12;
  if (posY + estimatedH > window.innerHeight) posY = window.innerHeight - estimatedH - 12;

  customContextMenu.style.left = `${Math.max(10, posX)}px`;
  customContextMenu.style.top = `${Math.max(10, posY)}px`;
  customContextMenu.classList.add('open');
  customContextMenu.setAttribute('aria-hidden', 'false');
}

export function closeCustomContextMenu() {
  if (!customContextMenu) return;
  customContextMenu.classList.remove('open');
  customContextMenu.style.display = '';
  customContextMenu.setAttribute('aria-hidden', 'true');
}
