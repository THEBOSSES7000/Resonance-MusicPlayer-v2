// Audio · Conteo de reproducciones según el umbral de escucha.

import { audioVars } from './sharedState.js';
import { incrementPlayCount, state } from '../state.js';
import { renderGrids } from '../ui.js';

/** Umbral 0.85–1.0: al alcanzarlo se cuenta 1 reproducción (por sesión de pista). */
let playCountThresholdRatio = Math.min(1, Math.max(0.85, (Number(localStorage.getItem('pn_play_count_threshold')) || 90) / 100));

export function setPlayCountThresholdPercent(percent) {
  const p = Math.min(100, Math.max(85, Math.round(Number(percent) || 90)));
  playCountThresholdRatio = p / 100;
  localStorage.setItem('pn_play_count_threshold', String(p));
  return p;
}

export function getPlayCountThresholdPercent() {
  return Math.round(playCountThresholdRatio * 100);
}

export function resetPlayCountSession() {
  audioVars.playCountedForCurrentTrack = false;
}

export function maybeCountPlayFromProgress(positionSeconds, durationSeconds) {
  if (audioVars.playCountedForCurrentTrack) return;
  const dur = Number(durationSeconds) || 0;
  const pos = Number(positionSeconds) || 0;
  if (!(dur > 0) || !(pos >= 0)) return;
  if (pos / dur < playCountThresholdRatio) return;
  const track = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  if (!track) return;
  try {
    incrementPlayCount(track);
    audioVars.playCountedForCurrentTrack = true;
    renderGrids();
  } catch (_) {}
}
