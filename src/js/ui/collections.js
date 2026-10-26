// UI · Colecciones: opciones, exportación M3U8, acceso rápido y barra lateral de playlists.

import { persistPlaylists, state } from '../state.js';
import { matchesListSearch, matchesTrackFilter } from './trackFilters.js';
import { getPlaylistSongs, getSmartPlaylistSongs } from './playlistData.js';
import { uiVars } from './sharedState.js';
import { getFavoritesDisplayName } from './favorites.js';
import { albumContextId, artistContextId, artistsFromCredit, matchingAlbumSongs, matchingArtistSongs } from './libraryEntities.js';
import { addSongsToQueue, renderQueue } from './queueHistory.js';
import { isPlaybackPaused, setShuffleEnabled, shuffleArray } from '../audioPlayer.js';
import { playFromContext } from './playback.js';
import { openPlaylistPicker } from './playlistPicker.js';
import { navigateToView } from './navigation.js';
import { openMissingSongsResolver } from './m3uImport.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { escapeHtml, getSoundWaveHTML, showConfirmDialog } from './uiUtils.js';
import { bindLazyCover, clearContainerCovers } from './covers.js';
import { playlistsContainer } from './dom.js';
import { sidebarPlaylistDragReorderEnabled } from './init.js';
import { pnStartPointerDrag } from './dragReorder.js';

export function getCollectionForOptions() {
  if (state.currentView === 'queue-detail') {
    return {
      title: state.activeQueueTitle ? `Cola (${state.activeQueueTitle})` : 'Cola de reproducción',
      songs: (state.activeQueue || []).filter(song => matchesListSearch(song)),
      contextId: 'queue_detail'
    };
  }
  if (state.currentView === 'playlist') {
    const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);
    if (!playlist) return null;
    const songs = playlist.smartFilter ? getSmartPlaylistSongs(playlist) : [...(playlist.songs || [])];
    return {
      title: playlist.title,
      songs: songs.filter(song => matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)),
      contextId: `playlist_${playlist.id}`
    };
  }
  if (state.currentView === 'folder-detail') {
    const folder = state.configuredFolders.find(item => item.id === state.currentFolderId);
    return folder
      ? {
        title: folder.name,
        songs: state.localMusicFiles.filter(song =>
          song.folderName === folder.name && matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)
        ),
        contextId: `folder_${folder.id}`
      }
      : null;
  }
  if (state.currentView === 'favorites') {
    return {
      title: getFavoritesDisplayName(),
      songs: state.localMusicFiles.filter(song =>
        song.isFavorite && matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)
      ),
      contextId: 'favorites'
    };
  }
  if (state.currentView === 'artist') {
    return {
      title: state.artistName,
      songs: matchingArtistSongs(state.artistName).filter(song =>
        matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)
      ),
      contextId: artistContextId(state.artistName)
    };
  }
  if (state.currentView === 'album-detail') {
    return {
      title: `${state.albumTitle} — ${state.albumArtistName}`,
      songs: matchingAlbumSongs(state.albumArtistName, state.albumTitle).filter(song =>
        matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)
      ),
      contextId: albumContextId(state.albumArtistName, state.albumTitle)
    };
  }
  if (state.currentView === 'all-music') {
    return {
      title: 'Música',
      songs: state.localMusicFiles.filter(song => matchesTrackFilter(song, uiVars.activeTrackFilter) && matchesListSearch(song)),
      contextId: 'all_music'
    };
  }
  return null;
}

export function getCollectionQueueContextItems(collection) {
  const isEmpty = collection.songs.length === 0;
  return [
    {
      label: 'Reproducir todo a continuación',
      icon: 'ph ph-skip-forward',
      disabled: isEmpty,
      action: () => addSongsToQueue(collection.songs, true, collection.title, collection.contextId)
    },
    {
      label: 'Agregar todo a la cola',
      icon: 'ph ph-queue',
      disabled: isEmpty,
      action: () => addSongsToQueue(collection.songs, false, collection.title, collection.contextId)
    }
  ];
}

export function playCollectionShuffled(collection) {
  setShuffleEnabled(true);
  playFromContext(shuffleArray(collection.songs), 0, collection.title, true, collection.contextId, true);
}

export function getArtistAlbumContextItems(collection, type, includeOpen = false) {
  const isArtist = type === 'artist';
  const isEmpty = collection.songs.length === 0;
  const items = [
    {
      label: isArtist ? 'Reproducir canciones' : 'Reproducir álbum',
      icon: 'ph ph-play',
      disabled: isEmpty,
      action: () => playFromContext(
        collection.songs,
        0,
        collection.title,
        true,
        collection.contextId,
        true
      )
    },
    {
      label: 'Reproducir a continuación',
      icon: 'ph ph-skip-forward',
      disabled: isEmpty,
      action: () => addSongsToQueue(collection.songs, true, collection.title, collection.contextId)
    },
    {
      label: isArtist ? 'Agregar a la cola' : 'Agregar álbum a la cola',
      icon: 'ph ph-queue',
      disabled: isEmpty,
      action: () => addSongsToQueue(collection.songs, false, collection.title, collection.contextId)
    },
    {
      label: 'Reproducir aleatoriamente',
      icon: 'ph ph-shuffle',
      disabled: isEmpty,
      action: () => playCollectionShuffled(collection)
    },
    {
      label: isArtist ? 'Agregar canciones a playlist' : 'Agregar álbum a playlist',
      icon: 'ph ph-playlist',
      disabled: isEmpty,
      action: () => openPlaylistPicker(collection.songs)
    }
  ];
  if (!isArtist) {
    items.push({
      label: 'Ir al artista',
      icon: 'ph ph-user',
      action: () => navigateToView('artist', {
        artistName: artistsFromCredit(collection.artist || state.albumArtistName)[0] ||
          collection.artist ||
          state.albumArtistName
      })
    });
  }
  if (includeOpen) {
    items.push({
      label: isArtist ? 'Ver perfil del artista' : 'Abrir álbum',
      icon: isArtist ? 'ph ph-user' : 'ph ph-disc',
      action: () => isArtist
        ? navigateToView('artist', { artistName: collection.artist })
        : navigateToView('album-detail', {
          artistName: collection.artist,
          albumTitle: collection.album
        })
    });
  }
  return items;
}

export function getCollectionOptionContextItems() {
  const collection = getCollectionForOptions();
  if (!collection) return [];
  const isEmpty = collection.songs.length === 0;
  const items = [
    ...getCollectionQueueContextItems(collection),
    { type: 'separator' },
    ...(state.currentView === 'playlist' ? [] : [getCollectionExportContextItem(collection)]),
    {
      label: 'Reproducir aleatoriamente',
      icon: 'ph ph-shuffle',
      disabled: isEmpty,
      action: () => playCollectionShuffled(collection)
    },
  ];
  if (state.currentView === 'playlist' &&
      !state.playlists.find(item => item.id === state.currentPlaylistId)?.smartFilter) {
    items.splice(2, 0, {
      label: 'Buscar canciones no ubicadas',
      icon: 'ph ph-magnifying-glass',
      disabled: isEmpty,
      action: () => {
        const playlist = state.playlists.find(item => item.id === state.currentPlaylistId);
        if (!playlist) return;
        openMissingSongsResolver(playlist.songs || [], songs => {
          playlist.songs = songs;
          persistPlaylists();
          void renderPlaylistDetailView();
          renderPlaylistsUI();
        });
      }
    });
  }
  return items;
}

export function getCollectionExportContextItem(collection) {
  return {
    label: 'Exportar lista (.m3u8)',
    icon: 'ph ph-export',
    disabled: collection.songs.length === 0,
    action: () => exportCollectionM3U8(collection)
  };
}

export async function exportCollectionM3U8(collection, filenameOverride = null, showError = true) {
  try {
    const lines = ['#EXTM3U'];
    collection.songs.forEach(song => {
      const fileLocation = song.file?.path || song.file?.webkitRelativePath || song.file?.name;
      if (!fileLocation) return;
      const duration = Number.isFinite(song.duration) && song.duration > 0
        ? Math.round(song.duration)
        : -1;
      const trackName = [song.artist, song.title].filter(Boolean).join(' - ').replace(/[\r\n]/g, ' ');
      lines.push(`#EXTINF:${duration},${trackName}`, fileLocation.replace(/[\r\n]/g, ''));
    });

    if (lines.length === 1) {
      throw new Error('No hay rutas de archivo disponibles para exportar esta lista.');
    }

    const safeName = (filenameOverride || collection.title).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'playlist';
    const fileName = `${safeName}.m3u8`;
    const contents = `\uFEFF${lines.join('\r\n')}\r\n`;
    const invoke = window.__TAURI__?.core?.invoke;

    if (invoke) {
      return await invoke('save_m3u8_file', { fileName, contents });
    }

    if (typeof window.showSaveFilePicker !== 'function') {
      throw new Error('Este entorno no ofrece un diálogo para elegir dónde guardar archivos.');
    }
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [{
        description: 'Playlist M3U8',
        accept: { 'audio/x-mpegurl': ['.m3u8'] }
      }]
    });
    const writable = await fileHandle.createWritable();
    await writable.write(new TextEncoder().encode(contents));
    await writable.close();
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    console.error('No se pudo exportar la lista:', error);
    if (showError) {
      await showConfirmDialog({
        title: 'No se pudo exportar',
        message: error instanceof Error ? error.message : 'Ocurrió un error al crear el archivo de playlist.',
        confirmText: 'Entendido',
        showCancel: false
      });
    }
    return null;
  }
}

export function openPlaylistExportPicker() {
  if (!state.playlists.length) {
    void showConfirmDialog({
      title: 'No hay playlists',
      message: 'Crea una playlist antes de exportar.',
      confirmText: 'Aceptar',
      showCancel: false
    });
    return;
  }

  const modal = document.getElementById('playlist-export-modal');
  const options = document.getElementById('playlist-export-options');
  const selectAllButton = document.getElementById('playlist-export-select-all');
  const exportButton = document.getElementById('playlist-export-confirm');
  const cancelButton = document.getElementById('playlist-export-cancel');
  const closeButton = document.getElementById('playlist-export-close');
  if (!modal || !options || !selectAllButton || !exportButton || !cancelButton || !closeButton) return;

  clearContainerCovers(options);
  options.replaceChildren();
  state.playlists.forEach(playlist => {
    const label = document.createElement('label');
    label.className = 'multi-playlist-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(playlist.id);
    const thumbnail = document.createElement('span');
    thumbnail.className = 'playlist-picker-thumb';
    if (playlist.coverUrl) {
      const image = document.createElement('img');
      bindLazyCover(image, playlist.coverUrl, '');
      thumbnail.appendChild(image);
    } else {
      const icon = document.createElement('i');
      icon.className = 'ph ph-playlist';
      thumbnail.appendChild(icon);
    }
    const name = document.createElement('span');
    name.className = 'playlist-picker-name';
    name.textContent = playlist.title;
    label.append(checkbox, thumbnail, name);
    options.appendChild(label);
  });

  const selectedCheckboxes = () => [...options.querySelectorAll('input[type="checkbox"]')];
  const updateSelectionControls = () => {
    const checkboxes = selectedCheckboxes();
    const allSelected = checkboxes.length > 0 && checkboxes.every(checkbox => checkbox.checked);
    selectAllButton.textContent = allSelected ? 'Deseleccionar todas' : 'Seleccionar todas';
    exportButton.disabled = !checkboxes.some(checkbox => checkbox.checked);
  };
  const close = () => {
    modal.classList.remove('open');
    clearContainerCovers(options);
    options.replaceChildren();
    selectAllButton.removeEventListener('click', toggleAll);
    exportButton.removeEventListener('click', exportSelected);
    cancelButton.removeEventListener('click', close);
    closeButton.removeEventListener('click', close);
    options.removeEventListener('change', updateSelectionControls);
    modal.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeyDown);
  };
  const toggleAll = () => {
    const checkboxes = selectedCheckboxes();
    const shouldSelectAll = checkboxes.some(checkbox => !checkbox.checked);
    checkboxes.forEach(checkbox => { checkbox.checked = shouldSelectAll; });
    updateSelectionControls();
  };
  const exportSelected = async () => {
    const selectedIds = new Set(
      selectedCheckboxes().filter(checkbox => checkbox.checked).map(checkbox => checkbox.value)
    );
    const selectedPlaylists = state.playlists.filter(playlist => selectedIds.has(String(playlist.id)));
    if (!selectedPlaylists.length) return;
    close();

    const titleCounts = new Map();
    let exportedCount = 0;
    let failedCount = 0;
    let cancelled = false;
    for (const playlist of selectedPlaylists) {
      const baseTitle = playlist.title || 'playlist';
      const occurrence = (titleCounts.get(baseTitle) || 0) + 1;
      titleCounts.set(baseTitle, occurrence);
      const filename = occurrence > 1 ? `${baseTitle} (${occurrence})` : baseTitle;
      const result = await exportCollectionM3U8({
        title: baseTitle,
        songs: playlist.smartFilter ? getSmartPlaylistSongs(playlist) : (playlist.songs || [])
      }, filename, false);
      if (result === true) {
        exportedCount += 1;
      } else if (result === false) {
        cancelled = true;
        break;
      } else {
        failedCount += 1;
      }
    }
    if ((cancelled || failedCount > 0) && (exportedCount > 0 || failedCount > 0)) {
      void showConfirmDialog({
        title: cancelled ? 'Exportación cancelada' : 'Exportación incompleta',
        message: `Se exportaron ${exportedCount} playlists${failedCount ? ` y ${failedCount} no se pudieron exportar` : ''}${cancelled ? '. Se canceló el guardado de las siguientes playlists' : ''}.`,
        confirmText: 'Entendido',
        showCancel: false
      });
    }
  };
  const onBackdropClick = event => { if (event.target === modal) event.stopPropagation(); };
  const onKeyDown = event => {
    if (event.key === 'Escape') close();
  };

  selectAllButton.addEventListener('click', toggleAll);
  exportButton.addEventListener('click', exportSelected);
  cancelButton.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  options.addEventListener('change', updateSelectionControls);
  modal.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown);
  updateSelectionControls();
  modal.classList.add('open');
}

export function appendCollectionToQueue(collection) {
  if (state.activeQueue.length === 0 || state.currentTrackIndex === -1) {
    playFromContext(collection.songs, 0, collection.title, true, collection.contextId, true);
    return;
  }
  const tracks = collection.songs.map(song => {
      const entry = Object.create(song);
      entry.isEnqueuedNext = false;
      return entry;
    });
  state.activeQueue.push(...tracks);
  renderQueue();
}

/* RENDERIZADO DE LAS PLAYLISTS EN LA BARRA LATERAL (ACCESO DIRECTO) */
function quickSongReference(song) {
  return {
    path: song.file?.path || '',
    relativePath: song.file?.webkitRelativePath || '',
    fileName: song.file?.name || '',
    title: song.title || '',
    artist: song.artist || ''
  };
}

export function sameQuickSongReference(reference, song) {
  const songReference = quickSongReference(song);
  if (reference.path && songReference.path) {
    return reference.path.replace(/\\/g, '/').toLocaleLowerCase() ===
      songReference.path.replace(/\\/g, '/').toLocaleLowerCase();
  }
  if (reference.relativePath && songReference.relativePath) {
    return reference.relativePath.replace(/\\/g, '/').toLocaleLowerCase() ===
      songReference.relativePath.replace(/\\/g, '/').toLocaleLowerCase();
  }
  return reference.fileName === songReference.fileName &&
    reference.title === songReference.title &&
    reference.artist === songReference.artist;
}

function renderQuickAccessEntries() {
  const entries = Array.isArray(state.quickAccess) ? state.quickAccess : [];
  entries.forEach(entry => {
    let title;
    let iconClass;
    let target;

    if (entry.type === 'song') {
      target = state.localMusicFiles.find(song => sameQuickSongReference(entry, song));
      if (!target) return;
      title = target.title || 'Sin título';
      iconClass = 'ph ph-music-note';
    } else if (entry.type === 'folder') {
      target = state.configuredFolders?.find(folder => folder.name === entry.name);
      if (!target) return;
      title = target.name;
      iconClass = 'ph ph-folder';
    } else {
      return;
    }

    const el = document.createElement('div');
    el.className = 'playlist-card-left quick-access-item';
    el.dataset.quickType = entry.type;
    el.dataset.quickKey = entry.type === 'folder' ? entry.name : JSON.stringify(entry);
    if (entry.type === 'folder') el.dataset.folderId = target.id;

    const thumb = document.createElement('div');
    thumb.className = 'playlist-thumb-box';
    const icon = document.createElement('i');
    icon.className = iconClass;
    thumb.appendChild(icon);

    const meta = document.createElement('span');
    meta.className = 'playlist-sidebar-title quick-access-title';
    meta.textContent = title;

    const wave = document.createElement('div');
    wave.className = 'sidebar-soundwave-wrap';
    const isPlaying = entry.type === 'song'
      ? state.activeContextId === `quick_song_${target.id}`
      : state.activeContextId === `folder_${target.id}`;
    if (isPlaying) {
      el.classList.add('is-playing-origin');
      wave.innerHTML = getSoundWaveHTML(isPlaybackPaused());
    }
    el.append(thumb, meta, wave);
    el.addEventListener('click', () => {
      if (entry.type === 'folder') {
        navigateToView('folder-detail', { folderId: target.id });
        return;
      }
      playFromContext([target], 0, target.title || 'Canción', true, `quick_song_${target.id}`);
    });
    playlistsContainer.appendChild(el);
  });
}

export function renderPlaylistsUI() {
  clearContainerCovers(playlistsContainer);
  playlistsContainer.innerHTML = '';

  let list = state.playlists.filter(pl => pl.isPinned !== false);

  if (state.playlistSortMode === 'alpha') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (state.playlistSortMode === 'count') {
    list.sort((a, b) => getPlaylistSongs(b).length - getPlaylistSongs(a).length);
  } else if (state.playlistSortMode === 'recent') {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  list.forEach((pl, index) => {
    const el = document.createElement('div');
    el.className = 'playlist-card-left';
    el.dataset.id = pl.id;
    el.dataset.index = index;

    const isThisPlaylistPlaying = state.activeContextId === ('playlist_' + pl.id);
    if (isThisPlaylistPlaying) {
      el.classList.add('is-playing-origin');
    }

    if (state.playlistSortMode === 'custom') {
      el.draggable = false;
      el.dataset.playlistId = String(pl.id);
      if (sidebarPlaylistDragReorderEnabled) {
        el.style.cursor = 'grab';
        el.addEventListener('pointerdown', (e) => {
          pnStartPointerDrag(e, { type: 'playlist', fromIndex: -1, fromId: pl.id, el });
        });
      } else {
        el.style.cursor = '';
      }
    }

    const thumbHtml = pl.coverUrl
      ? `<img alt="${escapeHtml(pl.title)}" class="pl-thumb-img" draggable="false" />`
      : `<i class="ph ph-playlist"></i>`;

    el.innerHTML = `
      <div class="playlist-thumb-box">${thumbHtml}</div>
      <span class="playlist-sidebar-title-row">
        <span class="playlist-sidebar-title">${escapeHtml(pl.title)}</span>
        ${pl.smartFilter ? '<i class="ph ph-lightning smart-playlist-badge" title="Playlist dinámica" aria-label="Playlist dinámica"></i>' : ''}
      </span>
      <div class="sidebar-soundwave-wrap">
        ${isThisPlaylistPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
      </div>
    `;

    if (pl.coverUrl) {
      const plImg = el.querySelector('.pl-thumb-img');
      if (plImg) bindLazyCover(plImg, pl.coverUrl, pl.title);
    }

    el.addEventListener('click', (e) => {
      if (uiVars.isDragging) {
        e.preventDefault();
        return;
      }
      navigateToView('playlist', { playlistId: pl.id });
    });

    playlistsContainer.appendChild(el);
  });
  renderQuickAccessEntries();
}
