// Audio · Temporizador de apagado.

import { audioVars } from './sharedState.js';
import { formatTime, state } from '../state.js';
import { applyNativeStatusToUi, nativeInvoke, nativeShadow, stopNativeProgressPoll } from './nativeEngine.js';
import { playIcon } from './dom.js';
import { syncPlayingUI } from '../ui.js';
import { updateWindowsMediaPlayback } from './windowIntegration.js';
import { audio } from './playback.js';

export function updateSleepTimerStatus() {
  const status = document.getElementById('sleep-timer-status');
  if (!status) return;
  if (audioVars.sleepTimerMode === 'time') {
    const secondsLeft = Math.max(0, Math.ceil((audioVars.sleepTimerDeadline - Date.now()) / 1000));
    const hours = Math.floor(secondsLeft / 3600);
    const remaining = secondsLeft % 3600;
    const countdown = hours
      ? `${hours}:${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
      : formatTime(secondsLeft);
    status.textContent = `Se pausará en ${countdown}.`;
  } else if (audioVars.sleepTimerMode === 'tracks') {
    status.textContent = `Se pausará al terminar ${audioVars.sleepTimerRemainingTracks} ${audioVars.sleepTimerRemainingTracks === 1 ? 'pista' : 'pistas'}.`;
  } else if (audioVars.sleepTimerMode === 'end') {
    status.textContent = 'Se pausará al terminar la lista actual.';
  } else {
    status.textContent = 'Temporizador desactivado';
  }
}

export function cancelSleepTimer() {
  clearInterval(audioVars.sleepTimerInterval);
  audioVars.sleepTimerInterval = null;
  audioVars.sleepTimerMode = null;
  audioVars.sleepTimerRemainingTracks = 0;
  audioVars.sleepTimerDeadline = 0;
  updateSleepTimerStatus();
  document.getElementById('btn-sleep-timer')?.classList.remove('active-toggle');
}

export function pauseForSleepTimer() {
  cancelSleepTimer();
  if (audioVars.nativeAudioActive) {
    void (async () => {
      try {
        const st = await nativeInvoke('native_audio_pause', { fadeOutSecs: 0 });
        applyNativeStatusToUi(st);
      } catch (error) {
        console.error('pauseForSleepTimer (nativo):', error);
      }
      stopNativeProgressPoll();
      nativeShadow.paused = true;
      playIcon.className = 'ph-fill ph-play';
      syncPlayingUI(false);
      updateWindowsMediaPlayback(false);
    })();
    return;
  }
  audio.pause();
  playIcon.className = 'ph-fill ph-play';
  syncPlayingUI(false);
  updateWindowsMediaPlayback(false);
}

export function handleSleepTimerTrackEnd() {
  if (audioVars.sleepTimerMode === 'time') {
    if (Date.now() >= audioVars.sleepTimerDeadline) {
      pauseForSleepTimer();
      return true;
    }
    return false;
  }
  if (audioVars.sleepTimerMode === 'tracks') {
    audioVars.sleepTimerRemainingTracks--;
    if (audioVars.sleepTimerRemainingTracks <= 0) {
      pauseForSleepTimer();
      return true;
    }
    updateSleepTimerStatus();
  }
  if (audioVars.sleepTimerMode === 'end' && state.currentTrackIndex >= state.activeQueue.length - 1) {
    pauseForSleepTimer();
    return true;
  }
  return false;
}
