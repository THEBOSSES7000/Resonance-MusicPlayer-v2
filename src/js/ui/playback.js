// UI · Reproducción desde contexto y sincronización de la interfaz con la canción actual.

import { state } from '../state.js';
import { btnOpenFavorites, btnPlayAllFavorites, favSidebarSoundwave, foldersSidebarSoundwave, homeSidebarSoundwave, musicSidebarSoundwave, navBtnFolders, navBtnHome, navBtnMusic, navBtnPlaylists, playerSourceLabel, playlistsSidebarSoundwave, queueHeaderTitle } from './dom.js';
import { isPlaybackPaused, loadSong, resolveManualAutoPlay, shuffleArray } from '../audioPlayer.js';
import { renderHistoryUI } from './queueHistory.js';
import { extractMetadata, resolveCoverUrl, trackLoadedLyricsInRam } from '../scanner.js';
import { bindLazyCover } from './covers.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { renderSearchResultsContent } from './search.js';
import { syncLiquidAnimationPlayState } from '../../visual_plus/blurred_background.js';
import { syncImmersiveAnimationPlayState } from '../../visual_plus/liquid_background.js';
import { syncLyricsDockButtonStates, syncLyricsDockPlayIcon } from './lyricsDock.js';
import { albumContextId, artistContextId, syncPlayerAlbumLinkState } from './libraryEntities.js';
import { getSoundWaveHTML } from './uiUtils.js';
import { syncLibraryAlbumIndicators } from './homeGrids.js';
import { sameQuickSongReference } from './collections.js';

export function playFromContext(list, trackIndex, contextTitle = "Cola de reproducción", autoPlay = true, contextId = null, randomizeStart = false, preserveQueueOrder = false) {
  const sourceQueue = [...list];
  state.activeQueue = sourceQueue;
  state.activeQueueTitle = contextTitle;
  state.activeContextId = contextId || contextTitle;
  if (playerSourceLabel) {
    const sourceText = playerSourceLabel.querySelector('.player-source-text');
    if (sourceText) sourceText.textContent = contextTitle;
    playerSourceLabel.title = contextTitle;
    playerSourceLabel.setAttribute('aria-label', `Origen de reproducción: ${contextTitle}`);
  }
  state.queueVisibleCount = 25;
  state.playbackHistory = [];

  if (trackIndex > 0) {
    const historySlice = Math.min(trackIndex, 50);
    for (let i = trackIndex - historySlice; i < trackIndex; i++) {
      state.playbackHistory.unshift(state.activeQueue[i]);
    }
  }

  if (state.isShuffle && sourceQueue.length > 1 && !preserveQueueOrder) {
    if (randomizeStart) {
      state.activeQueue = shuffleArray(sourceQueue);
      trackIndex = 0;
    } else if (trackIndex >= 0 && trackIndex < sourceQueue.length) {
      const selectedTrack = sourceQueue[trackIndex];
      const upcomingTracks = sourceQueue.filter((_, index) => index !== trackIndex);
      state.activeQueue = [selectedTrack, ...shuffleArray(upcomingTracks)];
      trackIndex = 0;
    }
  }

  renderHistoryUI();

  if (queueHeaderTitle) {
    queueHeaderTitle.textContent = `Cola (${contextTitle})`;
  }
  loadSong(trackIndex, resolveManualAutoPlay(autoPlay), false);
}

function updateSongCardsDOM(song) {
  document.querySelectorAll(`.song-card[data-id="${song.id}"]`).forEach(card => {
    const imgWrap = card.querySelector('.card-img-wrap');
    if (imgWrap && resolveCoverUrl(song)) {
      const icon = imgWrap.querySelector('.cover-placeholder-icon');
      if (icon) icon.remove();
      let img = imgWrap.querySelector('.song-cover-img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'song-cover-img';
        imgWrap.prepend(img);
      }
      bindLazyCover(img, song);
    }
    const h4 = card.querySelector('h4');
    const p = card.querySelector('p');
    if (h4) h4.textContent = song.title;
    if (p) p.textContent = song.artist || "Desconocido";
  });
}

export async function ensureSongMetadata(song) {
  if (!song || song.metadataLoaded) return;
  if (
    song.file?.isNativeFile &&
    song.title &&
    song.artist
  ) {
    song.metadataLoaded = true;
    return;
  }
  if (!song.metadataPromise) {
    song.metadataPromise = (async () => {
      try {
        const meta = await extractMetadata(song.file);
        if (meta.title) song.title = meta.title;
        if (meta.artist) song.artist = meta.artist;
        if (meta.album) song.album = meta.album;
        if (meta.coverUrl) song.coverUrl = meta.coverUrl;
        if (meta.lyrics) {
          song.lyrics = meta.lyrics;
          song.lyricsLoaded = true;
          trackLoadedLyricsInRam(song);
        }
        if (meta.sampleRate) song.sampleRate = meta.sampleRate;
        if (meta.channels) song.channels = meta.channels;
        if (meta.bitDepth) song.bitDepth = meta.bitDepth;
        if (meta.codec) song.codec = meta.codec;
      } catch (err) {
        console.warn("Error leyendo metadatos:", err);
      } finally {
        song.metadataLoaded = true;
        delete song.metadataPromise;
        updateSongCardsDOM(song);
        if (state.currentView === 'favorites' || state.currentView === 'playlist' || state.currentView === 'all-music' || state.currentView === 'folder-detail') {
          renderPlaylistDetailView();
        } else if (state.currentView === 'artist') {
          renderPlaylistDetailView();
        } else if (state.currentView === 'search') {
          renderSearchResultsContent();
        }
      }
    })();
  }
  await song.metadataPromise;
}

export function updatePlaylistRowTitleMarquee(row, shouldScroll) {
  row.classList.toggle('is-track-playing', shouldScroll);
  const title = row.querySelector('.row-text-meta strong');
  if (!title) return;

  title.classList.remove('is-scrolling');
  title.style.removeProperty('--row-title-scroll-distance');
  title.style.removeProperty('--row-title-scroll-duration');
  if (!shouldScroll) return;

  requestAnimationFrame(() => {
    if (!row.isConnected || !row.classList.contains('is-track-playing')) return;
    const overflow = title.scrollWidth - title.clientWidth;
    if (overflow <= 8) return;
    title.style.setProperty('--row-title-scroll-distance', `${overflow + 12}px`);
    title.style.setProperty('--row-title-scroll-duration', `${Math.max(6, Math.min(16, 5 + overflow / 16))}s`);
    title.classList.add('is-scrolling');
  });
}

/**
 * Sincroniza el estado visual completo de sonido en tiempo real
 */
export 
/** Promedia colores de la carátula (muestreo liviano en canvas) para el centro del vinilo. */
function averageCoverColor(coverSrc) {
  return new Promise((resolve) => {
    if (!coverSrc) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 24; // muestreo pequeño = bajo costo
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 32) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
        if (!n) {
          resolve(null);
          return;
        }
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        resolve(`rgb(${r}, ${g}, ${b})`);
      } catch (_) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    // asset:// / blob / http del propio app suelen poder pintarse en canvas
    try { img.crossOrigin = 'anonymous'; } catch (_) {}
    img.src = coverSrc;
  });
}

export function syncNpFsVinylLabelArt(coverSrc) {
  const label = document.getElementById('np-fs-vinyl-label-art');
  if (!label) return;
  label.style.backgroundImage = '';
  label.classList.remove('has-art');
  const fallback = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b8cff';
  if (!coverSrc) {
    label.style.backgroundColor = fallback;
    document.documentElement.style.setProperty('--cover-accent-color', fallback);
    return;
  }
  averageCoverColor(coverSrc).then((color) => {
    const c = color || fallback;
    label.style.backgroundColor = c;
    document.documentElement.style.setProperty('--cover-accent-color', c);
  }).catch(() => {
    label.style.backgroundColor = fallback;
  });
}

export function syncPlayingUI(isPlaying) {
  document.body.classList.toggle('np-fs-audio-playing', Boolean(isPlaying));
  try { syncLiquidAnimationPlayState(); } catch (_) {}
  try { syncImmersiveAnimationPlayState(); } catch (_) {}
  try { syncLyricsDockPlayIcon(); syncLyricsDockButtonStates(); } catch (_) {}
  const playPauseButton = document.getElementById('play-pause-btn');
  const playPauseIcon = document.getElementById('play-icon');
  if (playPauseIcon) {
    playPauseIcon.className = isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
  }
  if (playPauseButton) {
    playPauseButton.title = isPlaying ? 'Pausar' : 'Reproducir';
    playPauseButton.setAttribute('aria-label', playPauseButton.title);
  }

  const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
  syncPlayerAlbumLinkState();
  const collectionContextId = state.currentView === 'playlist'
    ? `playlist_${state.currentPlaylistId}`
    : state.currentView === 'folder-detail'
      ? `folder_${state.currentFolderId}`
      : state.currentView === 'all-music'
        ? 'all_music'
        : state.currentView === 'favorites'
          ? 'favorites'
          : state.currentView === 'artist'
            ? artistContextId(state.artistName)
            : state.currentView === 'album-detail'
              ? albumContextId(state.albumArtistName, state.albumTitle)
              : null;
  const collectionPlayIcon = btnPlayAllFavorites?.querySelector('i');
  if (collectionPlayIcon) {
    const isCurrentCollectionPlaying = Boolean(currentSong) &&
      state.activeContextId === collectionContextId &&
      isPlaying;
    collectionPlayIcon.className = isCurrentCollectionPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    btnPlayAllFavorites.title = isCurrentCollectionPlaying ? 'Pausar' : 'Reproducir todo';
    btnPlayAllFavorites.setAttribute('aria-label', btnPlayAllFavorites.title);
  }

  // 1. Tarjetas del menú principal
  document.querySelectorAll('.song-card').forEach(card => {
    const songId = Number(card.dataset.id);
    const cardContext = card.dataset.context;
    const playBtnIcon = card.querySelector('.card-play-hover i');
    let soundwaveBadge = card.querySelector('.card-soundwave-badge');

    if (currentSong && currentSong.id === songId) {
      const isExactOrigin = cardContext === state.activeContextId;

      if (isExactOrigin) {
        card.classList.add('is-active');
        card.classList.remove('is-playing-elsewhere');
        if (playBtnIcon) {
          playBtnIcon.className = isPlaying ? "ph-fill ph-pause" : "ph-fill ph-play";
        }
        if (!soundwaveBadge) {
          soundwaveBadge = document.createElement('div');
          soundwaveBadge.className = 'card-soundwave-badge';
          card.querySelector('.card-img-wrap').appendChild(soundwaveBadge);
        }
        soundwaveBadge.innerHTML = getSoundWaveHTML(!isPlaying);
        soundwaveBadge.style.display = 'flex';
      } else {
        card.classList.remove('is-active');
        card.classList.add('is-playing-elsewhere');
        if (playBtnIcon) {
          playBtnIcon.className = "ph-fill ph-play";
        }
        if (soundwaveBadge) {
          soundwaveBadge.style.display = 'none';
        }
      }
    } else {
      card.classList.remove('is-active', 'is-playing-elsewhere');
      if (playBtnIcon) {
        playBtnIcon.className = "ph-fill ph-play";
      }
      if (soundwaveBadge) {
        soundwaveBadge.style.display = 'none';
      }
    }
  });
  syncLibraryAlbumIndicators(currentSong, isPlaying);

  // 2. Filas de tabla de detalle y búsqueda
  let activeViewContext = 'none';
  if (state.currentView === 'favorites') activeViewContext = 'favorites';
  else if (state.currentView === 'all-music') activeViewContext = 'all_music';
  else if (state.currentView === 'playlist') activeViewContext = 'playlist_' + state.currentPlaylistId;
  else if (state.currentView === 'folder-detail') activeViewContext = 'folder_' + state.currentFolderId;
  else if (state.currentView === 'artist') activeViewContext = artistContextId(state.artistName);
  else if (state.currentView === 'album-detail') activeViewContext = albumContextId(state.albumArtistName, state.albumTitle);
  else if (state.currentView === 'search') activeViewContext = 'search_songs';

  const isTableSourceActive = activeViewContext === state.activeContextId;

  document.querySelectorAll('.playlist-table-row').forEach(row => {
    const songId = Number(row.dataset.songId);
    const indexCell = row.querySelector('.row-index');
    const trackIdx = Number(row.dataset.trackIdx);

    if (currentSong && currentSong.id === songId) {
      if (isTableSourceActive) {
        row.classList.add('is-active');
        row.classList.remove('is-playing-elsewhere');
        if (indexCell) {
          indexCell.innerHTML = getSoundWaveHTML(!isPlaying);
        }
      } else {
        row.classList.remove('is-active');
        row.classList.add('is-playing-elsewhere');
        if (indexCell) {
          indexCell.textContent = trackIdx + 1;
        }
      }
    } else {
      row.classList.remove('is-active', 'is-playing-elsewhere');
      if (indexCell) {
        indexCell.textContent = trackIdx + 1;
      }
    }
    updatePlaylistRowTitleMarquee(row, Boolean(currentSong && currentSong.id === songId && isPlaying));
  });

  // 3. Soundwave en tarjeta "Sonando ahora"
  const nowPlayingWaveWrap = document.querySelector('.now-playing-wave-wrap');
  if (nowPlayingWaveWrap) {
    nowPlayingWaveWrap.innerHTML = getSoundWaveHTML(isPlaybackPaused());
  }

  // 4. Barra lateral izquierda:
  // 4.1 Inicio
  const isHomePlaying = state.activeContextId === 'recent' || state.activeContextId === 'mostPlayed';
  if (navBtnHome) {
    navBtnHome.classList.toggle('is-playing-origin', isHomePlaying);
    if (homeSidebarSoundwave) {
      homeSidebarSoundwave.innerHTML = isHomePlaying ? getSoundWaveHTML(!isPlaying) : '';
    }
  }

  // 4.2 Música
  const isMusicPlaying = state.activeContextId === 'all_music';
  if (navBtnMusic) {
    navBtnMusic.classList.toggle('is-playing-origin', isMusicPlaying);
    if (musicSidebarSoundwave) {
      musicSidebarSoundwave.innerHTML = isMusicPlaying ? getSoundWaveHTML(!isPlaying) : '';
    }
  }

  // 4.3 Carpetas
  const isFoldersPlaying = typeof state.activeContextId === 'string' && state.activeContextId.startsWith('folder_');
  if (navBtnFolders) {
    navBtnFolders.classList.toggle('is-playing-origin', isFoldersPlaying);
    if (foldersSidebarSoundwave) {
      foldersSidebarSoundwave.innerHTML = isFoldersPlaying ? getSoundWaveHTML(!isPlaying) : '';
    }
  }

  // 4.4 Listas de reproducción:
  let isPlaylistPlaying = typeof state.activeContextId === 'string' && state.activeContextId.startsWith('playlist_');
  let isPinnedPlaylist = false;
  if (isPlaylistPlaying) {
    const plId = Number(state.activeContextId.replace('playlist_', ''));
    const pl = state.playlists.find(p => p.id === plId);
    if (pl && pl.isPinned !== false) {
      isPinnedPlaylist = true;
    }
  }

  const shouldShowOnGeneralPlaylistsNav = isPlaylistPlaying && !isPinnedPlaylist;
  if (navBtnPlaylists) {
    navBtnPlaylists.classList.toggle('is-playing-origin', shouldShowOnGeneralPlaylistsNav);
    if (playlistsSidebarSoundwave) {
      playlistsSidebarSoundwave.innerHTML = shouldShowOnGeneralPlaylistsNav ? getSoundWaveHTML(!isPlaying) : '';
    }
  }

  // 4.5 Tus me gusta
  const isFavPlaying = state.activeContextId === 'favorites';
  if (btnOpenFavorites) {
    btnOpenFavorites.classList.toggle('is-playing-origin', isFavPlaying);
    if (favSidebarSoundwave) {
      favSidebarSoundwave.innerHTML = isFavPlaying ? getSoundWaveHTML(!isPlaying) : '';
    }
  }

  // 4.6 Acceso directo de playlists fijadas
  document.querySelectorAll('.playlist-card-left').forEach(card => {
    if (card.classList.contains('quick-access-item')) {
      const originId = card.dataset.quickType === 'song'
        ? `quick_song_${state.localMusicFiles.find(song =>
          sameQuickSongReference(JSON.parse(card.dataset.quickKey), song)
        )?.id}`
        : `folder_${card.dataset.folderId}`;
      const isQuickItemPlaying = Boolean(state.activeContextId) &&
        state.activeContextId === originId;
      card.classList.toggle('is-playing-origin', isQuickItemPlaying);
      const waveWrap = card.querySelector('.sidebar-soundwave-wrap');
      if (waveWrap) waveWrap.innerHTML = isQuickItemPlaying ? getSoundWaveHTML(!isPlaying) : '';
      return;
    }
    const plId = Number(card.dataset.id);
    const isThisPlaylist = state.activeContextId === ('playlist_' + plId);
    card.classList.toggle('is-playing-origin', isThisPlaylist);
    const waveWrap = card.querySelector('.sidebar-soundwave-wrap');
    if (waveWrap) {
      waveWrap.innerHTML = isThisPlaylist ? getSoundWaveHTML(!isPlaying) : '';
    }
  });

  // 5. Cuadrícula de Carpetas
  document.querySelectorAll('.folder-card').forEach(fCard => {
    const fId = Number(fCard.dataset.id);
    const isThisFolder = state.activeContextId === ('folder_' + fId);
    fCard.classList.toggle('is-playing-origin', isThisFolder);
    const playIcon = fCard.querySelector('.card-play-hover i');
    if (playIcon) {
      const isPlayingThisFolder = isThisFolder && Boolean(currentSong) && isPlaying;
      playIcon.className = isPlayingThisFolder ? 'ph-fill ph-pause' : 'ph-fill ph-play';
      const playButton = playIcon.closest('.card-play-hover');
      if (playButton) {
        playButton.title = isPlayingThisFolder ? 'Pausar carpeta' : 'Reproducir carpeta';
        playButton.setAttribute('aria-label', playButton.title);
      }
    }
    const waveWrap = fCard.querySelector('.folder-soundwave-wrap');
    if (waveWrap) {
      waveWrap.innerHTML = isThisFolder ? getSoundWaveHTML(!isPlaying) : '';
    }
  });

  // 6. Cuadrícula del Hub de Playlists
  document.querySelectorAll('.playlist-grid-card').forEach(pCard => {
    const plId = Number(pCard.dataset.id);
    const isThisPlaylist = state.activeContextId === ('playlist_' + plId);
    pCard.classList.toggle('is-playing-origin', isThisPlaylist);
    const playIcon = pCard.querySelector('.card-play-hover i');
    if (playIcon) {
      const isPlayingThisPlaylist = isThisPlaylist && Boolean(currentSong) && isPlaying;
      playIcon.className = isPlayingThisPlaylist ? 'ph-fill ph-pause' : 'ph-fill ph-play';
      const playButton = playIcon.closest('.card-play-hover');
      if (playButton) {
        playButton.title = isPlayingThisPlaylist ? 'Pausar playlist' : 'Reproducir playlist';
        playButton.setAttribute('aria-label', playButton.title);
      }
    }
    const waveWrap = pCard.querySelector('.playlist-hub-soundwave-wrap');
    if (waveWrap) {
      waveWrap.innerHTML = isThisPlaylist ? getSoundWaveHTML(!isPlaying) : '';
    }
  });
}
