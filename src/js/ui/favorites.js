// UI · Favoritos: claves, contadores, nombre visible e iconos.

import { readFavoriteAddedMap, writeFavoriteAddedMap } from './playlistData.js';
import { state } from '../state.js';
import { getSelectedSongs, getSongForSelectableElement, updateSelectionBar } from './selection.js';
import { showConfirmDialog } from './uiUtils.js';
import { favCountEl, favIcon, playerFavBtn, playerSourceLabel, playlistHeroTitle, queueHeaderTitle } from './dom.js';
import { updateNowPlayingFsHeader } from './nowPlayingFs.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { renderSearchResultsContent } from './search.js';

export function normalizeSongPath(song) {
  const path = song?.file?.path || song?.path || '';
  return String(path).replace(/\\/g, '/').toLowerCase();
}

export function songsMatch(first, second) {
  if (!first || !second) return false;
  const p1 = normalizeSongPath(first);
  const p2 = normalizeSongPath(second);
  if (p1 && p2 && p1 === p2) return true;
  if (first.id !== undefined && first.id !== null &&
      second.id !== undefined && second.id !== null &&
      String(first.id) === String(second.id)) return true;
  const t1 = (first.title || '').trim();
  const t2 = (second.title || '').trim();
  const a1 = (first.artist || '').trim();
  const a2 = (second.artist || '').trim();
  return Boolean(t1 && t2 && t1 === t2 && a1 === a2);
}

function persistFavoriteKeys() {
  updateFavoritesCount();
  void import('../scanner.js')
    .then(mod => mod.saveNativeLibraryCache?.())
    .catch(() => {});
}

function setSongFavorite(song, isFavorite) {
  if (!song) return;
  const favValue = Boolean(isFavorite);
  song.isFavorite = favValue;

  const key = favoriteStorageKey(song);
  let favoriteTs = Number(song.favoriteAddedAt) || 0;
  if (favValue) {
    const map = readFavoriteAddedMap();
    if (key) {
      if (!(Number(map[key]) > 0)) {
        map[key] = Date.now();
        writeFavoriteAddedMap(map);
      }
      favoriteTs = Number(map[key]) || Date.now();
    } else if (!(favoriteTs > 0)) {
      favoriteTs = Date.now();
    }
    song.favoriteAddedAt = favoriteTs;
  } else {
    if (key) {
      const map = readFavoriteAddedMap();
      if (map[key]) {
        delete map[key];
        writeFavoriteAddedMap(map);
      }
    }
    song.favoriteAddedAt = undefined;
    favoriteTs = 0;
  }

  const syncFavoriteMeta = (candidate) => {
    if (!candidate || !songsMatch(candidate, song)) return;
    candidate.isFavorite = favValue;
    if (favValue) candidate.favoriteAddedAt = favoriteTs;
    else delete candidate.favoriteAddedAt;
  };

  const pathKey = normalizeSongPath(song);
  if (pathKey && state.songsById?.get) {
    const lib = state.songsById.get(pathKey);
    if (lib) syncFavoriteMeta(lib);
  }
  if (song.id !== undefined && song.id !== null && state.songsById?.get) {
    const byId = state.songsById.get(String(song.id)) || state.songsById.get(song.id);
    if (byId) syncFavoriteMeta(byId);
  }

  for (let i = 0; i < state.localMusicFiles.length; i++) syncFavoriteMeta(state.localMusicFiles[i]);
  for (let i = 0; i < state.activeQueue.length; i++) syncFavoriteMeta(state.activeQueue[i]);
  for (let i = 0; i < state.playbackHistory.length; i++) syncFavoriteMeta(state.playbackHistory[i]);
  for (let i = 0; i < state.playlists.length; i++) {
    const plSongs = state.playlists[i]?.songs;
    if (!Array.isArray(plSongs)) continue;
    for (let j = 0; j < plSongs.length; j++) syncFavoriteMeta(plSongs[j]);
  }

  persistFavoriteKeys();
}

export async function toggleFavoriteForSelection(song, clickedElement = null) {
  const selectedSongs = clickedElement
    ? getSelectedSongs(clickedElement, song)
    : [...document.querySelectorAll('.song-card.is-multi-selected, .playlist-table-row.is-multi-selected')]
      .map(getSongForSelectableElement)
      .filter(Boolean);
  const sourceSongs = selectedSongs.length > 1 ? selectedSongs : [song];
  const songs = sourceSongs.filter((candidate, index) =>
    sourceSongs.findIndex(other => songsMatch(candidate, other)) === index
  );
  const allAreFavorites = songs.every(selectedSong => selectedSong.isFavorite);

  if (songs.length > 1) {
    if (allAreFavorites) {
      const proceed = await showConfirmDialog({
        title: '¿Quitar canciones de favoritos?',
        message: `Se quitarán ${songs.length} canciones de ${getFavoritesDisplayName()}. ¿Deseas continuar?`,
        confirmText: 'Quitar',
        cancelText: 'Cancelar'
      });
      if (!proceed) return;
    } else {
      const proceed = await showConfirmDialog({
        title: '¿Agregar a favoritos?',
        message: `Se agregarán ${songs.length} canciones a ${getFavoritesDisplayName()}. ¿Deseas continuar?`,
        confirmText: 'Agregar',
        cancelText: 'Cancelar'
      });
      if (!proceed) return;
    }
  }

  const nextValue = songs.length > 1 ? !allAreFavorites : !song.isFavorite;
  songs.forEach(selectedSong => setSongFavorite(selectedSong, nextValue));
  refreshSongCardFavoriteIndicators();
  updateFavoritesCount();
  updateFavIcon();
  updateSelectionBar();
}

export function toggleCurrentSongFavorite() {
  const song = state.currentTrackIndex === -1
    ? null
    : state.activeQueue[state.currentTrackIndex];
  if (!song) return;

  setSongFavorite(song, !song.isFavorite);
  refreshSongCardFavoriteIndicators();
  updateFavoritesCount();
  updateFavIcon();
}

function refreshSongCardFavoriteIndicators() {
  document.querySelectorAll('.song-card').forEach(card => {
    const song = getSongForSelectableElement(card);
    if (!song) return;
    const imageWrap = card.querySelector('.card-img-wrap');
    if (!imageWrap) return;
    imageWrap.classList.toggle('has-favorite', song.isFavorite);
    let badge = imageWrap.querySelector('.card-favorite-badge');
    if (song.isFavorite && !badge) {
      badge = document.createElement('span');
      badge.className = 'card-favorite-badge';
      badge.title = 'En favoritos';
      badge.setAttribute('aria-label', 'En favoritos');
      badge.innerHTML = '<i class="ph-fill ph-heart" aria-hidden="true"></i>';
      imageWrap.appendChild(badge);
    } else if (!song.isFavorite) {
      badge?.remove();
    }
  });

  // Filas de listas (álbum, playlist, música, etc.): actualizar corazón sin re-render completo
  document.querySelectorAll('.playlist-table-row, .song-row, .track-row').forEach(row => {
    const song = getSongForSelectableElement(row);
    if (!song) return;
    const btn = row.querySelector('.row-fav-btn');
    if (!btn) return;
    btn.classList.toggle('active', Boolean(song.isFavorite));
    btn.title = getFavoriteActionLabel(Boolean(song.isFavorite));
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = song.isFavorite ? 'ph-fill ph-heart' : 'ph ph-heart';
    }
  });
}

export function favoriteStorageKey(song) {
  if (!song) return '';
  const pathKey = normalizeSongPath(song);
  if (pathKey) return `path:${pathKey}`;
  const title = (song.title || '').trim();
  const artist = (song.artist || '').trim();
  return title || artist ? `${title}:::${artist}` : '';
}

function songMatchesFavoriteKey(song, key) {
  if (!song || !key) return false;
  if (key.startsWith('path:')) {
    const path = (song.file?.path || song.path || '').replace(/\\/g, '/').toLowerCase();
    return path && key === `path:${path}`;
  }
  return key === `${song.title || ''}:::${song.artist || ''}`;
}

export function updateFavoritesCount() {
  const count = state.localMusicFiles.filter(s => s.isFavorite).length;
  if (favCountEl) favCountEl.textContent = `${count} canciones`;

  const favSongs = state.localMusicFiles.filter(s => s.isFavorite);
  const favKeys = favSongs.map(favoriteStorageKey).filter(Boolean);
  try {
    localStorage.setItem('pn_favorites_keys', JSON.stringify(favKeys));
  } catch (error) {
    console.warn('No se pudieron guardar favoritos:', error);
  }

  // Mantener mapa de fechas alineado con favoritos actuales
  const map = readFavoriteAddedMap();
  const keep = new Set(favKeys);
  let mapChanged = false;
  Object.keys(map).forEach(key => {
    if (!keep.has(key)) {
      delete map[key];
      mapChanged = true;
    }
  });
  favSongs.forEach(song => {
    const key = favoriteStorageKey(song);
    if (!key) return;
    const ts = Number(song.favoriteAddedAt) || Number(map[key]) || 0;
    if (ts > 0) {
      if (Number(map[key]) !== ts) {
        map[key] = ts;
        mapChanged = true;
      }
      song.favoriteAddedAt = ts;
    } else if (!map[key]) {
      map[key] = Date.now();
      song.favoriteAddedAt = map[key];
      mapChanged = true;
    }
  });
  if (mapChanged) writeFavoriteAddedMap(map);
}

export function getFavoritesDisplayName() {
  return localStorage.getItem('pn_rename_favorites_label') === 'true'
    ? 'Favoritos'
    : 'Tus me gusta';
}

/** Icono + fondo SOLO del acceso directo y del hero de favoritos (no toca Música ni otras playlists). */
export function syncFavoritesCollectionVisual(useFavoritesName = localStorage.getItem('pn_use_favorites_name') === 'true') {
  const named = useFavoritesName === true || getFavoritesDisplayName() === 'Favoritos';
  const iconClass = named ? 'ph-fill ph-star fav-side-star' : 'ph-fill ph-heart';
  const goldBg = 'linear-gradient(145deg, #f6d56a 0%, #e8b923 42%, #c9920a 100%)';
  const isFavView = state.currentView === 'favorites';

  const paintFavBox = (box, forceIcon) => {
    if (!box) return;
    if (named) {
      box.classList.add('is-named-favorites');
      box.style.background = goldBg;
      box.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.12)';
      box.style.color = '#fff';
      box.style.filter = 'none';
    } else {
      box.classList.remove('is-named-favorites');
      box.style.removeProperty('background');
      box.style.removeProperty('box-shadow');
      box.style.removeProperty('color');
      box.style.removeProperty('filter');
    }
    if (forceIcon && !box.querySelector('img')) {
      let icon = box.querySelector('i');
      if (!icon) {
        icon = document.createElement('i');
        box.appendChild(icon);
      }
      icon.className = iconClass;
    }
  };

  // 1) Acceso directo lateral (siempre, solo favoritos)
  const shortcut = document.getElementById('btn-open-favorites');
  if (shortcut) {
    shortcut.classList.toggle('is-named-favorites', named);
    paintFavBox(shortcut.querySelector('.fav-icon-box'), true);
  }

  // 2) Hero del menú completo: SOLO en vista favoritos
  if (isFavView) {
    const heroIcons = document.querySelectorAll(
      '#playlist-view i.ph-heart, #playlist-view i.ph-star, #playlist-view i.fav-side-star, #playlist-view i.ph-fill.ph-heart, #playlist-view i.ph-fill.ph-star'
    );
    let painted = false;
    heroIcons.forEach(icon => {
      const box = icon.parentElement;
      if (!box || box.closest('.playlist-table-row, .row-fav-btn, .player-fav, .song-row, .track-row')) return;
      const rect = box.getBoundingClientRect?.();
      if (rect && rect.width >= 64 && rect.height >= 64) {
        paintFavBox(box, true);
        painted = true;
      }
    });
    if (!painted) {
      const fallback = document.getElementById('playlist-cover')
        || document.getElementById('playlist-hero-cover')
        || document.querySelector('#playlist-view .playlist-cover, #playlist-view .playlist-hero-cover');
      if (fallback && !fallback.querySelector('img')) {
        paintFavBox(fallback, true);
      }
    }
  } else {
    // Fuera de favoritos: quitar dorado residual en covers de Música / playlists
    document.querySelectorAll(
      '#playlist-view .playlist-cover, #playlist-view .playlist-hero-cover, #playlist-cover, #playlist-hero-cover, #music-view .playlist-cover, .library-hero-cover'
    ).forEach(box => {
      if (!box || box.closest('#btn-open-favorites')) return;
      if (box.style.background && String(box.style.background).includes('f6d56a')) {
        box.style.removeProperty('background');
        box.style.removeProperty('box-shadow');
        box.style.removeProperty('color');
        box.style.removeProperty('filter');
      }
      box.classList.remove('is-named-favorites');
    });
  }
}

export function getFavoriteActionLabel(isFavorite) {
  if (localStorage.getItem('pn_rename_favorites_label') === 'true') {
    return isFavorite ? 'Quitar de Favoritos' : 'Guardar en Favoritos';
  }
  return isFavorite ? 'Quitar de tus me gusta' : 'Guardar en tus me gusta';
}

export function getFavoriteActionLabelForSongs(songs) {
  if (songs.length <= 1) return getFavoriteActionLabel(Boolean(songs[0]?.isFavorite));
  const allAreFavorites = songs.every(song => song.isFavorite);
  return allAreFavorites
    ? `Quitar ${songs.length} de ${getFavoritesDisplayName()}`
    : `Agregar ${songs.length} a ${getFavoritesDisplayName()}`;
}

export function applyFavoritesDisplayName() {
  // Icono estrella + estilo dorado solo en el acceso directo lateral
  // El icono sigue al nombre ya resuelto (evita claves de storage distintas)
  const namedFavorites = getFavoritesDisplayName() === 'Favoritos';
  syncFavoritesCollectionVisual(namedFavorites);
  // Reaplicar tras navegación / re-render del hero
  [0, 50, 150, 400].forEach(ms => {
    setTimeout(() => {
      try { syncFavoritesCollectionVisual(getFavoritesDisplayName() === 'Favoritos'); } catch (_) {}
    }, ms);
  });
  if (!window.__favVisualObserverBound) {
    window.__favVisualObserverBound = true;
    const reapply = () => {
      try { syncFavoritesCollectionVisual(getFavoritesDisplayName() === 'Favoritos'); } catch (_) {}
    };
    document.getElementById('btn-open-favorites')?.addEventListener('click', () => {
      setTimeout(reapply, 0);
      setTimeout(reapply, 80);
      setTimeout(reapply, 250);
    });
    // Cuando el DOM del detalle de playlist cambia, re-sincronizar
    const playlistView = document.getElementById('playlist-view');
    if (playlistView && typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => {
        if (state.currentView === 'favorites') reapply();
      });
      mo.observe(playlistView, { childList: true, subtree: true });
    }
  }
  const displayName = getFavoritesDisplayName();
  const shortcutLabel = document.getElementById('favorites-shortcut-label');
  if (shortcutLabel) shortcutLabel.textContent = displayName;
  if (state.currentView === 'favorites') playlistHeroTitle.textContent = displayName;

  document.querySelectorAll('.row-fav-btn').forEach(button => {
    button.title = getFavoriteActionLabel(button.classList.contains('active'));
  });
  updateFavIcon();

  if (state.activeContextId === 'favorites') {
    state.activeQueueTitle = displayName;
    if (queueHeaderTitle) queueHeaderTitle.textContent = `Cola (${displayName})`;
    if (playerSourceLabel) {
      const sourceText = playerSourceLabel.querySelector('.player-source-text');
      if (sourceText) sourceText.textContent = displayName;
      playerSourceLabel.title = displayName;
      playerSourceLabel.setAttribute('aria-label', `Origen de reproducción: ${displayName}`);
    }
  }
}

export function updateFavIcon() {
  const song = state.currentTrackIndex === -1 ? null : state.activeQueue[state.currentTrackIndex];
  if (!song) {
    favIcon.className = "ph ph-heart";
    playerFavBtn.classList.remove('active');
    playerFavBtn.title = getFavoriteActionLabel(false);
  } else {
    favIcon.className = song.isFavorite ? "ph-fill ph-heart" : "ph ph-heart";
    playerFavBtn.classList.toggle('active', song.isFavorite);
    playerFavBtn.title = getFavoriteActionLabel(song.isFavorite);
  }
  updateFavoritesCount();

  const lyricsFavBtn = document.getElementById('lyrics-btn-fav');
  const lyricsFavIcon = document.getElementById('lyrics-fav-icon');
  if (lyricsFavBtn) {
    const isFav = !!(song && song.isFavorite);
    lyricsFavBtn.classList.toggle('active', isFav);
    lyricsFavBtn.classList.toggle('active-toggle', isFav);
    lyricsFavBtn.title = getFavoriteActionLabel(isFav);
    if (lyricsFavIcon) {
      lyricsFavIcon.className = isFav ? 'ph-fill ph-heart' : 'ph ph-heart';
    }
  }
  const coverFavBtn = document.getElementById('lyrics-focus-cover-fav');
  const coverFavIcon = document.getElementById('lyrics-focus-cover-fav-icon');
  if (coverFavBtn) {
    const isFav = !!(song && song.isFavorite);
    coverFavBtn.classList.toggle('active', isFav);
    coverFavBtn.classList.toggle('active-toggle', isFav);
    coverFavBtn.title = getFavoriteActionLabel(isFav);
    coverFavBtn.setAttribute('aria-pressed', String(isFav));
    if (coverFavIcon) {
      coverFavIcon.className = isFav ? 'ph-fill ph-heart' : 'ph ph-heart';
    }
  }
  updateNowPlayingFsHeader();

  if (
    state.currentView === 'favorites' ||
    state.currentView === 'all-music' ||
    state.currentView === 'folder-detail' ||
    state.currentView === 'playlist' ||
    state.currentView === 'artist' ||
    state.currentView === 'album-detail' ||
    state.currentView === 'queue-detail'
  ) {
    renderPlaylistDetailView();
  } else if (state.currentView === 'search') {
    renderSearchResultsContent();
  }
}
