// UI · Vista de detalle de una playlist/colección.

import { ensureTrackSortDirState, loadTrackSortModeForView, trackSortMul, updateTrackSortLabelUI } from './sorting.js';
import { matchesListSearch, matchesTrackFilter, syncTrackFilterContext } from './trackFilters.js';
import { formatTime, state } from '../state.js';
import { uiVars } from './sharedState.js';
import { artistAlbumsSection, artistBioToggle, artistDisambiguation, artistFacts, artistLoadMoreButton, artistLoadMoreWrap, artistRelatedSection, artistTagsContainer, btnCollectionOptions, btnPlayAllFavorites, collectionOptionsMenu, collectionOptionsWrap, currentTrackSortLabel, playlistBadgeType, playlistHeroAuthor, playlistHeroBanner, playlistHeroCount, playlistHeroCover, playlistHeroDesc, playlistHeroDuration, playlistHeroTitle, playlistTracksBody, trackSortMenu, tracksFilterBar } from './dom.js';
import { pnStartPointerDrag, updateTrackReorderToggle } from './dragReorder.js';
import { queueDetailShowHistory } from './init.js';
import { albumContextId, artistContextId, matchingAlbumSongs, matchingArtistSongs } from './libraryEntities.js';
import { bindListSongCover, clearContainerCovers, formatListRowIndexHtml } from './covers.js';
import { applyArtistHeroMetadata, renderArtistAlbums, renderRelatedArtists } from './artists.js';
import { getProfileOverride } from './profileEditor.js';
import { resolveCoverUrl } from '../scanner.js';
import { escapeSearchText } from './search.js';
import { getFavoriteActionLabel, getFavoritesDisplayName, syncFavoritesCollectionVisual } from './favorites.js';
import { ensureFavoriteAddedTimestamps, formatFavoriteAddedDate, formatPlaylistAddedDate, getFavoriteAddedTimestamp, getPlaylistAddedTimestamp, getSmartPlaylistSongs } from './playlistData.js';
import { escapeHtml, extractDominantColor } from './uiUtils.js';
import { isPlaybackPaused } from '../audioPlayer.js';
import { ensurePlayableSong } from './songCards.js';
import { updateQueuePositionIndicator } from './queueHistory.js';
import { updatePlaylistRowTitleMarquee } from './playback.js';

export const ARTIST_TRACK_PAGE_SIZE = 15;

export async function renderPlaylistDetailView({ append = false, previousVisibleCount = 0 } = {}) {
  loadTrackSortModeForView();
  syncTrackFilterContext();
  const paginationContextKey = JSON.stringify([
    state.currentView,
    state.currentPlaylistId,
    state.currentFolderId,
    state.artistName,
    state.albumArtistName,
    state.albumTitle,
    uiVars.activeTrackFilter.field,
    uiVars.activeTrackFilter.value,
    uiVars.listSearchQuery
  ]);
  if (uiVars.detailVisibleContextKey !== paginationContextKey) {
    uiVars.detailVisibleContextKey = paginationContextKey;
    uiVars.detailVisibleCount = state.currentView === 'artist' ? ARTIST_TRACK_PAGE_SIZE : 50;
    if (state.currentView === 'all-music') state.musicVisibleCount = 50;
  }
  const isFav = state.currentView === 'favorites';
  const isMusic = state.currentView === 'all-music';
  const isFolder = state.currentView === 'folder-detail';
  const isArtist = state.currentView === 'artist';
  const isAlbum = state.currentView === 'album-detail';
  const isQueue = state.currentView === 'queue-detail';
  let queueHistoryPrefixLen = 0;
  if (artistLoadMoreWrap) artistLoadMoreWrap.hidden = true;
  const effectiveTrackSortMode = (isMusic || isFolder) && state.trackSortMode === 'custom'
    ? 'title'
    : state.trackSortMode;
  updateTrackReorderToggle();
  if (artistAlbumsSection) artistAlbumsSection.hidden = !isArtist;
  if (artistRelatedSection) artistRelatedSection.hidden = !isArtist;
  if (artistTagsContainer && !isArtist) {
    artistTagsContainer.replaceChildren();
    artistTagsContainer.hidden = true;
  }
  if (!isArtist) {
    if (artistDisambiguation) {
      artistDisambiguation.textContent = '';
      artistDisambiguation.hidden = true;
    }
    if (artistFacts) {
      artistFacts.replaceChildren();
      artistFacts.hidden = true;
    }
  }
  if (artistBioToggle) artistBioToggle.hidden = !isArtist;
  playlistHeroBanner.classList.toggle('artist-profile-hero', isArtist);
  playlistHeroBanner.classList.toggle('album-detail-hero', isAlbum);
  if (collectionOptionsWrap) {
    collectionOptionsWrap.hidden = !(isMusic || isFolder || isFav || isArtist || isAlbum || isQueue || state.currentView === 'playlist');
  }
  document.querySelectorAll('.playlist-view .playlist-sort-wrapper').forEach(el => {
    // En cola: mantener el wrapper solo para manito + historial (sin "Ordenar por")
    el.hidden = false;
  });
  const btnQueueHistory = document.getElementById('btn-toggle-queue-history');
  if (btnQueueHistory) {
    btnQueueHistory.hidden = !isQueue;
    btnQueueHistory.setAttribute('aria-pressed', String(queueDetailShowHistory));
    btnQueueHistory.title = queueDetailShowHistory
      ? 'Ocultar reproducidas'
      : 'Mostrar reproducidas';
    btnQueueHistory.setAttribute('aria-label', btnQueueHistory.title);
    const histIcon = btnQueueHistory.querySelector('i');
    if (histIcon) {
      histIcon.className = queueDetailShowHistory
        ? 'ph-fill ph-clock-counter-clockwise'
        : 'ph ph-clock-counter-clockwise';
    }
  }
  const refreshProfileAction = collectionOptionsMenu?.querySelector('[data-collection-action="refresh-profile"]');
  const editProfileAction = collectionOptionsMenu?.querySelector('[data-collection-action="edit-profile"]');
  if (refreshProfileAction) refreshProfileAction.hidden = !(isArtist || isAlbum);
  if (editProfileAction) editProfileAction.hidden = !(isArtist || isAlbum || isFolder);
  const refreshProfileLabel = refreshProfileAction?.querySelector('span');
  if (refreshProfileLabel) {
    refreshProfileLabel.textContent = isArtist ? 'Actualizar desde MusicBrainz' : 'Actualizar desde la biblioteca';
  }
  const editProfileLabel = editProfileAction?.querySelector('span');
  if (editProfileLabel) editProfileLabel.textContent = isFolder ? 'Editar descripción' : 'Editar información y foto';
  if (playlistHeroAuthor) {
    playlistHeroAuthor.disabled = !isAlbum;
    playlistHeroAuthor.classList.toggle('is-link', isAlbum);
  }
  const findMissingAction = collectionOptionsMenu?.querySelector('[data-collection-action="find-missing"]');
  if (findMissingAction) {
    const currentPlaylist = state.playlists.find(item => item.id === state.currentPlaylistId);
    findMissingAction.hidden = state.currentView !== 'playlist' || Boolean(currentPlaylist?.smartFilter);
  }
  if (collectionOptionsMenu) collectionOptionsMenu.hidden = true;
  if (btnCollectionOptions) btnCollectionOptions.setAttribute('aria-expanded', 'false');
  if (!isArtist && !isAlbum) {
    trackSortMenu?.querySelectorAll('.sort-option').forEach(option => { option.hidden = false; });
    const dateSortOption = trackSortMenu?.querySelector('[data-sort="date"]');
    if (dateSortOption) dateSortOption.textContent = 'Fecha en que se agregó';
    const albumTrackOption = trackSortMenu?.querySelector('[data-sort="track"]');
    if (albumTrackOption) albumTrackOption.hidden = true;
    const customSortOption = trackSortMenu?.querySelector('[data-sort="custom"]');
    if (customSortOption) customSortOption.hidden = isMusic || isFolder;
    trackSortMenu?.querySelectorAll('.sort-option').forEach(option => {
      option.classList.toggle('active', option.dataset.sort === effectiveTrackSortMode);
    });
    if (currentTrackSortLabel) {
      const activeOption = trackSortMenu?.querySelector(`[data-sort="${effectiveTrackSortMode}"]`);
      updateTrackSortLabelUI(activeOption?.textContent || 'Nombre de la canción');
    }
  }
  let playlist = null;
  let currentFolder = null;
  let rawSongs = [];

  if (isArtist) {
    const artistName = String(state.artistName || '').trim();
    if (!artistName) return;
    rawSongs = matchingArtistSongs(artistName);
    if (playlistBadgeType) playlistBadgeType.textContent = 'Artista';
    playlistHeroTitle.textContent = artistName;
    playlistHeroAuthor.textContent = artistName;
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = '<i class="ph ph-user-circle"></i>';
    playlistHeroDesc.textContent = 'Cargando información de MusicBrainz…';
    playlistHeroDesc.style.removeProperty('display');
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    if (artistDisambiguation) {
      artistDisambiguation.textContent = '';
      artistDisambiguation.hidden = true;
    }
    if (artistFacts) {
      artistFacts.replaceChildren();
      artistFacts.hidden = true;
    }
    if (artistTagsContainer) {
      artistTagsContainer.replaceChildren();
      artistTagsContainer.hidden = true;
    }
    playlistHeroBanner.style.background = 'var(--bg-hero)';
    if (artistBioToggle) {
      artistBioToggle.hidden = true;
      artistBioToggle.textContent = 'Leer más';
      artistBioToggle.setAttribute('aria-expanded', 'false');
    }
    void applyArtistHeroMetadata(artistName);
    renderArtistAlbums(rawSongs);
    renderRelatedArtists(artistName, rawSongs);
    const sortLabel = state.artistSortMode === 'date' ? 'Más recientes' : 'Más escuchadas';
    if (currentTrackSortLabel) updateTrackSortLabelUI(sortLabel);
    trackSortMenu?.querySelectorAll('.sort-option').forEach(option => {
      const visible = option.dataset.sort === 'plays' || option.dataset.sort === 'date';
      option.hidden = !visible;
      option.classList.toggle('active', option.dataset.sort === state.artistSortMode);
      if (option.dataset.sort === 'date') option.textContent = 'Más recientes';
    });
  } else if (isAlbum) {
    const albumTitle = String(state.albumTitle || '').trim();
    const artistName = String(state.albumArtistName || state.artistName || '').trim();
    if (!albumTitle || !artistName) return;
    rawSongs = matchingAlbumSongs(artistName, albumTitle);
    const albumOverride = getProfileOverride('album', artistName, albumTitle);
    if (playlistBadgeType) playlistBadgeType.textContent = 'Álbum';
    playlistHeroTitle.textContent = albumTitle;
    playlistHeroAuthor.textContent = artistName;
    const coverUrl = albumOverride?.photo || rawSongs.map(s => resolveCoverUrl(s)).find(Boolean);
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = coverUrl
      ? `<img src="${escapeSearchText(coverUrl)}" class="playlist-hero-cover-img" alt="Carátula de ${escapeSearchText(albumTitle)}" />`
      : '<i class="ph ph-disc"></i>';
    playlistHeroDesc.textContent = albumOverride?.description || '';
    playlistHeroDesc.style.display = albumOverride?.description ? 'block' : 'none';
    if (artistFacts) {
      artistFacts.replaceChildren();
      const facts = [
        ['Año', albumOverride?.year],
        ['Sello', albumOverride?.label]
      ].filter(([, value]) => value);
      artistFacts.hidden = facts.length === 0;
      facts.forEach(([label, value]) => {
        const item = document.createElement('span');
        item.className = 'artist-fact';
        const name = document.createElement('strong');
        name.textContent = `${label}: `;
        item.append(name, document.createTextNode(value));
        artistFacts.appendChild(item);
      });
    }
    if (artistBioToggle) artistBioToggle.hidden = true;
    playlistHeroBanner.style.background = 'var(--bg-hero)';
    const sortLabel = state.albumSortMode === 'plays'
      ? 'Más escuchadas'
      : state.albumSortMode === 'date' ? 'Más recientes' : 'N.º de pista';
    if (currentTrackSortLabel) updateTrackSortLabelUI(sortLabel);
    trackSortMenu?.querySelectorAll('.sort-option').forEach(option => {
      const visible = ['track', 'plays', 'date'].includes(option.dataset.sort);
      option.hidden = !visible;
      option.classList.toggle('active', option.dataset.sort === state.albumSortMode);
      if (option.dataset.sort === 'track') option.textContent = 'N.º de pista';
      if (option.dataset.sort === 'date') option.textContent = 'Más recientes';
    });
  } else if (isFav) {
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    rawSongs = state.localMusicFiles.filter(s => s.isFavorite);
    if (playlistBadgeType) playlistBadgeType.textContent = "Playlist";
    playlistHeroTitle.textContent = getFavoritesDisplayName();
    // Forzar icono/fondo después de pintar el hero (evita que el render lo pise)
    queueMicrotask(() => {
      try { syncFavoritesCollectionVisual(getFavoritesDisplayName() === 'Favoritos'); } catch (_) {}
    });
    setTimeout(() => {
      try { syncFavoritesCollectionVisual(getFavoritesDisplayName() === 'Favoritos'); } catch (_) {}
    }, 0);
    if (playlistHeroAuthor) playlistHeroAuthor.textContent = 'Resonance';
    playlistHeroDesc.style.display = "none";
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = `<i class="ph-fill ph-heart"></i>`;
    playlistHeroBanner.style.background = 'var(--bg-hero)';
    } else if (isQueue) {
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    // Historial (más antiguo arriba) + cola actual
    const cur = Math.max(0, state.currentTrackIndex >= 0 ? state.currentTrackIndex : 0);
    const upcoming = (state.activeQueue || []).slice(cur);
    // Historial de "reproducidas" (panel lateral), más antiguas arriba
    const hist = queueDetailShowHistory
      ? [...(state.playbackHistory || [])].slice().reverse()
      : [];
    queueHistoryPrefixLen = hist.length;
    // Sin historial: solo canción actual + siguientes (las ya reproducidas desaparecen)
    rawSongs = [...hist, ...upcoming];
    if (playlistBadgeType) playlistBadgeType.textContent = 'Cola';
    const qTitle = state.activeQueueTitle ? String(state.activeQueueTitle) : 'Reproducción';
    playlistHeroTitle.textContent = qTitle;
    if (playlistHeroAuthor) playlistHeroAuthor.textContent = 'Cola de reproducción';
    playlistHeroDesc.style.display = 'none';
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = `<i class="ph ph-queue"></i>`;
    playlistHeroBanner.style.background = 'var(--bg-hero)';
    // Sin ordenar por: orden fijo de la cola
    if (currentTrackSortLabel) updateTrackSortLabelUI('Orden de la cola');
    trackSortMenu?.querySelectorAll('.sort-option').forEach(option => { option.hidden = true; });
} else if (isMusic) {
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    rawSongs = [...state.localMusicFiles];
    if (playlistBadgeType) playlistBadgeType.textContent = "Biblioteca";
    playlistHeroTitle.textContent = "Música";
    if (playlistHeroAuthor) playlistHeroAuthor.textContent = 'Resonance';
    playlistHeroDesc.style.display = "none";
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = `<i class="ph ph-music-notes"></i>`;
    playlistHeroBanner.style.background = 'var(--bg-hero)';
  } else if (isFolder) {
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    currentFolder = state.configuredFolders.find(f => f.id === state.currentFolderId);
    if (!currentFolder) return;
    rawSongs = state.localMusicFiles.filter(s => s.folderName === currentFolder.name);
    if (playlistBadgeType) playlistBadgeType.textContent = "Carpeta";
    playlistHeroTitle.textContent = currentFolder.name;
    if (playlistHeroAuthor) playlistHeroAuthor.textContent = currentFolder.name;
    playlistHeroDesc.textContent = currentFolder.description || "Carpeta local de música";
    playlistHeroDesc.style.display = "block";
    clearContainerCovers(playlistHeroCover);
    playlistHeroCover.innerHTML = `<i class="ph-fill ph-folder"></i>`;
    playlistHeroBanner.style.background = 'var(--bg-hero)';
  } else {
    playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
    playlist = state.playlists.find(p => p.id === state.currentPlaylistId);
    if (!playlist) return;
    rawSongs = playlist.smartFilter ? getSmartPlaylistSongs(playlist) : (playlist.songs || []);
    if (playlistBadgeType) {
      playlistBadgeType.replaceChildren();
      if (playlist.smartFilter) {
        const icon = document.createElement('i');
        icon.className = 'ph ph-lightning';
        icon.setAttribute('aria-hidden', 'true');
        playlistBadgeType.append(icon, document.createTextNode(' Lista dinámica'));
      } else {
        playlistBadgeType.textContent = 'Playlist';
      }
    }
    playlistHeroTitle.textContent = playlist.title;
    if (playlistHeroAuthor) playlistHeroAuthor.textContent = 'Resonance';
    
    if (playlist.description && playlist.description.trim()) {
      playlistHeroDesc.textContent = playlist.description.trim();
      playlistHeroDesc.style.display = "block";
    } else {
      playlistHeroDesc.style.display = "none";
    }

    clearContainerCovers(playlistHeroCover);
    if (playlist.coverUrl) {
      playlistHeroCover.innerHTML = `<img src="${escapeHtml(playlist.coverUrl)}" class="playlist-hero-cover-img" alt="Cover" />`;
      const color = await extractDominantColor(playlist.coverUrl);
      playlistHeroBanner.style.background = `linear-gradient(180deg, rgba(${color.r}, ${color.g}, ${color.b}, 0.75) 0%, color-mix(in srgb, var(--bg-app) 40%, transparent) 100%)`;
    } else {
      playlistHeroCover.innerHTML = `<i class="ph ph-playlist"></i>`;
      playlistHeroBanner.style.background = 'var(--bg-hero)';
    }
  }

  if (tracksFilterBar) {
    tracksFilterBar.hidden = !(isFav || isMusic || isFolder || state.currentView === 'playlist');
  }
  let songs = [...rawSongs];
  if (isQueue) {
    songs = songs.filter(song => matchesListSearch(song));
  } else if (isFav || isMusic || isFolder || state.currentView === 'playlist') {
    songs = songs.filter(song => matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song));
  }
  ensureTrackSortDirState();
  const sortMul = trackSortMul();
  if (isQueue) {
    // Mantener el orden real de la cola
  } else if (isAlbum && state.albumSortMode === 'plays') {
    songs.sort((a, b) => sortMul * ((a.playCount || 0) - (b.playCount || 0)));
  } else if (isAlbum && state.albumSortMode === 'date') {
    songs.sort((a, b) => sortMul * ((a.file?.lastModified || 0) - (b.file?.lastModified || 0)));
  } else if (isAlbum && state.albumSortMode === 'track') {
    songs.sort((a, b) => {
      const trackA = Number(a.trackNumber) || Number.MAX_SAFE_INTEGER;
      const trackB = Number(b.trackNumber) || Number.MAX_SAFE_INTEGER;
      return sortMul * (trackA - trackB);
    });
  } else if (isArtist && state.artistSortMode === 'plays') {
    songs.sort((a, b) => sortMul * ((a.playCount || 0) - (b.playCount || 0)));
  } else if (isArtist && state.artistSortMode === 'date') {
    songs.sort((a, b) => sortMul * ((a.file?.lastModified || 0) - (b.file?.lastModified || 0)));
  } else if (effectiveTrackSortMode === 'plays') {
    songs.sort((a, b) => sortMul * ((a.playCount || 0) - (b.playCount || 0)));
  } else if (effectiveTrackSortMode === 'title') {
    songs.sort((a, b) => sortMul * (a.title || "").localeCompare(b.title || ""));
  } else if (effectiveTrackSortMode === 'date') {
    if (state.currentView === 'playlist') {
      songs.sort((a, b) => sortMul * (getPlaylistAddedTimestamp(a) - getPlaylistAddedTimestamp(b)));
    } else if (state.currentView === 'favorites') {
      ensureFavoriteAddedTimestamps();
      songs.sort((a, b) => sortMul * (getFavoriteAddedTimestamp(a) - getFavoriteAddedTimestamp(b)));
    } else {
      songs.sort((a, b) => sortMul * ((a.file?.lastModified || 0) - (b.file?.lastModified || 0)));
    }
  } else if (effectiveTrackSortMode === 'duration') {
    songs.sort((a, b) => sortMul * ((a.duration || 0) - (b.duration || 0)));
  }

  playlistHeroCount.textContent = `${songs.length} canciones`;
  let totalSecs = 0;
  let songsWithDuration = 0;
  songs.forEach(song => {
    if (Number.isFinite(song.duration) && song.duration > 0) {
      totalSecs += song.duration;
      songsWithDuration++;
    }
  });
  const totalMins = Math.floor(totalSecs / 60);
  const formattedTotal = totalMins > 60
    ? `${Math.floor(totalMins / 60)} h ${totalMins % 60} min`
    : `${totalMins} min`;
  playlistHeroDuration.textContent = songsWithDuration === 0
    ? 'Duración desconocida'
    : songsWithDuration < songs.length
      ? `Al menos ${formattedTotal}`
      : formattedTotal;
  if (collectionOptionsMenu) {
    collectionOptionsMenu.querySelectorAll('[data-collection-action]').forEach(button => {
      if (button.dataset.collectionAction === 'edit-profile') {
        button.hidden = !(isArtist || isAlbum || isFolder);
        button.disabled = false;
      } else if (button.dataset.collectionAction === 'refresh-profile') {
        button.hidden = !(isArtist || isAlbum);
        button.disabled = false;
      } else {
        button.hidden = isArtist || isAlbum;
        button.disabled = songs.length === 0;
      }
    });
  }

  if (!append) {
    clearContainerCovers(playlistTracksBody);
    playlistTracksBody.replaceChildren();
  }

  if (songs.length === 0) {
    uiVars.renderedTrackList = [];
    const emptyMsg = uiVars.activeTrackFilter.field !== 'all' && (isFolder || isFav || isMusic || state.currentView === 'playlist')
      ? "No hay canciones que coincidan con el filtro actual."
      : isFolder
      ? "No hay canciones dentro de esta carpeta."
      : (isAlbum
        ? `No hay canciones del álbum ${escapeSearchText(state.albumTitle)} de ${escapeSearchText(state.albumArtistName)} en tu biblioteca.`
      : (isArtist
        ? `No hay canciones de ${escapeSearchText(state.artistName)} en tu biblioteca.`
      : (isMusic 
        ? "Tu biblioteca local aún no tiene canciones escaneadas." 
        : (isFav ? "Aún no tienes canciones favoritas." : "Esta playlist está vacía."))));
    playlistTracksBody.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 4rem 1rem; font-size: 0.95rem;">
        <i class="ph ph-folder-dashed" style="font-size: 3rem; color: var(--accent-light); margin-bottom: 0.8rem; display: block;"></i>
        ${emptyMsg}
      </div>
    `;
    return;
  }

  const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
  
  let currentContextId = 'playlist_' + playlist?.id;
  if (isFav) currentContextId = 'favorites';
  else if (isMusic) currentContextId = 'all_music';
  else if (isFolder) currentContextId = 'folder_' + currentFolder.id;
  else if (isArtist) currentContextId = artistContextId(state.artistName);
  else if (isAlbum) currentContextId = albumContextId(state.albumArtistName, state.albumTitle);

  const isTableSourceActive = currentContextId === state.activeContextId;
  const collectionPlayIcon = btnPlayAllFavorites?.querySelector('i');
  if (collectionPlayIcon) {
    const isCurrentCollectionPlaying = currentSong &&
      state.activeContextId === currentContextId &&
      !isPlaybackPaused();
    collectionPlayIcon.className = isCurrentCollectionPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    btnPlayAllFavorites.title = isCurrentCollectionPlaying ? 'Pausar' : 'Reproducir todo';
  }
  const visibleCount = isMusic ? state.musicVisibleCount : uiVars.detailVisibleCount;
  // Paginación acumulativa: se muestran 0..visibleCount y al scrollear se añaden más.
  // (La ventana deslizante de ~120 filas quitaba las de arriba y bloqueaba el "cargar más".)
  const songsToDisplay = songs.slice(0, visibleCount);
  const useAppend = Boolean(append) &&
    previousVisibleCount > 0 &&
    previousVisibleCount < songsToDisplay.length;
  const firstSongToRender = useAppend
    ? Math.min(previousVisibleCount, songsToDisplay.length)
    : 0;
  if (artistLoadMoreWrap) {
    const remainingCount = Math.max(0, songs.length - songsToDisplay.length);
    artistLoadMoreWrap.hidden = !isArtist || remainingCount === 0;
    if (artistLoadMoreButton && remainingCount > 0) {
      artistLoadMoreButton.textContent = `Cargar más canciones (${remainingCount} restantes)`;
    }
  }

  uiVars.renderedTrackList = songs.map(s => ensurePlayableSong(s) || s);
  uiVars.renderedTrackContextId = currentContextId;
  uiVars.renderedTrackContextTitle = playlist?.title ||
    (isMusic ? 'Música'
      : isFolder ? currentFolder.name
        : isArtist ? state.artistName
          : isAlbum ? `${state.albumTitle} — ${state.albumArtistName}`
            : isFav ? getFavoritesDisplayName()
              : isQueue ? (state.activeQueueTitle || 'Cola de reproducción')
                : 'Cola de reproducción');

  const rawSongIndexMap = new Map();
  for (let i = 0; i < rawSongs.length; i++) {
    rawSongIndexMap.set(rawSongs[i], i);
  }

  songsToDisplay.slice(firstSongToRender).forEach((song, pageIndex) => {
    const idx = firstSongToRender + pageIndex;
    const row = document.createElement('div');
    row.className = 'playlist-table-row';
    row.dataset.songId = song.id != null ? String(song.id) : '';
    row.dataset.trackIdx = String(idx);
    row.dataset.songPath = String(song.file?.path || song.path || '');
    let sourceIdx = rawSongIndexMap.get(song);
    row.dataset.sourceTrackIdx = sourceIdx !== undefined ? String(sourceIdx) : '-1';

    if (isQueue) {
      const displayIdx = typeof idx === 'number' ? idx : sourceIdx;
      const isHistRow = queueHistoryPrefixLen > 0 && displayIdx < queueHistoryPrefixLen;
      if (isHistRow) {
        row.classList.add('is-queue-history');
        row.dataset.queueHistory = '1';
        row.dataset.sourceTrackIdx = '-1';
      } else {
        const cur = Math.max(0, state.currentTrackIndex >= 0 ? state.currentTrackIndex : 0);
        const queueIdx = cur + (displayIdx - queueHistoryPrefixLen);
        row.dataset.sourceTrackIdx = String(queueIdx);
        row.dataset.queueIdx = String(queueIdx);
        if (queueIdx === state.currentTrackIndex) {
          row.classList.add('is-current');
        }
        if (state.queueTrackDragReorderEnabled !== false && !uiVars.listSearchQuery) {
          row.draggable = false;
          row.style.cursor = 'grab';
          row.addEventListener('pointerdown', (e) => {
            pnStartPointerDrag(e, { type: 'queue-detail', fromIndex: queueIdx, el: row });
          });
        }
      }
    } else if ((isFav || state.currentView === 'playlist') &&
        state.trackSortMode === 'custom' && uiVars.activeTrackFilter.field === 'all' &&
        !playlist?.smartFilter && !isMusic && !isFolder && !isArtist &&
        (state.currentView !== 'playlist' || state.playlistTrackDragReorderEnabled)) {
      row.draggable = false;
      row.style.cursor = 'grab';
      row.dataset.sourceTrackIdx = row.dataset.sourceTrackIdx || String(sourceIdx ?? '');
      const trackIdxForDrag = Number(row.dataset.sourceTrackIdx);
      if (Number.isInteger(trackIdxForDrag) && trackIdxForDrag >= 0) {
        row.addEventListener('pointerdown', (e) => {
          pnStartPointerDrag(e, { type: 'track', fromIndex: trackIdxForDrag, el: row });
        });
      }
    }

    const isCurrent = currentSong && currentSong.id === song.id;
    if (isCurrent && isTableSourceActive) {
      row.classList.add('is-active');
    } else if (isCurrent) {
      row.classList.add('is-playing-elsewhere');
    }

    const thumbHtml = `<img class="row-thumb-img" draggable="false" alt="" width="40" height="40" />`;

    const displayNumber = isAlbum && song.trackNumber ? song.trackNumber : idx + 1;
    const indexHtml = formatListRowIndexHtml({
      isCurrent,
      isActiveSource: isTableSourceActive,
      displayNumber
    });

    row.innerHTML = `
      <div class="row-index">${indexHtml}</div>
      <div class="row-title-box">
        <div class="row-thumb-box">${thumbHtml}</div>
        <div class="row-text-meta">
          <strong>${escapeHtml(song.title)}</strong>
          <span>${escapeHtml(song.artist || "Desconocido")}</span>
        </div>
      </div>
      <div class="row-album">${escapeHtml(song.album || "Sencillo")}</div>
      <div class="row-date">${(state.currentView === 'playlist' && !isQueue) ? formatPlaylistAddedDate(song) : (state.currentView === 'favorites' ? formatFavoriteAddedDate(song) : escapeHtml(song.addedDate || "Reciente"))}</div>
      <div class="row-duration-box">
        <span>${Number.isFinite(song.duration) && song.duration > 0 ? formatTime(song.duration) : '--:--'}</span>
        <button class="row-fav-btn ${song.isFavorite ? 'active' : ''}" title="${getFavoriteActionLabel(song.isFavorite)}">
          <i class="${song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
        </button>
      </div>
    `;

    updateQueuePositionIndicator(row, song);
    playlistTracksBody.appendChild(row);
    const thumbImg = row.querySelector('.row-thumb-img');
    if (thumbImg) bindListSongCover(thumbImg, song);
    updatePlaylistRowTitleMarquee(row, Boolean(isCurrent && !isPlaybackPaused()));
  });
}
