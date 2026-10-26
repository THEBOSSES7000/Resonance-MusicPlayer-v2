// UI · Carátulas: carga perezosa y modos de portada en listas.

import { resolveCoverUrl } from '../scanner.js';
import { state } from '../state.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { renderSearchResultsContent } from './search.js';
import { getSoundWaveHTML } from './uiUtils.js';
import { isPlaybackPaused } from '../audioPlayer.js';
import { renderHistoryUI, renderQueue } from './queueHistory.js';

export const EMPTY_PIXEL_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Carga carátulas solo cuando entran al viewport; al salir se purga el bitmap decodificado con 1x1 GIF y se quita `src`. */
const lazyCoverObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const img = entry.target;
        if (entry.isIntersecting) {
          const src = img.dataset.coverSrc;
          if (src && img.getAttribute('src') !== src) img.src = src;
        } else if (img.hasAttribute('src')) {
          img.src = EMPTY_PIXEL_GIF;
          img.removeAttribute('src');
        }
      }
    }, { root: null, rootMargin: '180px 0px', threshold: 0.01 })
  : null;

export function clearContainerCovers(container) {
  if (!container) return;
  const images = container.querySelectorAll('img');
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (lazyCoverObserver) lazyCoverObserver.unobserve(img);
    if (img.hasAttribute('src')) {
      img.src = EMPTY_PIXEL_GIF;
      img.removeAttribute('src');
    }
    delete img.dataset.coverSrc;
  }
}

export function bindLazyCover(img, songOrSrc, altText = '') {
  if (!img) return;
  let src = null;
  if (typeof songOrSrc === 'string') {
    src = songOrSrc;
  } else if (songOrSrc) {
    src = resolveCoverUrl(songOrSrc);
    if (!altText) altText = songOrSrc.title || '';
  }
  if (!src) return;
  if (altText) img.alt = altText;
  img.loading = 'lazy';
  img.decoding = 'async';
  if (lazyCoverObserver) {
    // Evitar doble observación del mismo <img> al re-bind
    try { lazyCoverObserver.unobserve(img); } catch (_) {}
    img.dataset.coverSrc = src;
    img.removeAttribute('src');
    lazyCoverObserver.observe(img);
  } else {
    img.src = src;
  }
}

const LIST_COVER_MODES = ['individual', 'album', 'icon', 'none'];

/** Caché álbum → URL (o 'none') para reutilizar una sola carátula por álbum en listas */
const albumListCoverCache = new Map();

const MAX_ALBUM_LIST_COVER_CACHE = 400;

export function shouldShowListTrackNumbers() {
  // Excepción: álbum ordenado por N° de pista
  if (state.currentView === 'album-detail' && state.albumSortMode === 'track') return true;
  return localStorage.getItem('pn_show_list_track_numbers') !== 'false';
}

export function applyListTrackNumbersVisibility(enabled, { refresh = true } = {}) {
  localStorage.setItem('pn_show_list_track_numbers', String(Boolean(enabled)));
  document.documentElement.dataset.listTrackNumbers = String(Boolean(enabled));
  const input = document.getElementById('show-list-track-numbers');
  if (input) input.checked = Boolean(enabled);
  if (!refresh) return;
  try {
    if (['all-music', 'favorites', 'playlist', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
      void renderPlaylistDetailView();
    }
    if (state.currentView === 'search') renderSearchResultsContent();
  } catch (error) {
    console.warn('No se pudo refrescar listas tras cambiar números de pista:', error);
  }
}

export function formatListRowIndexHtml({ isCurrent, isActiveSource, displayNumber }) {
  if (isCurrent && isActiveSource) return getSoundWaveHTML(isPlaybackPaused());
  if (!shouldShowListTrackNumbers()) return '';
  return String(displayNumber);
}

export function getListCoverMode() {
  const mode = localStorage.getItem('pn_list_cover_mode') || 'individual';
  return LIST_COVER_MODES.includes(mode) ? mode : 'individual';
}

function albumCoverCacheKey(song) {
  const album = String(song?.album || '').trim().toLowerCase();
  const artist = String(song?.albumArtist || song?.artist || '').trim().toLowerCase();
  return album ? `${album}:::${artist}` : '';
}

function resolveAlbumListCoverUrl(song) {
  if (!song) return null;
  const key = albumCoverCacheKey(song);
  if (key && albumListCoverCache.has(key)) {
    const cached = albumListCoverCache.get(key);
    return cached === 'none' ? null : cached;
  }
  let found = resolveCoverUrl(song);
  if (!found && key) {
    const album = String(song.album || '').trim().toLowerCase();
    const artist = String(song.albumArtist || song.artist || '').trim().toLowerCase();
    for (const candidate of state.localMusicFiles) {
      if (String(candidate?.album || '').trim().toLowerCase() !== album) continue;
      if (artist) {
        const candArtist = String(candidate.albumArtist || candidate.artist || '').trim().toLowerCase();
        if (candArtist && candArtist !== artist) continue;
      }
      found = resolveCoverUrl(candidate);
      if (found) break;
    }
  }
  if (key) {
    if (albumListCoverCache.size >= MAX_ALBUM_LIST_COVER_CACHE) {
      const oldest = albumListCoverCache.keys().next().value;
      if (oldest !== undefined) albumListCoverCache.delete(oldest);
    }
    albumListCoverCache.set(key, found || 'none');
  }
  return found;
}

function resolveListCoverUrl(song) {
  const mode = getListCoverMode();
  if (mode === 'none' || mode === 'icon') return null;
  if (mode === 'album') return resolveAlbumListCoverUrl(song);
  return resolveCoverUrl(song);
}

/** Carátulas en listas (no player / inicio / hero de álbum). */
export function bindListSongCover(img, song, altText = '') {
  if (!img) return;
  const mode = getListCoverMode();
  const box = img.closest('.row-thumb-box, .queue-item-icon, .queue-thumb, .history-thumb, .search-suggestion-cover');
  if (mode === 'none') {
    try { lazyCoverObserver?.unobserve(img); } catch (_) {}
    img.removeAttribute('src');
    delete img.dataset.coverSrc;
    img.hidden = true;
    if (box) {
      box.classList.add('list-cover-hidden');
      box.setAttribute('hidden', '');
      box.style.display = 'none';
    }
    return;
  }
  if (box) {
    box.classList.remove('list-cover-hidden');
    box.removeAttribute('hidden');
    box.style.removeProperty('display');
  }
  if (mode === 'icon') {
    try { lazyCoverObserver?.unobserve(img); } catch (_) {}
    img.removeAttribute('src');
    delete img.dataset.coverSrc;
    img.hidden = true;
    // Sacar el <img> del flujo flex; si no, empuja el icono a la derecha
    img.style.display = 'none';
    img.style.position = 'absolute';
    img.style.width = '0';
    img.style.height = '0';
    if (box) {
      box.classList.add('list-cover-icon-only');
      let icon = box.querySelector('i.list-cover-fallback-icon');
      if (!icon) {
        icon = document.createElement('i');
        icon.className = 'ph ph-music-notes list-cover-fallback-icon';
        icon.setAttribute('aria-hidden', 'true');
        box.appendChild(icon);
      }
      icon.hidden = false;
      icon.style.display = 'flex';
    }
    return;
  }
  img.hidden = false;
  img.style.removeProperty('display');
  img.style.removeProperty('position');
  img.style.removeProperty('width');
  img.style.removeProperty('height');
  if (box) {
    box.classList.remove('list-cover-icon-only');
    box.querySelectorAll('i.list-cover-fallback-icon').forEach(el => el.remove());
  }
  const src = resolveListCoverUrl(song);
  if (!src) {
    try { lazyCoverObserver?.unobserve(img); } catch (_) {}
    img.removeAttribute('src');
    delete img.dataset.coverSrc;
    return;
  }
  bindLazyCover(img, src, altText || song?.title || '');
}

export function applyListCoverMode(mode, { refresh = true } = {}) {
  const selected = LIST_COVER_MODES.includes(mode) ? mode : 'individual';
  localStorage.setItem('pn_list_cover_mode', selected);
  document.documentElement.dataset.listCoverMode = selected;
  albumListCoverCache.clear();
  const select = document.getElementById('list-cover-mode');
  if (select && select.value !== selected) select.value = selected;
  if (!refresh) return;
  try {
    if (['all-music', 'favorites', 'playlist', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
      void renderPlaylistDetailView();
    }
    renderQueue();
    renderHistoryUI();
    if (state.currentView === 'search') renderSearchResultsContent();
  } catch (error) {
    console.warn('No se pudieron refrescar las listas tras cambiar el modo de carátula:', error);
  }
}
