/**
 * Visual+ · Wave Sound
 * Visualizadores de espectro / forma de onda (barras, línea, EQ, puntos, bloques, área).
 */

import { vp } from './state.js';

const smoothed = [];
let peakBin = 0;
let peakSmooth = 0;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  if (h.length !== 6) return { r: 255, g: 255, b: 255 };
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

function resolveColor() {
  // Normalizar modo (por si quedó un valor viejo o vacío)
  const raw = String(vp.wsColorMode || 'custom').toLowerCase().trim();
  const mode = (raw === 'theme' || raw === 'artwork' || raw === 'custom') ? raw : 'custom';

  if (mode === 'theme') {
    const theme = vp.cachedThemeColor
      || getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim();
    if (theme.startsWith('#')) return hexToRgb(theme);
    const rgb = parseRgbString(theme);
    if (rgb) return rgb;
    return hexToRgb(vp.wsColor || '#ffffff');
  }

  if (mode === 'artwork') {
    if (vp._wsArtColor && typeof vp._wsArtColor.r === 'number') {
      return vp._wsArtColor;
    }
    // Sin muestra aún: no usar color custom “fantasma”; blanco suave
    return { r: 200, g: 200, b: 220 };
  }

  // custom (u otros): siempre el color elegido en el picker
  return hexToRgb(vp.wsColor || '#ffffff');
}

function sampleCoverOnce() {
  const img = document.querySelector('#player-cover-box img, #player-cover img, .player-cover img');
  if (!img?.src) return;
  const src = img.currentSrc || img.src;
  if (vp._wsArtSrc === src) return;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const im = new Image();
  try { im.crossOrigin = 'anonymous'; } catch (_) {}
  im.onload = () => {
    try {
      ctx.drawImage(im, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
      }
      if (n) {
        vp._wsArtColor = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
        vp._wsArtSrc = src;
      }
    } catch (_) {}
  };
  im.src = src;
}

function isAudioPlaying() {
  if (document.body.classList.contains('np-fs-audio-playing')) return true;
  const audio = document.getElementById('audio') || document.querySelector('audio');
  if (audio) return !audio.paused && !audio.ended;
  return false;
}

function readSpectrum(barCount) {
  const playing = isAudioPlaying();
  let data;
  if (playing && typeof vp.spectrumReader === 'function') {
    try {
      data = vp.spectrumReader(barCount);
    } catch (_) {
      data = null;
    }
  }
  if (!playing) {
    data = new Float32Array(barCount); // silencio
  } else if (!data || data.length === 0) {
    const level = typeof vp.audioLevelReader === 'function' ? Number(vp.audioLevelReader()) || 0 : 0;
    data = new Float32Array(barCount);
    for (let i = 0; i < barCount; i += 1) {
      data[i] = level * (0.4 + 0.6 * Math.sin(i * 0.5 + performance.now() * 0.004));
    }
  }

  const reactivity = clamp((Number(vp.wsReactivity) || 70) / 100, 0.05, 1);
  // En pausa decae rápido; en play, smooth según reactividad
  const smooth = playing ? (1 - reactivity) : 0.82;
  const intensity = clamp((Number(vp.wsIntensity) || 70) / 100, 0.2, 1.5);

  while (smoothed.length < barCount) smoothed.push(0);
  if (smoothed.length > barCount) smoothed.length = barCount;

  let maxI = 0;
  let maxV = 0;
  for (let i = 0; i < barCount; i += 1) {
    const target = playing ? clamp((Number(data[i]) || 0) * intensity, 0, 1) : 0;
    smoothed[i] = smoothed[i] * smooth + target * (1 - smooth);
    if (smoothed[i] < 0.008) smoothed[i] = 0;
    if (smoothed[i] > maxV) {
      maxV = smoothed[i];
      maxI = i;
    }
  }
  peakBin = maxI;
  peakSmooth = peakSmooth * 0.85 + maxV * 0.15;
  if (!playing) peakSmooth *= 0.85;
  return smoothed;
}

function resolveGlowColor(barRgb) {
  const mode = vp.wsGlowColorMode || 'same';
  if (mode === 'custom') return hexToRgb(vp.wsGlowColor || '#6ea8ff');
  if (mode === 'theme') {
    const theme = vp.cachedThemeColor
      || getComputedStyle(document.documentElement).getPropertyValue('--accent-light').trim();
    if (theme.startsWith('#')) return hexToRgb(theme);
    const rgb = parseRgbString(theme);
    if (rgb) return rgb;
  }
  return barRgb;
}

function drawPeakGlow(ctx, w, h, barRgb, position, barCount) {
  if (!vp.wsPeakGlow) return;
  const rgb = resolveGlowColor(barRgb);
  const intensity = Math.max(0.2, Math.min(1.5, (Number(vp.wsPeakGlowIntensity) || 100) / 100));
  const x = ((peakBin + 0.5) / barCount) * w;
  // Anclar el brillo cerca de donde están las barras (abajo o centro)
  const cy = position === 'center' ? h * 0.5 : h * 0.92;
  const strength = Math.max(0.15, peakSmooth) * intensity;
  const radius = Math.max(w, h) * (0.28 + strength * 0.4);

  // Halo amplio
  const g = ctx.createRadialGradient(x, cy, 0, x, cy, radius);
  g.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.45 * strength})`);
  g.addColorStop(0.35, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.22 * strength})`);
  g.addColorStop(0.7, `rgba(${rgb.r},${rgb.g},${rgb.b},${0.08 * strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Núcleo más intenso
  const core = ctx.createRadialGradient(x, cy, 0, x, cy, radius * 0.35);
  core.addColorStop(0, `rgba(${Math.min(255, rgb.r + 40)},${Math.min(255, rgb.g + 40)},${Math.min(255, rgb.b + 40)},${0.35 * strength})`);
  core.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, w, h);
}

function barGeometry(i, count, w, gapRatio) {
  const slot = w / count;
  const gap = slot * gapRatio;
  const bw = Math.max(1, slot - gap);
  const x = i * slot + gap * 0.5;
  return { x, bw, slot };
}

function drawBars(ctx, values, w, h, rgb, position, style) {
  const count = values.length;
  const scale = clamp((Number(vp.wsSize) || 100) / 100, 0.35, 1.6);
  const maxH = (position === 'center' ? h * 0.42 : h * 0.55) * scale;
  const gapRatio = style === 'blocks' ? 0.12 : style === 'eq' ? 0.28 : 0.45;
  const round = style === 'eq' || style === 'blocks';

  for (let i = 0; i < count; i += 1) {
    const v = values[i];
    const { x, bw } = barGeometry(i, count, w, gapRatio);
    const barH = Math.max(2, v * maxH);
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    if (position === 'center') {
      const y = h * 0.5 - barH;
      if (round) {
        roundRect(ctx, x, y, bw, barH * 2, Math.min(bw / 2, 4));
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, barH * 2);
      }
    } else {
      // Pegadas al borde inferior del canvas
      const y = h - barH;
      if (round) {
        roundRect(ctx, x, y, bw, barH, Math.min(bw / 2, 6));
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, barH);
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawDots(ctx, values, w, h, rgb, position) {
  const count = values.length;
  const scale = clamp((Number(vp.wsSize) || 100) / 100, 0.35, 1.6);
  const maxR = Math.min(w / count, h * 0.08) * scale * 1.2;
  for (let i = 0; i < count; i += 1) {
    const v = values[i];
    const { x, bw } = barGeometry(i, count, w, 0.2);
    const cx = x + bw / 2;
    const levels = Math.max(1, Math.round(v * 10 * scale));
    for (let k = 0; k < levels; k += 1) {
      let cy;
      if (position === 'center') {
        const mid = h * 0.5;
        const step = maxR * 1.35;
        cy = mid - (k + 0.5) * step * (k % 2 === 0 ? 1 : -1);
        // stack up and down alternating from center
        const up = Math.ceil((k + 1) / 2);
        const down = Math.floor(k / 2);
        if (k % 2 === 0) cy = mid - up * step;
        else cy = mid + down * step + step;
      } else {
        const step = maxR * 1.35;
        cy = h - h * 0.08 - (k + 0.5) * step;
      }
      const r = maxR * (0.55 + v * 0.45);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.75 + v * 0.25})`;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLineOrArea(ctx, values, w, h, rgb, position, filled) {
  const count = values.length;
  const scale = clamp((Number(vp.wsSize) || 100) / 100, 0.35, 1.6);
  const maxH = (position === 'center' ? h * 0.38 : h * 0.5) * scale;
  const baseline = position === 'center' ? h * 0.5 : h;

  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const x = (i / Math.max(1, count - 1)) * w;
    const y = baseline - values[i] * maxH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (position === 'center') {
    // mirror down
    for (let i = count - 1; i >= 0; i -= 1) {
      const x = (i / Math.max(1, count - 1)) * w;
      const y = baseline + values[i] * maxH;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
      ctx.fill();
    }
    ctx.strokeStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    ctx.stroke();
    return;
  }

  if (filled) {
    ctx.lineTo(w, baseline);
    ctx.lineTo(0, baseline);
    ctx.closePath();
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`;
    ctx.fill();
  }
  ctx.strokeStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  ctx.lineWidth = Math.max(1.5, 2.5 * scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

export function drawWaveSound(dt) {
  if (!vp.context || vp.width <= 0 || vp.height <= 0) return;
  const ctx = vp.context;
  const w = vp.width;
  const h = vp.height;
  let style = vp.wsStyle || 'bars';
  if (style === 'dots') style = 'bars';
  const position = vp.wsPosition || 'bottom';
  const barCount = clamp(Number(vp.wsBarCount) || 48, 8, 128);

  if (String(vp.wsColorMode || '').toLowerCase() === 'artwork') sampleCoverOnce();
  else { vp._wsArtColor = null; vp._wsArtSrc = null; }
  const rgb = resolveColor();
  const values = readSpectrum(barCount);

  const opacity = Math.max(0.15, Math.min(1, (Number(vp.wsOpacity) || 85) / 100));

  // Glow a pantalla completa (antes de las barras)
  drawPeakGlow(ctx, w, h, rgb, position, barCount);

  ctx.save();
  ctx.globalAlpha = opacity;

  // Altura completa del canvas: las barras se anclan al borde inferior real
  if (style === 'line') {
    drawLineOrArea(ctx, values, w, h, rgb, position, false);
  } else if (style === 'area') {
    drawLineOrArea(ctx, values, w, h, rgb, position, true);
  } else if (style === 'eq') {
    drawBars(ctx, values, w, h, rgb, position, 'eq');
  } else if (style === 'blocks') {
    drawBars(ctx, values, w, h, rgb, position, 'blocks');
  } else {
    drawBars(ctx, values, w, h, rgb, position, 'bars');
  }

  ctx.restore();

  // Capa semitransparente del color de fondo sobre las barras (legibilidad UI)
  if (vp.wsUiVeil) {
    const veil = Math.max(0.08, Math.min(0.55, (Number(vp.wsUiVeilOpacity) || 30) / 100));
    // Usar tono del fondo de la app
    let br = 8, bg = 10, bb = 16;
    try {
      const cs = getComputedStyle(document.documentElement);
      const raw = (cs.getPropertyValue('--bg-app') || cs.getPropertyValue('--bg') || '').trim();
      if (raw.startsWith('#')) {
        const h6 = raw.slice(1);
        if (h6.length === 6) {
          br = parseInt(h6.slice(0, 2), 16);
          bg = parseInt(h6.slice(2, 4), 16);
          bb = parseInt(h6.slice(4, 6), 16);
        }
      }
    } catch (_) {}
    ctx.fillStyle = `rgba(${br},${bg},${bb},${veil})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function resetWaveSound() {
  smoothed.length = 0;
  peakBin = 0;
  peakSmooth = 0;
}
