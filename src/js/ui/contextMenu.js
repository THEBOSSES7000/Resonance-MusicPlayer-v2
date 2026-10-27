// UI · Menú contextual personalizado: decide qué menú mostrar según el elemento clicado y lo dibuja.

import { state } from '../state.js';
import { addSongContextActions } from './contextMenu/songActions.js';
import { albumContextId, artistContextId, matchingAlbumSongs, matchingArtistSongs } from './libraryEntities.js';
import { getArtistAlbumContextItems, getCollectionExportContextItem, getCollectionForOptions, getCollectionOptionContextItems, getCollectionQueueContextItems } from './collections.js';
import { buildSearchSuggestionContextItems } from './contextMenu/searchSuggestionMenu.js';
import { buildQuickAccessContextItems } from './contextMenu/quickAccessMenu.js';
import { buildFolderCardContextItems } from './contextMenu/folderCardMenu.js';
import { buildPlaylistCardContextItems } from './contextMenu/playlistCardMenu.js';
import { getFavoritesDisplayName } from './favorites.js';
import { btnOpenFavorites, btnPlayAllFavorites, customContextMenu } from './dom.js';
import { buildPlayerLeftContextItems } from './contextMenu/playerLeftMenu.js';
import { buildQueueItemContextItems } from './contextMenu/queueItemMenu.js';
import { buildSongContextItems } from './contextMenu/songMenu.js';
import { navigateToView } from './navigation.js';

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
    items = buildSearchSuggestionContextItems(target, items, searchSuggestion);
  }
  else if (quickAccessItem) {
    items = buildQuickAccessContextItems(target, items, quickAccessItem);
  }
  else if (folderCard) {
    items = buildFolderCardContextItems(target, items, folderCard);
  }
  else if (playlistCardLeft || playlistHubCard) {
    items = buildPlaylistCardContextItems(target, items, playlistHubCard, playlistCardLeft);
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
    items = buildPlayerLeftContextItems(target, items);
  }
  else if (target.closest('.queue-item')) {
    items = buildQueueItemContextItems(target, items);
  }
  else if (target.closest('.song-card') || target.closest('.playlist-table-row')) {
    items = buildSongContextItems(target, items);
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
