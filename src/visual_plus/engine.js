// Visual+ · Motor del lienzo
// Monta el canvas sobre la vista de letras, controla el bucle de animación, aplica los ajustes
// y delega el dibujo en el tema activo. El tema «liquid_gradient» vive aparte (liquid_gradient.js).

import { DEFAULT_SETTINGS, MAX_TRAIL_LENGTH, lyricsOverlay, randomBetween, settingsOverlay, vp } from './state.js';
import { MAX_SHOOTING_STARS, MAX_STARS, drawShootingStars, drawStaticStars, fillStar, shootingStars, stars } from './shooting_stars.js';
import { MAX_PARTICLES, drawParticles, particles, resetParticle } from './reactive_particles.js';
import { MAX_FIREFLIES, drawFireflies, fireflies, resetFirefly } from './fireflies.js';
import { MAX_RAIN_DROPS, drawRain, rainDrops, resetRainDrop } from './rain.js';
import { drawPs3Wave, resetPs3Wave } from './ps3_wave.js';
import { drawWaveSound, resetWaveSound } from './wave_sound.js';

let rafId = 0;

let lastTimestamp = 0;

let resizeObserver = null;

let intersectionObserver = null;

let lifecycleObserver = null;

let initialized = false;

let canvasBufferReleased = false;

let audioAnalysisConfigurer = null;

let audioAnalysisActive = false;

function refreshCachedThemeColor() {
  vp.cachedThemeColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-light')
    .trim();
}

function resizeCanvas() {
  if (!vp.canvas || !vp.context || !lyricsOverlay) return;
  canvasBufferReleased = false;
  const bounds = lyricsOverlay.getBoundingClientRect();
  vp.width = bounds.width;
  vp.height = bounds.height;
  vp.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  vp.canvas.width = Math.max(1, Math.round(vp.width * vp.pixelRatio));
  vp.canvas.height = Math.max(1, Math.round(vp.height * vp.pixelRatio));
  vp.context.setTransform(vp.pixelRatio, 0, 0, vp.pixelRatio, 0, 0);
  for (let index = 0; index < MAX_STARS; index += 1) {
    fillStar(stars[index], true);
  }
  for (let index = 0; index < MAX_SHOOTING_STARS; index += 1) {
    shootingStars[index].active = false;
  }
  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    resetParticle(particles[index], true);
  }
  for (let index = 0; index < MAX_FIREFLIES; index += 1) {
    resetFirefly(fireflies[index], true);
  }
  for (let index = 0; index < MAX_RAIN_DROPS; index += 1) {
    resetRainDrop(rainDrops[index], true);
  }
}

function releaseCanvasBuffer() {
  if (!vp.canvas || !vp.context || canvasBufferReleased) return;
  vp.context.setTransform(1, 0, 0, 1, 0, 0);
  vp.context.clearRect(0, 0, vp.canvas.width, vp.canvas.height);
  vp.canvas.width = 1;
  vp.canvas.height = 1;
  vp.context.clearRect(0, 0, 1, 1);
  vp.width = 0;
  vp.height = 0;
  canvasBufferReleased = true;
}

function prepareTrail() {
  vp.trailCanvas = document.createElement('canvas');
  vp.trailCanvas.width = MAX_TRAIL_LENGTH;
  vp.trailCanvas.height = 2;
  vp.trailContext = vp.trailCanvas.getContext('2d');
  if (!vp.trailContext) throw new Error('No se pudo crear el lienzo de la estela Visual+.');
  const gradient = vp.trailContext.createLinearGradient(0, 0, MAX_TRAIL_LENGTH, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
  vp.trailContext.fillStyle = gradient;
  vp.trailContext.fillRect(0, 0, MAX_TRAIL_LENGTH, 2);
}

function mountCanvas() {
  if (!lyricsOverlay || vp.canvas) return;
  vp.canvas = document.createElement('canvas');
  vp.canvas.id = 'visual-plus-canvas';
  vp.canvas.setAttribute('aria-hidden', 'true');
  vp.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  vp.context = vp.canvas.getContext('2d');
  if (!vp.context) throw new Error('No se pudo inicializar el lienzo Visual+.');
  lyricsOverlay.insertBefore(vp.canvas, lyricsOverlay.firstChild);
  prepareTrail();
  for (let index = 0; index < MAX_STARS; index += 1) {
    fillStar(stars[index], true);
  }
  if (lyricsOverlay.classList.contains('open')) resizeCanvas();
  else releaseCanvasBuffer();
}

function readSettings() {
  const stored = localStorage.getItem('pn_visual_plus');
  if (stored === null) return { ...DEFAULT_SETTINGS };
  const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  if (parsed.theme === 'liquid_immersive') parsed.theme = 'liquid';
  if (parsed.theme === 'liquid_gradient') parsed.theme = 'blurred';
  if (typeof parsed.enabled !== 'boolean' ||
      !(['shooting_stars', 'reactive_particles', 'atmospheric', 'ps3_wave', 'wave_sound', 'liquid', 'blurred', 'liquid_gradient', 'liquid_immersive'].includes(parsed.theme)) ||
      !Number.isInteger(parsed.starCount) || parsed.starCount < 20 || parsed.starCount > MAX_STARS ||
      !Number.isInteger(parsed.starBrightness) || parsed.starBrightness < 10 || parsed.starBrightness > 100 ||
      !Number.isInteger(parsed.shootingStarCount) || parsed.shootingStarCount < 1 || parsed.shootingStarCount > MAX_SHOOTING_STARS ||
      !Number.isInteger(parsed.shootingInterval) || parsed.shootingInterval < 1 || parsed.shootingInterval > 10 ||
      !Number.isInteger(parsed.shootingSpeed) || parsed.shootingSpeed < 50 || parsed.shootingSpeed > 200 ||
      !Number.isInteger(parsed.trailLength) || parsed.trailLength < 80 || parsed.trailLength > MAX_TRAIL_LENGTH ||
      !Number.isInteger(parsed.particleCount) || parsed.particleCount < 20 || parsed.particleCount > MAX_PARTICLES ||
      !Number.isInteger(parsed.particleSpeed) || parsed.particleSpeed < 10 || parsed.particleSpeed > 80 ||
      !Number.isFinite(parsed.particleIntensity) || parsed.particleIntensity < 0 || parsed.particleIntensity > 3 ||
      !Number.isInteger(parsed.particleMinSize) || parsed.particleMinSize < 1 || parsed.particleMinSize > 8 ||
      !Number.isInteger(parsed.particleMaxSize) || parsed.particleMaxSize < 1 || parsed.particleMaxSize > 12 ||
      parsed.particleMinSize > parsed.particleMaxSize ||
      !Number.isInteger(parsed.particleOpacity) || parsed.particleOpacity < 10 || parsed.particleOpacity > 100 ||
      !['theme', 'artwork', 'custom'].includes(parsed.particleColorMode) ||
      !/^#[0-9a-f]{6}$/i.test(parsed.particleColor) ||
      !['full', 'center'].includes(parsed.particleSpawnWidth) ||
      typeof parsed.particleGlow !== 'boolean' ||
      typeof parsed.firefliesEnabled !== 'boolean' ||
      !Number.isInteger(parsed.firefliesCount) || parsed.firefliesCount < 5 || parsed.firefliesCount > MAX_FIREFLIES ||
      !Number.isInteger(parsed.firefliesSize) || parsed.firefliesSize < 2 || parsed.firefliesSize > 8 ||
      !Number.isInteger(parsed.firefliesBrightness) || parsed.firefliesBrightness < 0 || parsed.firefliesBrightness > 100 ||
      typeof parsed.rainEnabled !== 'boolean' ||
      !Number.isInteger(parsed.rainCount) || parsed.rainCount < 20 || parsed.rainCount > MAX_RAIN_DROPS ||
      !['vertical', 'diagonal-left', 'diagonal-right'].includes(parsed.rainDirection) ||
      !Number.isInteger(parsed.rainBaseSpeed) || parsed.rainBaseSpeed < 60 || parsed.rainBaseSpeed > 500 ||
      !Number.isInteger(parsed.rainBaseOpacity) || parsed.rainBaseOpacity < 10 || parsed.rainBaseOpacity > 100 ||
      typeof parsed.rainDynamicEnabled !== 'boolean' ||
      !Number.isFinite(parsed.rainIntensityMultiplier) || parsed.rainIntensityMultiplier < 0.5 || parsed.rainIntensityMultiplier > 3 ||
      !Number.isFinite(parsed.rainMinDensity) || parsed.rainMinDensity < 0.2 || parsed.rainMinDensity > 1) {
    throw new Error('La configuración de Visual+ no es válida.');
  }
  return parsed;
}

function canAnimate() {
  return vp.enabled &&
    ['shooting_stars', 'reactive_particles', 'atmospheric', 'ps3_wave', 'wave_sound'].includes(vp.theme) &&
    (vp.theme !== 'atmospheric' || vp.firefliesEnabled || vp.rainEnabled) &&
    (vp.theme !== 'ps3_wave' || true) &&
    vp.intersecting &&
    document.visibilityState === 'visible' &&
    lyricsOverlay?.classList.contains('open') &&
    !settingsOverlay?.classList.contains('open') &&
    vp.width > 0 &&
    vp.height > 0;
}

function stopAnimation() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  lastTimestamp = 0;
}

function syncAnimation() {
  const lyricsAreOpen = Boolean(lyricsOverlay?.classList.contains('open'));
  if (lyricsAreOpen) {
    if (canvasBufferReleased) resizeCanvas();
    const bounds = lyricsOverlay.getBoundingClientRect();
    vp.intersecting = bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.right > 0 &&
      bounds.bottom > 0 &&
      bounds.left < window.innerWidth &&
      bounds.top < window.innerHeight;
  } else {
    vp.intersecting = false;
    stopAnimation();
    releaseCanvasBuffer();
    return;
  }
  if (!canAnimate()) {
    stopAnimation();
    return;
  }
  if (!rafId) {
    lastTimestamp = 0;
    rafId = requestAnimationFrame(draw);
  }
}

function syncVisualPlusSurface() {
  document.body.classList.toggle(
    'visual-plus-lyrics-active',
    vp.enabled &&
      Boolean(lyricsOverlay?.classList.contains('open')) &&
      !settingsOverlay?.classList.contains('open')
  );
}

function draw(timestamp) {
  rafId = 0;
  if (!canAnimate()) return;

  const dt = lastTimestamp === 0
    ? 0
    : Math.min((timestamp - lastTimestamp) / 1000, 0.05);
  lastTimestamp = timestamp;
  vp.context.globalAlpha = 1;
  vp.context.clearRect(0, 0, vp.width, vp.height);
  if (vp.theme === 'shooting_stars') {
    drawStaticStars(dt);
    drawShootingStars(dt);
  } else if (vp.theme === 'reactive_particles') {
    drawParticles(dt);
  } else if (vp.theme === 'ps3_wave') {
    drawPs3Wave(dt);
  } else if (vp.theme === 'wave_sound') {
    drawWaveSound(dt);
  } else {
    drawRain(dt);
    drawFireflies(dt);
  }
  rafId = requestAnimationFrame(draw);
}

function applySettings(settings) {
  const shouldAnalyzeAudio = settings.enabled && (
    settings.theme === 'reactive_particles' ||
    (settings.theme === 'atmospheric' && settings.rainEnabled && settings.rainDynamicEnabled) ||
    (settings.theme === 'ps3_wave' && settings.ps3AudioReactive !== false) ||
    settings.theme === 'wave_sound'
  );
  vp.enabled = settings.enabled && !['liquid', 'blurred', 'liquid_gradient', 'liquid_immersive'].includes(settings.theme);
  vp.theme = settings.theme;
  vp.starCount = settings.starCount;
  vp.starBrightness = settings.starBrightness;
  stars.forEach(star => {
    star.maxAlpha = star.baseMaxAlpha * vp.starBrightness / 100;
  });
  vp.shootingStarCount = settings.shootingStarCount;
  vp.shootingInterval = settings.shootingInterval;
  vp.shootingSpeed = settings.shootingSpeed;
  vp.trailLength = settings.trailLength;
  vp.particleCount = settings.particleCount;
  vp.particleSpeed = settings.particleSpeed;
  vp.particleIntensity = settings.particleIntensity;
  vp.particleMinSize = settings.particleMinSize;
  vp.particleMaxSize = settings.particleMaxSize;
  vp.particleOpacity = settings.particleOpacity;
  vp.particleColorMode = settings.particleColorMode;
  vp.particleColor = settings.particleColor;
  vp.particleSpawnWidth = settings.particleSpawnWidth;
  vp.particleGlow = settings.particleGlow;
  vp.firefliesEnabled = settings.firefliesEnabled;
  vp.firefliesCount = settings.firefliesCount;
  vp.firefliesSize = settings.firefliesSize;
  vp.firefliesBrightness = settings.firefliesBrightness;
  vp.rainEnabled = settings.rainEnabled;
  vp.rainCount = settings.rainCount;
  vp.rainDirection = settings.rainDirection;
  vp.rainBaseSpeed = settings.rainBaseSpeed;
  vp.rainBaseOpacity = settings.rainBaseOpacity;
  vp.rainDynamicEnabled = settings.rainDynamicEnabled;
  vp.rainIntensityMultiplier = settings.rainIntensityMultiplier;
  vp.rainMinDensity = settings.rainMinDensity;
  vp.ps3BgColorMode = settings.ps3BgColorMode ?? 'classic';
  vp.ps3BgColor = settings.ps3BgColor ?? '#0a1a66';
  vp.ps3WaveColorMode = settings.ps3WaveColorMode ?? 'classic';
  vp.ps3WaveColor = settings.ps3WaveColor ?? '#4a8cff';
  vp.ps3Speed = settings.ps3Speed ?? 100;
  vp.ps3Amplitude = settings.ps3Amplitude ?? 70;
  vp.ps3ParticleCount = settings.ps3ParticleCount ?? 50;
  vp.ps3Brightness = settings.ps3Brightness ?? 100;
  vp.ps3AudioReactive = settings.ps3AudioReactive !== false;
  vp.wsStyle = settings.wsStyle || 'bars';
  vp.wsPosition = settings.wsPosition || 'bottom';
  vp.wsColorMode = ['custom', 'theme', 'artwork'].includes(settings.wsColorMode) ? settings.wsColorMode : 'custom';
  vp.wsColor = (typeof settings.wsColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(settings.wsColor))
    ? settings.wsColor
    : '#ffffff';
  vp.wsBarCount = settings.wsBarCount ?? 48;
  vp.wsSize = settings.wsSize ?? 100;
  vp.wsReactivity = settings.wsReactivity ?? 70;
  vp.wsIntensity = settings.wsIntensity ?? 70;
  vp.wsPeakGlow = settings.wsPeakGlow !== false;
  vp.wsOpacity = settings.wsOpacity ?? 85;
  vp.wsPeakGlowIntensity = settings.wsPeakGlowIntensity ?? 100;
  vp.wsUiVeil = Boolean(settings.wsUiVeil);
  vp.wsUiVeilOpacity = settings.wsUiVeilOpacity ?? 30;
  vp.wsGlowColorMode = settings.wsGlowColorMode || 'same';
  vp.wsGlowColor = settings.wsGlowColor || '#6ea8ff';
  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    particles[index].size = randomBetween(vp.particleMinSize, vp.particleMaxSize);
  }
  for (let index = 0; index < MAX_FIREFLIES; index += 1) {
    const firefly = fireflies[index];
    firefly.size = randomBetween(vp.firefliesSize * 0.55, vp.firefliesSize);
    if (firefly.x === 0 && firefly.y === 0) resetFirefly(firefly, true);
  }
  if (shouldAnalyzeAudio !== audioAnalysisActive) {
    audioAnalysisActive = shouldAnalyzeAudio;
    if (audioAnalysisConfigurer) {
      Promise.resolve(audioAnalysisConfigurer(shouldAnalyzeAudio)).then(available => {
        if (audioAnalysisActive && !available) {
          console.warn('El análisis de audio no está disponible; los efectos reactivos usarán su nivel base.');
        }
      }).catch(error => {
        console.error('No se pudo configurar el análisis de audio de Visual+:', error);
      });
    }
  }
  vp.spawnCountdown = vp.shootingInterval;
  for (let index = vp.shootingStarCount; index < MAX_SHOOTING_STARS; index += 1) {
    shootingStars[index].active = false;
  }
  if (lyricsOverlay) {
    lyricsOverlay.classList.toggle('visual-plus-active', vp.enabled);
  }
  if (vp.canvas) {
    if (!vp.enabled) {
      if (vp.context) {
        try { vp.context.clearRect(0, 0, vp.canvas.width, vp.canvas.height); } catch (_) {}
      }
      vp.canvas.style.opacity = '0';
      vp.canvas.style.visibility = 'hidden';
    } else {
      vp.canvas.style.opacity = '';
      vp.canvas.style.visibility = '';
    }
  }
  syncVisualPlusSurface();
  syncAnimation();
}

export function initShootingStars(readAudioLevel = () => 0, configureAudioAnalysis = null, readSpectrum = null) {
  if (initialized || !lyricsOverlay || !settingsOverlay) return;
  initialized = true;
  vp.audioLevelReader = typeof readAudioLevel === 'function' ? readAudioLevel : () => 0;
  vp.spectrumReader = typeof readSpectrum === 'function' ? readSpectrum : null;
  audioAnalysisConfigurer = typeof configureAudioAnalysis === 'function' ? configureAudioAnalysis : null;
  mountCanvas();

  resizeObserver = new ResizeObserver(() => {
    if (lyricsOverlay.classList.contains('open')) resizeCanvas();
    syncAnimation();
  });
  resizeObserver.observe(lyricsOverlay);

  intersectionObserver = new IntersectionObserver(entries => {
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].target === lyricsOverlay) {
        vp.intersecting = entries[index].isIntersecting && entries[index].intersectionRatio > 0;
      }
    }
    syncAnimation();
  });
  intersectionObserver.observe(lyricsOverlay);

  lifecycleObserver = new MutationObserver(() => {
    syncVisualPlusSurface();
    syncAnimation();
  });
  lifecycleObserver.observe(lyricsOverlay, { attributes: true, attributeFilter: ['class'] });
  lifecycleObserver.observe(settingsOverlay, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', syncAnimation);
  window.addEventListener('resize', () => {
    if (lyricsOverlay.classList.contains('open')) resizeCanvas();
    syncAnimation();
  }, { passive: true });
  document.addEventListener('pn-visual-plus-settings-changed', event => {
    refreshCachedThemeColor();
    applySettings(event.detail);
  });

  refreshCachedThemeColor();
  new MutationObserver(refreshCachedThemeColor).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
  applySettings(readSettings());
}
