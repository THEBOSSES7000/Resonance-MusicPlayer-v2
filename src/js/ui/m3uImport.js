// UI · Importación de listas M3U y resolución de canciones faltantes.

import { resolveSongRef, state } from '../state.js';
import { showConfirmDialog } from './uiUtils.js';
import { rescanConfiguredMusic } from '../scanner.js';

export function parseM3UContent(text) {
  return parseM3UEntries(text).map(entry => {
    const ranked = rankM3UCandidates(entry);
    const best = ranked[0];
    return best && isConfidentM3UMatch(entry, ranked) ? best.song : null;
  }).filter(Boolean);
}

function normalizeM3UText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pathBasename(path) {
  return String(path || '').replace(/\\/g, '/').split('/').pop() || '';
}

/** Quita prefijo de número de pista: "01 - ", "1-01 - ", "303 - ", etc. */
function stripTrackNumberPrefix(text) {
  return String(text || '')
    .replace(/^\s*\d{1,3}(?:[._-]\d{1,3})?\s*[-–—.)]\s*/, '')
    .replace(/^\s*\d{1,3}(?:[._-]\d{1,3})?\s+/, '')
    .trim();
}

/** Separa "Artista - Título" de un texto (nombre de archivo o EXTINF). */
function splitArtistTitleText(text) {
  let raw = String(text || '')
    .replace(/\.[^.]+$/, '')
    .trim();
  if (!raw) return null;

  // Evitar que "1-01 - Lifelight" o "303 - Artist - Title" tome el número como artista
  raw = stripTrackNumberPrefix(raw);
  if (!raw) return null;

  const spaced = raw.match(/^(.+?)\s+[-–—|~]+\s+(.+)$/);
  if (spaced) {
    const left = spaced[1].trim();
    const right = spaced[2].trim();
    if (left && right) {
      // Si el lado izquierdo sigue siendo solo número, no usarlo como artista
      if (/^\d{1,4}$/.test(left)) {
        return { artist: '', title: right };
      }
      return { artist: left, title: right };
    }
  }
  return null;
}

function formatTitleArtistLabel(title, artist) {
  const t = String(title || '').trim();
  let a = String(artist || '').trim();
  if (a === 'Desconocido') a = '';
  if (t && a) return `${t} — ${a}`;
  if (t) return t;
  if (a) return a;
  return '';
}

export function parseM3UEntries(text) {
  const entries = [];
  let currentExtInf = null;
  String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#EXTINF:')) {
      const comma = trimmed.indexOf(',');
      if (comma < 0) return;
      const duration = Number(trimmed.slice(8, comma));
      const displayName = trimmed.slice(comma + 1).trim();
      const split = splitArtistTitleText(displayName);
      currentExtInf = {
        duration: Number.isFinite(duration) ? duration : 0,
        displayName,
        // Convención M3U habitual: "Artista - Título"
        artist: split?.artist || '',
        title: split?.title || displayName
      };
      return;
    }
    if (trimmed.startsWith('#')) return;
    const sourcePath = trimmed.replace(/^file:\/\//i, '').replace(/\//g, '\\');
    const filename = pathBasename(trimmed);
    const fallbackTitle = filename.replace(/\.[^.]+$/, '');
    entries.push({
      sourcePath,
      filename,
      duration: currentExtInf?.duration || 0,
      artist: currentExtInf?.artist || '',
      title: currentExtInf?.title || fallbackTitle,
      displayName: currentExtInf?.displayName || fallbackTitle
    });
    currentExtInf = null;
  });
  return entries;
}

/** Puntuación 0–100 de similitud para sugerencias M3U / archivos sueltos. */
function scoreM3UCandidate(entry, song) {
  const filename = normalizeM3UText(pathBasename(entry.filename || entry.sourcePath || ''));
  const normalizedTitle = normalizeM3UText(entry.title);
  const title = normalizedTitle;
  const artist = normalizeM3UText(entry.artist);
  const songFilename = normalizeM3UText(
    pathBasename(song.file?.name || song.file?.path || song.path || '')
  );
  const songTitle = normalizeM3UText(song.title);
  const songArtist = normalizeM3UText(song.artist);
  let score = 0;
  const filenameMatch = Boolean(filename && songFilename && filename === songFilename);
  if (filenameMatch) score += 50;
  else if (filename && songFilename && (filename.includes(songFilename) || songFilename.includes(filename))) {
    score += 22;
  }
  if (title && title === songTitle) score += 30;
  else if (title && songTitle && (title.includes(songTitle) || songTitle.includes(title))) score += 14;
  if (artist && artist === songArtist) score += 15;
  else if (artist && songArtist && (artist.includes(songArtist) || songArtist.includes(artist))) score += 7;
  if (entry.duration > 0 && song.duration > 0) {
    const difference = Math.abs(entry.duration - song.duration);
    if (difference <= 2) score += 5;
    else if (difference <= 5) score += 3;
  }
  return {
    song,
    score: Math.min(100, score),
    filenameMatch
  };
}

export function rankM3UCandidates(entry) {
  return state.localMusicFiles
    .map(song => scoreM3UCandidate(entry, song))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
}

/** Etiqueta legible del grado de compatibilidad (0–100). */
function compatibilityFromScore(score) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (value >= 90) return { level: 'identical', label: 'Idéntico', percent: value };
  if (value >= 72) return { level: 'near', label: 'Casi idéntico', percent: value };
  if (value >= 48) return { level: 'similar', label: 'Similar', percent: value };
  if (value >= 28) return { level: 'possible', label: 'Posible', percent: value };
  if (value > 0) return { level: 'low', label: 'Bajo', percent: value };
  return { level: 'none', label: '—', percent: 0 };
}

export function isConfidentM3UMatch(entry, ranked) {
  const [best, second] = ranked;
  if (!best || best.score < 45) return false;
  const titleMatches = normalizeM3UText(entry.title) === normalizeM3UText(best.song.title);
  const artistMatches = Boolean(entry.artist) &&
    normalizeM3UText(entry.artist) === normalizeM3UText(best.song.artist);
  const gapOk = !second || best.score - second.score >= 10;
  if (best.filenameMatch && (titleMatches || artistMatches || !entry.title) && gapOk) return true;
  return titleMatches && artistMatches && gapOk;
}

function rankM3UMetadataCandidates(entry) {
  const title = normalizeM3UText(entry.title);
  const artist = normalizeM3UText(entry.artist);
  if (!title && !artist) return [];
  return state.localMusicFiles.map(song => {
    const songTitle = normalizeM3UText(song.title);
    const songArtist = normalizeM3UText(song.artist);
    let score = 0;
    if (title && title === songTitle) score += 100;
    else if (title && songTitle && (title.includes(songTitle) || songTitle.includes(title))) score += 45;
    if (artist && artist === songArtist) score += 60;
    else if (artist && songArtist && (artist.includes(songArtist) || songArtist.includes(artist))) score += 25;
    if (entry.duration > 0 && song.duration > 0) {
      const difference = Math.abs(entry.duration - song.duration);
      if (difference <= 2) score += 20;
      else if (difference <= 5) score += 10;
    }
    return { song, score };
  }).filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
}

function isConfidentMetadataMatch(entry, ranked) {
  const [best, second] = ranked;
  if (!best || best.score < 100) return false;
  const titleMatches = normalizeM3UText(entry.title) === normalizeM3UText(best.song.title);
  const artistMatches = Boolean(entry.artist) &&
    normalizeM3UText(entry.artist) === normalizeM3UText(best.song.artist);
  if (!titleMatches || (entry.artist && !artistMatches)) return false;
  if (!second || best.score - second.score >= 20) return true;
  return !entry.artist && entry.duration > 0 &&
    Math.abs(entry.duration - best.song.duration) <= 2 &&
    Math.abs(entry.duration - second.song.duration) > 2;
}

export function createUnresolvedM3USong(entry) {
  const baseName = pathBasename(entry.filename || entry.sourcePath || '').trim();
  const pathSplit = splitArtistTitleText(baseName);
  let title = (entry.title || '').trim();
  let artist = (entry.artist || '').trim();
  // EXTINF a veces viene vacío; inferir desde el archivo "Artista - Título"
  if (pathSplit) {
    if (!artist) artist = pathSplit.artist;
    if (!title || title === baseName.replace(/\.[^.]+$/, '') || title === entry.displayName) {
      title = pathSplit.title;
    }
    // Si title/artist están invertidos respecto al path, corregir
    if (title === pathSplit.artist && artist === pathSplit.title) {
      title = pathSplit.title;
      artist = pathSplit.artist;
    }
  }
  if (!title) {
    const fromDisplay = splitArtistTitleText(entry.displayName || '');
    if (fromDisplay) {
      title = fromDisplay.title;
      if (!artist) artist = fromDisplay.artist;
    } else {
      title = entry.displayName || baseName.replace(/\.[^.]+$/, '') || pathBasename(entry.filename);
    }
  }
  if (!artist) artist = 'Desconocido';
  return {
    id: `m3u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    artist,
    album: '',
    duration: entry.duration || 0,
    file: {
      name: pathBasename(entry.filename || entry.sourcePath || ''),
      path: entry.sourcePath || '',
      isUnresolvedM3U: true
    },
    isUnresolvedM3U: true
  };
}

function isLinkedToLocalLibrary(song) {
  if (!song || song.isUnresolvedM3U) return false;
  if (song.id !== undefined && song.id !== null && state.songsById?.has?.(String(song.id))) {
    return true;
  }
  const songPath = String(song.file?.path || song.file?.webkitRelativePath || '')
    .replace(/\//g, '/').toLocaleLowerCase();
  if (songPath && state.songsById?.has?.(songPath)) return true;
  return state.localMusicFiles.some(localSong => {
    if (song.id !== undefined && song.id !== null && localSong.id === song.id) return true;
    const localPath = String(localSong.file?.path || localSong.file?.webkitRelativePath || '')
      .replace(/\\/g, '/').toLocaleLowerCase();
    return Boolean(songPath && songPath === localPath);
  });
}

function rankSongCandidates(song) {
  return rankM3UCandidates({
    filename: song?.file?.name || pathBasename(song?.file?.path),
    title: song?.title || '',
    artist: song?.artist === 'Desconocido' ? '' : song?.artist || '',
    duration: song?.duration || 0
  });
}

export function openMissingSongsResolver(sourceSongs, onApply, showCompleteMessage = true) {
  const workingSongs = [...sourceSongs];
  const reviewItems = [];

  workingSongs.forEach((song, index) => {
    if (!song?.isUnresolvedM3U && isLinkedToLocalLibrary(song)) return;
    const entry = {
      filename: song?.file?.name || pathBasename(song?.file?.path),
      sourcePath: song?.file?.path || '',
      title: song?.title || '',
      artist: song?.artist === 'Desconocido' ? '' : song?.artist || '',
      duration: song?.duration || 0
    };
    const ranked = rankSongCandidates(song);
    reviewItems.push({
      index,
      song,
      entry,
      ranked,
      suggestion: ranked[0]?.score >= 28 ? ranked[0] : null,
      selected: false
    });
  });

  if (!reviewItems.length) {
    onApply(workingSongs);
    if (showCompleteMessage) {
      void showConfirmDialog({
        title: 'Búsqueda completada',
        message: 'No se encontraron canciones sin ubicar en esta playlist.',
        confirmText: 'Aceptar',
        showCancel: false
      });
    }
    return;
  }

  const modal = document.getElementById('missing-songs-modal');
  const list = document.getElementById('missing-songs-list');
  const description = document.getElementById('missing-songs-description');
  const applyButton = document.getElementById('missing-songs-apply');
  const cancelButton = document.getElementById('missing-songs-cancel');
  const closeButton = document.getElementById('missing-songs-close');
  const autoFindButton = document.getElementById('missing-songs-auto-find');
  const autoFindStatus = document.getElementById('missing-songs-auto-status');
  const selectAllCheckbox = document.getElementById('missing-songs-select-all');
  if (!modal || !list || !description || !applyButton || !cancelButton || !closeButton ||
      !autoFindButton || !autoFindStatus) return;

  const formatSuggestionLabel = song => {
    if (!song) return '';
    const title = song.title || song.file?.name || 'Sin título';
    const artist = song.artist || 'Desconocido';
    return `${title} — ${artist}`;
  };

  const orphanPathLabel = song => {
    let path = song?.file?.path || song?.file?.name || '';
    if (!path) return 'Referencia sin ruta en disco';
    // Prefijo extendido de Windows (\?\C:\...) que se veía como "?C:\..."
    path = String(path)
      .replace(/^\\\\\?\\/, '')
      .replace(/^\/\/\?\//, '')
      .replace(/^file:\/\//i, '');
    return path;
  };

  const orphanTrackLabel = song => {
    // Siempre: Título — Artista (como "Reemplazo sugerido")
    let pathRaw = String(song?.file?.path || song?.file?.name || '')
      .replace(/^\\\\\?\\/, '')
      .replace(/^\/\/\?\//, '');
    const pathBase = pathBasename(pathRaw).trim();
    const pathSplit = splitArtistTitleText(pathBase);

    let title = (song?.title || '').trim();
    let artist = (song?.artist || '').trim();
    if (artist === 'Desconocido') artist = '';

    // Preferir metadatos si ya traen título y artista útiles
    if (title && artist && title !== pathBase.replace(/\.[^.]+$/, '')) {
      // Corregir si están invertidos respecto al path
      if (pathSplit && title === pathSplit.artist && artist === pathSplit.title) {
        return formatTitleArtistLabel(pathSplit.title, pathSplit.artist);
      }
      return formatTitleArtistLabel(title, artist);
    }

    // Path "Artista - Título" (sin número de pista)
    if (pathSplit?.title && pathSplit?.artist) {
      // Si el "artista" del path es solo un número residual, usar solo título + meta artist
      if (/^\d{1,4}$/.test(pathSplit.artist)) {
        return formatTitleArtistLabel(pathSplit.title, artist) || pathSplit.title;
      }
      return formatTitleArtistLabel(pathSplit.title, pathSplit.artist);
    }

    // Título que aún trae "Artista - Título" en un solo campo
    const titleSplit = splitArtistTitleText(title);
    if (titleSplit) {
      return formatTitleArtistLabel(titleSplit.title, titleSplit.artist || artist);
    }

    const formatted = formatTitleArtistLabel(title, artist);
    if (formatted) return formatted;
    const bare = stripTrackNumberPrefix(pathBase.replace(/\.[^.]+$/, ''));
    return bare || pathBase.replace(/\.[^.]+$/, '') || 'Sin título / artista';
  };






  const renderRow = item => {
    const compat = compatibilityFromScore(item.suggestion?.score || 0);
    const tr = document.createElement('tr');
    tr.dataset.index = String(item.index);
    if (item.selected) tr.classList.add('is-selected');
    if (item.suggestion) tr.classList.add('has-suggestion');
    tr.title = 'Doble clic para elegir el reemplazo manualmente';

    const tdCheck = document.createElement('td');
    tdCheck.className = 'missing-col-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.setAttribute('aria-label', `Seleccionar ${orphanTrackLabel(item.song)}`);
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      item.selected = checkbox.checked;
      tr.classList.toggle('is-selected', item.selected);
      syncSelectAllState();
      updateApplyButton();
    });
    tdCheck.appendChild(checkbox);

    const tdOrphan = document.createElement('td');
    tdOrphan.className = 'missing-col-orphan';
    const pathEl = document.createElement('span');
    pathEl.className = 'missing-orphan-path';
    pathEl.textContent = orphanPathLabel(item.song);
    pathEl.title = orphanPathLabel(item.song);
    const metaEl = document.createElement('span');
    const trackLabel = orphanTrackLabel(item.song);
    const hasMeta = trackLabel && trackLabel !== 'Sin título / artista';
    metaEl.className = hasMeta ? 'missing-orphan-meta' : 'missing-orphan-meta missing-orphan-meta-empty';
    metaEl.textContent = trackLabel;
    metaEl.title = trackLabel;
    tdOrphan.append(pathEl, metaEl);

    const tdReplace = document.createElement('td');
    tdReplace.className = 'missing-col-replace';
    const replaceEl = document.createElement('span');
    if (item.suggestion?.song) {
      replaceEl.className = 'missing-replace-text';
      replaceEl.textContent = formatSuggestionLabel(item.suggestion.song);
      replaceEl.title = [
        formatSuggestionLabel(item.suggestion.song),
        item.suggestion.song.file?.path || ''
      ].filter(Boolean).join('\n');
    } else {
      replaceEl.className = 'missing-replace-empty';
      replaceEl.textContent = 'Sin coincidencia';
    }
    tdReplace.appendChild(replaceEl);

    const tdMatch = document.createElement('td');
    tdMatch.className = 'missing-col-match';
    const badge = document.createElement('span');
    badge.className = 'missing-match-badge';
    badge.dataset.level = compat.level;
    badge.textContent = compat.level === 'none'
      ? '—'
      : `${compat.label} (${compat.percent}%)`;
    badge.title = compat.level === 'none'
      ? 'No hay sugerencia en la biblioteca'
      : `Compatibilidad estimada: ${compat.percent}%`;
    tdMatch.appendChild(badge);

    tr.append(tdCheck, tdOrphan, tdReplace, tdMatch);

    const pickManual = async () => {
      autoFindStatus.textContent = 'Seleccioná un archivo de la biblioteca…';
      try {
        const selectedSong = await selectSongFromConfiguredLibrary();
        if (!selectedSong) {
          autoFindStatus.textContent = '';
          return;
        }
        const scored = scoreM3UCandidate(item.entry, selectedSong);
        item.suggestion = scored;
        item.ranked = [scored, ...item.ranked.filter(c => c.song !== selectedSong)];
        item.selected = true;
        const fresh = renderRow(item);
        tr.replaceWith(fresh);
        rowByIndex.set(item.index, fresh);
        syncSelectAllState();
        updateApplyButton();
        autoFindStatus.textContent = `Reemplazo manual: ${formatSuggestionLabel(selectedSong)}`;
      } catch (error) {
        console.error('Reemplazo manual:', error);
        autoFindStatus.textContent = error.message || 'No se pudo seleccionar el archivo.';
      }
    };

    tr.addEventListener('dblclick', event => {
      if (event.target.closest('input[type="checkbox"]')) return;
      void pickManual();
    });

    return tr;
  };

  reviewItems.sort((a, b) => {
    const scoreA = a.suggestion?.score ?? -1;
    const scoreB = b.suggestion?.score ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(orphanPathLabel(a.song)).localeCompare(String(orphanPathLabel(b.song)), 'es');
  });

  const rowByIndex = new Map();
  list.replaceChildren();
  reviewItems.forEach(item => {
    if (item.suggestion && item.suggestion.score >= 48) {
      item.selected = true;
    }
    const tr = renderRow(item);
    list.appendChild(tr);
    rowByIndex.set(item.index, tr);
  });

  const suggestedCount = reviewItems.filter(i => i.suggestion).length;
  description.textContent =
    `${reviewItems.length} archivo(s) suelto(s). ` +
    (suggestedCount
      ? `Se encontraron ${suggestedCount} reemplazo(s) sugerido(s) en la biblioteca. `
      : 'No hubo coincidencias automáticas. ') +
    'Marcá las filas a aplicar. Doble clic en una fila para elegir el reemplazo a mano.';

  const syncSelectAllState = () => {
    if (!selectAllCheckbox) return;
    const n = reviewItems.length;
    const checked = reviewItems.filter(i => i.selected).length;
    selectAllCheckbox.checked = n > 0 && checked === n;
    selectAllCheckbox.indeterminate = checked > 0 && checked < n;
  };

  const updateApplyButton = () => {
    const ready = reviewItems.filter(i => i.selected && i.suggestion?.song).length;
    applyButton.disabled = ready === 0;
    applyButton.title = ready
      ? `Aplicar ${ready} reemplazo(s)`
      : 'Seleccioná al menos una fila con reemplazo sugerido';
  };

  const autoFindSongs = () => {
    let matched = 0;
    reviewItems.forEach(item => {
      const ranked = rankSongCandidates(item.song);
      item.ranked = ranked;
      const best = ranked[0];
      if (best && best.score >= 28) {
        item.suggestion = best;
        if (best.score >= 48) item.selected = true;
        matched++;
      } else {
        item.suggestion = null;
      }
    });
    reviewItems.sort((a, b) => {
      const scoreA = a.suggestion?.score ?? -1;
      const scoreB = b.suggestion?.score ?? -1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(orphanPathLabel(a.song)).localeCompare(String(orphanPathLabel(b.song)), 'es');
    });
    list.replaceChildren();
    rowByIndex.clear();
    reviewItems.forEach(item => {
      const fresh = renderRow(item);
      list.appendChild(fresh);
      rowByIndex.set(item.index, fresh);
    });
    autoFindStatus.textContent = matched
      ? `Búsqueda actualizada: ${matched} coincidencia(s) en la biblioteca.`
      : 'No se encontraron coincidencias en la biblioteca.';
    syncSelectAllState();
    updateApplyButton();
  };

  const cleanup = () => {
    modal.classList.remove('open');
    list.replaceChildren();
    rowByIndex.clear();
    applyButton.removeEventListener('click', applyDecisions);
    autoFindButton.removeEventListener('click', autoFindSongs);
    cancelButton.removeEventListener('click', close);
    closeButton.removeEventListener('click', close);
    modal.removeEventListener('click', onBackdropClick);
    document.removeEventListener('keydown', onKeyDown);
    if (selectAllCheckbox) selectAllCheckbox.onchange = null;
  };
  const close = () => cleanup();
  const applyDecisions = () => {
    let applied = 0;
    reviewItems.forEach(item => {
      if (item.selected && item.suggestion?.song) {
        const matched = item.suggestion.song;
        // Usar la instancia canónica de la biblioteca; quitar flags M3U
        const resolved = resolveSongRef(matched) || matched;
        if (resolved && typeof resolved === 'object') {
          resolved.isUnresolvedM3U = false;
          if (resolved.file) resolved.file.isUnresolvedM3U = false;
        }
        workingSongs[item.index] = resolved;
        applied++;
      }
    });
    cleanup();
    onApply(workingSongs);
    if (showCompleteMessage && applied > 0) {
      void showConfirmDialog({
        title: 'Reemplazos aplicados',
        message: `Se ubicaron ${applied} canción(es) en la playlist.`,
        confirmText: 'Aceptar',
        showCancel: false
      });
    }
  };
  const onBackdropClick = event => { if (event.target === modal) event.stopPropagation(); };
  const onKeyDown = event => {
    if (event.key === 'Escape') close();
  };

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    selectAllCheckbox.onchange = () => {
      const value = selectAllCheckbox.checked;
      reviewItems.forEach(item => {
        item.selected = value;
        const tr = rowByIndex.get(item.index);
        const cb = tr?.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = value;
        tr?.classList.toggle('is-selected', value);
      });
      syncSelectAllState();
      updateApplyButton();
    };
  }

  applyButton.addEventListener('click', applyDecisions);
  autoFindButton.addEventListener('click', autoFindSongs);
  cancelButton.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  modal.addEventListener('click', onBackdropClick);
  document.addEventListener('keydown', onKeyDown);
  syncSelectAllState();
  updateApplyButton();
  autoFindStatus.textContent = suggestedCount
    ? `Búsqueda automática: ${suggestedCount} sugerencia(s). Revisá y aplicá lo seleccionado.`
    : 'Búsqueda automática sin resultados. Usá doble clic o «Buscar…».';
  modal.classList.add('open');
}

async function selectSongFromConfiguredLibrary() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') {
    throw new Error('La selección manual de archivos está disponible desde la aplicación Resonance.');
  }
  const selectedPath = await invoke('select_music_file');
  if (!selectedPath) return null;
  const normalizePath = path => String(path || '').replace(/\//g, '\\').toLocaleLowerCase();
  let selectedSong = state.localMusicFiles.find(song =>
    normalizePath(song.file?.path) === normalizePath(selectedPath)
  );
  if (!selectedSong) {
    await rescanConfiguredMusic();
    selectedSong = state.localMusicFiles.find(song =>
      normalizePath(song.file?.path) === normalizePath(selectedPath)
    );
  }
  if (!selectedSong) {
    throw new Error('El archivo elegido no aparece en la biblioteca. Actualiza el escaneo de las carpetas configuradas e inténtalo de nuevo.');
  }
  return selectedSong;
}
