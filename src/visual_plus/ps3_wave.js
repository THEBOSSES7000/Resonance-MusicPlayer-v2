/**
 * Visual+ · Ondas (estilo XMB)
 * Una cinta sedosa de capas muy juntas, partículas y degradado profundo.
 */

import { randomBetween, vp } from './state.js';

const artworkSampleCanvas = document.createElement('canvas');
artworkSampleCanvas.width = 24;
artworkSampleCanvas.height = 24;
const artworkSampleContext = artworkSampleCanvas.getContext('2d', { willReadFrequently: true });

let artworkSource = '';
let artworkRgb = null;
let artworkSamplePendingSrc = null;

let wavePhase = 0;
let audioSmooth = 0;
let sparkles = [];

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { r: 26, g: 60, b: 220 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function parseRgbString(str) {
  const m = String(str || '').match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function sampleArtworkRgb() {
  const image = document.querySelector('#player-cover-box img')
    || document.querySelector('#player-cover img')
    || document.querySelector('.player-cover img');
  if (!image?.src) return artworkRgb;
  const src = image.currentSrc || image.src;
  if (src === artworkSource) return artworkRgb;
  if (!artworkSampleContext) return artworkRgb;
  if (artworkSamplePendingSrc !== src) {
    artworkSamplePendingSrc = src;
    const img = new Image();
    try { img.crossOrigin = 'anonymous'; } catch (_) {}
    img.onload = () => {
      try {
        artworkSampleContext.clearRect(0, 0, 24, 24);
        artworkSampleContext.drawImage(img, 0, 0, 24, 24);
        const data = artworkSampleContext.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 40) continue;
          const lum = data[i] * 0.2 + data[i + 1] * 0.5 + data[i + 2] * 0.1;
          if (lum < 18 || lum > 245) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
        if (n) artworkRgb = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
        artworkSource = src;
      } catch (_) {
        artworkSource = src;
      }
      if (artworkSamplePendingSrc === src) artworkSamplePendingSrc = null;
    };
    img.onerror = () => {
      artworkSource = src;
      artworkSamplePendingSrc = null;
    };
    img.src = src;
  }
  return artworkRgb;
}

function resolveColor(mode, customHex, fallback) {
  if (mode === 'artwork') {
    const sampled = sampleArtworkRgb();
    if (sampled) return sampled;
  }
  if (mode === 'theme') {
    const theme = vp.cachedThemeColor
      || getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim();
    if (theme.startsWith('#')) return hexToRgb(theme);
    const rgb = parseRgbString(theme);
    if (rgb) return rgb;
  }
  if (mode === 'custom') return hexToRgb(customHex || fallback);
  // classic
  return hexToRgb(fallback);
}

function ensureSparkles(count) {
  const target = Math.max(0, Math.min(140, count | 0));
  while (sparkles.length < target) {
    sparkles.push({
      x: Math.random(),
      y: Math.random(),
      z: randomBetween(0.25, 1),
      speed: randomBetween(0.012, 0.045),
      twinkle: Math.random() * Math.PI * 2,
      size: randomBetween(0.5, 1.9),
    });
  }
  if (sparkles.length > target) sparkles.length = target;
}

/** Perfil de onda XMB: varias armónicas, capas casi solapadas */
function waveY(x, phase, amp, layerOffset) {
  const t = x * 0.0036 + phase;
  const o = layerOffset * 0.15;
  return (
    Math.sin(t + o) * amp
    + Math.sin(t * 0.5 + o * 0.5) * amp * 0.38
    + Math.sin(t * 1.7 + o) * amp * 0.14
  );
}

function drawBackground(ctx, w, h, rgb, brightness) {
  const b = brightness / 100;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  // Azul PS3 profundo: casi negro-azul arriba, azul medio abajo
  g.addColorStop(0, `rgb(${Math.round(rgb.r * 0.06 * b)}, ${Math.round(rgb.g * 0.1 * b)}, ${Math.round(rgb.b * 0.22 * b)})`);
  g.addColorStop(0.55, `rgb(${Math.round(rgb.r * 0.1 * b)}, ${Math.round(rgb.g * 0.16 * b)}, ${Math.round(rgb.b * 0.38 * b)})`);
  g.addColorStop(1, `rgb(${Math.round(rgb.r * 0.05 * b)}, ${Math.round(rgb.g * 0.08 * b)}, ${Math.round(rgb.b * 0.2 * b)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Una cinta gruesa hecha de muchas sub-capas muy juntas (efecto “una sola onda”).
 */
function drawSilkRibbon(ctx, w, h, rgb, phase, amp, audioBoost, brightness) {
  const midY = h * 0.52;
  // Reactividad: casi no cambia la forma (evita deformar); sí el brillo
  const baseAmp = amp * (1 + audioBoost * 0.06);
  const layers = 12;
  const stepX = 4;
  const b = (brightness / 100) * (1 + audioBoost * 0.55);
  const phaseWrapped = phase % (Math.PI * 64);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (let layer = 0; layer < layers; layer += 1) {
    const layerT = layer / (layers - 1);
    const yShift = (layerT - 0.5) * Math.min(baseAmp * 0.08, 6);
    // Misma fase en todas las capas (no se separan con el tiempo)
    const layerPhase = phaseWrapped + layerT * 0.12;
    const thickness = Math.max(12, h * 0.032) * (0.7 + layerT * 0.35);
    const alpha = (0.05 + layerT * 0.05) * b * (1 + audioBoost * 0.35);

    ctx.beginPath();
    for (let x = -30; x <= w + 30; x += stepX) {
      const y = midY + yShift + waveY(x, layerPhase, baseAmp, layerT * 0.4);
      if (x === -30) ctx.moveTo(x, y - thickness * 0.15);
      else ctx.lineTo(x, y - thickness * 0.15);
    }
    for (let x = w + 30; x >= -30; x -= stepX) {
      const y = midY + yShift + waveY(x, layerPhase, baseAmp, layerT * 0.4);
      ctx.lineTo(x, y + thickness);
    }
    ctx.closePath();

    const r = rgb.r;
    const g = rgb.g;
    const bl = rgb.b;
    const hiR = Math.min(255, r + 90);
    const hiG = Math.min(255, g + 110);
    const hiB = Math.min(255, bl + 130);
    const grad = ctx.createLinearGradient(0, midY - baseAmp * 1.2, w, midY + baseAmp * 1.2);
    grad.addColorStop(0, `rgba(${r},${g},${bl},0)`);
    grad.addColorStop(0.2, `rgba(${hiR},${hiG},${hiB},${alpha * 0.35})`);
    grad.addColorStop(0.45, `rgba(${hiR},${hiG},${hiB},${alpha})`);
    grad.addColorStop(0.7, `rgba(${r},${g},${bl},${alpha * 0.55})`);
    grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Borde superior brillante (reflejo de la cinta)
  ctx.beginPath();
  for (let x = -30; x <= w + 30; x += 3) {
    const y = midY - baseAmp * 0.05 + waveY(x, phase, baseAmp, 0);
    if (x === -30) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 140)},${Math.min(255, rgb.g + 160)},${Math.min(255, rgb.b + 180)},${0.22 * b})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.restore();
}

function drawSparkles(ctx, w, h, rgb, dt, brightness, audioBoost) {
  const b = brightness / 100;
  const drift = 0.12 + audioBoost * 0.2;
  for (const s of sparkles) {
    s.x += s.speed * dt * drift;
    s.twinkle += dt * (2 + audioBoost * 2);
    if (s.x > 1.06) {
      s.x = -0.04;
      s.y = Math.random();
      s.z = randomBetween(0.25, 1);
    }
    // Concentrar partículas cerca de la cinta
    const band = 0.35 + Math.sin(s.x * Math.PI * 2 + wavePhase) * 0.08;
    const py = (band * 0.35 + s.y * 0.45) * h + h * 0.12;
    const px = s.x * w;
    const flicker = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(s.twinkle));
    const size = s.size * s.z * (1 + audioBoost * 0.25);
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.min(255, rgb.r + 130)},${Math.min(255, rgb.g + 150)},${Math.min(255, rgb.b + 170)},${flicker * 0.5 * b * s.z})`;
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawPs3Wave(dt) {
  if (!vp.context || vp.width <= 0 || vp.height <= 0) return;
  const ctx = vp.context;
  const w = vp.width;
  const h = vp.height;

  const bgMode = vp.ps3BgColorMode || 'classic';
  const waveMode = vp.ps3WaveColorMode || 'classic';
  const bgRgb = resolveColor(bgMode, vp.ps3BgColor, '#0a1a66');
  const waveRgb = resolveColor(waveMode, vp.ps3WaveColor, '#4a8cff');

  const brightness = clamp(Number(vp.ps3Brightness) || 100, 40, 100);
  const speed = clamp(Number(vp.ps3Speed) || 100, 25, 200) / 100;
  // Amplitud acotada para no deformar la cinta
  const amplitude = (clamp(Number(vp.ps3Amplitude) || 70, 40, 100) / 100) * Math.min(h * 0.14, 72);
  const reactive = vp.ps3AudioReactive !== false;

  let level = 0;
  if (reactive && typeof vp.audioLevelReader === 'function') {
    try {
      level = clamp(Number(vp.audioLevelReader()) || 0, 0, 1);
    } catch (_) {
      level = 0;
    }
  }
  // Suavizado: sigue el ritmo sin temblor
  audioSmooth += (level - audioSmooth) * Math.min(1, dt * 12);
  const audioBoost = reactive ? audioSmooth : 0;

  // El ritmo acelera un poco la onda y el brillo (no la forma)
  wavePhase += dt * speed * (0.55 + audioBoost * 0.85);
  if (wavePhase > Math.PI * 256) wavePhase -= Math.PI * 256;

  ensureSparkles(Number(vp.ps3ParticleCount) || 50);

  drawBackground(ctx, w, h, bgRgb, brightness);
  drawSilkRibbon(ctx, w, h, waveRgb, wavePhase, amplitude, audioBoost, brightness);
  drawSparkles(ctx, w, h, waveRgb, dt, brightness, audioBoost);
}

export function resetPs3Wave() {
  wavePhase = 0;
  audioSmooth = 0;
  sparkles = [];
}
