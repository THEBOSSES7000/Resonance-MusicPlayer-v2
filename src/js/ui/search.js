// UI · Búsqueda: sugerencias, resultados y selector de pestañas.

import { searchResultsContent, searchSuggestions } from './dom.js';
import { bindLazyCover, clearContainerCovers } from './covers.js';
import { state } from '../state.js';
import { SEARCH_PAGE_SIZE, uiVars } from './sharedState.js';
import { navigateToView } from './navigation.js';
import { resolveCoverUrl } from '../scanner.js';
import { playSongReplacingCurrent } from './songCards.js';
import { getPlaylistSongs } from './playlistData.js';
import { renderSongSearchResults } from './search/songResults.js';
import { renderPlaylistSearchResults } from './search/playlistResults.js';
import { renderFolderSearchResults } from './search/folderResults.js';
import { createLibraryAlbumCard, createLibraryArtistCard, getLibraryAlbums, getLibraryArtists } from './libraryEntities.js';
import { loadArtistPortraits } from './artists.js';
import { albumsMinTrackCount } from './init.js';
import { syncLibraryAlbumIndicators } from './homeGrids.js';
import { isPlaybackPaused } from '../audioPlayer.js';
import { renderQueueSearchResults } from './search/queueResults.js';

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
    renderSongSearchResults(append, previousVisibleCount, q, displayQuery);
  }

  // 2. PESTAÑA PLAYLISTS
  else if (state.searchTab === 'playlists') {
    renderPlaylistSearchResults(q, displayQuery);
  }

  // 3. PESTAÑA CARPETAS
  else if (state.searchTab === 'folders') {
    renderFolderSearchResults(q, displayQuery);
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
    renderQueueSearchResults(append, previousVisibleCount, q, displayQuery);
  }
}
