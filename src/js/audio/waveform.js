// Audio · Forma de onda de la barra de progreso.

import { WAVEFORM_PEAK_COUNT, audioVars } from './sharedState.js';
import { playbackBar, progressContainer, progressWavePlayed, progressWaveTrack } from './dom.js';
import { lastProgressRatio, setProgressVisual, updateProgressTimes } from './progressUI.js';
import { nativeAudioEnabled, nativeInvoke } from './nativeEngine.js';
import { updatePlayerMinimumHeight } from './playerSizing.js';
import { state } from '../state.js';

function waveformLevelAt(index, count = audioVars.waveformBarCount) {
  if (audioVars.waveformPeaks && audioVars.waveformPeaks.length > 0) {
    const n = audioVars.waveformPeaks.length;
    if (n === count) return Math.max(0, Math.min(1, audioVars.waveformPeaks[index] || 0));
    const t = index / Math.max(1, count - 1);
    const pos = t * (n - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(n - 1, i0 + 1);
    const frac = pos - i0;
    return Math.max(0, Math.min(1, (audioVars.waveformPeaks[i0] || 0) * (1 - frac) + (audioVars.waveformPeaks[i1] || 0) * frac));
  }
  return 0.28;
}

function createWaveformSvg() {
  const count = audioVars.waveformBarCount;
  const points = [];
  for (let index = 0; index < count; index++) {
    const progress = index / Math.max(1, count - 1);
    const level = waveformLevelAt(index, count);
    points.push(`${(progress * 1000).toFixed(1)},${(100 - level * 92).toFixed(1)}`);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M0 100 L${points.join(' L')} L1000 100 Z`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'progress-wave-svg');
  svg.appendChild(path);
  return svg;
}

/**
 * Reutiliza el mismo elemento <canvas> dentro del contenedor para no crear ni abandonar
 * buffers de bitmap 2D en cada pista o cambio de modo.
 */
function renderWaveformBarsOnCanvas(container, colorCss) {
  if (!container) return;
  const count = audioVars.waveformBarCount;
  let canvas = container.querySelector('canvas.progress-wave-canvas');
  if (!canvas || container.children.length !== 1) {
    container.replaceChildren();
    canvas = document.createElement('canvas');
    canvas.className = 'progress-wave-canvas';
    container.appendChild(canvas);
  }
  const w = Math.max(count * 4, 800);
  const h = 100;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colorCss;
  const slot = w / count;
  const barW = Math.max(1.5, slot * 0.58);
  const minH = h * 0.08;
  const maxH = h * 0.62;
  for (let i = 0; i < count; i++) {
    const level = waveformLevelAt(i, count);
    const barH = minH + level * (maxH - minH);
    const x = i * slot + (slot - barW) * 0.5;
    ctx.fillRect(x, h - barH, barW, barH);
  }
}

export function releaseWaveformCanvases() {
  [progressWaveTrack, progressWavePlayed].forEach(container => {
    if (!container) return;
    container.querySelectorAll('canvas').forEach(c => {
      c.width = 1;
      c.height = 1;
    });
    container.replaceChildren();
  });
}

export function initializeProgressWaveforms() {
  if (!progressWaveTrack || !progressWavePlayed) return;
  if (progressContainer?.dataset?.progressStyle !== 'waveform') {
    releaseWaveformCanvases();
    return;
  }
  if (audioVars.waveformMode === 'smooth') {
    releaseWaveformCanvases();
    progressWaveTrack.replaceChildren(createWaveformSvg());
    progressWavePlayed.replaceChildren(createWaveformSvg());
  } else {
    renderWaveformBarsOnCanvas(progressWaveTrack, '#666666');
    renderWaveformBarsOnCanvas(progressWavePlayed, '#ffffff');
  }
  setProgressVisual(lastProgressRatio);
}

export async function loadWaveformForTrack(track) {
  if (progressContainer?.dataset?.progressStyle !== 'waveform') {
    return;
  }
  const path = track?.file?.path || track?.path;
  if (!path || typeof path !== 'string' || path.startsWith('blob:')) {
    audioVars.waveformPeaks = null;
    audioVars.waveformPeaksPath = null;
    initializeProgressWaveforms();
    return;
  }
  if (
    audioVars.waveformPeaksPath === path &&
    audioVars.waveformPeaks &&
    audioVars.waveformPeaks.length === WAVEFORM_PEAK_COUNT
  ) {
    initializeProgressWaveforms();
    return;
  }
  if (!nativeAudioEnabled) {
    audioVars.waveformPeaks = null;
    audioVars.waveformPeaksPath = null;
    initializeProgressWaveforms();
    return;
  }

  const requestId = ++audioVars.waveformPeaksRequestId;
  audioVars.waveformPeaks = null;
  audioVars.waveformPeaksPath = path;
  initializeProgressWaveforms();

  try {
    const result = await nativeInvoke('native_audio_waveform_peaks', {
      path,
      barCount: WAVEFORM_PEAK_COUNT
    });
    if (requestId !== audioVars.waveformPeaksRequestId) return;

    const resultPath = result?.path || result?.Path || '';
    const peaks = Array.isArray(result) ? result : (result?.peaks || result?.Peaks || null);

    if (resultPath && resultPath !== path) {
      return;
    }
    if (!Array.isArray(peaks) || peaks.length === 0) {
      audioVars.waveformPeaks = null;
    } else {
      audioVars.waveformPeaks = peaks.map(v => Math.max(0, Math.min(1, Number(v) || 0)));
      audioVars.waveformPeaksPath = path;
    }
    initializeProgressWaveforms();
  } catch (error) {
    if (requestId !== audioVars.waveformPeaksRequestId) return;
    console.warn('No se pudo generar la waveform de la pista:', error);
    audioVars.waveformPeaks = null;
    initializeProgressWaveforms();
  }
}

export function configureProgressWaveform(modeOrCount, modeMaybe, splitTimesMaybe) {
  let mode;
  let splitTimes;
  if (typeof modeOrCount === 'string') {
    mode = modeOrCount;
    splitTimes = modeMaybe;
  } else {
    mode = modeMaybe;
    splitTimes = splitTimesMaybe;
  }
  audioVars.waveformBarCount = WAVEFORM_PEAK_COUNT;
  audioVars.waveformMode = mode === 'smooth' ? 'smooth' : 'bars';
  audioVars.showRemainingTime = Boolean(splitTimes);
  progressContainer.dataset.waveformMode = audioVars.waveformMode;
  playbackBar?.classList.toggle(
    'is-waveform-split',
    audioVars.showRemainingTime && progressContainer.dataset.progressStyle === 'waveform'
  );
  updatePlayerMinimumHeight();
  initializeProgressWaveforms();
  updateProgressTimes();
  const track = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  if (track && progressContainer.dataset.progressStyle === 'waveform') {
    void loadWaveformForTrack(track);
  }
}
