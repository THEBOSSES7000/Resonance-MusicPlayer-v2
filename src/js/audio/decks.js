// Audio · Decks de audio HTML: estado, volumen y rampas.

import { audioDecks, primaryAudio, secondaryAudio } from './dom.js';
import { audioVars } from './sharedState.js';
import { nativeAudioEnabled, nativeSetVolume } from './nativeEngine.js';
import { audioDeckNodes, masterVolume, playbackFadeInDuration, playbackFadeInEnabled, replayGainEnabled } from './webAudio.js';
import { audio } from './playback.js';
import { updateCrossfadeIndicator } from './progressUI.js';

// Con motor nativo, bloquear .play() del <audio> para no abrir sesiones WASAPI en WebView2
for (const el of [primaryAudio, secondaryAudio]) {
  const originalPlay = el.play.bind(el);
  el.play = function (...args) {
    if (typeof audioVars.nativeAudioActive !== 'undefined' && audioVars.nativeAudioActive) {
      return Promise.resolve();
    }
    if (typeof nativeAudioEnabled !== 'undefined' && nativeAudioEnabled) {
      return Promise.resolve();
    }
    return originalPlay(...args);
  };
}

audioDecks.forEach(deck => {
  deck.crossOrigin = 'anonymous';
  deck.preload = nativeAudioEnabled ? 'none' : 'auto';
});

export function getDeckState(deck) {
  if (!audioDeckNodes.has(deck)) {
    audioDeckNodes.set(deck, {
      transitionLevel: deck === audio ? 1 : 0,
      envelopeLevel: 1,
      replayGainLevel: 1,
      source: null,
      filters: [],
      analyser: null,
      analysisData: null,
      ramps: new Map()
    });
  }
  return audioDeckNodes.get(deck);
}

export function getReplayGainLevel(track) {
  if (!replayGainEnabled || !Number.isFinite(track?.replayGainDb)) return 1;
  const db = Math.max(-24, Math.min(6, track.replayGainDb));
  return Math.min(1, 10 ** (db / 20));
}

export function updateDeckVolume(deck) {
  const deckState = getDeckState(deck);
  const volume = masterVolume * deckState.transitionLevel * deckState.envelopeLevel * deckState.replayGainLevel;
  const clamped = Math.max(0, Math.min(1, volume));
  deck.volume = clamped;
  if (audioVars.nativeAudioActive && deck === audio) {
    void nativeSetVolume(clamped);
  }
}

export function setDeckTrack(deck, track, startWithFade = false) {
  const deckState = getDeckState(deck);
  cancelDeckRamp(deck, 'envelopeLevel');
  deckState.replayGainLevel = getReplayGainLevel(track);
  deckState.envelopeLevel = startWithFade && playbackFadeInEnabled ? 0 : 1;
  deckState.transitionLevel = 1;
  audioVars.trackFadeStarted = false;
  updateDeckVolume(deck);
  if (startWithFade && playbackFadeInEnabled) {
    void rampDeckValue(deck, 'envelopeLevel', 1, playbackFadeInDuration);
  }
}

export function cancelDeckRamp(deck, property) {
  const ramps = getDeckState(deck).ramps;
  const ramp = ramps.get(property);
  if (!ramp) return;
  if (ramp.animationId !== null) cancelAnimationFrame(ramp.animationId);
  ramps.delete(property);
  ramp.resolve();
}

export function rampDeckValue(deck, property, target, durationSeconds) {
  const deckState = getDeckState(deck);
  cancelDeckRamp(deck, property);
  const startValue = deckState[property];
  const startTime = performance.now();
  const durationMs = Math.max(1, durationSeconds * 1000);
  return new Promise(resolve => {
    const ramp = { animationId: null, resolve };
    const step = now => {
      if (deckState.ramps.get(property) !== ramp) return;
      const progress = Math.min(1, (now - startTime) / durationMs);
      deckState[property] = startValue + (target - startValue) * progress;
      updateDeckVolume(deck);
      if (progress >= 1) {
        deckState.ramps.delete(property);
        resolve();
      } else {
        ramp.animationId = requestAnimationFrame(step);
      }
    };
    deckState.ramps.set(property, ramp);
    ramp.animationId = requestAnimationFrame(step);
  });
}

export function otherDeck(deck) {
  return deck === primaryAudio ? secondaryAudio : primaryAudio;
}

export function cancelCrossfade() {
  audioVars.crossfadeGeneration++;
  if (audioVars.rampAnimationId !== null) cancelAnimationFrame(audioVars.rampAnimationId);
  audioVars.rampAnimationId = null;
  const resolveAnimation = audioVars.crossfadeAnimationResolve;
  audioVars.crossfadeAnimationResolve = null;
  resolveAnimation?.();
  audioVars.crossfadeInProgress = false;
  audioVars.crossfadeVisualActive = false;
  updateCrossfadeIndicator();
  audioDecks.forEach(deck => {
    const deckState = getDeckState(deck);
    deckState.transitionLevel = deck === audio ? 1 : 0;
    if (deck !== audio) {
      deck.pause();
      deck.removeAttribute('src');
      deck.load();
    }
    updateDeckVolume(deck);
  });
}
