// UI · Navegación principal, favoritos y botón de favorito del reproductor.

import { artistBioToggle, btnCollapseCover, btnOpenAlbums, btnOpenFavorites, btnPlayAllFavorites, btnShuffleFavorites, navBtnFolders, navBtnHome, navBtnMusic, navBtnPlaylists, playerCoverBox, playerFavBtn, playlistHeroDesc } from '../dom.js';
import { navigateToView } from '../navigation.js';
import { toggleExpandedCover } from '../nowPlayingFs.js';
import { state } from '../../state.js';
import { getFavoritesDisplayName, toggleFavoriteForSelection } from '../favorites.js';
import { albumContextId, artistContextId, matchingAlbumSongs, matchingArtistSongs } from '../libraryEntities.js';
import { getCollectionForOptions } from '../collections.js';
import { setShuffleEnabled, shuffleArray, togglePlay } from '../../audioPlayer.js';
import { playFromContext } from '../playback.js';

/** Navegación principal, favoritos y botón de favorito del reproductor. */
export function bindNavigationAndFavorites() {

  btnOpenAlbums?.addEventListener('click', () => navigateToView('albums'));

  if (playerCoverBox) {
    playerCoverBox.addEventListener('click', (e) => {
      if (e.button === 0) {
        toggleExpandedCover();
      }
    });
  }

  if (btnCollapseCover) {
    btnCollapseCover.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpandedCover(false);
    });
  }

  // Navegación Sidebar
  navBtnHome.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToView('home');
  });

  if (navBtnMusic) {
    navBtnMusic.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('all-music');
    });
  }

  if (navBtnFolders) {
    navBtnFolders.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('folders');
    });
  }

  if (navBtnPlaylists) {
    navBtnPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToView('playlists-hub');
    });
  }

  btnOpenFavorites.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToView('favorites');
  });

  artistBioToggle?.addEventListener('click', () => {
    const expanded = playlistHeroDesc.classList.toggle('is-expanded');
    artistBioToggle.textContent = expanded ? 'Mostrar menos' : 'Mostrar más';
    artistBioToggle.setAttribute('aria-expanded', String(expanded));
  });

  btnPlayAllFavorites.addEventListener('click', () => {
    let songs = [];
    const isArtist = state.currentView === 'artist';
    const isAlbum = state.currentView === 'album-detail';
    let title = getFavoritesDisplayName();
    let ctx = 'favorites';
    if (state.currentView === 'favorites') {
      songs = state.localMusicFiles.filter(s => s.isFavorite);
    } else if (state.currentView === 'all-music') {
      songs = [...state.localMusicFiles];
      title = "Música";
      ctx = 'all_music';
    } else if (state.currentView === 'folder-detail') {
      const currentFolder = state.configuredFolders.find(f => f.id === state.currentFolderId);
      if (currentFolder) {
        songs = state.localMusicFiles.filter(s => s.folderName === currentFolder.name);
        title = currentFolder.name;
        ctx = 'folder_' + currentFolder.id;
        currentFolder.lastPlayed = Date.now();
      }
    } else if (state.currentView === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (pl) {
        songs = pl.songs || [];
        title = pl.title;
        ctx = 'playlist_' + pl.id;
      }
    } else if (state.currentView === 'artist') {
      songs = matchingArtistSongs(state.artistName);
      title = state.artistName;
      ctx = artistContextId(state.artistName);
    } else if (state.currentView === 'album-detail') {
      songs = matchingAlbumSongs(state.albumArtistName, state.albumTitle);
      title = `${state.albumTitle} — ${state.albumArtistName}`;
      ctx = albumContextId(state.albumArtistName, state.albumTitle);
    } else if (state.currentView === 'queue-detail') {
      songs = [...(state.activeQueue || [])];
      title = state.activeQueueTitle || 'Cola de reproducción';
      ctx = state.activeContextId || 'queue_detail';
    }
    if (isArtist && state.artistSortMode === 'plays') {
      songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    } else if (isArtist && state.artistSortMode === 'date') {
      songs.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
    } else if (isAlbum && state.albumSortMode === 'plays') {
      songs.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    } else if (isAlbum && state.albumSortMode === 'date') {
      songs.sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0));
    } else if (isAlbum && state.albumSortMode === 'track') {
      songs.sort((a, b) => {
        const trackA = Number(a.trackNumber) || Number.MAX_SAFE_INTEGER;
        const trackB = Number(b.trackNumber) || Number.MAX_SAFE_INTEGER;
        return trackA - trackB;
      });
    }
    if (['favorites', 'all-music', 'folder-detail', 'playlist'].includes(state.currentView)) {
      const collection = getCollectionForOptions();
      if (collection) {
        songs = collection.songs;
        title = collection.title;
        ctx = collection.contextId;
      }
    }
    if (songs.length > 0) {
      if (state.currentView === 'queue-detail') {
        const idx = Math.max(0, state.currentTrackIndex >= 0 ? state.currentTrackIndex : 0);
        if (state.currentTrackIndex >= 0) {
          togglePlay();
        } else {
          playFromContext(songs, 0, title, true, ctx, false, true);
        }
      } else if (state.activeContextId === ctx && state.currentTrackIndex !== -1) {
        togglePlay();
      } else {
        playFromContext(songs, 0, title, true, ctx, true);
      }
    }
  });

  btnShuffleFavorites.addEventListener('click', () => {
    let songs = [];
    let title = getFavoritesDisplayName();
    let ctx = 'favorites';
    if (state.currentView === 'favorites') {
      songs = state.localMusicFiles.filter(s => s.isFavorite);
    } else if (state.currentView === 'all-music') {
      songs = [...state.localMusicFiles];
      title = "Música";
      ctx = 'all_music';
    } else if (state.currentView === 'folder-detail') {
      const currentFolder = state.configuredFolders.find(f => f.id === state.currentFolderId);
      if (currentFolder) {
        songs = state.localMusicFiles.filter(s => s.folderName === currentFolder.name);
        title = currentFolder.name;
        ctx = 'folder_' + currentFolder.id;
        currentFolder.lastPlayed = Date.now();
      }
    } else if (state.currentView === 'playlist') {
      const pl = state.playlists.find(p => p.id === state.currentPlaylistId);
      if (pl) {
        songs = pl.songs || [];
        title = pl.title;
        ctx = 'playlist_' + pl.id;
      }
    } else if (state.currentView === 'artist') {
      songs = matchingArtistSongs(state.artistName);
      title = state.artistName;
      ctx = artistContextId(state.artistName);
    } else if (state.currentView === 'album-detail') {
      songs = matchingAlbumSongs(state.albumArtistName, state.albumTitle);
      title = `${state.albumTitle} — ${state.albumArtistName}`;
      ctx = albumContextId(state.albumArtistName, state.albumTitle);
    } else if (state.currentView === 'queue-detail') {
      songs = [...(state.activeQueue || [])];
      title = state.activeQueueTitle || 'Cola de reproducción';
      ctx = state.activeContextId || 'queue_detail';
    }
    if (['favorites', 'all-music', 'folder-detail', 'playlist'].includes(state.currentView)) {
      const collection = getCollectionForOptions();
      if (collection) {
        songs = collection.songs;
        title = collection.title;
        ctx = collection.contextId;
      }
    }

    if (songs.length > 0) {
      setShuffleEnabled(true);

      const randIdx = Math.floor(Math.random() * songs.length);
      const firstSong = songs[randIdx];

      const remaining = songs.filter((_, i) => i !== randIdx);
      const shuffledRemaining = shuffleArray(remaining);

      const shuffledQueue = [firstSong, ...shuffledRemaining];
      playFromContext(shuffledQueue, 0, title, true, ctx);
    }
  });

  playerFavBtn.addEventListener('click', () => {
    if (state.currentTrackIndex === -1 || !state.activeQueue[state.currentTrackIndex]) return;
    const song = state.activeQueue[state.currentTrackIndex];
    void toggleFavoriteForSelection(song);
  });
}
