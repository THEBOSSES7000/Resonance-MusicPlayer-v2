// Audio · Barra de progreso, tiempos, calidad de audio y estilo de progreso.

import { WAVEFORM_PEAK_COUNT, audioVars } from './sharedState.js';
import { audioQualityEl, crossfadeIndicator, playbackBar, playbackRow, progressContainer, progressFill, progressWavePlayed, timeCurrentEl, timeTotalEl } from './dom.js';
import { updateTaskbarPlaybackProgress } from './windowIntegration.js';
import { audio } from './playback.js';
import { formatTime, state } from '../state.js';
import { updatePlayerMinimumHeight } from './playerSizing.js';
import { initializeProgressWaveforms, loadWaveformForTrack, releaseWaveformCanvases } from './waveform.js';
import { getPlaybackDuration, seekPlayback } from './position.js';

export let lastProgressRatio = 0;

const CONTINUOUS_WAVE_LAYERS = [
  { color: '--accent-secondary', fallback: '--accent-light', wavelength: 112, amplitude: 10, opacity: 0.42, phaseOffset: 0 },
  { color: '--accent-purple', fallback: '--accent-light', wavelength: 78, amplitude: 8, opacity: 0.62, phaseOffset: 1.1 },
  { color: '--accent-tertiary', fallback: '--accent-secondary', wavelength: 52, amplitude: 6, opacity: 0.76, phaseOffset: 2.4 },
  { color: '--accent-light', fallback: '--accent-purple', wavelength: 36, amplitude: 4, opacity: 0.86, phaseOffset: 3.2 },
];

let continuousWaveCanvas;
let continuousWaveContext;
let continuousWaveFrame = 0;
let continuousWaveLastFrameTime = 0;
let continuousWavePhase = 0;
let continuousWaveAmplitude = 0;
let continuousWaveColors = [];

function isContinuousWaveEnabled() {
  return progressContainer.dataset.progressStyle === 'solid'
    && progressContainer.dataset.animated === 'true'
    && progressContainer.dataset.animationStyle === 'continuous';
}

function readContinuousWaveTheme() {
  const styles = getComputedStyle(document.documentElement);
  continuousWaveColors = CONTINUOUS_WAVE_LAYERS.map(({ color, fallback }) => (
    styles.getPropertyValue(color).trim()
      || styles.getPropertyValue(fallback).trim()
      || '#ffffff'
  ));
  drawContinuousWave();
}

function drawContinuousWave() {
  if (!continuousWaveCanvas || !continuousWaveContext || !isContinuousWaveEnabled()) return;

  const rect = progressFill.getBoundingClientRect();
  const width = rect.width;
  const isProgressAtTop = document.getElementById('bottom-player')?.classList.contains('progress-at-top');
  const height = 26;
  const amplitudeScale = isProgressAtTop ? 0.65 : 1;
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
  const pixelHeight = Math.round(height * pixelRatio);

  if (continuousWaveCanvas.width !== pixelWidth || continuousWaveCanvas.height !== pixelHeight) {
    continuousWaveCanvas.width = pixelWidth;
    continuousWaveCanvas.height = pixelHeight;
  }

  continuousWaveCanvas.style.width = `${width}px`;
  continuousWaveContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  continuousWaveContext.clearRect(0, 0, width, height);
  if (width <= 0) return;

  const context = continuousWaveContext;
  const baseline = isProgressAtTop ? height - 1 : height / 2;
  const envelopePower = 0.72;
  context.globalCompositeOperation = 'screen';

  CONTINUOUS_WAVE_LAYERS.forEach((layer, index) => {
    const color = continuousWaveColors[index];
    if (!color) return;

    context.beginPath();
    context.moveTo(0, baseline);
    for (let x = 0; x <= width; x += 2) {
      const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * x / width)), envelopePower);
      const wave = (Math.sin((x / layer.wavelength) * Math.PI * 2 - continuousWavePhase + layer.phaseOffset) + 1) / 2;
      const crest = wave * layer.amplitude * amplitudeScale * envelope * continuousWaveAmplitude;
      context.lineTo(x, baseline - crest);
    }
    context.lineTo(width, baseline);
    context.closePath();
    context.globalAlpha = layer.opacity;
    context.fillStyle = color;
    context.fill();
  });

  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 0.88;
  context.strokeStyle = continuousWaveColors[1] || '#ffffff';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(0, baseline);
  context.lineTo(width, baseline);
  context.stroke();
  context.globalAlpha = 1;
}

function continuousWaveAnimationFrame(timestamp) {
  continuousWaveFrame = 0;
  if (!isContinuousWaveEnabled()) return;

  const elapsed = continuousWaveLastFrameTime
    ? Math.min((timestamp - continuousWaveLastFrameTime) / 1000, 0.05)
    : 0;
  continuousWaveLastFrameTime = timestamp;

  const isPlaying = document.getElementById('bottom-player')?.classList.contains('is-playing');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targetAmplitude = isPlaying && !prefersReducedMotion ? 1 : 0;
  const easing = 1 - Math.exp(-elapsed * (targetAmplitude ? 4.5 : 6));
  continuousWaveAmplitude += (targetAmplitude - continuousWaveAmplitude) * easing;

  if (targetAmplitude) continuousWavePhase += elapsed * 2.2;
  drawContinuousWave();

  if (targetAmplitude || continuousWaveAmplitude > 0.01) {
    continuousWaveFrame = window.requestAnimationFrame(continuousWaveAnimationFrame);
  } else {
    continuousWaveLastFrameTime = 0;
  }
}

function scheduleContinuousWaveFrame() {
  if (continuousWaveFrame || !isContinuousWaveEnabled()) return;
  continuousWaveFrame = window.requestAnimationFrame(continuousWaveAnimationFrame);
}

function syncContinuousWave() {
  if (!continuousWaveCanvas || !isContinuousWaveEnabled()) {
    if (continuousWaveFrame) window.cancelAnimationFrame(continuousWaveFrame);
    continuousWaveFrame = 0;
    continuousWaveLastFrameTime = 0;
    continuousWaveAmplitude = 0;
    if (continuousWaveContext && continuousWaveCanvas) {
      continuousWaveContext.clearRect(0, 0, continuousWaveCanvas.width, continuousWaveCanvas.height);
    }
    return;
  }

  scheduleContinuousWaveFrame();
}

function initializeContinuousWave() {
  if (!progressFill || continuousWaveCanvas) return;

  continuousWaveCanvas = document.createElement('canvas');
  continuousWaveCanvas.className = 'progress-wave-canvas';
  continuousWaveCanvas.setAttribute('aria-hidden', 'true');
  continuousWaveContext = continuousWaveCanvas.getContext('2d');
  progressFill.prepend(continuousWaveCanvas);

  new ResizeObserver(() => {
    drawContinuousWave();
  }).observe(progressFill);

  new MutationObserver(syncContinuousWave).observe(progressContainer, {
    attributes: true,
    attributeFilter: ['data-progress-style', 'data-animated', 'data-animation-style'],
  });

  const player = document.getElementById('bottom-player');
  if (player) {
    new MutationObserver(syncContinuousWave).observe(player, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  new MutationObserver(readContinuousWaveTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  });

  readContinuousWaveTheme();
  syncContinuousWave();
}

export function updateCrossfadeIndicator() {
  const isVisible = audioVars.crossfadeVisualActive && audioVars.crossfadeIndicatorEnabled;
  playbackRow?.classList.toggle('crossfade-active', isVisible);
  crossfadeIndicator?.setAttribute('aria-hidden', String(!isVisible));
}

export function setProgressVisual(ratio) {
  lastProgressRatio = Math.max(0, Math.min(1, ratio));
  progressFill.style.width = `${lastProgressRatio * 100}%`;
  progressContainer.style.setProperty('--progress-ratio', `${lastProgressRatio * 100}%`);
  if (progressWavePlayed) progressWavePlayed.style.width = `${progressContainer.clientWidth}px`;
  drawContinuousWave();
  updateTaskbarPlaybackProgress();
}

export function resetProgressVisual() {
  setProgressVisual(0);
}

export function updateProgressTimes(currentTime = audio.currentTime, duration = audio.duration) {
  timeCurrentEl.textContent = formatTime(currentTime);
  const showRemaining = audioVars.showRemainingTime && progressContainer.dataset.progressStyle === 'waveform';
  timeTotalEl.textContent = showRemaining && Number.isFinite(duration) && duration >= 0
    ? `-${formatTime(Math.max(0, duration - currentTime))}`
    : formatTime(duration);
}

function getAudioQualityLabel(track) {
  const codec = String(track?.codec || '').toLowerCase();
  const extension = String(track?.file?.name || track?.file?.path || '').split('.').pop().toLowerCase();
  const isLossless = /flac|pcm|lossless|alac|wav/.test(codec) || ['flac', 'wav'].includes(extension);
  if (!isLossless) return 'Estándar';

  const sampleRate = Number(track?.sampleRate);
  const bitDepth = Number(track?.bitDepth);
  return sampleRate > 48000 || bitDepth > 16 ? 'Hi-Res' : 'Lossless';
}

export function updateAudioQuality(track) {
  if (!audioQualityEl) return;
  const quality = track ? getAudioQualityLabel(track) : '';
  audioQualityEl.textContent = quality;
  audioQualityEl.dataset.qualityLevel = quality === 'Hi-Res' || quality === 'Lossless'
    ? 'lossless'
    : quality ? 'standard' : '';
}

export function setProgressStyle(style) {
  initializeContinuousWave();
  progressContainer.dataset.progressStyle = style;
  playbackBar?.classList.toggle('is-waveform-split', audioVars.showRemainingTime && style === 'waveform');
  updatePlayerMinimumHeight();
  updateProgressTimes();
  if (style === 'waveform') {
    const track = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
    if (track) void loadWaveformForTrack(track);
    else initializeProgressWaveforms();
  } else {
    releaseWaveformCanvases();
  }
}

export function updateSeekPosition(clientX, { commit = false } = {}) {
  const dur = getPlaybackDuration();
  if (!Number.isFinite(dur) || dur <= 0) return;
  const rect = progressContainer.getBoundingClientRect();
  if (rect.width <= 0) return;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const dest = ratio * dur;
  audioVars.pendingSeekSeconds = dest;
  setProgressVisual(ratio);
  progressContainer.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  updateProgressTimes(dest, dur);
  if (commit) {
    if (audioVars.nativeAudioActive) {
      void seekPlayback(dest);
    } else if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = dest;
    }
  }
}

export function updateProgressPreview(clientX) {
  const duration = getPlaybackDuration();
  const rect = progressContainer.getBoundingClientRect();
  if (!Number.isFinite(duration) || duration <= 0 || rect.width <= 0) {
    clearProgressPreview();
    return;
  }
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  progressContainer.dataset.previewTime = formatTime(ratio * duration);
  progressContainer.style.setProperty('--progress-hover-x', `${ratio * 100}%`);
}

export function clearProgressPreview() {
  progressContainer.removeAttribute('data-preview-time');
  progressContainer.style.removeProperty('--progress-hover-x');
}

initializeContinuousWave();
