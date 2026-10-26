// Visual+ · Tema «Partículas reactivas» (theme = reactive_particles)
// Partículas que suben y reaccionan al nivel de audio; pueden tomar el color de la carátula.

import { randomBetween, vp } from './state.js';

export const MAX_PARTICLES = 150;

const artworkSampleCanvas = document.createElement('canvas');

artworkSampleCanvas.width = 16;

artworkSampleCanvas.height = 16;

const artworkSampleContext = artworkSampleCanvas.getContext('2d', { willReadFrequently: true });

export const particles = Array.from({ length: MAX_PARTICLES }, () => ({
  x: 0,
  y: 0,
  size: 1,
  opacity: 1,
  speed: 1,
  drift: 0,
  phase: 0
}));

let artworkSource = '';

let artworkColor = null;

let artworkSamplePendingSrc = null;

function particleSpawnX() {
  return vp.particleSpawnWidth === 'center'
    ? randomBetween(vp.width * 0.25, vp.width * 0.75)
    : Math.random() * vp.width;
}

export function resetParticle(particle, initialize = false) {
  particle.x = particleSpawnX();
  particle.y = initialize ? Math.random() * vp.height : vp.height + randomBetween(0, Math.max(1, vp.height * 0.12));
  particle.size = randomBetween(vp.particleMinSize, vp.particleMaxSize);
  particle.opacity = randomBetween(0.55, 1);
  particle.speed = randomBetween(0.7, 1.3);
  particle.drift = randomBetween(-7, 7);
  particle.phase = randomBetween(0, Math.PI * 2);
}

function sampleArtworkColor() {
  const image = document.querySelector('#player-cover-box img');
  const src = image?.currentSrc || image?.src || '';
  if (!src || !image.complete || !image.naturalWidth) return null;
  if (src === artworkSource) return artworkColor;

  // Muestreo async: evita canvas tainted por asset:// / http://asset.localhost sin CORS
  if (artworkSamplePendingSrc !== src) {
    artworkSamplePendingSrc = src;
    void sampleArtworkColorFromUrl(src);
  }
  return artworkColor;
}

async function sampleArtworkColorFromUrl(src) {
  if (!artworkSampleContext) {
    artworkSource = src;
    artworkColor = null;
    return;
  }
  try {
    let bitmap = null;
    try {
      const response = await fetch(src, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      bitmap = await createImageBitmap(blob);
    } catch (_) {
      // Fallback: Image + crossOrigin (sirve si el origen manda CORS)
      bitmap = await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          createImageBitmap(img).then(resolve).catch(reject);
        };
        img.onerror = () => reject(new Error('img load'));
        img.src = src;
      });
    }
    if (artworkSamplePendingSrc !== src) {
      try { bitmap.close?.(); } catch (_) {}
      return;
    }
    artworkSampleContext.clearRect(0, 0, artworkSampleCanvas.width, artworkSampleCanvas.height);
    artworkSampleContext.drawImage(bitmap, 0, 0, artworkSampleCanvas.width, artworkSampleCanvas.height);
    try { bitmap.close?.(); } catch (_) {}
    const pixels = artworkSampleContext.getImageData(0, 0, artworkSampleCanvas.width, artworkSampleCanvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      const a = pixels[i + 3];
      if (a < 32) continue;
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      count += 1;
    }
    if (!count) {
      artworkSource = src;
      artworkColor = null;
      return;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    artworkSource = src;
    artworkColor = `rgb(${r}, ${g}, ${b})`;
  } catch (_) {
    // Silencioso: se usa el color del tema
    if (artworkSamplePendingSrc === src) {
      artworkSource = src;
      artworkColor = null;
    }
  }
}

function particleFillStyle() {
  let color = vp.particleColor;
  if (vp.particleColorMode === 'theme' || vp.particleColorMode === 'artwork') {
    color = vp.particleColorMode === 'artwork'
      ? sampleArtworkColor() || vp.cachedThemeColor
      : vp.cachedThemeColor;
  }
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (match) {
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [192, 132, 252];
}

export function drawParticles(dt) {
  const level = Math.max(0, Math.min(1, vp.audioLevelReader()));
  const speedMultiplier = 1 + vp.particleIntensity * level;
  const [red, green, blue] = particleFillStyle();
  for (let index = 0; index < vp.particleCount; index += 1) {
    const particle = particles[index];
    particle.phase += dt * 1.4;
    particle.y -= vp.particleSpeed * particle.speed * speedMultiplier * dt;
    particle.x += (particle.drift + Math.sin(particle.phase) * 2) * dt;
    if (particle.y < -particle.size) {
      resetParticle(particle);
    }
    const audioBrightness = 0.7 + level * 0.3;
    vp.context.globalAlpha = vp.particleOpacity / 100 * particle.opacity * audioBrightness;
    vp.context.beginPath();
    vp.context.arc(particle.x, particle.y, particle.size * (1 + level * 0.15) * 0.5, 0, Math.PI * 2);
    vp.context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
    if (vp.particleGlow) {
      vp.context.shadowColor = `rgba(${red}, ${green}, ${blue}, 0.8)`;
      vp.context.shadowBlur = 7;
    }
    vp.context.fill();
    vp.context.shadowBlur = 0;
  }
  vp.context.globalAlpha = 1;
}
