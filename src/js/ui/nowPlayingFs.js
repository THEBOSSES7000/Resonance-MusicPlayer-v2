// UI · Reproductor en pantalla completa, portada expandida y vista de letras.

import { state } from '../state.js';
import { btnLyrics, customContextMenu, expandedCoverWidget, lyricsOverlay, playerLeftPanel, playerSourceLabel } from './dom.js';
import { getPlaybackPosition, updateTitleMarquee } from '../audioPlayer.js';
import { resumeLyricsAutoScrollAtActiveLine, resyncLyricsScrollForFullscreen, stopLyricsActiveRowAnimation, updateLyricsUI, updateSyncedLyricsProgress } from './lyricsRender.js';
import { applyNpFsVolumeBar, bindLyricsDockControls, clearLyricsChromeHideTimer, clearLyricsFocusModeTimer, revealLyricsChrome, scheduleLyricsFocusMode } from './lyricsDock.js';
import { openPlaylistPicker } from './playlistPicker.js';
import { showSongDetails } from './songDetails.js';
import { renderContextMenu } from './contextMenu.js';
import { closeDiscordRpcContextMenu } from '../discordRpc.js';

let coverExpandedBeforeLyrics = false;

function isSettingsOverlayOpen() {
  return Boolean(
    document.body.classList.contains('settings-overlay-open') ||
    document.getElementById('settings-overlay')?.classList.contains('open')
  );
}

export function toggleExpandedCover(forceState) {
  const requestedState = typeof forceState === 'boolean' ? forceState : !state.isCoverExpanded;
  // En configuración no se puede expandir la carátula (queda oculta detrás del overlay)
  if (requestedState && isSettingsOverlayOpen()) return;
  const newState = requestedState && !state.isLyricsOpen;
  state.isCoverExpanded = newState;

  if (expandedCoverWidget) {
    expandedCoverWidget.classList.toggle('open', state.isCoverExpanded);
  }

  // Permite scrollear accesos directos por encima de la carátula expandida
  document.body.classList.toggle('cover-expanded', state.isCoverExpanded);

  if (playerLeftPanel) {
    playerLeftPanel.classList.toggle('cover-hidden', state.isCoverExpanded);
  }

  setTimeout(() => {
    updateTitleMarquee();
  }, 260);
}

const NP_FS_LAYOUT_KEY = 'pn_now_playing_fs_layout';

export function getNowPlayingFsLayout() {
  try {
    const v = localStorage.getItem(NP_FS_LAYOUT_KEY);
    if (v === 'swapped' || v === 'centered' || v === 'default') return v;
  } catch (_) {}
  return 'default';
}

let npFsLayoutToken = 0;
let npFsLayoutSyncTimer = null;
let npFsLayoutBusy = false;
let npFsLayoutQueued = null;
/** True mientras el dock/letras están ocultos a propósito (no tocar Visual+). */
let npFsContentHidden = false;

function delayMs(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function getCurrentFsLayoutMode() {
  if (document.body.classList.contains('np-fs-centered')) return 'centered';
  if (document.body.classList.contains('np-fs-swapped')) return 'swapped';
  return 'default';
}

function isAudioCrossfadeActive() {
  try {
    const vars = window.__pnAudioVars;
    if (vars && (vars.crossfadeInProgress || vars.crossfadeVisualActive)) return true;
  } catch (_) {}
  return false;
}

function isFsAdaptLyricsEnabled() {
  return localStorage.getItem('pn_now_playing_fs_adapt_lyrics') === 'true';
}

function setFsLayoutClasses(mode) {
  const m = mode === 'swapped' || mode === 'centered' ? mode : 'default';
  document.body.classList.toggle('np-fs-swapped', m === 'swapped');
  document.body.classList.toggle('np-fs-centered', m === 'centered');
}

/** Oculta solo dock + letras (captura, antes de que cambie la carátula). */
function hideFsMovingContent() {
  document.body.classList.remove('np-fs-layout-fade-in');
  document.body.classList.add('np-fs-layout-fade-out');
  npFsContentHidden = true;
}

function showFsMovingContent() {
  document.body.classList.remove('np-fs-layout-fade-out');
  document.body.classList.add('np-fs-layout-fade-in');
  npFsContentHidden = false;
}

function clearFsFadeClasses() {
  document.body.classList.remove('np-fs-layout-fade-out', 'np-fs-layout-fade-in');
  npFsContentHidden = false;
}

/**
 * Cambia el layout: el contenido móvil ya debería estar oculto (o se oculta aquí).
 */
async function transitionNowPlayingFsLayout(mode, { persist = true, alreadyHidden = false } = {}) {
  const m = mode === 'swapped' || mode === 'centered' ? mode : 'default';
  const same = getCurrentFsLayoutMode() === m;

  if (same && !alreadyHidden && !npFsContentHidden) {
    if (persist) {
      try { localStorage.setItem(NP_FS_LAYOUT_KEY, m); } catch (_) {}
    }
    return;
  }

  const token = ++npFsLayoutToken;
  npFsLayoutBusy = true;

  // 1) Ocultar del todo (fade corto)
  if (!alreadyHidden && !npFsContentHidden) {
    hideFsMovingContent();
    await delayMs(320);
  } else {
    // Ya oculto por capture: asegurar que el fade-out terminó
    await delayMs(npFsContentHidden ? 300 : 50);
  }
  if (token !== npFsLayoutToken) return;

  // 2) Cambio de layout + datos mientras INVISIBLE
  setFsLayoutClasses(m);
  if (persist) {
    try { localStorage.setItem(NP_FS_LAYOUT_KEY, m); } catch (_) {}
  }
  try { updateNowPlayingFsHeader(); } catch (_) {}
  try { applyNpFsVolumeBar(); } catch (_) {}
  try { resyncLyricsScrollForFullscreen?.(); } catch (_) {}

  // Dar tiempo a layout/carátula/Visual+ a estabilizar (canvas resize, letras, etc.)
  void document.body.offsetWidth;
  try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  await delayMs(50);
  try { resyncLyricsScrollForFullscreen?.(); } catch (_) {}
  // Hold invisible ~0.85s para que no se vea el “gris” ni el swap a medias
  await delayMs(850);
  if (token !== npFsLayoutToken) return;

  // 3) Fade in más pausado
  showFsMovingContent();
  await delayMs(420);
  if (token !== npFsLayoutToken) return;

  clearFsFadeClasses();
  npFsLayoutBusy = false;

  if (npFsLayoutQueued) {
    const queued = npFsLayoutQueued;
    npFsLayoutQueued = null;
    void transitionNowPlayingFsLayout(queued.mode, {
      persist: queued.persist,
      alreadyHidden: false,
    });
  }
}

function applyNowPlayingFsLayout(mode, { persist = true, animate = true } = {}) {
  const m = mode === 'swapped' || mode === 'centered' ? mode : 'default';
  if (!animate || !document.body.classList.contains('now-playing-fs')) {
    setFsLayoutClasses(m);
    if (persist) {
      try { localStorage.setItem(NP_FS_LAYOUT_KEY, m); } catch (_) {}
    }
    try { applyNpFsVolumeBar(); } catch (_) {}
    if (document.body.classList.contains('now-playing-fs')) {
      requestAnimationFrame(() => resyncLyricsScrollForFullscreen?.());
    }
    return;
  }
  if (npFsLayoutBusy) {
    npFsLayoutQueued = { mode: m, persist };
    return;
  }
  void transitionNowPlayingFsLayout(m, {
    persist,
    alreadyHidden: npFsContentHidden,
  });
}

function trackHasDisplayableLyrics(song) {
  if (!song) return false;
  const lines = song.lyrics?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return false;
  return lines.some(line => String(line?.text || '').trim().length > 0);
}

function resolveAdaptLayoutTarget() {
  const song = state.currentTrackIndex >= 0
    ? state.activeQueue?.[state.currentTrackIndex]
    : null;
  const hasLyrics = trackHasDisplayableLyrics(song);
  let preferred = 'default';
  try {
    const stored = localStorage.getItem(NP_FS_LAYOUT_KEY);
    if (stored === 'swapped' || stored === 'default') preferred = stored;
    else if (stored === 'centered') preferred = 'default';
  } catch (_) {}
  return hasLyrics ? preferred : 'centered';
}

/** Ajusta default/swapped vs centrado según si hay letras (si el switch está activo). */
export function syncNowPlayingFsLayoutForLyrics() {
  if (!document.body.classList.contains('now-playing-fs')) return;
  if (!isFsAdaptLyricsEnabled()) return;

  const run = () => {
    const target = resolveAdaptLayoutTarget();
    applyNowPlayingFsLayout(target, {
      persist: false,
      animate: true,
    });
  };

  if (npFsLayoutSyncTimer) window.clearTimeout(npFsLayoutSyncTimer);
  const wait = isAudioCrossfadeActive() ? 420 : 30;
  npFsLayoutSyncTimer = window.setTimeout(run, wait);
}

/** Capture: ocultar carátula/letras ANTES de que otros handlers cambien la imagen. */
function onTrackChangedHideFsContentFirst() {
  if (!document.body.classList.contains('now-playing-fs')) return;
  if (!isFsAdaptLyricsEnabled()) return;
  // Ocultar de inmediato (aunque el layout final sea el mismo, evita ver el swap de carátula)
  hideFsMovingContent();
  npFsLayoutBusy = true;
  // El sync (bubble) hará el resto y el fade-in
}


export function openNowPlayingFsMoreMenu(anchorEl) {
  const song = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  if (!song) return;

  const layout = getNowPlayingFsLayout();
  const rect = anchorEl?.getBoundingClientRect?.();
  const x = rect ? rect.left : Math.max(16, window.innerWidth * 0.2);
  const y = rect ? rect.bottom + 6 : 80;

  const items = [
    {
      label: layout === 'swapped' ? 'Posición normal (carátula izquierda)' : 'Invertir carátula y letras',
      icon: 'ph ph-arrows-left-right',
      action: () => applyNowPlayingFsLayout(layout === 'swapped' ? 'default' : 'swapped')
    },
    {
      label: layout === 'centered' ? 'Vista dividida (carátula + letras)' : 'Centrar carátula y controles',
      icon: 'ph ph-corners-out',
      action: () => applyNowPlayingFsLayout(layout === 'centered' ? 'default' : 'centered')
    },
    { type: 'separator' },
    {
      label: 'Agregar a playlist',
      icon: 'ph ph-playlist',
      action: () => openPlaylistPicker([song])
    },
    {
      label: 'Ver detalles de la canción',
      icon: 'ph ph-info',
      action: () => { void showSongDetails(song); }
    }
  ];

  renderContextMenu(x, y, items);
}

export function updateNowPlayingFsHeader() {
  const header = document.getElementById('lyrics-focus-nowplaying-header');
  const sourceName = document.getElementById('lyrics-focus-source-name');
  const positionEl = document.getElementById('lyrics-focus-track-position');
  if (!header) return;

  const isFs = document.body.classList.contains('now-playing-fs');
  if (isFs) header.removeAttribute('hidden');
  else header.setAttribute('hidden', '');
  if (!isFs) return;

  let source = 'Reproduciendo';
  const sourceText = playerSourceLabel?.querySelector?.('.player-source-text')?.textContent?.trim();
  if (sourceText) source = sourceText;
  else if (state.activeQueueTitle) source = state.activeQueueTitle;
  else if (state.currentContextTitle) source = state.currentContextTitle;
  else if (typeof state.currentView === 'string' && state.currentView) {
    const map = {
      'all-music': 'Toda la música',
      favorites: 'Favoritos',
      queue: 'Cola de reproducción',
      playlist: 'Playlist',
      folder: 'Carpeta',
      album: 'Álbum',
      artist: 'Artista'
    };
    source = map[state.currentView] || state.currentView;
  }
  if (sourceName) sourceName.textContent = source;

  const total = Array.isArray(state.activeQueue) ? state.activeQueue.length : 0;
  const idx = Number.isFinite(state.currentTrackIndex) ? state.currentTrackIndex : -1;
  const n = idx >= 0 ? idx + 1 : 0;
  if (positionEl) {
    positionEl.textContent = total > 0 && n > 0
      ? `Canción ${n} de ${total}`
      : 'Canción —';
  }
}

export function setNowPlayingFullscreen(enabled) {
  queueMicrotask(() => { try { updateNowPlayingFsAvailability(); } catch (_) {} });
  document.body.classList.toggle('now-playing-fs', Boolean(enabled));
  const btn = document.getElementById('btn-now-playing-fs');
  if (btn) {
    btn.classList.toggle('active-toggle', Boolean(enabled));
    btn.setAttribute('aria-pressed', String(Boolean(enabled)));
  }
  if (enabled) {
    applyNowPlayingFsLayout(getNowPlayingFsLayout());
    try { syncNowPlayingFsLayoutForLyrics(); } catch (_) {}
  } else {
    document.body.classList.remove('np-fs-swapped', 'np-fs-centered', 'np-fs-layout-animating');
  }
  updateNowPlayingFsHeader();
  try { applyNpFsVolumeBar(); } catch (_) {}
}

function hasActivePlaybackTrack() {
  try {
    if (state.currentTrackIndex < 0) return false;
    const track = state.activeQueue?.[state.currentTrackIndex];
    if (!track || track.unavailable) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function openNowPlayingFullscreen() {
  if (!hasActivePlaybackTrack()) return;
  if (isSettingsOverlayOpen()) return;
  setNowPlayingFullscreen(true);
  if (!state.isLyricsOpen) openLyricsView();
  else {
    document.body.classList.remove('lyrics-chrome-hidden');
    revealLyricsChrome?.();
  }
  updateNowPlayingFsHeader();
  try { applyNpFsVolumeBar(); } catch (_) {}
  try { syncNowPlayingFsLayoutForLyrics(); } catch (_) {}
  // Tras el layout de pantalla completa, recolocar letras (evita empezar a mitad)
  requestAnimationFrame(() => {
    updateNowPlayingFsHeader();
    try { syncNowPlayingFsLayoutForLyrics(); } catch (_) {}
    try { applyNpFsVolumeBar(); } catch (_) {}
    resyncLyricsScrollForFullscreen();
    setTimeout(() => {
      try { applyNpFsVolumeBar(); } catch (_) {}
      resyncLyricsScrollForFullscreen();
    }, 80);
    setTimeout(() => resyncLyricsScrollForFullscreen(), 220);
  });
}

export function toggleNowPlayingFullscreen() {
  if (document.body.classList.contains('now-playing-fs') && state.isLyricsOpen) {
    setNowPlayingFullscreen(false);
    closeLyricsView();
    return;
  }
  openNowPlayingFullscreen();
}

export function openLyricsView() {
  if (state.isLyricsOpen) return;
  // Solo en menús principales: en configuración Visual+ no se ve bien
  if (isSettingsOverlayOpen()) return;
  coverExpandedBeforeLyrics = state.isCoverExpanded;
  state.isLyricsOpen = true;
  document.body.classList.remove('lyrics-focus-mode');
  document.body.classList.remove('lyrics-focus-mini-player-enabled');
  document.body.classList.remove('lyrics-chrome-hidden');
  document.body.classList.add('lyrics-overlay-open');
  customContextMenu?.classList.remove('open');
  closeDiscordRpcContextMenu();
  toggleExpandedCover(false);
  lyricsOverlay.classList.add('open');
  btnLyrics.classList.add('active-toggle');
  bindLyricsDockControls();
  updateLyricsUI();
  updateSyncedLyricsProgress(getPlaybackPosition());
  resumeLyricsAutoScrollAtActiveLine();
  revealLyricsChrome();
  scheduleLyricsFocusMode();
}

export function showLyricsCompactPlayerImmediately() {
  // Solo menú de letras o pantalla completa (no abre letras desde otras vistas)
  const inFs = document.body.classList.contains('now-playing-fs');
  if (!state.isLyricsOpen && !inFs) return;
  if (document.body.classList.contains('lyrics-chrome-hidden')) {
    revealLyricsChrome();
  } else {
    clearLyricsChromeHideTimer();
    document.body.classList.add('lyrics-chrome-hidden');
  }
}

export function toggleNowPlayingFullscreenFromShortcut() {
  try {
    if (typeof toggleNowPlayingFullscreen === 'function') {
      toggleNowPlayingFullscreen();
    } else if (document.body.classList.contains('now-playing-fs')) {
      closeNowPlayingFullscreen?.();
    } else {
      openNowPlayingFullscreen?.();
    }
  } catch (_) {}
}

export function cycleNowPlayingFsLayout() {
  // Solo tiene efecto útil en pantalla completa; si no está, la abre
  if (!document.body.classList.contains('now-playing-fs')) {
    try { openNowPlayingFullscreen(); } catch (_) {}
  }
  const order = ['default', 'swapped', 'centered'];
  let current = 'default';
  try {
    current = localStorage.getItem('pn_now_playing_fs_layout') || 'default';
  } catch (_) {}
  if (document.body.classList.contains('np-fs-centered')) current = 'centered';
  else if (document.body.classList.contains('np-fs-swapped')) current = 'swapped';
  const idx = order.indexOf(current);
  const next = order[(idx + 1) % order.length];
  try { applyNowPlayingFsLayout(next); } catch (_) {}
}

export function closeLyricsView() {
  if (!state.isLyricsOpen) return;
  state.isLyricsOpen = false;
  stopLyricsActiveRowAnimation();
  clearLyricsFocusModeTimer();
  clearLyricsChromeHideTimer();
  document.body.classList.remove('lyrics-focus-mode');
  document.body.classList.remove('lyrics-focus-mini-player-enabled');
  document.body.classList.remove('lyrics-chrome-hidden');
  setNowPlayingFullscreen(false);
  document.body.classList.remove('lyrics-overlay-open');
  try {
    const sleepPopover = document.getElementById('sleep-timer-popover');
    const speedPopover = document.getElementById('playback-speed-popover');
    if (sleepPopover) { sleepPopover.hidden = true; sleepPopover.classList.remove('lyrics-popover-anchored'); }
    if (speedPopover) { speedPopover.hidden = true; speedPopover.classList.remove('lyrics-popover-anchored'); }
  } catch (_) {}

  lyricsOverlay.classList.remove('open');
  btnLyrics.classList.remove('active-toggle');
  document.getElementById('lyrics-floating-actions').hidden = true;
  toggleExpandedCover(coverExpandedBeforeLyrics);
  coverExpandedBeforeLyrics = false;
}

export function updateNowPlayingFsAvailability() {
  const btn = document.getElementById('btn-now-playing-fs');
  if (!btn) return;
  const ok = hasActivePlaybackTrack();
  btn.disabled = !ok;
  btn.setAttribute('aria-disabled', String(!ok));
  btn.classList.toggle('is-disabled', !ok);
  if (!ok && document.body.classList.contains('now-playing-fs')) {
    try {
      setNowPlayingFullscreen(false);
      if (state.isLyricsOpen) closeLyricsView();
    } catch (_) {}
  }
}

/** Actualiza color de acento del vinilo (variable CSS). */
export function updateNpFsVinylAccent(accentColor) {
  const color = accentColor || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b8cff';
  document.documentElement.style.setProperty('--cover-accent-color', color);
}

/** API modular: estado play + acento del vinilo en FS. */
export function updatePlayerState(isPlaying, coverUrl, accentColor) {
  document.body.classList.toggle('np-fs-audio-playing', Boolean(isPlaying));
  if (accentColor) updateNpFsVinylAccent(accentColor);
  // coverUrl se gestiona por el pipeline normal de carátulas del dock FS
  void coverUrl;
}

document.addEventListener('pn-lyrics-view-updated', () => {
  try { syncNowPlayingFsLayoutForLyrics(); } catch (_) {}
});
document.addEventListener('pn-track-changed', onTrackChangedHideFsContentFirst, true);
document.addEventListener('pn-track-changed', () => {
  try { syncNowPlayingFsLayoutForLyrics(); } catch (_) {}
});
