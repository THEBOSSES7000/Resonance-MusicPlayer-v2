// Audio · Motor nativo (Rust): carga, reproducción, sondeo de estado, fades y eventos de energía.

import { audioVars } from './sharedState.js';
import { setProgressVisual, updateCrossfadeIndicator, updateProgressTimes } from './progressUI.js';
import { incrementPlayCount, state } from '../state.js';
import { renderGrids, syncPlayingUI, updateLyricsUI, updateSyncedLyricsProgress } from '../ui.js';
import { audioDecks, playIcon, progressContainer } from './dom.js';
import { maybeCountPlayFromProgress, resetPlayCountSession } from './playCount.js';
import { notifyDiscordPresence, updateWindowsMediaPlayback, updateWindowsMediaPosition } from './windowIntegration.js';
import { crossfadeDuration, crossfadeEnabled, masterVolume, pauseFadeEnabled, pauseFadeInDuration, pauseFadeOutDuration, playbackFadeInDuration, playbackFadeInEnabled, playbackFadeOutDuration, playbackFadeOutEnabled, releaseWebAudioIfPossible, silenceHtmlAudioDecks } from './webAudio.js';
import { crossfadeToNext, nextSong } from './playback.js';
import { handleSleepTimerTrackEnd } from './sleepTimer.js';
import { cancelCrossfade, getReplayGainLevel } from './decks.js';
import { pushNativeEqualizer, pushNativeRate } from './effects.js';

// ——— Fase 1: audio nativo (Tauri / Rust) ———
export const nativeAudioEnabled = Boolean(window.__TAURI__?.core?.invoke);

let nativePollTimer = null;

/** Energía RMS (0–1) recibida desde Rust vía evento `audio-energy` (Visual+). */
export let nativeAudioEnergy = 0;

let nativeEnergyUnlisten = null;

export let nativeShadow = {
  paused: true,
  currentTime: 0,
  duration: 0,
  path: null
};

/** Reloj de pared del último status nativo (para interpolar posición entre polls). */
export let nativePositionSampleMs = 0;

/** Suscribe al evento de energía del motor nativo (una sola vez). */
export function ensureNativeEnergyListener() {
  if (nativeEnergyUnlisten || !window.__TAURI__?.event?.listen) return;
  void window.__TAURI__.event.listen('audio-energy', event => {
    const value = Number(event.payload);
    nativeAudioEnergy = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }).then(unlisten => {
    nativeEnergyUnlisten = unlisten;
  }).catch(() => {});
}

ensureNativeEnergyListener();

export function canUseNativeAudio(track) {
  if (!nativeAudioEnabled) return false;
  const path = track?.file?.path || track?.path;
  return Boolean(path && typeof path === 'string' && !path.startsWith('blob:'));
}

export async function nativeInvoke(cmd, args = {}) {
  return window.__TAURI__.core.invoke(cmd, args);
}

export function stopNativeProgressPoll() {
  if (nativePollTimer) {
    clearInterval(nativePollTimer);
    nativePollTimer = null;
  }
}

export function applyNativeStatusToUi(st, { fromEnded = false } = {}) {
  if (!st) return;
  const previousPath = nativeShadow.path || null;
  const nextPath = st.path || null;
  const pathChanged = Boolean(previousPath && nextPath && previousPath !== nextPath);

  nativeShadow.paused = !st.playing;
  nativeShadow.currentTime = st.positionSeconds || 0;
  nativeShadow.duration = st.durationSeconds || 0;
  nativeShadow.path = nextPath;
  nativePositionSampleMs = performance.now();

  // Icono de crossfade: seguir estrictamente el flag del motor nativo
  if (st.crossfading) {
    if (!audioVars.crossfadeVisualActive || !audioVars.crossfadeInProgress) {
      audioVars.crossfadeVisualActive = true;
      audioVars.crossfadeInProgress = true;
      updateCrossfadeIndicator();
    }
  } else if (audioVars.crossfadeVisualActive || audioVars.crossfadeInProgress) {
    audioVars.crossfadeVisualActive = false;
    audioVars.crossfadeInProgress = false;
    audioVars.lyricsCrossfadeFreeze = false;
    updateCrossfadeIndicator();
    if (state.isLyricsOpen) {
      try {
        updateSyncedLyricsProgress(Number(st.positionSeconds) || 0);
      } catch (_) {}
    }
  }

  // Cambio de pista: recargar letra y sincronizar con la posición real (pista entrante)
  if (pathChanged && state.isLyricsOpen) {
    try {
      audioVars.lyricsCrossfadeFreeze = false;
      updateLyricsUI();
      updateSyncedLyricsProgress(Number(st.positionSeconds) || 0);
    } catch (_) {}
  }


  if (!audioVars.isSeeking) {
    updateProgressTimes(nativeShadow.currentTime, nativeShadow.duration || 0);
    if (nativeShadow.duration > 0) {
      const ratio = nativeShadow.currentTime / nativeShadow.duration;
      setProgressVisual(ratio);
      progressContainer?.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }
  }
  if (state.isLyricsOpen) {
    updateSyncedLyricsProgress(nativeShadow.currentTime);
  }
  if (st.playing) {
    maybeCountPlayFromProgress(nativeShadow.currentTime, nativeShadow.duration);
  }
  updateWindowsMediaPlayback(Boolean(st.playing));
  updateWindowsMediaPosition(true);
  notifyDiscordPresence();

  // Disparo automático de crossfade cerca del final (modo nativo)
  if (
    !fromEnded &&
    !st.ended &&
    st.playing &&
    !st.crossfading &&
    !audioVars.crossfadeInProgress &&
    crossfadeEnabled
  ) {
    maybeStartNativeCrossfade(st);
  }

  if (st.ended && !audioVars.nativeLastEnded && !fromEnded) {
    audioVars.nativeLastEnded = true;
    handleNativeTrackEnded();
  } else if (!st.ended) {
    audioVars.nativeLastEnded = false;
  }
}

/** Si queda poco de la pista y hay siguiente, inicia crossfade nativo (fin natural). */
function maybeStartNativeCrossfade(st) {
  const remaining = (st.durationSeconds || 0) - (st.positionSeconds || 0);
  if (!(remaining > 0) || remaining > crossfadeDuration + 0.05) return;
  const hasQueuedNext =
    state.repeatMode !== 'one' && state.currentTrackIndex + 1 < state.activeQueue.length;
  if (!hasQueuedNext) return;
  void crossfadeToNext(state.currentTrackIndex + 1);
}

export function startNativeProgressPoll() {
  stopNativeProgressPoll();
  nativePollTimer = setInterval(() => {
    if (!audioVars.nativeAudioActive) return;
    nativeInvoke('native_audio_status')
      .then(st => applyNativeStatusToUi(st))
      .catch(() => {});
  }, 250);
}

function handleNativeTrackEnded() {
  if (state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]) {
    try {
      const currentTrack = state.activeQueue[state.currentTrackIndex];
      if (!audioVars.playCountedForCurrentTrack) {
        incrementPlayCount(currentTrack);
        audioVars.playCountedForCurrentTrack = true;
        renderGrids();
      }
    } catch (_) {}
  }
  try {
    if (handleSleepTimerTrackEnd()) return;
  } catch (_) {}
  if (localStorage.getItem('pn_playback_continuous') !== 'false' || state.repeatMode !== 'off') {
    void nextSong(true);
    return;
  }
  stopNativeProgressPoll();
  void nativeInvoke('native_audio_pause').catch(() => {});
  nativeShadow.paused = true;
  playIcon.className = 'ph-fill ph-play';
  syncPlayingUI(false);
  updateWindowsMediaPlayback(false);
}

export async function nativeLoadTrack(track, autoPlay) {
  const path = track.file?.path || track.path;
  const volBase = typeof masterVolume === 'number' ? masterVolume : 0.8;
  const vol = Math.max(0, Math.min(1, volBase * getReplayGainLevel(track)));
  // Silenciar decks HTML para no duplicar audio ni buffers en el mezclador
  audioDecks.forEach(deck => {
    try {
      deck.pause();
      deck.removeAttribute('src');
      deck.volume = 0;
    } catch (_) {}
  });
  const fadeIn = autoPlay ? nativeFadeInSecs() : 0;
  const st = await nativeInvoke('native_audio_load', {
    path,
    autoPlay: Boolean(autoPlay),
    volume: vol,
    fadeInSecs: fadeIn
  });
  audioVars.nativeAudioActive = true;
  audioVars.nativeLastEnded = false;
  resetPlayCountSession();
  releaseWebAudioIfPossible();
  silenceHtmlAudioDecks();
  applyNativeStatusToUi(st);
  if (autoPlay) startNativeProgressPoll();
  else stopNativeProgressPoll();
  // Reaplicar EQ y rate nativos al cargar pista
  void pushNativeEqualizer();
  void pushNativeRate();
  // Liberar grafo Web Audio y no precargar buffers HTML
  releaseWebAudioIfPossible();
  audioDecks.forEach(deck => {
    try {
      deck.preload = 'none';
    } catch (_) {}
  });
  if (st.durationSeconds > 0) {
    track.duration = st.durationSeconds;
  }
  return st;
}

export async function nativeTogglePlay() {
  if (!audioVars.nativeAudioActive) return false;
  if (nativeShadow.paused) {
    const st = await nativeInvoke('native_audio_play', { fadeInSecs: nativePauseFadeInSecs() });
    applyNativeStatusToUi(st);
    startNativeProgressPoll();
    playIcon.className = 'ph-fill ph-pause';
    syncPlayingUI(true);
  } else {
    if (audioVars.crossfadeInProgress) cancelCrossfade();
    const st = await nativeInvoke('native_audio_pause', { fadeOutSecs: nativePauseFadeOutSecs() });
    applyNativeStatusToUi(st);
    playIcon.className = 'ph-fill ph-play';
    syncPlayingUI(false);
  }
  return true;
}

export async function nativeSeek(seconds) {
  if (!audioVars.nativeAudioActive) return false;
  try {
    const st = await nativeInvoke('native_audio_seek', { positionSeconds: Number(seconds) || 0 });
    applyNativeStatusToUi(st);
    updateWindowsMediaPosition(true);
    return true;
  } catch (error) {
    console.error('nativeSeek:', error);
    return false;
  }
}

export async function nativeSetVolume(vol01) {
  if (!nativeAudioEnabled) return;
  try {
    await nativeInvoke('native_audio_set_volume', { volume: Math.max(0, Math.min(1, vol01)) });
  } catch (_) {}
}

export function nativeFadeInSecs() {
  if (!playbackFadeInEnabled) return 0;
  const d = Number(playbackFadeInDuration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0.05, Math.min(5, d));
}

function nativeFadeOutSecs() {
  if (!playbackFadeOutEnabled) return 0;
  const d = Number(playbackFadeOutDuration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0.05, Math.min(5, d));
}

function nativePauseFadeOutSecs() {
  if (!pauseFadeEnabled) return 0;
  const d = Number(pauseFadeOutDuration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0.05, Math.min(5, d));
}

function nativePauseFadeInSecs() {
  if (!pauseFadeEnabled) return 0;
  const d = Number(pauseFadeInDuration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0.05, Math.min(5, d));
}
