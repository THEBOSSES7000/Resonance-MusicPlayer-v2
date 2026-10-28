// Letras · Búsqueda multi-proveedor (LRCLib, LyricsPlus, Deezer…) y aplicación a la canción.
// Proveedores inspirados en MusicResync (sin keys frágiles).

import { escapeHtml, formatDuration, isTauri } from './utils.js';
import { formatTime, getSongByIdOrPath, state } from '../state.js';
import { getPlaybackDuration } from '../audioPlayer.js';
import { ensureMetadataForTarget, getUi } from './uiBridge.js';
import { parseLyricsText } from '../scanner.js';
import { invalidateLyricsTranslationCache } from './translation.js';
import { PROVIDERS, PROVIDER_MAP, searchAllProviders } from './providers.js';

export let lyricsTargetSong = null;
export let lyricsResults = [];

/** Type filter: 'all' | 'synced' | 'plain' */
let lyricsSearchFilter = 'all';
/** Provider filter: 'all' | provider id */
let lyricsProviderFilter = 'all';

let lyricsSearching = false;

export function rawLyricsOf(song) {
  if (!song?.lyrics?.lines?.length) return '';
  if (song.lyrics.isSynced) {
    return song.lyrics.lines.map(line => {
      if (line.time === null || line.time === undefined || Number.isNaN(line.time)) return line.text;
      const m = Math.floor(line.time / 60);
      const s = Math.floor(line.time % 60);
      const ms = Math.floor((line.time % 1) * 100);
      return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}]${line.text ? ' ' + line.text : ''}`;
    }).join('\n');
  }
  return song.lyrics.lines.join('\n');
}

export function setLyricsStatus(message, isError = false) {
  const el = document.getElementById('lyrics-search-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', isError);
  el.style.display = message ? 'block' : 'none';
}

function matchesFilters(item) {
  // Type filter
  if (lyricsSearchFilter === 'synced' && !item.syncedLyrics) return false;
  if (lyricsSearchFilter === 'plain' && item.syncedLyrics) return false;
  // Provider filter
  if (lyricsProviderFilter !== 'all' && item.provider !== lyricsProviderFilter) return false;
  return true;
}

function renderLyricsResults() {
  const list = document.getElementById('lyrics-search-results');
  const count = document.getElementById('lyrics-search-count');
  if (!list) return;

  const filteredResults = lyricsResults
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesFilters(item));

  if (count) {
    count.textContent = lyricsResults.length
      ? `${filteredResults.length} de ${lyricsResults.length} resultado(s)`
      : '';
  }

  // Highlight active type filter buttons
  document.querySelectorAll('[data-lyrics-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.lyricsFilter === lyricsSearchFilter));
  });
  // Highlight active provider filter buttons
  document.querySelectorAll('[data-lyrics-provider]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.lyricsProvider === lyricsProviderFilter));
  });

  list.replaceChildren();

  if (!lyricsResults.length) {
    list.innerHTML = '<div class="lyrics-result-empty">Sin resultados. Ajusta el título/artista y vuelve a buscar.</div>';
    return;
  }
  if (!filteredResults.length) {
    list.innerHTML = '<div class="lyrics-result-empty">No hay resultados para este filtro.</div>';
    return;
  }

  filteredResults.forEach(({ item, index }) => {
    const card = document.createElement('div');
    card.className = 'lyrics-result-card';
    const synced = Boolean(item.syncedLyrics);
    const title = escapeHtml(item.trackName || 'Sin título');
    const artist = escapeHtml(item.artistName || 'Desconocido');
    const album = item.albumName ? ' • ' + escapeHtml(item.albumName) : '';
    const providerLabel = escapeHtml(item.providerLabel || item.provider || '');
    card.innerHTML =
      '<div class="lyrics-result-main">' +
        '<strong>' + title + '</strong>' +
        '<span>' + artist + album + '</span>' +
        '<div class="lyrics-result-meta">' +
          '<span class="lyrics-result-duration"><i class="ph ph-clock"></i> ' + formatDuration(item.duration) + '</span>' +
          (synced
            ? '<span class="lyrics-badge-synced"><i class="ph ph-waveform"></i> Sincronizada</span>'
            : '<span class="lyrics-badge-plain">Texto plano</span>') +
          (providerLabel
            ? '<span class="lyrics-badge-provider">' + providerLabel + '</span>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="lyrics-result-actions">' +
        '<button type="button" class="btn-icon" data-action="copy" data-index="' + index + '" title="Copiar letra"><i class="ph ph-copy"></i></button>' +
        '<button type="button" class="btn-pill-save" data-action="apply" data-index="' + index + '">Aplicar</button>' +
      '</div>';
    list.appendChild(card);
  });
}

function renderLyricsResultsPending() {
  const list = document.getElementById('lyrics-search-results');
  if (list) list.innerHTML = '<div class="lyrics-result-empty">Buscando en varios proveedores…</div>';
}

/** Update the two independent filter labels. */
function updateFilterLabel() {
  const typeLabels = {
    all: 'Todas las letras',
    synced: 'Solo sincronizadas',
    plain: 'Solo planas',
  };
  const typeEl = document.getElementById('lyrics-search-filter-label');
  if (typeEl) typeEl.textContent = typeLabels[lyricsSearchFilter] || 'Todas las letras';

  const provEl = document.getElementById('lyrics-search-provider-label');
  if (provEl) {
    if (lyricsProviderFilter === 'all') {
      provEl.textContent = 'Todos los proveedores';
    } else {
      const p = PROVIDER_MAP[lyricsProviderFilter];
      provEl.textContent = p?.label || lyricsProviderFilter;
    }
  }
}

function closeAllFilterMenus() {
  const pairs = [
    ['lyrics-search-filter-menu', 'lyrics-search-filter-toggle'],
    ['lyrics-search-provider-menu', 'lyrics-search-provider-toggle'],
  ];
  for (const [menuId, toggleId] of pairs) {
    const menu = document.getElementById(menuId);
    const toggle = document.getElementById(toggleId);
    if (menu) menu.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
  }
}

export function setLyricsSearchFilter(filter) {
  const options = { all: true, synced: true, plain: true };
  if (!Object.prototype.hasOwnProperty.call(options, filter)) return;
  lyricsSearchFilter = filter;
  updateFilterLabel();
  closeAllFilterMenus();
  renderLyricsResults();
}

export function setLyricsProviderFilter(providerId) {
  if (providerId !== 'all' && !PROVIDER_MAP[providerId]) return;
  lyricsProviderFilter = providerId;
  updateFilterLabel();
  closeAllFilterMenus();
  renderLyricsResults();
}

export function getLyricsTarget() {
  if (lyricsTargetSong) return lyricsTargetSong;
  return state.currentTrackIndex !== -1 ? state.activeQueue[state.currentTrackIndex] : null;
}

function updateLyricsSearchSongInfo(song) {
  const contextEl = document.getElementById('lyrics-search-context');
  const durationEl = document.getElementById('lyrics-search-duration');
  if (contextEl) {
    contextEl.textContent = 'Aplicar a: ' + (song.title || 'Sin título') + ' — ' + (song.artist || 'Desconocido');
  }
  const isCurrentTrack = state.currentTrackIndex !== -1 &&
    state.activeQueue[state.currentTrackIndex]?.id === song.id;
  const liveDuration = isCurrentTrack ? getPlaybackDuration() : 0;
  const duration = Number.isFinite(song.duration) && song.duration > 0
    ? song.duration
    : liveDuration > 0
      ? liveDuration
      : 0;
  if (durationEl) durationEl.textContent = duration > 0 ? formatTime(duration) : 'No disponible';
}

export function openLyricsSearch(song = null) {
  lyricsTargetSong = song || getLyricsTarget();
  if (!lyricsTargetSong) {
    void getUi().then(ui => ui.showConfirmDialog({
      title: 'Sin canción',
      message: 'Reproduce o selecciona una canción primero.',
      confirmText: 'Entendido',
      showCancel: false,
    }));
    return;
  }
  const targetSong = lyricsTargetSong;
  updateLyricsSearchSongInfo(targetSong);
  void ensureMetadataForTarget(targetSong).then(() => {
    if (lyricsTargetSong !== targetSong ||
        !document.getElementById('lyrics-search-modal')?.classList.contains('open')) return;
    const titleInput = document.getElementById('lyrics-search-title');
    const artistInput = document.getElementById('lyrics-search-artist');
    if (titleInput && !titleInput.value.trim()) titleInput.value = targetSong.title || '';
    if (artistInput && !artistInput.value.trim() && targetSong.artist && targetSong.artist !== 'Desconocido') {
      artistInput.value = targetSong.artist;
    }
    updateLyricsSearchSongInfo(targetSong);
  });
  lyricsResults = [];
  const titleInput = document.getElementById('lyrics-search-title');
  const artistInput = document.getElementById('lyrics-search-artist');
  if (titleInput) titleInput.value = targetSong.title || '';
  if (artistInput) {
    artistInput.value = (targetSong.artist && targetSong.artist !== 'Desconocido') ? targetSong.artist : '';
  }
  setLyricsStatus('');
  renderLyricsResults();
  updateFilterLabel();

  const modal = document.getElementById('lyrics-search-modal');
  if (modal) modal.classList.add('open');
}

export function closeLyricsSearch() {
  const modal = document.getElementById('lyrics-search-modal');
  if (modal) modal.classList.remove('open');
  lyricsTargetSong = null;
  lyricsResults = [];
  document.getElementById('lyrics-search-results')?.replaceChildren();
}

export async function searchLyricsNow() {
  const titleInput = document.getElementById('lyrics-search-title');
  const artistInput = document.getElementById('lyrics-search-artist');
  const title = titleInput?.value.trim() || '';
  const artist = artistInput?.value.trim() || '';
  if (!title || !artist) {
    setLyricsStatus('Escribe título y artista para buscar.', true);
    return;
  }
  if (lyricsSearching) return;
  lyricsSearching = true;

  // Determine which providers to query
  const providerIds = lyricsProviderFilter === 'all' ? 'all' : [lyricsProviderFilter];
  const providerNames = providerIds === 'all'
    ? PROVIDERS.map(p => p.label).join(', ')
    : (PROVIDER_MAP[lyricsProviderFilter]?.label || lyricsProviderFilter);

  setLyricsStatus('Buscando en ' + providerNames + '…');
  renderLyricsResultsPending();

  // Duration hint for providers that use it
  let durationSec = 0;
  if (lyricsTargetSong) {
    const isCurrent = state.currentTrackIndex !== -1 &&
      state.activeQueue[state.currentTrackIndex]?.id === lyricsTargetSong.id;
    durationSec = Number.isFinite(lyricsTargetSong.duration) && lyricsTargetSong.duration > 0
      ? lyricsTargetSong.duration
      : (isCurrent ? getPlaybackDuration() : 0);
  }

  try {
    const results = await searchAllProviders(
      { title, artist, durationSec },
      providerIds
    );
    lyricsResults = results;
    setLyricsStatus(
      lyricsResults.length
        ? ''
        : 'Sin resultados en los proveedores seleccionados para esa búsqueda.'
    );
    renderLyricsResults();
  } catch (error) {
    console.error('Error buscando letras:', error);
    setLyricsStatus('No se pudo buscar: ' + (error?.message || error), true);
    lyricsResults = [];
    renderLyricsResults();
  } finally {
    lyricsSearching = false;
  }
}

export async function applyLyricsToSong(song, rawLyrics, sourceLabel = 'LRCLIB') {
  if (!song || !rawLyrics?.trim()) return false;
  const ui = await getUi();
  const proceed = await ui.showConfirmDialog({
    title: '¿Aplicar letra a la pista?',
    message: 'Se reemplazará la letra actual de "' + song.title + '" con la letra de ' + sourceLabel + '.',
    confirmText: 'Aplicar',
    cancelText: 'Cancelar',
  });
  if (!proceed) return false;
  const parsed = parseLyricsText(rawLyrics);
  if (!parsed) {
    await ui.showConfirmDialog({
      title: 'Letra vacía',
      message: 'La letra recibida no tiene contenido válido.',
      confirmText: 'Entendido',
      showCancel: false,
    });
    return false;
  }
  song.lyrics = parsed;
  song.lyricsLoaded = true;
  invalidateLyricsTranslationCache(song);
  song.metadataLoaded = true;

  // Sincronizar en la copia canónica de la biblioteca si `song` era otra referencia
  const canonical = getSongByIdOrPath(song.file?.path || song.path || song.id);
  if (canonical && canonical !== song) {
    canonical.lyrics = parsed;
    canonical.lyricsLoaded = true;
    canonical.metadataLoaded = true;
  }

  const filePath = song.file?.path;
  if (isTauri() && filePath) {
    try {
      await window.__TAURI__.core.invoke('update_track_tags', {
        update: { path: filePath, lyrics: rawLyrics, removeCover: false },
      });
    } catch (error) {
      console.error('No se pudo guardar la letra en disco:', error);
      await ui.showConfirmDialog({
        title: 'Letra aplicada solo en sesión',
        message: 'La letra se muestra ahora, pero no se pudo escribir en el archivo: ' + error,
        confirmText: 'Entendido',
        showCancel: false,
      });
    }
  } else if (!isTauri()) {
    try {
      localStorage.setItem('pn_lyrics_override_' + song.title + ':::' + song.artist, rawLyrics);
    } catch { /* ignore */ }
  }
  ui.updateLyricsUI();
  if (state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]?.id === song.id) {
    const btnLyrics = document.getElementById('btn-lyrics');
    if (btnLyrics) btnLyrics.style.display = 'flex';
  }
  window.dispatchEvent(new Event('pn-save-library-cache'));
  return true;
}

/** Wire click handlers for apply / copy on result cards (call once at init). */
export function bindLyricsResultActions() {
  const list = document.getElementById('lyrics-search-results');
  if (!list || list.dataset.bound) return;
  list.dataset.bound = '1';
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const item = lyricsResults[index];
    if (!item) return;
    const raw = item.syncedLyrics || item.plainLyrics || '';
    if (btn.dataset.action === 'copy') {
      try {
        await navigator.clipboard.writeText(raw);
        setLyricsStatus('Letra copiada al portapapeles.');
      } catch {
        setLyricsStatus('No se pudo copiar.', true);
      }
      return;
    }
    if (btn.dataset.action === 'apply') {
      const song = lyricsTargetSong || getLyricsTarget();
      if (!song) return;
      const source = item.providerLabel || item.provider || 'proveedor';
      const ok = await applyLyricsToSong(song, raw, source);
      if (ok) closeLyricsSearch();
    }
  });
}
