// UI · Agregar canciones a playlists y selector de playlist.

import { persistPlaylists, state } from '../state.js';
import { showConfirmDialog } from './uiUtils.js';
import { stampSongForPlaylist } from './playlistData.js';
import { renderPlaylistsUI } from './collections.js';
import { renderPlaylistsHubUI } from './folderPlaylistViews.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { songsMatch } from './favorites.js';
import { bindLazyCover, clearContainerCovers } from './covers.js';
import { btnAddPlaylist } from './dom.js';

export function addCurrentSongToPlaylist() {
  const song = state.currentTrackIndex === -1
    ? null
    : state.activeQueue[state.currentTrackIndex];
  if (!song) {
    void showConfirmDialog({
      title: 'Sin canción',
      message: 'Reproduce una canción para agregarla a una playlist.',
      confirmText: 'Entendido',
      showCancel: false
    });
    return;
  }
  openPlaylistPicker([song]);
}

export async function addSongToPlaylist(song, playlist) {
  if (!song || !playlist) return;
  if (playlist.smartFilter) {
    await showConfirmDialog({
      title: "Playlist dinámica",
      message: "Su contenido se determina por sus filtros y no admite canciones agregadas manualmente.",
      confirmText: "Aceptar",
      showCancel: false
    });
    return;
  }
  if (!playlist.songs) playlist.songs = [];

  const alreadyExists = playlist.songs.some(s => s.id === song.id || (s.title === song.title && s.artist === song.artist));
  if (alreadyExists) {
    const proceed = await showConfirmDialog({
      title: "¿Canción repetida en playlist?",
      message: `La canción "${song.title}" ya se encuentra en "${playlist.title}". ¿Deseas agregarla de nuevo?`,
      confirmText: "Agregar",
      cancelText: "Cancelar"
    });
    if (!proceed) return;
  }

  playlist.songs.push(stampSongForPlaylist(song));
  persistPlaylists();
  renderPlaylistsUI();
  if (state.currentView === 'playlists-hub') {
    renderPlaylistsHubUI();
  }
  if (state.currentView === 'playlist' && state.currentPlaylistId === playlist.id) {
    renderPlaylistDetailView();
  }
}

async function addSongsToPlaylist(songs, playlist) {
  if (!playlist) return;
  if (playlist.smartFilter) return;
  const playlistSongs = Array.isArray(playlist.songs) ? playlist.songs : [];
  const songsToAdd = songs.filter((song, index) =>
    !playlistSongs.some(existing => songsMatch(existing, song)) &&
    songs.findIndex(other => songsMatch(song, other)) === index
  );
  if (!songsToAdd.length) return;

  const now = Date.now();
  const stamped = songsToAdd.map((song, index) => stampSongForPlaylist(song, now + index));
  playlist.songs = [...playlistSongs, ...stamped];
  persistPlaylists();
  renderPlaylistsUI();
  if (state.currentView === 'playlists-hub') renderPlaylistsHubUI();
  if (state.currentView === 'playlist' && state.currentPlaylistId === playlist.id) {
    renderPlaylistDetailView();
  }
}

function playlistContainsSong(playlist, song) {
  if (!playlist || !song) return false;
  const list = playlist.songs || [];
  const songId = song.id != null ? String(song.id) : '';
  const songPath = String(song.file?.path || song.path || '').toLowerCase();
  return list.some(entry => {
    if (!entry) return false;
    if (songId && entry.id != null && String(entry.id) === songId) return true;
    const entryPath = String(entry.file?.path || entry.path || '').toLowerCase();
    return songPath && entryPath && entryPath === songPath;
  });
}

function playlistAlreadyHasAllSongs(playlist, songs) {
  if (!playlist || !Array.isArray(songs) || !songs.length) return false;
  return songs.every(song => playlistContainsSong(playlist, song));
}

export function openPlaylistPicker(songs) {
  const editablePlaylists = state.playlists.filter(playlist => !playlist.smartFilter);
  if (!editablePlaylists.length) {
    void showConfirmDialog({
      title: 'No hay playlists editables',
      message: 'Crea una playlist manual para agregar canciones. Las playlists dinámicas se actualizan mediante sus filtros.',
      confirmText: 'Aceptar',
      showCancel: false
    });
    return;
  }

  const modal = document.getElementById('multi-playlist-modal');
  const options = document.getElementById('multi-playlist-options');
  const title = document.getElementById('multi-playlist-title');
  const description = document.getElementById('multi-playlist-description');
  const modeToggle = document.getElementById('multi-playlist-toggle');
  const applyButton = document.getElementById('multi-playlist-apply');
  const cancelButton = document.getElementById('multi-playlist-cancel');
  const closeButton = document.getElementById('multi-playlist-close');
  if (!modal || !options || !title || !description || !modeToggle || !applyButton || !cancelButton || !closeButton) return;

  const selectedSongs = Array.isArray(songs) ? songs : [songs];
  let mode = 'single';

  const createPlaylistThumbnail = playlist => {
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
    return thumbnail;
  };

  const renderSingleChoice = () => {
    mode = 'single';
    title.textContent = 'Agregar a playlist';
    description.textContent = `Elige dónde agregar ${selectedSongs.length === 1 ? 'esta canción' : `estas ${selectedSongs.length} canciones`}. Las canciones repetidas se omitirán.`;
    modeToggle.title = 'Elegir varias playlists';
    modeToggle.setAttribute('aria-label', 'Elegir varias playlists');
    modeToggle.setAttribute('aria-pressed', 'false');
    modeToggle.querySelector('i').className = 'ph ph-list-checks';
    clearContainerCovers(options);
    options.replaceChildren();
    editablePlaylists.forEach(playlist => {
      const alreadyHas = playlistAlreadyHasAllSongs(playlist, selectedSongs);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'playlist-picker-item' + (alreadyHas ? ' is-disabled already-in-playlist' : '');
      button.dataset.playlistId = String(playlist.id);
      if (alreadyHas) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        button.title = selectedSongs.length === 1
          ? 'Esta canción ya está en esta playlist'
          : 'Todas las canciones ya están en esta playlist';
      }
      button.appendChild(createPlaylistThumbnail(playlist));
      const name = document.createElement('span');
      name.className = 'playlist-picker-name';
      name.textContent = playlist.title;
      button.appendChild(name);
      if (alreadyHas) {
        const badge = document.createElement('span');
        badge.className = 'playlist-picker-badge';
        badge.textContent = 'Ya está';
        button.appendChild(badge);
      }
      options.appendChild(button);
    });

    const createButton = document.createElement('button');
    createButton.type = 'button';
    createButton.className = 'playlist-picker-item';
    createButton.dataset.playlistAction = 'create';
    createButton.innerHTML = '<i class="ph ph-plus"></i><span>Nueva playlist...</span>';
    options.appendChild(createButton);

    applyButton.hidden = true;
    applyButton.disabled = true;
  };

  const renderMultipleChoices = () => {
    mode = 'multiple';
    title.textContent = 'Agregar a varias playlists';
    description.textContent = `Selecciona los destinos para ${selectedSongs.length === 1 ? 'esta canción' : `estas ${selectedSongs.length} canciones`}. Los duplicados se omitirán.`;
    modeToggle.title = 'Volver a elegir una playlist';
    modeToggle.setAttribute('aria-label', 'Volver a elegir una playlist');
    modeToggle.setAttribute('aria-pressed', 'true');
    modeToggle.querySelector('i').className = 'ph ph-arrow-left';
    clearContainerCovers(options);
    options.replaceChildren();

    editablePlaylists.forEach(playlist => {
      const alreadyHas = playlistAlreadyHasAllSongs(playlist, selectedSongs);
      const label = document.createElement('label');
      label.className = 'multi-playlist-option' + (alreadyHas ? ' is-disabled already-in-playlist' : '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(playlist.id);
      if (alreadyHas) {
        checkbox.disabled = true;
        label.title = selectedSongs.length === 1
          ? 'Esta canción ya está en esta playlist'
          : 'Todas las canciones ya están en esta playlist';
      }
      label.append(checkbox, createPlaylistThumbnail(playlist));
      const name = document.createElement('span');
      name.className = 'playlist-picker-name';
      name.textContent = playlist.title;
      label.appendChild(name);
      if (alreadyHas) {
        const badge = document.createElement('span');
        badge.className = 'playlist-picker-badge';
        badge.textContent = 'Ya está';
        label.appendChild(badge);
      }
      options.appendChild(label);
    });

    applyButton.hidden = false;
    updateApplyState();
  };

  const updateApplyState = () => {
    applyButton.disabled = mode !== 'multiple' || !options.querySelector('input:checked');
  };

  const toggleMode = () => {
    if (mode === 'single') renderMultipleChoices();
    else renderSingleChoice();
  };

  const close = () => {
    modal.classList.remove('open');
    clearContainerCovers(options);
    options.replaceChildren();
    applyButton.removeEventListener('click', apply);
    cancelButton.removeEventListener('click', close);
    closeButton.removeEventListener('click', close);
    modeToggle.removeEventListener('click', toggleMode);
    options.removeEventListener('click', handleOptionClick);
    options.removeEventListener('change', updateApplyState);
    modal.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeyDown);
  };

  const handleOptionClick = event => {
    const actionButton = event.target.closest('[data-playlist-action]');
    if (actionButton?.dataset.playlistAction === 'create') {
      close();
      btnAddPlaylist.click();
      return;
    }
    const playlistButton = event.target.closest('[data-playlist-id]');
    if (!playlistButton) return;
    const playlist = state.playlists.find(item => String(item.id) === playlistButton.dataset.playlistId);
    if (!playlist) return;
    close();
    void addSongsToPlaylist(selectedSongs, playlist);
  };

  const apply = () => {
    if (mode !== 'multiple') return;
    const selectedIds = new Set(
      [...options.querySelectorAll('input:checked')].map(input => input.value)
    );
    const selectedPlaylists = state.playlists.filter(playlist => selectedIds.has(String(playlist.id)));
    close();
    selectedPlaylists.forEach(playlist => { void addSongsToPlaylist(selectedSongs, playlist); });
  };
  const onBackdropClick = event => { if (event.target === modal) event.stopPropagation(); };
  const onKeyDown = event => {
    if (event.key === 'Escape') close();
  };

  renderSingleChoice();
  modeToggle.addEventListener('click', toggleMode);
  options.addEventListener('click', handleOptionClick);
  applyButton.addEventListener('click', apply);
  cancelButton.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  options.addEventListener('change', updateApplyState);
  modal.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown);
  modal.classList.add('open');
}
