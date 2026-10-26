// Letras · Editor de pista: carátula, estado y vista previa.

import { resolveCoverUrl, state } from '../state.js';
import { lyricsVars } from './sharedState.js';
import { getLyricsTarget, rawLyricsOf } from './lyricsSearch.js';
import { getUi } from './uiBridge.js';
import { ensureSongLyrics } from '../scanner.js';
import { isPlaybackPaused, paintPlayerCover } from '../audioPlayer.js';

const ACCEPTED_COVER_TYPES = ['image/jpeg', 'image/png'];

const MAX_COVER_BYTES = 16 * 1024 * 1024;

export let editTargetSong = null;

export function setEditStatus(message, isError = false) {
  const el = document.getElementById('track-edit-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', isError);
  el.style.display = message ? 'block' : 'none';
}

export function renderEditCoverPreview() {
  const box = document.getElementById('track-edit-cover-preview');
  if (!box) return;
  const existingCover = editTargetSong ? resolveCoverUrl(editTargetSong) : null;
  if (lyricsVars.editCoverDataUrl) {
    box.innerHTML = '<img src="' + lyricsVars.editCoverDataUrl + '" alt="Portada" />';
  } else if (existingCover && !lyricsVars.editCoverRemove) {
    box.innerHTML = '<img src="' + existingCover + '" alt="Portada actual" />';
  } else {
    box.innerHTML = '<i class="ph ph-music-notes"></i>';
  }
  const removeBtn = document.getElementById('btn-track-edit-cover-remove');
  if (removeBtn) removeBtn.disabled = !lyricsVars.editCoverDataUrl && !(existingCover && !lyricsVars.editCoverRemove);
}

export function openTrackEditor(song = null, metadata = null) {
  editTargetSong = song || getLyricsTarget();
  if (!editTargetSong) {
    void getUi().then(ui => ui.showConfirmDialog({ title: 'Sin canción', message: 'Selecciona una canción para editar sus metadatos.', confirmText: 'Entendido', showCancel: false }));
    return;
  }
  const target = editTargetSong;
  const selectedFields = new Set(metadata?.selectedFields || []);
  const useMetadataField = field => selectedFields.has(field);
  lyricsVars.editCoverDataUrl = useMetadataField('cover') ? metadata?.coverDataUrl || null : null;
  lyricsVars.editCoverRemove = false;
  document.getElementById('track-edit-title').value =
    (useMetadataField('title') && metadata?.title) || target.title || '';
  const artistVal = target.artist && target.artist !== 'Desconocido' ? target.artist : '';
  document.getElementById('track-edit-artist').value =
    (useMetadataField('artist') && metadata?.artist) || artistVal;
  document.getElementById('track-edit-album').value =
    (useMetadataField('album') && metadata?.album) || target.album || '';
  document.getElementById('track-edit-year').value =
    (useMetadataField('date') && metadata?.date) || target.year || '';
  document.getElementById('track-edit-track-number').value =
    (useMetadataField('trackNumber') && metadata?.trackNumber) || target.trackNumber || '';
  document.getElementById('track-edit-disc-number').value =
    (useMetadataField('discNumber') && metadata?.discNumber) || target.discNumber || '';
  document.getElementById('track-edit-genre').value =
    (useMetadataField('genre') && metadata?.genre) || target.genre || '';
  const moreFields = document.getElementById('track-edit-more-fields');
  const moreToggle = document.getElementById('track-edit-more-toggle');
  const showMore = ['date', 'trackNumber', 'discNumber', 'genre'].some(useMetadataField);
  moreFields.hidden = !showMore;
  moreToggle.setAttribute('aria-expanded', String(showMore));
  moreToggle.innerHTML = showMore
    ? '<i class="ph ph-caret-up"></i> Mostrar menos'
    : '<i class="ph ph-caret-down"></i> Mostrar más';

  const lyricsTextarea = document.getElementById('track-edit-lyrics');
  lyricsTextarea.value = rawLyricsOf(target);

  // Si las letras fueron descargadas de RAM por el límite FIFO, recuperarlas del archivo antes de editar
  if (!target.lyricsLoaded) {
    void ensureSongLyrics(target).then(() => {
      if (editTargetSong === target &&
          document.getElementById('track-edit-modal')?.classList.contains('open') &&
          !lyricsTextarea.value.trim()) {
        lyricsTextarea.value = rawLyricsOf(target);
      }
    });
  }

  const fileNameEl = document.getElementById('track-edit-filename');
  if (fileNameEl) fileNameEl.textContent = target.file?.name || target.file?.path || 'Archivo desconocido';
  setEditStatus('');
  renderEditCoverPreview();
  document.getElementById('track-edit-modal')?.classList.add('open');
}

export function closeTrackEditor() {
  document.getElementById('track-edit-modal')?.classList.remove('open');
  editTargetSong = null;
  // Liberar el string Base64 de hasta 16 MB y la imagen del preview al cerrar el modal
  lyricsVars.editCoverDataUrl = null;
  lyricsVars.editCoverRemove = false;
  const preview = document.getElementById('track-edit-cover-preview');
  if (preview) preview.innerHTML = '<i class="ph ph-music-notes"></i>';
}

export function refreshSongViews(song) {
  getUi().then(ui => {
    ui.renderGrids();
    ui.renderQueue();
    ui.renderHistoryUI();
    ui.renderFoldersUI();
    ui.updateFavoritesCount();
    ui.updateFavIcon();
    if (state.currentView === 'search') ui.renderSearchResultsContent();
    else if (['favorites', 'playlist', 'all-music', 'folder-detail', 'artist', 'album-detail'].includes(state.currentView)) {
      void ui.renderPlaylistDetailView();
    }
    if (state.currentView === 'playlists-hub') ui.renderPlaylistsHubUI();
    const current = state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
    if (current && current.id === song.id) {
      document.getElementById('current-title-text').textContent = song.title;
      document.getElementById('current-artist').textContent = song.artist || 'Desconocido';
      ui.syncPlayerAlbumLinkState();
      paintPlayerCover(resolveCoverUrl(song), song);
      ui.updateLyricsUI();
      ui.syncPlayingUI(!isPlaybackPaused());
    }
  });
}

/**
 * Comprime y redimensiona portadas excesivamente grandes al cargarlas en el editor
 * para no retener strings Base64 de 10-16 MB en el heap de V8.
 */
async function readAndOptimizeCoverFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = 1000;
      const largest = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
      // Si ya es pequeña (< 512 KB y <= 1000px), leer directamente sin recodificar
      if (largest > 0 && largest <= maxDim && file.size <= 512 * 1024) {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.readAsDataURL(file);
        return;
      }
      const scale = largest > maxDim ? maxDim / largest : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        canvas.width = 1;
        canvas.height = 1;
        reject(new Error('No se pudo preparar el lienzo de la portada.'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, 0.88);
      canvas.width = 1;
      canvas.height = 1;
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo decodificar la imagen seleccionada.'));
    };
    img.src = objectUrl;
  });
}

export function handleCoverFileSelect(file) {
  setEditStatus('');
  if (!file) return;
  if (!ACCEPTED_COVER_TYPES.includes(file.type)) {
    setEditStatus('Formato no válido. Usa JPG o PNG.', true);
    return;
  }
  if (file.size > MAX_COVER_BYTES) {
    setEditStatus('La imagen supera los 16 MB permitidos.', true);
    return;
  }
  void readAndOptimizeCoverFile(file).then(dataUrl => {
    lyricsVars.editCoverDataUrl = dataUrl;
    lyricsVars.editCoverRemove = false;
    renderEditCoverPreview();
  }).catch(error => {
    setEditStatus(error?.message || 'No se pudo leer la imagen.', true);
  });
}

export function dataUrlToBase64Parts(dataUrl) {
  const match = String(dataUrl).match(/^data:(image\/(?:jpeg|png));base64,(.+)$/i);
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: match[2] };
}
