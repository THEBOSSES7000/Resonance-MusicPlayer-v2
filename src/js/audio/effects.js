// Audio · Efectos: velocidad, tono, ecualizador nativo y migración entre motor nativo y HTML.

import { audioVars } from './sharedState.js';
import { resolveAudioUrl, state } from '../state.js';
import { getPlaybackPosition, isPlaybackPaused } from './position.js';
import { nativeAudioEnabled, nativeInvoke, stopNativeProgressPoll } from './nativeEngine.js';
import { audio } from './playback.js';
import { setDeckTrack } from './decks.js';
import { audioDecks, playIcon } from './dom.js';
import { syncPlayingUI } from '../ui.js';
import { updateWindowsMediaPlayback } from './windowIntegration.js';
import { EQUALIZER_FREQUENCIES, equalizerEnabled, equalizerGains } from './webAudio.js';

export function needsHtmlAudioEffects() {
  return false;
}

async function migrateNativeToHtmlForEffects() {
  if (!audioVars.nativeAudioActive) return;
  const track = state.currentTrackIndex >= 0
    ? state.activeQueue[state.currentTrackIndex]
    : null;
  if (!track) return;
  const pos = getPlaybackPosition();
  const wasPlaying = !isPlaybackPaused();
  try {
    await nativeInvoke('native_audio_stop', {});
  } catch (_) {}
  audioVars.nativeAudioActive = false;
  stopNativeProgressPoll();
  const src = resolveAudioUrl(track);
  if (!src) return;
  audio.src = src;
  try {
    audio.currentTime = pos;
  } catch (_) {}
  setDeckTrack(audio, track, false);
  applyPlaybackRate();
  if (wasPlaying) {
    try {
      await audio.play();
      playIcon.className = 'ph-fill ph-pause';
      syncPlayingUI(true);
      updateWindowsMediaPlayback(true);
    } catch (error) {
      console.error('No se pudo reanudar en HTML tras activar efectos:', error);
    }
  }
}

export async function pushNativeEqualizer() {
  if (!nativeAudioEnabled) return;
  try {
    // Siempre 20 bandas alineadas al motor Rust (EQ_FREQUENCIES_HZ)
    const gainsDb = EQUALIZER_FREQUENCIES.map((_, index) =>
      Math.max(-15, Math.min(15, Number(equalizerGains[index]) || 0))
    );
    await nativeInvoke('native_audio_set_eq', {
      enabled: Boolean(equalizerEnabled),
      gainsDb
    });
  } catch (error) {
    console.error('native_audio_set_eq:', error);
  }
}

function effectivePlaybackRate() {
  return audioVars.playbackRate * (2 ** (audioVars.playbackPitch / 12));
}

export async function pushNativeRate() {
  if (!nativeAudioEnabled) return;
  try {
    await nativeInvoke('native_audio_set_rate', {
      rate: Math.max(0.25, Math.min(4, effectivePlaybackRate()))
    });
  } catch (error) {
    console.error('native_audio_set_rate:', error);
  }
}

function applyPlaybackRate() {
  const effectiveRate = effectivePlaybackRate();
  audioDecks.forEach(deck => {
    deck.playbackRate = effectiveRate;
  });
  void pushNativeRate();
}

export function setPlaybackSpeed(rate) {
  audioVars.playbackRate = Math.min(2, Math.max(0.5, Number(rate) || 1));
  applyPlaybackRate();
  localStorage.setItem('pn_playback_rate', String(audioVars.playbackRate));
  const slider = document.getElementById('playback-speed');
  const value = document.getElementById('playback-speed-value');
  if (slider) slider.value = String(audioVars.playbackRate);
  if (value) value.value = `${audioVars.playbackRate.toFixed(2)}x`;
}

export function setPlaybackPitch(semitones) {
  audioVars.playbackPitch = audioVars.preservePitch ? 0 : Math.min(12, Math.max(-12, Number(semitones) || 0));
  applyPlaybackRate();
  localStorage.setItem('pn_playback_pitch', String(audioVars.playbackPitch));
  const slider = document.getElementById('playback-pitch');
  const value = document.getElementById('playback-pitch-value');
  if (slider) slider.value = String(audioVars.playbackPitch);
  if (value) value.value = `${audioVars.playbackPitch > 0 ? '+' : ''}${audioVars.playbackPitch} st`;
}

export function setPreservePitch(enabled) {
  audioVars.preservePitch = Boolean(enabled);
  if (audioVars.preservePitch) setPlaybackPitch(0);
  audioDecks.forEach(deck => {
    deck.preservesPitch = audioVars.preservePitch;
    deck.webkitPreservesPitch = audioVars.preservePitch;
    deck.mozPreservesPitch = audioVars.preservePitch;
  });
  const pitchSlider = document.getElementById('playback-pitch');
  if (pitchSlider) pitchSlider.disabled = audioVars.preservePitch;
  localStorage.setItem('pn_playback_preserve_pitch', String(audioVars.preservePitch));
  const checkbox = document.getElementById('playback-preserve-pitch');
  if (checkbox) checkbox.checked = audioVars.preservePitch;
}
