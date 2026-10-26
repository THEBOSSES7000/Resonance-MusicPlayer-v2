// Audio · Posición, duración, pausa y búsqueda de la reproducción actual.

import { audioVars } from './sharedState.js';
import { nativePositionSampleMs, nativeSeek, nativeShadow } from './nativeEngine.js';
import { audio } from './playback.js';
import { setProgressVisual, updateProgressTimes } from './progressUI.js';
import { updateWindowsMediaPosition } from './windowIntegration.js';

/** Posición / pausa / duración unificadas (HTML o nativo). */
export function getPlaybackPosition() {
  if (audioVars.nativeAudioActive) {
    let t = nativeShadow.currentTime || 0;
    // Durante crossfade no extrapolar: evita que la letra se adelante al audio audible
    if (
      !nativeShadow.paused &&
      nativePositionSampleMs > 0 &&
      !audioVars.crossfadeInProgress &&
      !audioVars.crossfadeVisualActive &&
      !audioVars.lyricsCrossfadeFreeze
    ) {
      t += (performance.now() - nativePositionSampleMs) / 1000;
      const dur = nativeShadow.duration || 0;
      if (dur > 0) t = Math.min(t, dur);
    }
    return Math.max(0, t);
  }
  return Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
}

export function getPlaybackDuration() {
  if (audioVars.nativeAudioActive) return nativeShadow.duration || 0;
  return Number.isFinite(audio.duration) ? audio.duration : 0;
}

export function isPlaybackPaused() {
  if (audioVars.nativeAudioActive) return Boolean(nativeShadow.paused);
  return Boolean(audio.paused);
}

/** Seek unificado: barra de progreso, letras, SMTC, atajos. */
export async function seekPlayback(seconds) {
  const dur = getPlaybackDuration();
  let dest = Number(seconds) || 0;
  if (dur > 0) dest = Math.max(0, Math.min(dur, dest));
  else dest = Math.max(0, dest);
  if (audioVars.nativeAudioActive) {
    await nativeSeek(dest);
    return;
  }
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = dest;
    updateProgressTimes(audio.currentTime, audio.duration);
    setProgressVisual(audio.duration ? audio.currentTime / audio.duration : 0);
    updateWindowsMediaPosition(true);
  }
}
