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

export function updateCrossfadeIndicator() {
  const isVisible = audioVars.crossfadeVisualActive && audioVars.crossfadeIndicatorEnabled;
  playbackRow?.classList.toggle('crossfade-active', isVisible);
  crossfadeIndicator?.setAttribute('aria-hidden', String(!isVisible));
}

export function setProgressVisual(ratio) {
  lastProgressRatio = Math.max(0, Math.min(1, ratio));
  progressFill.style.width = `${lastProgressRatio * 100}%`;
  if (progressWavePlayed) progressWavePlayed.style.width = `${progressContainer.clientWidth}px`;
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
