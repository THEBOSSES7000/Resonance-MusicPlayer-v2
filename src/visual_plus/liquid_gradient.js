/**
 * Fondo líquido Visual+ — orbes de color que derivan suavemente (sin rotar el contenedor).
 * Se pausa al pausar la reproducción; opción de mantener estático.
 */

const DEFAULT_COLORS = ['#6b5cff', '#ff5cad', '#3ec6ff', '#ffc857', '#7dffb3'];
let lastCoverSrc = null;
let paletteCache = new Map();
let playStateBound = false;

function getLiquidRoot() {
  return document.getElementById('visual-plus-liquid-bg');
}

function readVisualPlusSettings() {
  try {
    const raw = localStorage.getItem('pn_visual_plus');
    if (!raw) return { enabled: false, theme: 'shooting_stars', liquidSpeed: 100, liquidStatic: false };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { liquidSpeed: 100, liquidStatic: false, ...parsed }
      : { enabled: false, theme: 'shooting_stars', liquidSpeed: 100, liquidStatic: false };
  } catch (_) {
    return { enabled: false, theme: 'shooting_stars', liquidSpeed: 100, liquidStatic: false };
  }
}

export function updateBackgroundPalette(colorArray) {
  const root = getLiquidRoot();
  if (!root) return;
  const colors = Array.isArray(colorArray) && colorArray.length
    ? colorArray.slice(0, 5)
    : DEFAULT_COLORS.slice();
  while (colors.length < 5) colors.push(colors[colors.length - 1] || DEFAULT_COLORS[0]);
  for (let i = 0; i < 5; i += 1) {
    root.style.setProperty(`--liquid-color-${i + 1}`, colors[i]);
  }
}

function applyLiquidSpeed(speedPercent) {
  const root = getLiquidRoot();
  if (!root) return;
  const pct = Math.max(25, Math.min(200, Number(speedPercent) || 100));
  root.style.setProperty('--liquid-speed', String(pct / 100));
}

function isAudioPlaying() {
  // Prefer body class used by fullscreen; also check known audio element
  if (document.body.classList.contains('np-fs-audio-playing')) return true;
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) return !audio.paused && !audio.ended;
  return false;
}

export function setLiquidBackgroundActive(active) {
  const root = getLiquidRoot();
  if (!root) return;
  const settings = readVisualPlusSettings();
  root.classList.toggle('is-active', Boolean(active));
  root.classList.toggle('is-static', Boolean(settings.liquidStatic));
  if (active) {
    applyLiquidSpeed(settings.liquidSpeed ?? 100);
    syncLiquidAnimationPlayState();
  } else {
    root.classList.remove('is-animating');
  }
}

export function syncLiquidAnimationPlayState() {
  const root = getLiquidRoot();
  if (!root || !root.classList.contains('is-active')) return;
  const settings = readVisualPlusSettings();
  if (settings.liquidStatic) {
    root.classList.remove('is-animating');
    root.classList.add('is-static');
    return;
  }
  root.classList.remove('is-static');
  root.classList.toggle('is-animating', isAudioPlaying());
}

async function extractPaletteFromCover(coverSrc) {
  if (!coverSrc) return DEFAULT_COLORS.slice();
  if (paletteCache.has(coverSrc)) return paletteCache.get(coverSrc);
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(DEFAULT_COLORS.slice());
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        let data;
        try {
          data = ctx.getImageData(0, 0, size, size).data;
        } catch (err) {
          // Canvas tainted: no cachear defaults para permitir reintento
          console.warn('[liquid] no se pudo leer carátula (CORS/tainted)', coverSrc);
          resolve(DEFAULT_COLORS.slice());
          return;
        }
        const regions = [
          [0, 0, 12, 12],
          [20, 0, 12, 12],
          [0, 20, 12, 12],
          [20, 20, 12, 12],
          [10, 10, 12, 12]
        ];
        const colors = regions.map(([sx, sy, w, h]) => {
          let r = 0, g = 0, b = 0, n = 0;
          for (let y = sy; y < sy + h && y < size; y += 1) {
            for (let x = sx; x < sx + w && x < size; x += 1) {
              const i = (y * size + x) * 4;
              if (data[i + 3] < 40) continue;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              n += 1;
            }
          }
          if (!n) return DEFAULT_COLORS[0];
          r = Math.min(255, Math.round((r / n) * 1.15));
          g = Math.min(255, Math.round((g / n) * 1.15));
          b = Math.min(255, Math.round((b / n) * 1.15));
          return `rgb(${r}, ${g}, ${b})`;
        });
        paletteCache.set(coverSrc, colors);
        if (paletteCache.size > 40) {
          const first = paletteCache.keys().next().value;
          paletteCache.delete(first);
        }
        resolve(colors);
      } catch (_) {
        resolve(DEFAULT_COLORS.slice());
      }
    };
    img.onerror = () => resolve(DEFAULT_COLORS.slice());
    try { img.crossOrigin = 'anonymous'; } catch (_) {}
    img.src = coverSrc;
  });
}

export async function syncLiquidBackgroundFromCover(coverSrc) {
  const settings = readVisualPlusSettings();
  const shouldShow = settings.enabled && settings.theme === 'liquid_gradient';
  setLiquidBackgroundActive(shouldShow);
  if (!shouldShow) return;
  if (!coverSrc) return;
  // Si es la misma carátula y ya hay paleta, reaplicar (por si se reabrió letras)
  if (coverSrc === lastCoverSrc && paletteCache.has(coverSrc)) {
    updateBackgroundPalette(paletteCache.get(coverSrc));
    return;
  }
  lastCoverSrc = coverSrc;
  const colors = await extractPaletteFromCover(coverSrc);
  updateBackgroundPalette(colors);
}

export function refreshLiquidBackgroundState() {
  const settings = readVisualPlusSettings();
  const shouldShow = settings.enabled && settings.theme === 'liquid_gradient';
  setLiquidBackgroundActive(shouldShow);
  if (shouldShow && lastCoverSrc) {
    extractPaletteFromCover(lastCoverSrc).then(updateBackgroundPalette);
  }
}

function bindPlayStateObservers() {
  if (playStateBound) return;
  playStateBound = true;
  // Body class toggled by syncPlayingUI
  const bodyObs = new MutationObserver(() => {
    try { syncLiquidAnimationPlayState(); } catch (_) {}
  });
  bodyObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) {
    ['play', 'pause', 'ended'].forEach((ev) => {
      audio.addEventListener(ev, () => {
        try { syncLiquidAnimationPlayState(); } catch (_) {}
      });
    });
  }
}



function resolveCurrentCoverSrc() {
  // Prefer main player cover image
  const candidates = [
    document.querySelector('#player-cover img'),
    document.querySelector('.player-cover img'),
    document.querySelector('#lyrics-focus-mini-cover img'),
    document.querySelector('.lyrics-focus-mini-cover img'),
    document.getElementById('player-cover'),
  ];
  for (const el of candidates) {
    if (!el) continue;
    const src = el.currentSrc || el.src || el.getAttribute('src');
    if (src && !src.endsWith('.svg') && src !== window.location.href) return src;
  }
  return null;
}

function bindCoverChangeObserver() {
  const watchTargets = [
    document.getElementById('lyrics-focus-mini-cover'),
    document.getElementById('player-cover'),
    document.querySelector('.player-cover'),
  ].filter(Boolean);
  if (!watchTargets.length) return;
  const obs = new MutationObserver(() => {
    try {
      const src = resolveCurrentCoverSrc();
      if (src) syncLiquidBackgroundFromCover(src);
    } catch (_) {}
  });
  for (const target of watchTargets) {
    obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }
}

export function initLiquidGradientBackground() {
  refreshLiquidBackgroundState();
  bindPlayStateObservers();
  try { bindCoverChangeObserver(); } catch (_) {}
  // Intento inicial con la carátula actual
  try {
    const src = resolveCurrentCoverSrc();
    if (src) syncLiquidBackgroundFromCover(src);
  } catch (_) {}
  document.addEventListener('pn-visual-plus-settings-changed', () => {
    refreshLiquidBackgroundState();
    try {
      const src = resolveCurrentCoverSrc();
      if (src) syncLiquidBackgroundFromCover(src);
    } catch (_) {}
  });
  document.addEventListener('pn-track-cover-changed', (event) => {
    try {
      const src = event?.detail?.coverSrc || resolveCurrentCoverSrc();
      if (src) syncLiquidBackgroundFromCover(src);
    } catch (_) {}
  });
}


