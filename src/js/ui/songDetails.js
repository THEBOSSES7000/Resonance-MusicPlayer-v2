// UI · Detalles de canción y búsqueda/aplicación de metadatos.

import { ensureSongMetadata } from './playback.js';
import { ensureSongLyrics, ensureSongTechDetails, resolveCoverUrl } from '../scanner.js';
import { uiVars } from './sharedState.js';
import { btnFetchTrackMetadata, detailsCoverBox, detailsLyricsBadge, detailsLyricsContent, detailsMainMeta, detailsTechGrid, metadataMatchClose, metadataMatchList, metadataMatchModal, metadataSearchAlbum, metadataSearchArtist, metadataSearchSubmit, metadataSearchTitle, metadataTextSearchContext, metadataTextSearchModal, metadataTextSearchStatus, songDetailsModal, trackMetadataSearchMenu, trackMetadataSearchStatus } from './dom.js';
import { clearContainerCovers } from './covers.js';
import { formatTime, state } from '../state.js';
import { getPlaybackDuration } from '../audioPlayer.js';
import { escapeHtml, showConfirmDialog } from './uiUtils.js';
import { openTrackEditor } from '../lyrics.js';

export let trackMetadataMatches = [];

let metadataApplying = false;

let metadataTextSearchSong = null;

export async function showSongDetails(song) {
  if (!song) return;
  await ensureSongMetadata(song);
  await Promise.all([
    ensureSongTechDetails(song).catch(() => {}),
    ensureSongLyrics(song).catch(() => {})
  ]);
  uiVars.songDetailsTarget = song;
  if (trackMetadataSearchStatus) trackMetadataSearchStatus.textContent = '';
  if (trackMetadataSearchMenu) trackMetadataSearchMenu.hidden = true;
  btnFetchTrackMetadata?.setAttribute('aria-expanded', 'false');

  clearContainerCovers(detailsCoverBox);
  const coverUrl = resolveCoverUrl(song);
  if (coverUrl) {
    detailsCoverBox.innerHTML = `<img src="${escapeHtml(coverUrl)}" class="details-cover-img" alt="${escapeHtml(song.title)}" />`;
  } else {
    detailsCoverBox.innerHTML = `<i class="ph ph-waveform"></i>`;
  }

  const durSec = song.duration || (song.id === state.activeQueue[state.currentTrackIndex]?.id ? getPlaybackDuration() : 0);
  const durFormatted = durSec > 0 ? formatTime(durSec) : "Desconocida";

  const fileName = song.file ? song.file.name : "Desconocido";
  const ext = fileName.includes('.') ? fileName.split('.').pop().toUpperCase() : "AUDIO";
  const fileBytes = Number(song.file?.size);
  let fileSizeStr = "Desconocido";
  if (Number.isFinite(fileBytes) && fileBytes >= 0) {
    if (fileBytes < 1024) {
      fileSizeStr = `${fileBytes} B`;
    } else {
      const units = ['KB', 'MB', 'GB'];
      let size = fileBytes / 1024;
      let unitIndex = 0;
      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
      }
      fileSizeStr = `${size.toFixed(1)} ${units[unitIndex]}`;
    }
  }

  detailsMainMeta.innerHTML = `
    <h4 class="details-main-title">${escapeHtml(song.title)}</h4>
    <div class="details-main-artist">${escapeHtml(song.artist || "Desconocido")}</div>
    <div class="details-main-sub">
      <i class="ph ph-disc"></i>
      <span>${escapeHtml(song.album || "Sencillo / Desconocido")}</span>
    </div>
    <div class="details-main-sub">
      <span>•</span>
      <i class="ph ph-clock"></i>
      <span>${durFormatted}</span>
    </div>
    <div class="details-main-sub">
      <span>•</span>
      <i class="ph ph-file" aria-label="Tamaño del archivo"></i>
      <span>${fileSizeStr}</span>
    </div>
  `;

  let bitrateStr = "N/D";
  if (durSec > 0 && song.file) {
    const kbps = Math.round((song.file.size * 8) / (durSec * 1000));
    bitrateStr = `${kbps} kbps`;
  } else {
    bitrateStr = ext === 'FLAC' ? "Lossless (Flac)" : "320 kbps";
  }

  const sampleRateStr = song.sampleRate ? `${(song.sampleRate / 1000).toFixed(1)} kHz` : "44.1 kHz";
  const channelsStr = song.channels === 1 ? "Mono (1.0)" : "Estéreo (2.0)";
  const depthStr = song.bitDepth ? `${song.bitDepth}-bit` : "16-bit";
  const codecStr = song.codec || `${ext} Audio`;
  const playsStr = `${song.playCount || 0} reproducciones`;

  detailsTechGrid.innerHTML = `
    <div class="tech-cell">
      <span class="tech-cell-label">Formato / Códec</span>
      <span class="tech-cell-value">${escapeHtml(codecStr)}</span>
    </div>
    <div class="tech-cell">
      <span class="tech-cell-label">Tasa de Bits</span>
      <span class="tech-cell-value">${bitrateStr}</span>
    </div>
    <div class="tech-cell">
      <span class="tech-cell-label">Frecuencia</span>
      <span class="tech-cell-value">${sampleRateStr}</span>
    </div>
    <div class="tech-cell">
      <span class="tech-cell-label">Profundidad</span>
      <span class="tech-cell-value">${depthStr}</span>
    </div>
    <div class="tech-cell">
      <span class="tech-cell-label">Canales</span>
      <span class="tech-cell-value">${channelsStr}</span>
    </div>
    <div class="tech-cell">
      <span class="tech-cell-label">Reproducciones</span>
      <span class="tech-cell-value" style="color:var(--accent-light);">${playsStr}</span>
    </div>
  `;

  if (song.lyrics && song.lyrics.lines && song.lyrics.lines.length > 0) {
    detailsLyricsBadge.textContent = song.lyrics.isSynced ? "Sincronizadas (LRC)" : "Texto plano";
    detailsLyricsBadge.style.display = "inline-block";

    let lyricsBody = "";
    if (song.lyrics.isSynced) {
      lyricsBody = song.lyrics.lines.map(l => l.text).filter(t => t && t !== "•••").join("\n");
    } else {
      lyricsBody = song.lyrics.lines.join("\n");
    }
    detailsLyricsContent.textContent = lyricsBody || "No hay versos legibles en esta pista.";
  } else {
    detailsLyricsBadge.textContent = "No disponible";
    detailsLyricsContent.innerHTML = `<span style="font-style: italic; opacity: 0.6;">No se encontraron letras incrustadas en los metadatos de este archivo.</span>`;
  }

  songDetailsModal.classList.add('open');
}

export async function refreshSongDetailsIfOpen(song) {
  if (uiVars.songDetailsTarget?.id === song?.id && songDetailsModal.classList.contains('open')) {
    await showSongDetails(song);
  }
}

export function closeMetadataMatchModal() {
  if (metadataApplying) return;
  metadataMatchModal?.classList.remove('open');
  clearContainerCovers(metadataMatchList);
  metadataMatchList?.replaceChildren();
  trackMetadataMatches = [];
}

function renderMetadataMatches(matches) {
  if (!metadataMatchList || !metadataMatchModal) return;
  trackMetadataMatches = matches;
  clearContainerCovers(metadataMatchList);
  metadataMatchList.replaceChildren();
  matches.forEach((match, index) => {
    const card = document.createElement('article');
    card.className = 'metadata-match-option';
    card.dataset.matchIndex = String(index);
    const summary = document.createElement('div');
    summary.className = 'metadata-match-summary';
    const copyAll = document.createElement('button');
    copyAll.type = 'button';
    copyAll.className = 'metadata-match-summary-copy';
    copyAll.dataset.metadataCopyAll = '';
    const title = document.createElement('strong');
    title.textContent = match.title || 'Título desconocido';
    const info = document.createElement('span');
    info.textContent = [
      match.artist || 'Artista desconocido',
      match.album || 'Álbum desconocido',
      match.date || ''
    ].filter(Boolean).join(' · ');
    copyAll.append(title, info);
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'metadata-match-expand';
    expand.dataset.metadataExpand = '';
    expand.setAttribute('aria-label', 'Mostrar datos completos de la coincidencia');
    expand.setAttribute('aria-expanded', 'false');
    expand.innerHTML = '<i class="ph ph-caret-down"></i>';
    summary.append(copyAll, expand);

    const details = document.createElement('div');
    details.className = 'metadata-match-details';
    details.hidden = true;
    details.dataset.metadataDetails = '';
    card.append(summary, details);
    metadataMatchList.appendChild(card);
  });
  metadataMatchModal.classList.add('open');
}

const metadataCopyFields = [
  ['title', 'Título'],
  ['artist', 'Artista'],
  ['album', 'Álbum'],
  ['date', 'Año / fecha'],
  ['trackNumber', 'Número de pista'],
  ['discNumber', 'Número de disco'],
  ['genre', 'Género']
];

function addMetadataDetailRow(details, label, value, field = null) {
  const row = document.createElement('div');
  row.className = 'metadata-detail-row';
  if (field) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(value);
    checkbox.disabled = !value;
    checkbox.dataset.metadataField = field;
    checkbox.setAttribute('aria-label', `Incluir ${label}`);
    row.appendChild(checkbox);
  }
  const name = document.createElement('strong');
  name.textContent = `${label}:`;
  const content = document.createElement('span');
  content.textContent = value || 'No disponible';
  row.append(name, content);
  if (field) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'metadata-field-copy';
    copy.dataset.metadataCopyField = field;
    copy.textContent = 'Usar';
    copy.disabled = !value;
    row.appendChild(copy);
  }
  details.appendChild(row);
}

export function renderMetadataMatchDetails(card, match) {
  const details = card.querySelector('[data-metadata-details]');
  if (!details) return;
  clearContainerCovers(details);
  details.replaceChildren();

  if (match.coverDataUrl) {
    const image = document.createElement('img');
    image.className = 'metadata-match-cover';
    image.src = match.coverDataUrl;
    image.alt = 'Portada encontrada';
    details.appendChild(image);
    addMetadataDetailRow(details, 'Portada', 'Disponible', 'cover');
  } else if (match.coverError) {
    addMetadataDetailRow(details, 'Portada', 'No se encontró una portada');
  } else if (match.coverLoading) {
    addMetadataDetailRow(details, 'Portada', 'Cargando portada…');
  } else if (match.releaseMbid) {
    addMetadataDetailRow(details, 'Portada', 'Pulsa para cargar portada');
  } else {
    addMetadataDetailRow(details, 'Portada', 'No hay lanzamiento asociado');
  }

  metadataCopyFields.forEach(([field, label]) => {
    addMetadataDetailRow(details, label, match[field] || '', field);
  });
  addMetadataDetailRow(details, 'Recording MBID', match.recordingMbid || '');
  addMetadataDetailRow(details, 'Release MBID', match.releaseMbid || '');
  addMetadataDetailRow(details, 'Grupo del álbum', match.releaseGroup || '');
  addMetadataDetailRow(details, 'País', match.country || '');
  addMetadataDetailRow(details, 'Formato', match.mediaFormat || '');
  addMetadataDetailRow(details, 'Código de barras', match.barcode || '');
  addMetadataDetailRow(details, 'Estado del lanzamiento', match.releaseStatus || '');
  addMetadataDetailRow(details, 'Duración', match.length || '');
  addMetadataDetailRow(details, 'Desambiguación', match.disambiguation || '');

  const applySelected = document.createElement('button');
  applySelected.type = 'button';
  applySelected.className = 'btn-pill-save metadata-match-copy-selected';
  applySelected.dataset.metadataCopySelected = '';
  applySelected.textContent = 'Usar seleccionados';
  details.appendChild(applySelected);
}

export async function loadMetadataMatchCover(card, match) {
  if (!match.releaseMbid || match.coverDataUrl || match.coverLoading || !window.__TAURI__?.core?.invoke) return;
  match.coverLoading = true;
  renderMetadataMatchDetails(card, match);
  try {
    match.coverDataUrl = await window.__TAURI__.core.invoke('fetch_cover_art', {
      releaseMbid: match.releaseMbid
    });
  } catch (error) {
    console.warn('No se pudo cargar la portada de Cover Art Archive:', error);
    match.coverError = true;
  } finally {
    match.coverLoading = false;
    renderMetadataMatchDetails(card, match);
  }
}

function setMetadataTextSearchStatus(message, isError = false) {
  if (!metadataTextSearchStatus) return;
  metadataTextSearchStatus.textContent = message;
  metadataTextSearchStatus.classList.toggle('is-error', isError);
}

function openMetadataTextSearch(song) {
  if (!song || !metadataTextSearchModal) return;
  metadataTextSearchSong = song;
  metadataTextSearchContext.textContent = `Buscar metadata para: ${song.title || 'Sin título'} — ${song.artist || 'Desconocido'}`;
  metadataSearchTitle.value = song.title || '';
  metadataSearchArtist.value = song.artist === 'Desconocido' ? '' : (song.artist || '');
  metadataSearchAlbum.value = song.album || '';
  metadataSearchSubmit.disabled = false;
  setMetadataTextSearchStatus('');
  metadataTextSearchModal.classList.add('open');
}

export function closeMetadataTextSearch() {
  metadataTextSearchModal?.classList.remove('open');
  metadataTextSearchSong = null;
}

export async function searchMetadataByText(title, artist, album, { allowFallback = false } = {}) {
  const targetSong = metadataTextSearchSong || uiVars.songDetailsTarget;
  const isFallbackSearch = Boolean(metadataTextSearchSong);
  if (!targetSong || !window.__TAURI__?.core?.invoke) {
    throw new Error('La búsqueda en línea está disponible en la aplicación de escritorio.');
  }
  const normalizedTitle = title.trim();
  const normalizedArtist = artist.trim();
  if (!normalizedTitle || !normalizedArtist) {
    if (allowFallback) {
      openMetadataTextSearch(targetSong);
      setMetadataTextSearchStatus('Completa el título y el artista para buscar.', true);
    } else {
      setMetadataTextSearchStatus('Escribe el título y el artista para buscar.', true);
    }
    return;
  }
  metadataSearchSubmit.disabled = true;
  setMetadataTextSearchStatus('Consultando MusicBrainz…');
  try {
    const matches = await window.__TAURI__.core.invoke('fetch_metadata_by_text', {
      title: normalizedTitle,
      artist: normalizedArtist,
      album: album.trim()
    });
    if (!songDetailsModal.classList.contains('open')) return;
    if (isFallbackSearch && !metadataTextSearchModal.classList.contains('open')) return;
    if (metadataTextSearchSong && metadataTextSearchSong.id !== targetSong.id) return;
    if (uiVars.songDetailsTarget?.id !== targetSong.id) return;
    if (!Array.isArray(matches) || matches.length === 0) {
      if (allowFallback) {
        closeMetadataTextSearch();
        openMetadataTextSearch(targetSong);
      } else {
        setMetadataTextSearchStatus('No se encontraron coincidencias. Prueba con otro título, artista o álbum.', true);
      }
      return;
    }
    closeMetadataTextSearch();
    trackMetadataSearchStatus.textContent = '';
    renderMetadataMatches(matches);
  } catch (error) {
    console.error('No se pudo buscar metadata en MusicBrainz:', error);
    if (allowFallback) {
      openMetadataTextSearch(targetSong);
      setMetadataTextSearchStatus(`No se pudo consultar la base de datos: ${String(error?.message || error)}`, true);
    } else {
      setMetadataTextSearchStatus(`No se pudo buscar: ${String(error?.message || error)}`, true);
    }
  } finally {
    if (metadataSearchSubmit) metadataSearchSubmit.disabled = false;
  }
}

export async function searchTrackMetadata(method) {
  if (!uiVars.songDetailsTarget || !btnFetchTrackMetadata) return;
  const targetSong = uiVars.songDetailsTarget;
  trackMetadataSearchMenu.hidden = true;
  btnFetchTrackMetadata.setAttribute('aria-expanded', 'false');
  btnFetchTrackMetadata.disabled = true;
  const isFingerprint = method === 'fingerprint';
  trackMetadataSearchStatus.textContent = isFingerprint
    ? 'Analizando audio…'
    : 'Consultando base de datos…';
  try {
    if (!window.__TAURI__?.core?.invoke) {
      throw new Error('La búsqueda en línea está disponible en la aplicación de escritorio.');
    }
    let matches;
    if (isFingerprint) {
      const filePath = targetSong.file?.path;
      if (!filePath) throw new Error('No se encontró la ruta local necesaria para analizar esta pista.');
      matches = await window.__TAURI__.core.invoke('fetch_metadata_by_fingerprint', { filePath });
    } else {
      await searchMetadataByText(
        targetSong.title || '',
        targetSong.artist === 'Desconocido' ? '' : (targetSong.artist || ''),
        targetSong.album || '',
        { allowFallback: true }
      );
      return;
    }
    if (uiVars.songDetailsTarget?.id !== targetSong.id) return;
    if (!Array.isArray(matches) || matches.length === 0) {
      trackMetadataSearchStatus.textContent = '';
      await showConfirmDialog({
        title: 'Sin coincidencias',
        message: 'No se encontraron coincidencias para esta pista.',
        confirmText: 'Entendido',
        showCancel: false
      });
      return;
    }
    trackMetadataSearchStatus.textContent = '';
    renderMetadataMatches(matches);
  } catch (error) {
    console.error('No se pudo buscar metadata de la pista:', error);
    trackMetadataSearchStatus.textContent = '';
    await showConfirmDialog({
      title: 'Error al buscar metadata',
      message: String(error?.message || error),
      confirmText: 'Entendido',
      showCancel: false
    });
  } finally {
    btnFetchTrackMetadata.disabled = false;
  }
}

export async function applyMetadataMatch(index, selectedFields = null) {
  const match = trackMetadataMatches[index];
  if (!match || !uiVars.songDetailsTarget) return;
  const song = uiVars.songDetailsTarget;
  const fields = selectedFields || metadataCopyFields
    .filter(([field]) => Boolean(match[field]))
    .map(([field]) => field)
    .concat(match.releaseMbid ? ['cover'] : []);
  metadataApplying = true;
  metadataMatchList?.querySelectorAll('button').forEach(button => {
    button.disabled = true;
  });
  if (metadataMatchClose) metadataMatchClose.disabled = true;
  let coverDataUrl = null;
  if (fields.includes('cover') && match.releaseMbid && window.__TAURI__?.core?.invoke) {
    try {
      coverDataUrl = match.coverDataUrl || await window.__TAURI__.core.invoke(
        'fetch_cover_art',
        { releaseMbid: match.releaseMbid }
      );
    } catch (error) {
      console.warn('No se pudo cargar la portada de Cover Art Archive:', error);
    }
  }
  metadataApplying = false;
  if (metadataMatchClose) metadataMatchClose.disabled = false;
  closeMetadataMatchModal();
  songDetailsModal.classList.remove('open');
  openTrackEditor(song, {
    title: match.title,
    artist: match.artist,
    album: match.album,
    date: match.date,
    trackNumber: match.trackNumber,
    discNumber: match.discNumber,
    genre: match.genre,
    coverDataUrl,
    selectedFields: fields
  });
}
