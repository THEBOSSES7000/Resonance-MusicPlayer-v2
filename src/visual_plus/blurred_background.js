/**
 * Fondo difuminado Visual+ — orbes de color derivados de la carátula.
 * Opción de diversidad cromática para portadas con un color dominante.
 */

const DEFAULT_COLORS = ['#6b5cff', '#ff5cad', '#3ec6ff', '#ffc857', '#7dffb3'];
let lastCoverSrc = null;
let lastDiversity = null;
let paletteCache = new Map();
let playStateBound = false;

function getLiquidRoot() {
  return document.getElementById('visual-plus-liquid-bg');
}

function migrateTheme(theme) {
  if (theme === 'liquid_gradient') return 'blurred';
  if (theme === 'liquid_immersive') return 'liquid';
  return theme;
}

function readVisualPlusSettings() {
  try {
    const raw = localStorage.getItem('pn_visual_plus');
    if (!raw) {
      return {
        enabled: false,
        theme: 'shooting_stars',
        blurredSpeed: 100,
        blurredStatic: false,
        colorDiversity: 55,
      };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false, theme: 'shooting_stars', blurredSpeed: 100, blurredStatic: false, colorDiversity: 55 };
    }
    return {
      blurredSpeed: 100,
      blurredStatic: false,
      colorDiversity: 55,
      ...parsed,
      theme: migrateTheme(parsed.theme),
      blurredStatic: typeof parsed.blurredStatic === 'boolean' ? parsed.blurredStatic : false,
      blurredSpeed: Number.isFinite(Number(parsed.blurredSpeed)) ? Number(parsed.blurredSpeed) : 100,
    };
  } catch (_) {
    return { enabled: false, theme: 'shooting_stars', blurredSpeed: 100, blurredStatic: false, colorDiversity: 55 };
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
  if (document.body.classList.contains('np-fs-audio-playing')) return true;
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) return !audio.paused && !audio.ended;
  return false;
}

export function setLiquidBackgroundActive(active) {
  const root = getLiquidRoot();
  if (!root) return;
  const settings = readVisualPlusSettings();
  // No activar orbes si el tema inmersivo está activo
  const show = Boolean(active) && settings.theme === 'blurred';
  root.classList.toggle('is-blurred-theme', show);
  root.classList.toggle('is-static', Boolean(settings.blurredStatic));
  if (show) {
    root.classList.remove('is-active-immersive');
    root.classList.add('is-active');
    // Ocultar canvas de Kawarp si quedó en el DOM
    const kawarpCanvas = root.querySelector('canvas.liquid-immersive-canvas');
    if (kawarpCanvas) kawarpCanvas.style.display = 'none';
    applyLiquidSpeed(settings.blurredSpeed ?? 100);
    syncLiquidAnimationPlayState();
  } else {
    root.classList.remove('is-animating');
    // Solo quitar is-active si no es el tema líquido (él lo gestiona)
    if (settings.theme !== 'liquid') {
      root.classList.remove('is-active');
      root.classList.remove('is-active-immersive');
    }
  }
}

export function syncLiquidAnimationPlayState() {
  const root = getLiquidRoot();
  if (!root || !root.classList.contains('is-active')) return;
  const settings = readVisualPlusSettings();
  if (settings.blurredStatic) {
    root.classList.remove('is-animating');
    return;
  }
  root.classList.toggle('is-animating', isAudioPlaying());
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r;
  let g;
  let b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [
    Math.min(255, Math.round(r * 255)),
    Math.min(255, Math.round(g * 255)),
    Math.min(255, Math.round(b * 255)),
  ];
}

function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

/**
 * Extrae 5 colores con control de diversidad (0–100).
 * Alta diversidad fuerza más separación de matiz y levanta saturación de acentos.
 */
export function extractPaletteFromCover(coverSrc, diversity = 55) {
  const div = Math.max(0, Math.min(100, Number(diversity) || 55));
  const cacheKey = `${coverSrc}::${div}`;
  if (paletteCache.has(cacheKey)) return Promise.resolve(paletteCache.get(cacheKey));

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        let data;
        try {
          data = ctx.getImageData(0, 0, size, size).data;
        } catch (err) {
          console.warn('[blurred] no se pudo leer carátula (CORS/tainted)', coverSrc);
          resolve(DEFAULT_COLORS.slice());
          return;
        }

        // Histograma de matiz (24 buckets) ponderado por saturación * valor * conteo
        const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0, n: 0 }));
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const hsv = rgbToHsv(r, g, b);
          // Ignorar casi grises muy oscuros
          if (hsv.v < 0.08) continue;
          const bi = Math.min(23, Math.floor(hsv.h * 24));
          // Peso: sat * brillo (los grises pesan menos)
          const weight = 0.35 + hsv.s * 1.4 + hsv.v * 0.4;
          buckets[bi].w += weight;
          buckets[bi].r += r * weight;
          buckets[bi].g += g * weight;
          buckets[bi].b += b * weight;
          buckets[bi].n += 1;
        }

        const candidates = buckets
          .map((bucket, index) => {
            if (!bucket.n || bucket.w <= 0) return null;
            const r = bucket.r / bucket.w;
            const g = bucket.g / bucket.w;
            const b = bucket.b / bucket.w;
            const hsv = rgbToHsv(r, g, b);
            return {
              index,
              weight: bucket.w,
              r, g, b,
              h: hsv.h,
              s: hsv.s,
              v: hsv.v,
            };
          })
          .filter(Boolean)
          .sort((a, b) => b.weight - a.weight);

        if (!candidates.length) {
          resolve(DEFAULT_COLORS.slice());
          return;
        }

        // minHueSep: 0.04 (baja diversidad) → 0.18 (alta)
        const minHueSep = 0.04 + (div / 100) * 0.16;
        const satBoost = (div / 100) * 0.35;
        const picked = [];

        for (const cand of candidates) {
          if (picked.length >= 5) break;
          const tooClose = picked.some((p) => hueDistance(p.h, cand.h) < minHueSep);
          if (tooClose && picked.length > 0 && div > 25) continue;
          picked.push(cand);
        }

        // Si no llegamos a 5, completar con los más pesados aunque estén cerca
        if (picked.length < 5) {
          for (const cand of candidates) {
            if (picked.length >= 5) break;
            if (picked.includes(cand)) continue;
            picked.push(cand);
          }
        }

        // Aún faltan: rotar matices desde el dominante
        while (picked.length < 5) {
          const base = candidates[0];
          const t = picked.length / 5;
          const h = (base.h + 0.12 + t * 0.35) % 1;
          const s = Math.min(1, base.s * 0.7 + 0.25);
          const v = Math.min(1, Math.max(0.35, base.v));
          const [r, g, b] = hsvToRgb(h, s, v);
          picked.push({ r, g, b, h, s, v, weight: 0 });
        }

        const colors = picked.slice(0, 5).map((c, idx) => {
          let { r, g, b, s, v, h } = c;
          // Boost saturación en acentos según diversidad; el primero (dominante) menos agresivo
          const boost = idx === 0 ? satBoost * 0.35 : satBoost;
          if (boost > 0 && s < 0.95) {
            const ns = Math.min(1, s + boost * (1 - s));
            const nv = Math.min(1, Math.max(v, 0.28 + (div / 100) * 0.15));
            [r, g, b] = hsvToRgb(h, ns, nv);
          }
          // Ligero lift para que no se vea apagado en fondo oscuro
          r = Math.min(255, Math.round(r * 1.08));
          g = Math.min(255, Math.round(g * 1.08));
          b = Math.min(255, Math.round(b * 1.08));
          return `rgb(${r}, ${g}, ${b})`;
        });

        paletteCache.set(cacheKey, colors);
        if (paletteCache.size > 60) {
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
  const shouldShow = settings.enabled && settings.theme === 'blurred';
  setLiquidBackgroundActive(shouldShow);
  if (!shouldShow) return;
  if (!coverSrc) return;
  const diversity = settings.colorDiversity ?? 55;
  if (coverSrc === lastCoverSrc && lastDiversity === diversity && paletteCache.has(`${coverSrc}::${diversity}`)) {
    updateBackgroundPalette(paletteCache.get(`${coverSrc}::${diversity}`));
    return;
  }
  lastCoverSrc = coverSrc;
  lastDiversity = diversity;
  const colors = await extractPaletteFromCover(coverSrc, diversity);
  updateBackgroundPalette(colors);
}

export function refreshLiquidBackgroundState() {
  const settings = readVisualPlusSettings();
  const shouldShow = settings.enabled && settings.theme === 'blurred';
  setLiquidBackgroundActive(shouldShow);
  if (shouldShow && lastCoverSrc) {
    extractPaletteFromCover(lastCoverSrc, settings.colorDiversity ?? 55).then(updateBackgroundPalette);
  }
}

function bindPlayStateObservers() {
  if (playStateBound) return;
  playStateBound = true;
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
  const candidates = [
    document.querySelector('#player-cover img'),
    document.querySelector('.player-cover img'),
    document.querySelector('#lyrics-focus-mini-cover img'),
    document.querySelector('#expanded-cover-img'),
  ];
  for (const img of candidates) {
    const src = img?.currentSrc || img?.src;
    if (src && !src.endsWith('.svg') && src.length > 8) return src;
  }
  return null;
}

export function initLiquidGradientBackground() {
  bindPlayStateObservers();
  const settings = readVisualPlusSettings();
  if (settings.enabled && settings.theme === 'blurred') {
    setLiquidBackgroundActive(true);
    const cover = resolveCurrentCoverSrc();
    if (cover) void syncLiquidBackgroundFromCover(cover);
  }
}

export const initBlurredBackground = initLiquidGradientBackground;
