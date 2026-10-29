// UI · Búsqueda principal, píldoras de búsqueda y área de contenido.

import { allAlbumsGrid, mainContent, searchInput, searchSuggestions } from '../dom.js';
import { hideSearchSuggestions, openSearchResults, renderSearchResultsContent, renderSearchSuggestions } from '../search.js';
import { state } from '../../state.js';
import { SEARCH_PAGE_SIZE, uiVars } from '../sharedState.js';
import { renderAllAlbumsUI } from '../homeGrids.js';
import { renderPlaylistDetailView } from '../playlistDetail.js';

let searchInputDebounceTimer = null;

/** Búsqueda principal, píldoras de búsqueda y área de contenido. */
export function bindSearchAndContent() {

  if (searchInput) {
    // Evitar el desplegable nativo "Información guardada" de WebView2/Chromium
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('autocorrect', 'off');
    searchInput.setAttribute('autocapitalize', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    searchInput.setAttribute('data-1p-ignore', 'true');
    searchInput.setAttribute('data-lpignore', 'true');
    searchInput.setAttribute('data-form-type', 'other');
    // Nombre único para que el navegador no reutilice historial de otros campos
    if (!searchInput.name || searchInput.name === 'q' || searchInput.name === 'search') {
      searchInput.name = 'resonance-song-search';
    }
    searchInput.addEventListener('focus', () => {
      // Reforzar en cada foco (WebView2 a veces ignora el atributo estático)
      searchInput.setAttribute('autocomplete', 'off');
      if (!searchInput.value.trim()) hideSearchSuggestions();
    });
    searchInput.addEventListener('input', () => {
      const rawValue = searchInput.value;
      state.searchQuery = rawValue.trim();
      if (searchInputDebounceTimer !== null) {
        window.clearTimeout(searchInputDebounceTimer);
      }
      searchInputDebounceTimer = window.setTimeout(() => {
        searchInputDebounceTimer = null;
        if (state.currentView === 'search') {
          hideSearchSuggestions();
          uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
          renderSearchResultsContent();
        } else {
          renderSearchSuggestions(rawValue);
        }
      }, 180);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (searchInputDebounceTimer !== null) {
          window.clearTimeout(searchInputDebounceTimer);
          searchInputDebounceTimer = null;
        }
        const q = searchInput.value.trim();
        if (!q) return;
        openSearchResults(q);
      }
    });

    searchInput.addEventListener('blur', event => {
      if (searchSuggestions?.contains(event.relatedTarget)) return;
      window.setTimeout(() => {
        if (!searchSuggestions?.contains(document.activeElement)) hideSearchSuggestions();
      }, 120);
    });
  }

  // Píldoras de búsqueda (Canciones, Playlists, Carpetas, Cola de reproducción)
  document.querySelectorAll('.search-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.search-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.searchTab = pill.dataset.tab;
      uiVars.searchVisibleCount = SEARCH_PAGE_SIZE;
      renderSearchResultsContent();
    });
  });

  // Renderiza el siguiente bloque de filas, búsqueda o álbumes solo al acercarse al final.
  if (mainContent) {
    let virtualScrollRaf = 0;
    mainContent.addEventListener('scroll', () => {
      // Ventana virtual: actualizar filas visibles aunque no estemos al final
      if (
        uiVars.trackListVirtual &&
        !uiVars.isLoadingMoreTrackRows &&
        ['all-music', 'playlist', 'favorites', 'folder-detail', 'album-detail', 'artist'].includes(state.currentView)
      ) {
        if (virtualScrollRaf) cancelAnimationFrame(virtualScrollRaf);
        virtualScrollRaf = requestAnimationFrame(() => {
          virtualScrollRaf = 0;
          if (uiVars.isLoadingMoreTrackRows) return;
          const prev = state.currentView === 'all-music' ? state.musicVisibleCount : uiVars.detailVisibleCount;
          uiVars.isLoadingMoreTrackRows = true;
          void renderPlaylistDetailView({ append: false, previousVisibleCount: prev })
            .catch(() => {})
            .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
        });
      }

      const scrollPos = mainContent.scrollTop + mainContent.clientHeight;
      const scrollMax = mainContent.scrollHeight;
      if (scrollMax - scrollPos >= 280 || uiVars.isLoadingMoreTrackRows) return;

      if (state.currentView === 'search' && (state.searchTab === 'songs' || state.searchTab === 'queue')) {
        const listLength = state.searchTab === 'songs'
          ? uiVars.renderedSearchSongsList.length
          : uiVars.renderedSearchQueueList.length;
        if (uiVars.searchVisibleCount >= listLength) return;
        const previousVisibleCount = uiVars.searchVisibleCount;
        uiVars.searchVisibleCount += SEARCH_PAGE_SIZE;
        uiVars.isLoadingMoreTrackRows = true;
        try {
          renderSearchResultsContent({ append: true, previousVisibleCount });
        } finally {
          uiVars.isLoadingMoreTrackRows = false;
        }
        return;
      }

      if (state.currentView === 'albums') {
        const renderedCount = allAlbumsGrid?.querySelectorAll('.library-album-card').length || 0;
        if (renderedCount < uiVars.albumGridVisibleCount) return;
        const previousVisibleCount = uiVars.albumGridVisibleCount;
        uiVars.albumGridVisibleCount += 50;
        uiVars.isLoadingMoreTrackRows = true;
        try {
          renderAllAlbumsUI({ append: true, previousVisibleCount });
        } finally {
          uiVars.isLoadingMoreTrackRows = false;
        }
        return;
      }

      if (!['all-music', 'playlist', 'favorites', 'folder-detail', 'album-detail', 'artist'].includes(state.currentView)) {
        return;
      }
      const previousVisibleCount = state.currentView === 'all-music'
        ? state.musicVisibleCount
        : uiVars.detailVisibleCount;
      const totalInList = Array.isArray(uiVars.renderedTrackList) ? uiVars.renderedTrackList.length : 0;

      // Lista virtualizada: al scrollear, re-pintar la ventana visible (sin acumular DOM)
      if (uiVars.trackListVirtual && totalInList > 0) {
        if (!uiVars.isLoadingMoreTrackRows) {
          uiVars.isLoadingMoreTrackRows = true;
          void renderPlaylistDetailView({ append: false, previousVisibleCount })
            .catch(error => console.error('No se pudo actualizar la ventana de la lista:', error))
            .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
        }
      }

      // Ampliar el rango "descubierto" al acercarse al final (sigue haciendo falta para listas enormes)
      if (totalInList > 0 && previousVisibleCount >= totalInList) return;
      if (scrollMax - scrollPos >= 280) return;
      if (state.currentView === 'all-music') state.musicVisibleCount += 50;
      else uiVars.detailVisibleCount += 50;
      uiVars.isLoadingMoreTrackRows = true;
      void renderPlaylistDetailView({ append: true, previousVisibleCount })
        .catch(error => console.error('No se pudieron cargar más canciones de la lista:', error))
        .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
    }, { passive: true });
  }
}
