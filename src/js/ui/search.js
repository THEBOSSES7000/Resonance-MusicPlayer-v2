// UI · Búsqueda: sugerencias y resultados.

import { SEARCH_PAGE_SIZE, uiVars } from './sharedState.js';
import { searchResultsContent, searchSuggestions } from './dom.js';
import { bindLazyCover, bindListSongCover, clearContainerCovers, formatListRowIndexHtml } from './covers.js';
import { formatTime, state } from '../state.js';
import { navigateToView } from './navigation.js';
import { resolveCoverUrl } from '../scanner.js';
import { getSearchPlayBehavior, playSongFromContext, playSongReplacingCurrent } from './songCards.js';
import { getPlaylistSongs } from './playlistData.js';
import { getFavoriteActionLabel, toggleFavoriteForSelection } from './favorites.js';
import { handleSongSelectionClick } from './selection.js';
import { updateQueuePositionIndicator } from './queueHistory.js';
import { playFromContext, updatePlaylistRowTitleMarquee } from './playback.js';
import { isPlaybackPaused, loadSong, resolveManualAutoPlay, togglePlay } from '../audioPlayer.js';
import { escapeHtml, getSoundWaveHTML } from './uiUtils.js';
import { createLibraryAlbumCard, createLibraryArtistCard, getLibraryAlbums, getLibraryArtists } from './libraryEntities.js';
import { loadArtistPortraits } from './artists.js';
import { albumsMinTrackCount } from './init.js';
import { syncLibraryAlbumIndicators } from './homeGrids.js';

let lastSearchRenderedQuery = '';

let lastSearchRenderedTab = '';

export function hideSearchSuggestions() {
  if (!searchSuggestions) return;
  clearContainerCovers(searchSuggestions);
  searchSuggestions.hidden = true;
  searchSuggestions.replaceChildren();
}

export function escapeSearchText(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function openSearchResults(query) {
  state.searchQuery = query;
  uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
  if (state.currentView !== 'search') {
    state.searchTab = 'songs';
    navigateToView('search');
  } else {
    renderSearchResultsContent();
  }
  hideSearchSuggestions();
}

export function renderSearchSuggestions(query) {
  if (!searchSuggestions) return;
  clearContainerCovers(searchSuggestions);
  searchSuggestions.replaceChildren();

  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery || state.currentView === 'search') {
    hideSearchSuggestions();
    return;
  }

  const songMatches = [];
  for (let i = 0; i < state.localMusicFiles.length; i++) {
    const song = state.localMusicFiles[i];
    if ([song.title, song.artist, song.album].some(value =>
      value && value.toLocaleLowerCase().includes(normalizedQuery)
    )) {
      songMatches.push(song);
    }
  }
  const playlistMatches = state.playlists.filter(playlist =>
    [playlist.title, playlist.description].some(value =>
      value && value.toLocaleLowerCase().includes(normalizedQuery)
    )
  );
  const folderMatches = (state.configuredFolders || []).filter(folder =>
    folder.name && folder.name.toLocaleLowerCase().includes(normalizedQuery)
  );
  const resultCount = songMatches.length + playlistMatches.length + folderMatches.length;

  const appendGroup = (label, entries, type, getTitle, getSubtitle, getIcon) => {
    if (entries.length === 0) return;
    const heading = document.createElement('div');
    heading.className = 'search-suggestions-label';
    heading.textContent = label;
    searchSuggestions.appendChild(heading);

    entries.slice(0, type === 'song' ? 4 : 2).forEach(entry => {
      const suggestion = document.createElement('button');
      suggestion.type = 'button';
      suggestion.className = 'search-suggestion';
      suggestion.setAttribute('role', 'option');
      suggestion.dataset.quickType = type;
      suggestion.dataset.quickId = entry.id;

      const cover = document.createElement('span');
      cover.className = 'search-suggestion-cover';
      const resolvedSuggestionCover = type === 'song' ? resolveCoverUrl(entry) : null;
      if (resolvedSuggestionCover) {
        const image = document.createElement('img');
        bindLazyCover(image, resolvedSuggestionCover, '');
        cover.appendChild(image);
      } else {
        cover.innerHTML = `<i class="${getIcon(entry)}"></i>`;
      }

      const meta = document.createElement('span');
      meta.className = 'search-suggestion-meta';
      const title = document.createElement('strong');
      title.textContent = getTitle(entry);
      const subtitle = document.createElement('span');
      subtitle.textContent = getSubtitle(entry);
      meta.append(title, subtitle);
      suggestion.append(cover, meta);
      suggestion.addEventListener('mousedown', event => event.preventDefault());
      suggestion.addEventListener('click', () => {
        if (type === 'song') {
          // Búsqueda rápida: siempre reemplazar solo la canción actual
          playSongReplacingCurrent(entry, 'Búsqueda');
        } else if (type === 'playlist') {
          navigateToView('playlist', { playlistId: entry.id });
        } else if (type === 'folder') {
          navigateToView('folder-detail', { folderId: entry.id });
        }
        hideSearchSuggestions();
      });
      searchSuggestions.appendChild(suggestion);
    });
  };

  appendGroup('Canciones', songMatches, 'song',
    song => song.title || 'Sin título',
    song => song.artist || 'Desconocido',
    () => 'ph ph-music-note');
  appendGroup('Playlists', playlistMatches, 'playlist',
    playlist => playlist.title || 'Playlist sin título',
    playlist => `${getPlaylistSongs(playlist).length} canciones`,
    () => 'ph ph-playlist');
  appendGroup('Carpetas', folderMatches, 'folder',
    folder => folder.name,
    folder => `${folder.count || 0} canciones`,
    () => 'ph ph-folder');

  if (resultCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-suggestions-label';
    empty.textContent = 'No se encontraron resultados';
    searchSuggestions.appendChild(empty);
  }

  const allResults = document.createElement('button');
  allResults.type = 'button';
  allResults.className = 'search-suggestion search-suggestion-all';
  allResults.textContent = `Ver todos los resultados (${resultCount})`;
  allResults.addEventListener('mousedown', event => event.preventDefault());
  allResults.addEventListener('click', () => openSearchResults(query.trim()));
  searchSuggestions.appendChild(allResults);
  searchSuggestions.hidden = false;
}

/**
 * RENDERIZADO DE RESULTADOS DE BÚSQUEDA (PESTAÑAS ESTILO SPOTIFY CON PAGINACIÓN Y DELEGACIÓN)
 */
export function renderSearchResultsContent({ append = false, previousVisibleCount = 0 } = {}) {
  queueMicrotask(() => { try { window.__pnEnsureMusicColumnHandles?.(); } catch (_) {} });
  if (!searchResultsContent) return;

  const q = (state.searchQuery || '').trim().toLowerCase();
  const displayQuery = escapeSearchText(state.searchQuery || '');

  if (!append || lastSearchRenderedQuery !== q || lastSearchRenderedTab !== state.searchTab) {
    append = false;
    uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
    lastSearchRenderedQuery = q;
    lastSearchRenderedTab = state.searchTab;
    clearContainerCovers(searchResultsContent);
    searchResultsContent.innerHTML = '';
  }

  document.querySelectorAll('.search-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.tab === state.searchTab);
  });

  if (!q) {
    uiVars.renderedSearchSongsList = [];
    uiVars.renderedSearchQueueList = [];
    searchResultsContent.innerHTML = `
      <div class="empty-state-card" style="margin-top: 1rem;">
        <i class="ph ph-magnifying-glass"></i>
        <h3>Escribe para buscar</h3>
        <p>Busca canciones, artistas, álbumes, listas, carpetas o elementos de tu cola.</p>
      </div>
    `;
    return;
  }

  // 1. PESTAÑA CANCIONES (PAGINADA Y CON DELEGACIÓN DE EVENTOS)
  if (state.searchTab === 'songs') {
    if (!append) {
      uiVars.renderedSearchSongsList = state.localMusicFiles.filter(s =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)) ||
        (s.album && s.album.toLowerCase().includes(q))
      );
    }
    const matches = uiVars.renderedSearchSongsList;

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-music-notes"></i>
          <h3>No se encontraron canciones</h3>
          <p>No hay canciones que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const currentSong = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
    const isSearchContextActive = state.activeContextId === 'search_songs';

    let body = searchResultsContent.querySelector('#search-tracks-body');
    if (!append || !body) {
      const container = document.createElement('div');
      container.className = 'playlist-table-container';
      container.style.padding = '0';

      container.innerHTML = `
        <div class="playlist-table-header">
          <div class="col-index">#</div>
          <div class="col-title">Título</div>
          <div class="col-album">Álbum</div>
          <div class="col-date">Fecha en que se agregó</div>
          <div class="col-duration"><i class="ph ph-clock"></i></div>
        </div>
        <div class="playlist-table-body" id="search-tracks-body"></div>
      `;

      body = container.querySelector('#search-tracks-body');

      // Delegación única de eventos en #search-tracks-body
      body.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const row = target?.closest('.playlist-table-row');
        if (!row) return;
        const idx = Number(row.dataset.trackIdx);
        const song = uiVars.renderedSearchSongsList[idx];
        if (!song) return;

        if (target.closest('.row-fav-btn')) {
          e.stopPropagation();
          void toggleFavoriteForSelection(song, row);
          return;
        }
        if (handleSongSelectionClick(row, e)) return;
        const behavior = getSearchPlayBehavior();
        if (behavior === 'replace_queue') {
          playSongFromContext(
            uiVars.renderedSearchSongsList,
            idx,
            `Búsqueda: ${state.searchQuery}`,
            'search_songs'
          );
        } else {
          playSongReplacingCurrent(song, `Búsqueda: ${state.searchQuery}`);
        }
      });

      searchResultsContent.appendChild(container);
    }

    const visibleSlice = matches.slice(0, uiVars.searchVisibleCount);
    const startIdx = append ? Math.min(previousVisibleCount, visibleSlice.length) : 0;

    for (let idx = startIdx; idx < visibleSlice.length; idx++) {
      const song = visibleSlice[idx];
      const row = document.createElement('div');
      row.className = 'playlist-table-row';
      row.dataset.songId = song.id;
      row.dataset.trackIdx = idx;

      const isCurrent = currentSong && currentSong.id === song.id;
      if (isCurrent && isSearchContextActive) {
        row.classList.add('is-active');
      } else if (isCurrent) {
        row.classList.add('is-playing-elsewhere');
      }

      const thumbHtml = `<img class="row-thumb-img" draggable="false" alt="" width="40" height="40" />`;

      const indexHtml = formatListRowIndexHtml({
        isCurrent,
        isActiveSource: isSearchContextActive,
        displayNumber: idx + 1
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
        <div class="row-date">${escapeHtml(song.addedDate || "Reciente")}</div>
        <div class="row-duration-box">
          <span>${Number.isFinite(song.duration) && song.duration > 0 ? formatTime(song.duration) : '--:--'}</span>
          <button class="row-fav-btn ${song.isFavorite ? 'active' : ''}" title="${getFavoriteActionLabel(song.isFavorite)}">
            <i class="${song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
          </button>
        </div>
      `;

      updateQueuePositionIndicator(row, song);
      body.appendChild(row);
      const lazyThumb = row.querySelector('.row-thumb-img');
      if (lazyThumb) bindListSongCover(lazyThumb, song);
      updatePlaylistRowTitleMarquee(row, Boolean(isCurrent && !isPlaybackPaused()));
    }
  }

  // 2. PESTAÑA PLAYLISTS
  else if (state.searchTab === 'playlists') {
    const matches = state.playlists.filter(p =>
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-playlist"></i>
          <h3>No se encontraron listas de reproducción</h3>
          <p>No hay playlists que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'playlists-grid';

    const isOverlay = state.playlistsViewLayout === 'overlay';

    matches.forEach(pl => {
      const card = document.createElement('div');
      card.className = `playlist-grid-card ${isOverlay ? 'design-overlay' : 'design-standard'}`;
      card.dataset.id = pl.id;

      const playlistSongs = getPlaylistSongs(pl);
      const songsCount = playlistSongs.length;
      const isPinned = pl.isPinned !== false;
      const pinBadge = isPinned ? `<div class="card-pin-badge" title="Fijada en acceso directo"><i class="ph-fill ph-push-pin"></i></div>` : '';

      const isThisPlaylistPlaying = state.activeContextId === ('playlist_' + pl.id);
      if (isThisPlaylistPlaying) card.classList.add('is-playing-origin');

      if (isOverlay) {
        const coverHtml = pl.coverUrl
          ? `<img class="overlay-bg-img" alt="${escapeHtml(pl.title)}" />`
          : `<div class="overlay-bg-placeholder"><i class="ph ph-playlist"></i></div>`;

        card.innerHTML = `
          ${pinBadge}
          ${coverHtml}
          <button class="card-play-hover" title="Reproducir playlist"><i class="ph-fill ph-play"></i></button>
          <div class="overlay-content-box">
            <div class="playlist-card-title-row">
              <h4>${escapeHtml(pl.title)}</h4>
              ${pl.smartFilter ? '<i class="ph ph-lightning smart-playlist-badge" title="Playlist dinámica" aria-label="Playlist dinámica"></i>' : ''}
              <div class="playlist-hub-soundwave-wrap">
                ${isThisPlaylistPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
              </div>
            </div>
            <p>${escapeHtml(pl.description || (pl.smartFilter ? "Playlist dinámica" : "Lista de reproducción"))}</p>
            <span class="playlist-grid-count">${songsCount} canciones</span>
          </div>
        `;
      } else {
        const coverHtml = pl.coverUrl
          ? `<img alt="${escapeHtml(pl.title)}" />`
          : `<i class="ph ph-playlist cover-placeholder-icon"></i>`;

        card.innerHTML = `
          ${pinBadge}
          <div class="playlist-card-cover-wrap">
            ${coverHtml}
            <button class="card-play-hover" title="Reproducir playlist"><i class="ph-fill ph-play"></i></button>
          </div>
          <div class="playlist-card-title-row">
            <h4>${escapeHtml(pl.title)}</h4>
            ${pl.smartFilter ? '<i class="ph ph-lightning smart-playlist-badge" title="Playlist dinámica" aria-label="Playlist dinámica"></i>' : ''}
            <div class="playlist-hub-soundwave-wrap">
              ${isThisPlaylistPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
            </div>
          </div>
          <p>${escapeHtml(pl.description || (pl.smartFilter ? "Playlist dinámica" : "Lista de reproducción"))}</p>
          <span class="playlist-grid-count">${songsCount} canciones</span>
        `;
      }

      if (pl.coverUrl) {
        const plImg = card.querySelector('img');
        if (plImg) bindLazyCover(plImg, pl.coverUrl, pl.title);
      }

      card.querySelector('.card-play-hover').addEventListener('click', (e) => {
        e.stopPropagation();
        if (playlistSongs.length > 0) {
          const contextId = 'playlist_' + pl.id;
          if (state.activeContextId === contextId && state.currentTrackIndex !== -1) {
            togglePlay();
          } else {
            playFromContext(playlistSongs, 0, pl.title, true, contextId, true);
          }
        }
      });

      card.addEventListener('click', () => {
        navigateToView('playlist', { playlistId: pl.id });
      });

      grid.appendChild(card);
    });

    searchResultsContent.appendChild(grid);
  }

  // 3. PESTAÑA CARPETAS
  else if (state.searchTab === 'folders') {
    const matches = state.configuredFolders.filter(f =>
      (f.name && f.name.toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-folder"></i>
          <h3>No se encontraron carpetas</h3>
          <p>No hay carpetas vinculadas que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'folders-grid';

    matches.forEach(folder => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.dataset.id = folder.id;

      const isThisFolderPlaying = state.activeContextId === ('folder_' + folder.id);
      if (isThisFolderPlaying) card.classList.add('is-playing-origin');

      card.innerHTML = `
        <div class="folder-card-icon"><i class="ph-fill ph-folder"></i></div>
        <div class="folder-card-info">
          <div class="folder-card-title-row">
            <span class="folder-card-title">${escapeHtml(folder.name)}</span>
            <div class="folder-soundwave-wrap">
              ${isThisFolderPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
            </div>
          </div>
          <span class="folder-card-desc">${escapeHtml(folder.description || "Carpeta local de música")}</span>
          <span class="folder-card-count">${folder.count} canciones</span>
        </div>
      `;

      card.addEventListener('click', () => {
        navigateToView('folder-detail', { folderId: folder.id });
      });

      grid.appendChild(card);
    });

    searchResultsContent.appendChild(grid);
  }

  // Pestaña artistas
  else if (state.searchTab === 'artists') {
    const matches = getLibraryArtists().filter(artist =>
      artist.name.toLocaleLowerCase().includes(q)
    ).slice(0, SEARCH_PAGE_SIZE);
    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-user"></i>
          <h3>No se encontraron artistas</h3>
          <p>No hay artistas que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'albums-grid';
    matches.forEach(artist => grid.appendChild(createLibraryArtistCard(artist)));
    searchResultsContent.appendChild(grid);
    loadArtistPortraits(grid);
  }

  // Pestaña álbumes
  else if (state.searchTab === 'albums') {
    const matches = getLibraryAlbums().filter(album =>
      album.songs.length > albumsMinTrackCount &&
      (album.title.toLocaleLowerCase().includes(q) || album.artist.toLocaleLowerCase().includes(q))
    ).slice(0, SEARCH_PAGE_SIZE);
    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-disc"></i>
          <h3>No se encontraron álbumes</h3>
          <p>No hay álbumes que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'albums-grid';
    matches.forEach(album => grid.appendChild(createLibraryAlbumCard(album, true)));
    searchResultsContent.appendChild(grid);
    const currentSong = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
    syncLibraryAlbumIndicators(currentSong, !isPlaybackPaused());
  }

  // Pestaña cola de reproducción (PAGINADA Y CON DELEGACIÓN DE EVENTOS)
  else if (state.searchTab === 'queue') {
    if (!append) {
      uiVars.renderedSearchQueueList = state.activeQueue
        .map((s, idx) => ({ song: s, queueIndex: idx }))
        .filter(({ song }) =>
          (song.title && song.title.toLowerCase().includes(q)) ||
          (song.artist && song.artist.toLowerCase().includes(q)) ||
          (song.album && song.album.toLowerCase().includes(q))
        );
    }
    const matches = uiVars.renderedSearchQueueList;

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-queue"></i>
          <h3>Sin coincidencias en la cola</h3>
          <p>No se encontraron canciones en la cola activa que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    let body = searchResultsContent.querySelector('#search-queue-body');
    if (!append || !body) {
      const container = document.createElement('div');
      container.className = 'playlist-table-container';
      container.style.padding = '0';

      container.innerHTML = `
        <div class="playlist-table-header">
          <div class="col-index">#</div>
          <div class="col-title">Título</div>
          <div class="col-album">Álbum</div>
          <div class="col-date">Posición en cola</div>
          <div class="col-duration"><i class="ph ph-clock"></i></div>
        </div>
        <div class="playlist-table-body" id="search-queue-body"></div>
      `;

      body = container.querySelector('#search-queue-body');

      // Delegación en contenedor padre #search-queue-body
      body.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const row = target?.closest('.playlist-table-row');
        if (!row) return;
        const queueIndex = Number(row.dataset.trackIdx);
        const song = state.activeQueue[queueIndex];
        if (!song) return;

        if (target.closest('.row-fav-btn')) {
          e.stopPropagation();
          void toggleFavoriteForSelection(song, row);
          return;
        }
        loadSong(queueIndex, resolveManualAutoPlay(true));
      });

      searchResultsContent.appendChild(container);
    }

    const visibleSlice = matches.slice(0, uiVars.searchVisibleCount);
    const startIdx = append ? Math.min(previousVisibleCount, visibleSlice.length) : 0;

    for (let i = startIdx; i < visibleSlice.length; i++) {
      const { song, queueIndex } = visibleSlice[i];
      const row = document.createElement('div');
      row.className = 'playlist-table-row';
      row.dataset.songId = song.id;
      row.dataset.trackIdx = queueIndex;

      const isCurrent = state.currentTrackIndex === queueIndex;
      if (isCurrent) {
        row.classList.add('is-active');
      }

      const thumbHtml = `<img class="row-thumb-img" draggable="false" alt="" width="40" height="40" />`;

      const indexHtml = formatListRowIndexHtml({
        isCurrent,
        isActiveSource: true,
        displayNumber: queueIndex + 1
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
        <div class="row-date">${isCurrent ? 'Sonando ahora' : `#${queueIndex + 1}`}</div>
        <div class="row-duration-box">
          <span>${Number.isFinite(song.duration) && song.duration > 0 ? formatTime(song.duration) : '--:--'}</span>
          <button class="row-fav-btn ${song.isFavorite ? 'active' : ''}" title="${getFavoriteActionLabel(song.isFavorite)}">
            <i class="${song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart'}"></i>
          </button>
        </div>
      `;

      body.appendChild(row);
      const lazyThumb = row.querySelector('.row-thumb-img');
      if (lazyThumb) bindListSongCover(lazyThumb, song);
      updatePlaylistRowTitleMarquee(row, Boolean(isCurrent && !isPlaybackPaused()));
    }
  }
}
