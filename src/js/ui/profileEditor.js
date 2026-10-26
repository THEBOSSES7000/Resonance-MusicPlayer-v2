// UI · Editor de perfil de artista (foto y overrides).

import { clearContainerCovers } from './covers.js';
import { playlistHeroCover, profileEditorModal, profileEditorPhotoInput, profileEditorPhotoPreview, profileEditorStatus } from './dom.js';
import { uiVars } from './sharedState.js';
import { state } from '../state.js';
import { artistPortraitCache, mbArtistCache } from './artists.js';
import { invalidateLibraryEntityCaches } from './libraryEntities.js';
import { renderGrids } from './homeGrids.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { showConfirmDialog } from './uiUtils.js';

let profileEditorTarget = null;

export function getProfileOverride(type, artistName, albumTitle = '') {
  const key = profileOverrideStorageKey(type, artistName, albumTitle);
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function profileOverrideStorageKey(type, artistName, albumTitle = '') {
  const artistKey = encodeURIComponent(String(artistName || '').trim().toLocaleLowerCase());
  const albumKey = type === 'album'
    ? `_${encodeURIComponent(String(albumTitle || '').trim().toLocaleLowerCase())}`
    : '';
  return `pn_${type}_profile_${artistKey}${albumKey}`;
}

const MAX_PROFILE_OVERRIDE_KEYS = 80;

function enforceProfileOverrideStorageLimit(justWrittenKey = null) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('pn_artist_profile_') || key.startsWith('pn_album_profile_'))) {
        keys.push(key);
      }
    }
    if (keys.length <= MAX_PROFILE_OVERRIDE_KEYS) return;
    keys.sort();
    const overflow = keys.length - MAX_PROFILE_OVERRIDE_KEYS;
    let removed = 0;
    for (const key of keys) {
      if (removed >= overflow) break;
      if (justWrittenKey && key === justWrittenKey) continue;
      localStorage.removeItem(key);
      removed++;
    }
  } catch (_) {}
}

export function setProfileEditorPhoto(photoUrl) {
  clearContainerCovers(profileEditorPhotoPreview);
  profileEditorPhotoPreview.replaceChildren();
  if (!photoUrl) {
    const icon = document.createElement('i');
    icon.className = 'ph ph-image';
    profileEditorPhotoPreview.appendChild(icon);
    return;
  }
  const image = document.createElement('img');
  image.src = photoUrl;
  image.alt = 'Vista previa de la foto';
  profileEditorPhotoPreview.appendChild(image);
}

export function closeProfileEditor() {
  profileEditorModal?.classList.remove('open');
  profileEditorTarget = null;
  uiVars.profileEditorPhotoData = null;
  if (profileEditorPhotoInput) profileEditorPhotoInput.value = '';
}

export function openProfileEditor() {
  const isArtist = state.currentView === 'artist';
  const isAlbum = state.currentView === 'album-detail';
  const tableContainer = document.querySelector('.playlist-table-container');
  if (tableContainer) {
    const forceIndex = isAlbum && state.albumSortMode === 'track';
    tableContainer.dataset.forceTrackIndex = forceIndex ? 'true' : 'false';
  }

  if (!isArtist && !isAlbum) return;
  const artistName = String(isArtist ? state.artistName : (state.albumArtistName || state.artistName) || '').trim();
  const albumTitle = String(state.albumTitle || '').trim();
  if (!artistName || (isAlbum && !albumTitle)) return;
  const override = getProfileOverride(isArtist ? 'artist' : 'album', artistName, albumTitle) || {};
  profileEditorTarget = { type: isArtist ? 'artist' : 'album', artistName, albumTitle };
  uiVars.profileEditorPhotoData = override.photo || null;
  document.getElementById('profile-editor-heading').textContent = isArtist ? 'Editar artista' : 'Editar álbum';
  document.getElementById('profile-editor-note').textContent = isArtist
    ? `Los cambios se guardan en este dispositivo para ${artistName}.`
    : `Los cambios se guardan en este dispositivo para ${albumTitle}.`;
  document.getElementById('profile-editor-artist-fields').hidden = !isArtist;
  document.getElementById('profile-editor-album-fields').hidden = !isAlbum;
  document.getElementById('profile-editor-description').value = override.description || '';
  document.getElementById('profile-editor-origin').value = override.origin || '';
  document.getElementById('profile-editor-activity').value = override.activity || '';
  document.getElementById('profile-editor-type').value = override.type || '';
  document.getElementById('profile-editor-genres').value = Array.isArray(override.genres) ? override.genres.join(', ') : '';
  document.getElementById('profile-editor-context').value = override.context || '';
  document.getElementById('profile-editor-album-description').value = override.description || '';
  document.getElementById('profile-editor-album-year').value = override.year || '';
  document.getElementById('profile-editor-album-label').value = override.label || '';
  profileEditorStatus.hidden = true;
  profileEditorStatus.textContent = '';
  setProfileEditorPhoto(uiVars.profileEditorPhotoData || playlistHeroCover.querySelector('img')?.src || null);
  profileEditorModal.classList.add('open');
}

export async function prepareProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('No se pudo preparar la imagen seleccionada.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen seleccionada.'));
    };
    image.src = objectUrl;
  });
}

export function saveProfileEditor() {
  if (!profileEditorTarget) return;
  const { type, artistName, albumTitle } = profileEditorTarget;
  const override = type === 'artist'
    ? {
      description: document.getElementById('profile-editor-description').value.trim(),
      origin: document.getElementById('profile-editor-origin').value.trim(),
      activity: document.getElementById('profile-editor-activity').value.trim(),
      type: document.getElementById('profile-editor-type').value.trim(),
      genres: document.getElementById('profile-editor-genres').value.split(',').map(value => value.trim()).filter(Boolean),
      context: document.getElementById('profile-editor-context').value.trim(),
      photo: uiVars.profileEditorPhotoData
    }
    : {
      description: document.getElementById('profile-editor-album-description').value.trim(),
      year: document.getElementById('profile-editor-album-year').value.trim(),
      label: document.getElementById('profile-editor-album-label').value.trim(),
      photo: uiVars.profileEditorPhotoData
    };
  try {
    const hasOverrides = Object.values(override).some(value =>
      Array.isArray(value) ? value.length > 0 : Boolean(value)
    );
    const key = profileOverrideStorageKey(type, artistName, albumTitle);
    if (hasOverrides) {
      localStorage.setItem(key, JSON.stringify(override));
      enforceProfileOverrideStorageLimit(key);
    } else localStorage.removeItem(key);
  } catch (error) {
    profileEditorStatus.textContent = `No se pudieron guardar los cambios: ${error.message}`;
    profileEditorStatus.hidden = false;
    return;
  }
  if (type === 'artist') delete artistPortraitCache[artistName];
  invalidateLibraryEntityCaches();
  closeProfileEditor();
  renderGrids();
  void renderPlaylistDetailView();
}

export async function refreshCurrentProfile() {
  const isArtist = state.currentView === 'artist';
  const isAlbum = state.currentView === 'album-detail';
  if (!isArtist && !isAlbum) return;
  const artistName = String(isArtist ? state.artistName : (state.albumArtistName || state.artistName) || '').trim();
  const albumTitle = String(state.albumTitle || '').trim();
  const type = isArtist ? 'artist' : 'album';
  const key = profileOverrideStorageKey(type, artistName, albumTitle);
  const currentOverride = getProfileOverride(type, artistName, albumTitle);
  if (currentOverride) {
    const confirmed = await showConfirmDialog({
      title: '¿Reemplazar la información personalizada?',
      message: 'Al actualizar se reemplazarán los datos que editaste. La foto personalizada se conservará.',
      confirmText: 'Actualizar y reemplazar'
    });
    if (!confirmed) return;
  }
  if (isArtist) {
    delete mbArtistCache[artistName];
  }
  try {
    localStorage.removeItem(key);
    if (isArtist) {
      localStorage.removeItem(`mb_artist_${artistName}`);
      if (currentOverride?.photo) {
        localStorage.setItem(key, JSON.stringify({ photo: currentOverride.photo }));
      }
    }
  } catch (error) {
    await showConfirmDialog({
      title: 'No se pudo limpiar la caché',
      message: `No fue posible reemplazar los datos guardados: ${error.message}`,
      confirmText: 'Aceptar',
      showCancel: false
    });
    return;
  }
  await renderPlaylistDetailView();
}
