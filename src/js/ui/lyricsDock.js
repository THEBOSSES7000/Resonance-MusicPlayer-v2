// UI · Pantalla de letras: dock de controles, volumen, barra de progreso y modo foco.

import { lyricsLinesBox, lyricsOverlay } from './dom.js';
import { activeLyricElement, lyricsAutoScrollEnabled, scrollLyricsLineIntoView, updateSyncedLyricsProgress } from './lyricsRender.js';
import { formatTime, state } from '../state.js';
import { getPlaybackDuration, getPlaybackPosition, isPlaybackPaused, seekPlayback } from '../audioPlayer.js';
import { openNowPlayingFsMoreMenu } from './nowPlayingFs.js';

export let lyricsProgressSeeking = false;

let lyricsFocusModeTimer = null;

const lyricsScrollContainer = lyricsOverlay?.querySelector('.lyrics-scroll-container');

export function setStylePropIfChanged(element, prop, value) {
  if (!element) return;
  if (element._styleCache?.[prop] === value) return;
  if (!element._styleCache) element._styleCache = Object.create(null);
  element._styleCache[prop] = value;
  element.style.setProperty(prop, value);
}

export function removeStylePropCached(element, prop) {
  if (!element) return;
  if (element._styleCache) delete element._styleCache[prop];
  element.style.removeProperty(prop);
}

function updateLyricsResponsiveScale() {
  const width = lyricsScrollContainer?.clientWidth || window.innerWidth;
  const height = lyricsScrollContainer?.clientHeight || window.innerHeight;
  const scale = Math.max(0.42, Math.min(1, width / 900, height / 600));
  document.documentElement.style.setProperty('--lyrics-window-scale', String(scale));
}

export function fitLyricLineToViewport(line) {
  const container = line?.closest('.lyrics-scroll-container');
  if (!container || container.clientHeight === 0) return;

  const topInset = Math.min(96, Math.max(32, container.clientHeight * 0.14));
  const bottomInset = Math.min(72, Math.max(24, container.clientHeight * 0.1));
  const availableHeight = Math.max(48, container.clientHeight - topInset - bottomInset);
  line.classList.add('is-fitting');
  line.style.setProperty('--lyric-line-fit-scale', '1');
  for (let attempt = 0; attempt < 5; attempt++) {
    const lineHeight = line.getBoundingClientRect().height;
    if (lineHeight <= availableHeight) break;
    const currentScale = Number.parseFloat(line.style.getPropertyValue('--lyric-line-fit-scale')) || 1;
    const nextScale = Math.max(0.32, currentScale * availableHeight / lineHeight * 0.96);
    if (nextScale === currentScale) break;
    line.style.setProperty('--lyric-line-fit-scale', String(nextScale));
  }
  line.classList.remove('is-fitting');
}

export function refitActiveLyricLine() {
  lyricsLinesBox.querySelectorAll('.lyric-line-sync').forEach(fitLyricLineToViewport);
  if (activeLyricElement?.isConnected) {
    fitLyricLineToViewport(activeLyricElement);
  }
  if (state.isLyricsOpen && activeLyricElement?.isConnected && lyricsAutoScrollEnabled) {
    scrollLyricsLineIntoView(activeLyricElement);
  }
}

updateLyricsResponsiveScale();

window.addEventListener('resize', () => {
  updateLyricsResponsiveScale();
  requestAnimationFrame(refitActiveLyricLine);
});

if (typeof ResizeObserver !== 'undefined' && lyricsScrollContainer) {
  const lyricsResizeObserver = new ResizeObserver(() => {
    updateLyricsResponsiveScale();
    requestAnimationFrame(refitActiveLyricLine);
  });
  lyricsResizeObserver.observe(lyricsScrollContainer);
}

export function clearLyricsFocusModeTimer() {
  if (lyricsFocusModeTimer !== null) {
    window.clearTimeout(lyricsFocusModeTimer);
    lyricsFocusModeTimer = null;
  }
}

let lyricsDockControlsBound = false;

export function syncLyricsDockButtonStates() {
  const map = [
    ['lyrics-btn-shuffle', 'btn-shuffle'],
    ['lyrics-btn-repeat', 'btn-repeat'],
    ['lyrics-btn-fav', 'player-fav-btn'],
    ['lyrics-focus-cover-fav', 'player-fav-btn'],
    ['lyrics-btn-queue', 'btn-toggle-queue'],
  ];
  map.forEach(([lyricsId, mainId]) => {
    const lyricsBtn = document.getElementById(lyricsId);
    const mainBtn = document.getElementById(mainId);
    if (!lyricsBtn || !mainBtn) return;
    const active = mainBtn.classList.contains('active') || mainBtn.classList.contains('active-toggle');
    lyricsBtn.classList.toggle('active', active);
    lyricsBtn.classList.toggle('active-toggle', active);
    // Copiar icono (p. ej. repeat → repeat-once)
    const mainIcon = mainBtn.querySelector('i');
    const lyricsIcon = lyricsBtn.querySelector('i');
    if (mainIcon && lyricsIcon) {
      lyricsIcon.className = mainIcon.className;
    } else if (mainIcon && !lyricsIcon) {
      lyricsBtn.innerHTML = mainBtn.innerHTML;
    }
    if (mainBtn.title) lyricsBtn.title = mainBtn.title;
  });
  syncLyricsDockPlayIcon();
}

export function syncLyricsDockPlayIcon() {
  const icon = document.getElementById('lyrics-play-icon');
  if (!icon) return;
  icon.className = isPlaybackPaused() ? 'ph-fill ph-play' : 'ph-fill ph-pause';
}

export function syncLyricsDockVolumeFromMain() {
  const main = document.getElementById('volume-range');
  const range = document.getElementById('lyrics-volume-range');
  const pct = document.getElementById('lyrics-volume-pct');
  if (main && range) {
    range.value = main.value;
    if (pct) pct.textContent = `${main.value}%`;
  }
  const fsRange = document.getElementById('np-fs-volume-range');
  if (main && fsRange) {
    fsRange.value = main.value;
    const pct = Math.max(0, Math.min(100, Number(main.value) || 0));
    fsRange.style.setProperty('--np-fs-vol', `${pct}%`);
    const volWrap = document.getElementById('np-fs-volume');
    if (volWrap) volWrap.style.setProperty('--np-fs-vol', `${pct}%`);
  }
  const muteIcon = document.getElementById('np-fs-volume-mute-icon');
  if (muteIcon && main) {
    const v = Number(main.value) || 0;
    muteIcon.className = v <= 0 ? 'ph ph-speaker-slash' : v < 40 ? 'ph ph-speaker-low' : 'ph ph-speaker-high';
  }
}

function resolveNpFsVolumePlacement() {
  try {
    const mode = (localStorage.getItem('pn_np_fs_volume_bar') || 'off').trim();
    if (mode === 'off' || mode === '') return 'off';
    if (mode === 'left' || mode === 'right' || mode === 'bottom') return mode;
    // auto
    if (document.body.classList.contains('np-fs-centered')) return 'bottom';
    if (document.body.classList.contains('np-fs-swapped')) return 'right';
    return 'left';
  } catch (_) {
    return 'off';
  }
}

function bindNpFsVolumeWheel() {
  const el = document.getElementById('np-fs-volume');
  if (!el || el.dataset.wheelBound === '1') return;
  el.dataset.wheelBound = '1';
  el.addEventListener('wheel', (e) => {
    if (!document.body.classList.contains('now-playing-fs')) return;
    if (el.hidden || el.dataset.placement === 'off') return;
    e.preventDefault();
    e.stopPropagation();
    const range = document.getElementById('np-fs-volume-range');
    if (!range) return;
    const step = e.deltaY > 0 ? -3 : 3;
    const next = Math.max(0, Math.min(100, (Number(range.value) || 0) + step));
    range.value = String(next);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
  }, { passive: false });
}

export function applyNpFsVolumeBar() {
  try { bindNpFsVolumeWheel(); } catch (_) {}

  const el = document.getElementById('np-fs-volume');
  if (!el) {
    console.warn('[np-fs-volume] elemento #np-fs-volume no encontrado');
    return;
  }
  const inFs = document.body.classList.contains('now-playing-fs');
  const placement = resolveNpFsVolumePlacement();
  const show = Boolean(inFs && placement !== 'off');

  el.dataset.placement = show ? placement : 'off';
  document.body.dataset.npFsVolumePlacement = show ? placement : 'off';
  document.body.dataset.npFsVolumeMode = (() => {
    try { return localStorage.getItem('pn_np_fs_volume_bar') || 'off'; } catch (_) { return 'off'; }
  })();

  if (show) {
    el.hidden = false;
    el.removeAttribute('hidden');
    el.style.display = 'flex';
    el.style.visibility = 'visible';
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  } else {
    el.hidden = true;
    el.setAttribute('hidden', '');
    el.style.display = 'none';
  }

  const coverRow = document.getElementById('lyrics-focus-cover-row');
  const miniPlayer = document.getElementById('lyrics-focus-mini-player');
  const transport = document.getElementById('lyrics-dock-transport');

  if (show && placement === 'bottom' && transport) {
    transport.insertAdjacentElement('afterend', el);
  } else if (show && coverRow) {
    // izquierda: antes de la carátula; derecha: después
    if (placement === 'right') {
      coverRow.appendChild(el);
    } else {
      coverRow.insertBefore(el, coverRow.firstChild);
    }
  }

  if (show) {
    try { syncLyricsDockVolumeFromMain(); } catch (_) {}
    // Longitud fija por CSS (~220px, igual que el slider centrado)
    el.style.height = '';
    el.style.maxHeight = '';
    el.style.top = '';
    el.style.transform = '';
  } else {
    el.style.height = '';
    el.style.maxHeight = '';
    el.style.top = '';
    el.style.transform = '';
  }
}

window.__pnApplyNpFsVolumeBar = applyNpFsVolumeBar;

function updateLyricsDockExtraVisibility() {
  const showSleep = localStorage.getItem('pn_show_player_sleep_timer') !== 'false';
  const showSpeed = localStorage.getItem('pn_show_player_speed_control') !== 'false';
  const hideQueue = localStorage.getItem('pn_hide_queue_ui') === 'true';
  const sleepBtn = document.getElementById('lyrics-btn-sleep');
  const speedBtn = document.getElementById('lyrics-btn-speed');
  const queueBtn = document.getElementById('lyrics-btn-queue');
  if (sleepBtn) sleepBtn.hidden = !showSleep;
  if (speedBtn) speedBtn.hidden = !showSpeed;
  if (queueBtn) queueBtn.hidden = hideQueue;
}

function bindLyricsProgressSeek() {
  const bar = document.getElementById('lyrics-focus-mini-progress');
  if (!bar || bar.dataset.seekBound === '1') return;
  bar.dataset.seekBound = '1';
  bar.setAttribute('role', 'slider');
  bar.setAttribute('aria-label', 'Buscar en la canción');
  bar.tabIndex = 0;

  let dragging = false;
  let pendingSeconds = null;
  let activePointerId = null;

  const ratioFromEvent = (event) => {
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return 0;
    const x = Number.isFinite(event.clientX) ? event.clientX : (event.touches?.[0]?.clientX ?? rect.left);
    return Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  };

  const previewSeek = (event) => {
    const duration = getPlaybackDuration();
    if (!Number.isFinite(duration) || duration <= 0) return null;
    const seconds = ratioFromEvent(event) * duration;
    const fill = document.getElementById('lyrics-focus-mini-progress-fill');
    if (fill) fill.style.width = `${(seconds / duration) * 100}%`;
    bar.setAttribute('aria-valuenow', String(Math.round((seconds / duration) * 100)));
    const curEl = document.getElementById('lyrics-focus-mini-time-current');
    const remEl = document.getElementById('lyrics-focus-mini-time-remaining');
    if (curEl) curEl.textContent = formatTime(seconds);
    if (remEl) remEl.textContent = `-${formatTime(Math.max(0, duration - seconds))}`;
    return seconds;
  };

  const commitSeek = async (seconds) => {
    if (!Number.isFinite(seconds)) {
      lyricsProgressSeeking = false;
      return;
    }
    lyricsProgressSeeking = true;
    try {
      await seekPlayback(seconds);
      updateSyncedLyricsProgress(seconds);
    } catch (error) {
      console.warn('No se pudo buscar en la barra de letras:', error);
    } finally {
      // Mantener el preview un frame más y luego dejar que el progreso real tome el control
      window.requestAnimationFrame(() => {
        lyricsProgressSeeking = false;
      });
    }
  };

  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    lyricsProgressSeeking = true;
    activePointerId = event.pointerId;
    pendingSeconds = previewSeek(event);
    try { bar.setPointerCapture(event.pointerId); } catch (_) {}
  });

  bar.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (activePointerId != null && event.pointerId !== activePointerId) return;
    event.preventDefault();
    pendingSeconds = previewSeek(event);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    if (activePointerId != null && event.pointerId !== activePointerId && event.type !== 'pointercancel') return;
    dragging = false;
    activePointerId = null;
    try { bar.releasePointerCapture(event.pointerId); } catch (_) {}
    const seconds = pendingSeconds != null ? pendingSeconds : previewSeek(event);
    pendingSeconds = null;
    void commitSeek(seconds);
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);
  // Si el capture se pierde, igual aplicar el último valor
  bar.addEventListener('lostpointercapture', (event) => {
    if (!dragging) return;
    dragging = false;
    activePointerId = null;
    const seconds = pendingSeconds;
    pendingSeconds = null;
    void commitSeek(seconds);
  });

  bar.addEventListener('keydown', (event) => {
    const duration = getPlaybackDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    const step = event.shiftKey ? 10 : 5;
    let next = getPlaybackPosition();
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      next = Math.max(0, next - step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      next = Math.min(duration, next + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      next = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      next = duration;
    } else {
      return;
    }
    void commitSeek(next);
  });
}

export function bindLyricsDockControls() {
  if (lyricsDockControlsBound) {
    updateLyricsDockExtraVisibility();
    syncLyricsDockPlayIcon();
    syncLyricsDockVolumeFromMain();
    return;
  }
  lyricsDockControlsBound = true;
  bindLyricsProgressSeek();
  const clickProxy = (lyricsId, mainId) => {
    document.getElementById(lyricsId)?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(mainId)?.click();
      window.setTimeout(() => { syncLyricsDockPlayIcon(); syncLyricsDockButtonStates(); }, 30);
    });
  };
  clickProxy('lyrics-btn-shuffle', 'btn-shuffle');
  clickProxy('lyrics-btn-prev', 'btn-prev');
  clickProxy('lyrics-btn-play', 'play-pause-btn');
  clickProxy('lyrics-btn-next', 'btn-next');
  clickProxy('lyrics-btn-repeat', 'btn-repeat');
  clickProxy('lyrics-btn-fav', 'player-fav-btn');
  clickProxy('lyrics-focus-cover-fav', 'player-fav-btn');
  document.getElementById('lyrics-focus-more-btn')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNowPlayingFsMoreMenu(event.currentTarget);
  });

  const anchorPlayerPopover = (popover, anchorBtn) => {
    if (!popover || !anchorBtn) return;
    // Mover al body: si queda dentro de .bottom-player (visibility:hidden) no se ve
    if (!popover.dataset.lyricsHome) {
      const parent = popover.parentElement;
      if (parent) {
        popover.dataset.lyricsHome = '1';
        // guardar nodo siguiente para restaurar
        popover._lyricsHomeParent = parent;
        popover._lyricsHomeNext = popover.nextSibling;
      }
    }
    if (popover.parentElement !== document.body) {
      document.body.appendChild(popover);
    }
    popover.classList.add('lyrics-popover-anchored');
    popover.hidden = false;
    const rect = anchorBtn.getBoundingClientRect();
    const pad = 10;
    popover.style.position = 'fixed';
    popover.style.zIndex = '10080';
    popover.style.visibility = 'visible';
    popover.style.opacity = '1';
    popover.style.pointerEvents = 'auto';
    popover.style.right = `${Math.max(pad, window.innerWidth - rect.right)}px`;
    popover.style.left = 'auto';
    popover.style.top = 'auto';
    popover.style.bottom = `${Math.max(pad, window.innerHeight - rect.top + 8)}px`;
  };
  const clearPopoverAnchor = (popover) => {
    if (!popover) return;
    popover.classList.remove('lyrics-popover-anchored');
    popover.style.position = '';
    popover.style.zIndex = '';
    popover.style.right = '';
    popover.style.left = '';
    popover.style.top = '';
    popover.style.bottom = '';
    popover.style.visibility = '';
    popover.style.opacity = '';
    popover.style.pointerEvents = '';
    // Restaurar al contenedor original del reproductor
    if (popover._lyricsHomeParent && popover.parentElement === document.body) {
      try {
        if (popover._lyricsHomeNext && popover._lyricsHomeNext.parentNode === popover._lyricsHomeParent) {
          popover._lyricsHomeParent.insertBefore(popover, popover._lyricsHomeNext);
        } else {
          popover._lyricsHomeParent.appendChild(popover);
        }
      } catch (_) {
        popover._lyricsHomeParent.appendChild(popover);
      }
    }
  };
  const toggleLyricsPlayerPopover = (kind) => {
    const sleepPopover = document.getElementById('sleep-timer-popover');
    const speedPopover = document.getElementById('playback-speed-popover');
    const sleepBtn = document.getElementById('btn-sleep-timer');
    const speedBtn = document.getElementById('btn-playback-speed');
    const lyricsSleep = document.getElementById('lyrics-btn-sleep');
    const lyricsSpeed = document.getElementById('lyrics-btn-speed');
    const sleepWasOpen = sleepPopover && sleepPopover.hidden === false;
    const speedWasOpen = speedPopover && speedPopover.hidden === false;
    const shouldOpenSleep = kind === 'sleep' && !sleepWasOpen;
    const shouldOpenSpeed = kind === 'speed' && !speedWasOpen;
    if (sleepPopover) sleepPopover.hidden = true;
    if (speedPopover) speedPopover.hidden = true;
    sleepBtn?.setAttribute('aria-expanded', 'false');
    speedBtn?.setAttribute('aria-expanded', 'false');
    clearPopoverAnchor(sleepPopover);
    clearPopoverAnchor(speedPopover);
    if (shouldOpenSleep && sleepPopover) {
      sleepPopover.hidden = false;
      sleepBtn?.setAttribute('aria-expanded', 'true');
      anchorPlayerPopover(sleepPopover, lyricsSleep);
      try { document.getElementById('btn-sleep-timer'); } catch (_) {}
    } else if (shouldOpenSpeed && speedPopover) {
      speedPopover.hidden = false;
      speedBtn?.setAttribute('aria-expanded', 'true');
      anchorPlayerPopover(speedPopover, lyricsSpeed);
    }
  };
  document.getElementById('lyrics-btn-sleep')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLyricsPlayerPopover('sleep');
  });
  document.getElementById('lyrics-btn-speed')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLyricsPlayerPopover('speed');
  });
  // Cola: solo proxy (abre el panel normal; no menú flotante)
  clickProxy('lyrics-btn-queue', 'btn-toggle-queue');

  const lyricsVol = document.getElementById('lyrics-volume-range');
  const mainVol = document.getElementById('volume-range');
  const lyricsVolBox = document.getElementById('lyrics-dock-volume');
  if (lyricsVol && mainVol) {
    lyricsVol.addEventListener('input', () => {
      mainVol.value = lyricsVol.value;
      mainVol.dispatchEvent(new Event('input', { bubbles: true }));
      const pct = document.getElementById('lyrics-volume-pct');
      if (pct) pct.textContent = `${lyricsVol.value}%`;
    });
    mainVol.addEventListener('input', syncLyricsDockVolumeFromMain);
    const applyLyricsWheelVolume = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY < 0 ? 5 : -5;
      const current = Number(mainVol.value) || 0;
      const next = Math.max(0, Math.min(100, current + step));
      mainVol.value = String(next);
      mainVol.dispatchEvent(new Event('input', { bubbles: true }));
      lyricsVol.value = String(next);
      const pct = document.getElementById('lyrics-volume-pct');
      if (pct) pct.textContent = `${next}%`;
    };
    // Rueda sobre el slider o el contenedor de volumen del dock de letras
    lyricsVol.addEventListener('wheel', applyLyricsWheelVolume, { passive: false });
    lyricsVolBox?.addEventListener('wheel', applyLyricsWheelVolume, { passive: false });
  }
  updateLyricsDockExtraVisibility();
  syncLyricsDockPlayIcon();
  syncLyricsDockButtonStates();
  syncLyricsDockVolumeFromMain();
}

function getLyricsHideChromeSeconds() {
  const raw = localStorage.getItem('pn_lyrics_hide_chrome_timeout');
  if (raw === '5' || raw === '15') return Number(raw);
  // compat: antiguo timeout de enfoque
  if (raw === '10' || localStorage.getItem('pn_lyrics_focus_mode_timeout') === '10') return 10;
  return 10;
}

export function scheduleLyricsFocusMode() {
  clearLyricsFocusModeTimer();
  if (!state.isLyricsOpen) {
    document.body.classList.remove('lyrics-focus-mode');
    document.body.classList.remove('lyrics-focus-mini-player-enabled');
    document.body.classList.remove('lyrics-chrome-hidden');
    return;
  }
  // Opción antigua "Ocultar interfaz al leer letras" eliminada; solo chrome de botones
  document.body.classList.remove('lyrics-focus-mode');
  document.body.classList.remove('lyrics-focus-mini-player-enabled');
  scheduleLyricsChromeHide();
}

let lyricsChromeHideTimer = null;

export function clearLyricsChromeHideTimer() {
  if (lyricsChromeHideTimer !== null) {
    window.clearTimeout(lyricsChromeHideTimer);
    lyricsChromeHideTimer = null;
  }
}

function scheduleLyricsChromeHide() {
  clearLyricsChromeHideTimer();
  if (!state.isLyricsOpen) {
    document.body.classList.remove('lyrics-chrome-hidden');
    return;
  }
  if (localStorage.getItem('pn_lyrics_hide_chrome_enabled') !== 'true') {
    document.body.classList.remove('lyrics-chrome-hidden');
    return;
  }
  const seconds = getLyricsHideChromeSeconds();
  lyricsChromeHideTimer = window.setTimeout(() => {
    if (state.isLyricsOpen && localStorage.getItem('pn_lyrics_hide_chrome_enabled') === 'true') {
      document.body.classList.add('lyrics-chrome-hidden');
    }
  }, seconds * 1000);
}

export function revealLyricsChrome() {
  document.body.classList.remove('lyrics-chrome-hidden');
  scheduleLyricsChromeHide();
}

export function handleLyricsFocusModeActivity() {
  if (!state.isLyricsOpen) return;
  document.body.classList.remove('lyrics-focus-mode');
  document.body.classList.remove('lyrics-focus-mini-player-enabled');
  document.body.classList.remove('lyrics-chrome-hidden');
  clearLyricsChromeHideTimer();
  revealLyricsChrome();
  scheduleLyricsFocusMode();
}
