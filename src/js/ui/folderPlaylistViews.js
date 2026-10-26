// UI · Vistas de carpetas y de playlists.

import { foldersGrid, playlistsGrid } from './dom.js';
import { loadFolderSortMode, loadPlaylistsViewSortMode } from './sorting.js';
import { bindLazyCover, clearContainerCovers } from './covers.js';
import { state } from '../state.js';
import { escapeHtml, getSoundWaveHTML, showConfirmDialog } from './uiUtils.js';
import { isPlaybackPaused, togglePlay } from '../audioPlayer.js';
import { navigateToView } from './navigation.js';
import { getPlaylistSongs } from './playlistData.js';
import { playFromContext } from './playback.js';

/* RENDERIZADO DEL GRID DE CARPETAS */
export function renderFoldersUI() {
  if (!foldersGrid) return;
  loadFolderSortMode();
  clearContainerCovers(foldersGrid);
  foldersGrid.innerHTML = '';

  if (!state.configuredFolders || state.configuredFolders.length === 0) {
    foldersGrid.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <i class="ph ph-folder-open"></i>
        <h3>No hay carpetas vinculadas</h3>
        <p>Ve a Configuración o escanea una carpeta para indexar tus canciones.</p>
      </div>
    `;
    return;
  }

  let foldersList = [...state.configuredFolders];

  if (state.folderSortMode === 'name') {
    foldersList.sort((a, b) => a.name.localeCompare(b.name));
  } else if (state.folderSortMode === 'count') {
    foldersList.sort((a, b) => (b.count || 0) - (a.count || 0));
  } else if (state.folderSortMode === 'date') {
    foldersList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (state.folderSortMode === 'recent') {
    foldersList.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }

  foldersList.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.id = folder.id;

    const isThisFolderPlaying = state.activeContextId === ('folder_' + folder.id);
    if (isThisFolderPlaying) {
      card.classList.add('is-playing-origin');
    }

    card.innerHTML = `
      <div class="folder-card-icon">
        <i class="ph-fill ph-folder"></i>
      </div>
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

    foldersGrid.appendChild(card);
  });
}

/* RENDERIZADO DEL HUB DE PLAYLISTS */
export function renderPlaylistsHubUI() {
  loadPlaylistsViewSortMode();
  if (!playlistsGrid) return;
  clearContainerCovers(playlistsGrid);
  playlistsGrid.innerHTML = '';

  if (!state.playlists || state.playlists.length === 0) {
    playlistsGrid.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <i class="ph ph-playlist"></i>
        <h3>No tienes listas de reproducción creadas</h3>
        <p>Haz clic en "Crear playlist" para organizar tus temas favoritos.</p>
        <button class="btn-primary" onclick="document.getElementById('btn-add-playlist').click()">
          <i class="ph ph-plus"></i> Crear mi primera playlist
        </button>
      </div>
    `;
    return;
  }

  let list = [...state.playlists];
  if (state.playlistsViewSortMode === 'name') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (state.playlistsViewSortMode === 'count') {
    list.sort((a, b) => getPlaylistSongs(b).length - getPlaylistSongs(a).length);
  } else if (state.playlistsViewSortMode === 'date') {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (state.playlistsViewSortMode === 'pinned') {
    list.sort((a, b) => (b.isPinned === false ? 0 : 1) - (a.isPinned === false ? 0 : 1));
  }

  const isOverlay = state.playlistsViewLayout === 'overlay';

  list.forEach(pl => {
    const card = document.createElement('div');
    card.className = `playlist-grid-card ${isOverlay ? 'design-overlay' : 'design-standard'}`;
    card.dataset.id = pl.id;

    const songsCount = getPlaylistSongs(pl).length;
    const isPinned = pl.isPinned !== false;
    const pinBadge = isPinned ? `<div class="card-pin-badge" title="Fijada en acceso directo"><i class="ph-fill ph-push-pin"></i></div>` : '';

    const isThisPlaylistPlaying = state.activeContextId === ('playlist_' + pl.id);
    if (isThisPlaylistPlaying) {
      card.classList.add('is-playing-origin');
    }

    if (isOverlay) {
      const coverHtml = pl.coverUrl
        ? `<img class="overlay-bg-img" alt="${escapeHtml(pl.title)}" />`
        : `<div class="overlay-bg-placeholder"><i class="ph ph-playlist"></i></div>`;

      card.innerHTML = `
        ${pinBadge}
        ${coverHtml}
        <button class="card-play-hover" title="Reproducir playlist">
          <i class="ph-fill ph-play"></i>
        </button>
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
          <button class="card-play-hover" title="Reproducir playlist">
            <i class="ph-fill ph-play"></i>
          </button>
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

    const playBtn = card.querySelector('.card-play-hover');
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const playlistSongs = getPlaylistSongs(pl);
      if (playlistSongs.length > 0) {
        const contextId = 'playlist_' + pl.id;
        if (state.activeContextId === contextId && state.currentTrackIndex !== -1) {
          togglePlay();
        } else {
          playFromContext(playlistSongs, 0, pl.title, true, contextId, true);
        }
      } else {
        showConfirmDialog({
          title: "Playlist vacía",
          message: "Esta playlist no contiene canciones aún.",
          confirmText: "Aceptar",
          showCancel: false
        });
      }
    });

    card.addEventListener('click', () => {
      navigateToView('playlist', { playlistId: pl.id });
    });

    playlistsGrid.appendChild(card);
    });
}
