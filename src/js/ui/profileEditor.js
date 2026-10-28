// UI · Editor de perfil de artista/álbum (foto, overrides y búsqueda online).

import { clearContainerCovers } from './covers.js';
import { playlistHeroCover, profileEditorModal, profileEditorPhotoInput, profileEditorPhotoPreview, profileEditorStatus } from './dom.js';
import { uiVars } from './sharedState.js';
import { state } from '../state.js';
import { artistPortraitCache, mbArtistCache } from './artists.js';
import { invalidateLibraryEntityCaches } from './libraryEntities.js';
import { renderGrids } from './homeGrids.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { showConfirmDialog } from './uiUtils.js';
import { searchAllArtistProviders } from './artistProviders.js';

let profileEditorTarget = null;
let artistSearchResults = [];
let artistSearching = false;

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
  artistSearchResults = [];
  const panel = document.getElementById('profile-editor-search-panel');
  if (panel) panel.hidden = true;
  const results = document.getElementById('profile-editor-search-results');
  if (results) results.replaceChildren();
}

function getCachedMbArtist(artistName) {
  const cached = mbArtistCache[artistName];
  if (!cached || typeof cached.then === 'function') {
    try {
      const raw = localStorage.getItem(`mb_artist_${artistName}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return cached;
}

/** Prefill artist fields from override + MusicBrainz cache + hero description. */
function prefillArtistFields(artistName, override) {
  const mb = getCachedMbArtist(artistName) || {};
  const heroDesc = document.getElementById('playlist-hero-desc')?.textContent?.trim() || '';
  const heroPhoto = playlistHeroCover?.querySelector('img')?.src || null;

  const description =
    (typeof override.description === 'string' && override.description) ||
    (heroDesc && !heroDesc.startsWith('Sin información') ? heroDesc : '') ||
    '';

  const origin =
    (Object.prototype.hasOwnProperty.call(override, 'origin') ? override.origin : null) ??
    mb.origin ??
    '';

  const type =
    (Object.prototype.hasOwnProperty.call(override, 'type') ? override.type : null) ??
    mb.type ??
    '';

  const genres = Object.prototype.hasOwnProperty.call(override, 'genres')
    ? (Array.isArray(override.genres) ? override.genres : [])
    : (Array.isArray(mb.genres) ? mb.genres : []);

  document.getElementById('profile-editor-description').value = description;
  document.getElementById('profile-editor-origin').value = origin || '';
  document.getElementById('profile-editor-type').value = type || '';
  document.getElementById('profile-editor-genres').value = genres.join(', ');

  return override.photo || heroPhoto || null;
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
  document.getElementById('profile-editor-heading').textContent = isArtist ? 'Editar artista' : 'Editar álbum';
  document.getElementById('profile-editor-note').textContent = isArtist
    ? `Los cambios se guardan en este dispositivo para ${artistName}.`
    : `Los cambios se guardan en este dispositivo para ${albumTitle}.`;
  document.getElementById('profile-editor-artist-fields').hidden = !isArtist;
  document.getElementById('profile-editor-album-fields').hidden = !isAlbum;

  artistSearchResults = [];
  const searchPanel = document.getElementById('profile-editor-search-panel');
  if (searchPanel) searchPanel.hidden = true;
  const searchResults = document.getElementById('profile-editor-search-results');
  if (searchResults) searchResults.replaceChildren();
  const searchStatus = document.getElementById('profile-editor-search-status');
  if (searchStatus) {
    searchStatus.hidden = true;
    searchStatus.textContent = '';
  }

  if (isArtist) {
    const photo = prefillArtistFields(artistName, override);
    uiVars.profileEditorPhotoData = override.photo || null;
    setProfileEditorPhoto(uiVars.profileEditorPhotoData || photo || null);
  } else {
    uiVars.profileEditorPhotoData = override.photo || null;
    document.getElementById('profile-editor-album-description').value = override.description || '';
    document.getElementById('profile-editor-album-year').value = override.year || '';
    document.getElementById('profile-editor-album-label').value = override.label || '';
    setProfileEditorPhoto(uiVars.profileEditorPhotoData || playlistHeroCover.querySelector('img')?.src || null);
  }

  profileEditorStatus.hidden = true;
  profileEditorStatus.textContent = '';
  profileEditorModal.classList.add('open');
}

export async function prepareProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Archivo de imagen no válido'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

export async function saveProfileEditor() {
  if (!profileEditorTarget) return;
  const { type, artistName, albumTitle } = profileEditorTarget;
  const isArtist = type === 'artist';
  const override = isArtist
    ? {
      description: document.getElementById('profile-editor-description').value.trim(),
      origin: document.getElementById('profile-editor-origin').value.trim(),
      type: document.getElementById('profile-editor-type').value.trim(),
      genres: document.getElementById('profile-editor-genres').value.split(',').map(value => value.trim()).filter(Boolean),
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

function setSearchStatus(message, isError = false) {
  const el = document.getElementById('profile-editor-search-status');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
  el.classList.toggle('is-error', Boolean(isError));
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max = 220) {
  const s = String(str || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function renderArtistSearchResults() {
  const list = document.getElementById('profile-editor-search-results');
  if (!list) return;
  list.replaceChildren();

  if (!artistSearchResults.length) {
    list.innerHTML = '<div class="profile-search-empty">Sin resultados. Probá con otro nombre o más tarde.</div>';
    return;
  }

  artistSearchResults.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'profile-search-card';
    const genres = (item.genres || []).slice(0, 6).join(', ');
    const photoHtml = item.photo
      ? `<img class="profile-search-thumb" src="${escapeHtml(item.photo)}" alt="" loading="lazy" />`
      : `<div class="profile-search-thumb profile-search-thumb--empty"><i class="ph ph-user"></i></div>`;

    card.innerHTML =
      `<div class="profile-search-card-top">` +
        photoHtml +
        `<div class="profile-search-card-main">` +
          `<div class="profile-search-card-title">` +
            `<strong>${escapeHtml(item.name || 'Sin nombre')}</strong>` +
            `<span class="profile-search-provider">${escapeHtml(item.providerLabel)}</span>` +
          `</div>` +
          (item.description
            ? `<p class="profile-search-desc">${escapeHtml(truncate(item.description, 240))}</p>`
            : '') +
          `<div class="profile-search-meta">` +
            (item.origin ? `<span><strong>Origen:</strong> ${escapeHtml(item.origin)}</span>` : '') +
            (item.type ? `<span><strong>Tipo:</strong> ${escapeHtml(item.type)}</span>` : '') +
            (genres ? `<span><strong>Géneros:</strong> ${escapeHtml(genres)}</span>` : '') +
          `</div>` +
        `</div>` +
      `</div>` +
      `<div class="profile-search-actions">` +
        `<button type="button" class="btn-pill-save" data-artist-apply="all" data-index="${index}">Aplicar todo</button>` +
        (item.description
          ? `<button type="button" class="btn-import-m3u" data-artist-apply="description" data-index="${index}">Descripción</button>`
          : '') +
        (item.origin
          ? `<button type="button" class="btn-import-m3u" data-artist-apply="origin" data-index="${index}">Origen</button>`
          : '') +
        (item.type
          ? `<button type="button" class="btn-import-m3u" data-artist-apply="type" data-index="${index}">Tipo</button>`
          : '') +
        (item.genres?.length
          ? `<button type="button" class="btn-import-m3u" data-artist-apply="genres" data-index="${index}">Géneros</button>`
          : '') +
        (item.photo
          ? `<button type="button" class="btn-import-m3u" data-artist-apply="photo" data-index="${index}">Foto</button>`
          : '') +
      `</div>`;
    list.appendChild(card);
  });
}

function applyArtistSearchField(item, field) {
  if (!item) return;
  if (field === 'all' || field === 'description') {
    if (item.description) {
      document.getElementById('profile-editor-description').value = item.description;
    }
  }
  if (field === 'all' || field === 'origin') {
    if (item.origin) {
      document.getElementById('profile-editor-origin').value = item.origin;
    }
  }
  if (field === 'all' || field === 'type') {
    if (item.type) {
      document.getElementById('profile-editor-type').value = item.type;
    }
  }
  if (field === 'all' || field === 'genres') {
    if (item.genres?.length) {
      document.getElementById('profile-editor-genres').value = item.genres.join(', ');
    }
  }
  if (field === 'all' || field === 'photo') {
    if (item.photo) {
      uiVars.profileEditorPhotoData = item.photo;
      setProfileEditorPhoto(item.photo);
    }
  }
  const labels = {
    all: 'Todos los campos aplicados',
    description: 'Descripción aplicada',
    origin: 'Origen aplicado',
    type: 'Tipo aplicado',
    genres: 'Géneros aplicados',
    photo: 'Foto aplicada',
  };
  setSearchStatus((labels[field] || 'Aplicado') + ` desde ${item.providerLabel}.`);
}

export async function searchArtistOnline() {
  if (!profileEditorTarget || profileEditorTarget.type !== 'artist') return;
  if (artistSearching) return;
  const artistName = profileEditorTarget.artistName;
  artistSearching = true;
  const panel = document.getElementById('profile-editor-search-panel');
  if (panel) panel.hidden = false;
  setSearchStatus('Buscando en MusicBrainz, Last.fm, Wikipedia, Deezer, TheAudioDB y Fanart.tv…');
  const list = document.getElementById('profile-editor-search-results');
  if (list) list.innerHTML = '<div class="profile-search-empty">Buscando…</div>';

  try {
    const results = await searchAllArtistProviders(artistName);
    artistSearchResults = results;
    setSearchStatus(
      results.length
        ? `${results.length} resultado(s). Podés aplicar todo o campo por campo.`
        : 'Sin resultados en los proveedores.'
    );
    renderArtistSearchResults();
  } catch (err) {
    console.error(err);
    artistSearchResults = [];
    setSearchStatus('Error al buscar: ' + (err?.message || err), true);
    renderArtistSearchResults();
  } finally {
    artistSearching = false;
  }
}

/** Wire search panel buttons (call once from global bindings). */
export function bindArtistSearchPanel() {
  document.getElementById('profile-editor-search-online')?.addEventListener('click', () => {
    void searchArtistOnline();
  });
  document.getElementById('profile-editor-search-results')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-artist-apply]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const field = btn.dataset.artistApply;
    const item = artistSearchResults[index];
    if (!item) return;
    applyArtistSearchField(item, field);
  });
}
