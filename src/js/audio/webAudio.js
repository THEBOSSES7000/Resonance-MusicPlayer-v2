// Audio · Web Audio: volumen, ecualizador, análisis, ReplayGain, crossfade y dispositivos de salida.

import { audioDecks, btnLyrics, playIcon, primaryAudio, secondaryAudio, volIcon, volumePercentage, volumeRange, volumeTooltip } from './dom.js';
import { state } from '../state.js';
import { closeLyricsView, syncPlayingUI } from '../ui.js';
import { cancelCrossfade, cancelDeckRamp, getDeckState, getReplayGainLevel, updateDeckVolume } from './decks.js';
import { audioVars } from './sharedState.js';
import { applyNativeStatusToUi, ensureNativeEnergyListener, disableNativeEnergyEmit, nativeAudioEnabled, nativeAudioEnergy, nativeInvoke, startNativeProgressPoll, stopNativeProgressPoll } from './nativeEngine.js';
import { pushNativeEqualizer } from './effects.js';
import { audio } from './playback.js';
import { updateCrossfadeIndicator } from './progressUI.js';

export function updateLyricsButtonVisibility(track) {
  if (!btnLyrics) return;
  const hasLyrics = Boolean(
    track?.lyrics &&
    Array.isArray(track.lyrics.lines) &&
    track.lyrics.lines.length > 0
  );
  btnLyrics.style.display = hasLyrics ? 'flex' : 'none';
  if (!hasLyrics && state.isLyricsOpen && localStorage.getItem('pn_lyrics_auto_close_empty') !== 'false') {
    try { closeLyricsView(); } catch (_) {}
  }
}

let tooltipTimeout = null;

export let masterVolume = 1;

let audioContext = null;

export let equalizerEnabled = false;

let audioAnalysisEnabled = false;

export let replayGainEnabled = false;

export let crossfadeEnabled = false;

export let crossfadeDuration = 4;

export let crossfadeAutomaticOnly = false;

export let playbackFadeInEnabled = false;

export let playbackFadeInDuration = 2;

export let playbackFadeOutEnabled = false;

export let playbackFadeOutDuration = 2;

export let pauseFadeEnabled = false;

export let pauseFadeInDuration = 1;

export let pauseFadeOutDuration = 1;

export let audioDeckNodes = new Map();

export let equalizerGains = Array(20).fill(0);

/** 20 bandas (Hz) — mismo set que el motor nativo / AIMP. */
export const EQUALIZER_FREQUENCIES = [
  31, 43, 63, 87, 125, 175, 250, 350, 500, 700,
  1000, 1400, 2000, 2800, 4000, 5600, 8000, 11200, 16000, 22000
];

export function showVolumeTooltip(val) {
  if (!volumeTooltip) return;
  if (document.documentElement.dataset.playerVolumePercentage === 'true') {
    volumeTooltip.classList.remove('visible');
    return;
  }
  volumeTooltip.textContent = `${Math.round(val)}%`;
  volumeTooltip.classList.add('visible');
  clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(() => {
    volumeTooltip.classList.remove('visible');
  }, 1200);
}

export function setAppVolume(val, showTooltip = true) {
  const clamped = Math.max(0, Math.min(100, Math.round(val)));
  localStorage.setItem('pn_volume', String(clamped));
  masterVolume = clamped / 100;
  audioDecks.forEach(updateDeckVolume);
  if (volumeRange) volumeRange.value = clamped;
  if (volumePercentage) volumePercentage.textContent = `${clamped}%`;

  if (clamped === 0) {
    volIcon.className = "ph ph-speaker-simple-x";
  } else if (clamped < 50) {
    volIcon.className = "ph ph-speaker-low";
  } else {
    volIcon.className = "ph ph-speaker-high";
  }
  volIcon.classList.toggle('is-muted', clamped === 0);

  if (clamped > 0) {
    audioVars.prevVolume = clamped / 100;
  }
  if (showTooltip) showVolumeTooltip(clamped);
}

export async function configureEqualizer(enabled, gains = equalizerGains) {
  equalizerGains = EQUALIZER_FREQUENCIES.map((_, index) =>
    Math.max(-15, Math.min(15, Number(gains[index]) || 0))
  );
  equalizerEnabled = Boolean(enabled);

  // En Tauri el EQ de 20 bandas corre en Rust (EqSource). Nunca instanciar AudioContext ni 40 BiquadFilterNodes en WebView2.
  if (nativeAudioEnabled) {
    await pushNativeEqualizer();
    releaseWebAudioIfPossible();
    return;
  }

  if (!equalizerEnabled && !audioContext) return;

  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext = new AudioContextClass();
  }

  for (const deck of audioDecks) {
    ensureDeckAudioNodes(deck);
    const deckState = getDeckState(deck);
    deckState.filters.forEach((filter, index) => {
      const g = equalizerEnabled ? (equalizerGains[index] || 0) : 0;
      filter.gain.setTargetAtTime(g, audioContext.currentTime, 0.025);
    });
    routeDeckAudio(deck);
  }

  syncAudioContextPlaybackState();
}

function ensureDeckAudioNodes(deck) {
  if (!audioContext) return;
  const deckState = getDeckState(deck);
  if (!deckState.source) {
    deckState.source = audioContext.createMediaElementSource(deck);
    deckState.filters = EQUALIZER_FREQUENCIES.map((frequency, index) => {
      const filter = audioContext.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQUALIZER_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = equalizerGains[index] || 0;
      return filter;
    });
  }
  if (audioAnalysisEnabled && !deckState.analyser) {
    deckState.analyser = audioContext.createAnalyser();
    deckState.analyser.fftSize = 512;
    deckState.analyser.smoothingTimeConstant = 0.55;
    deckState.analysisData = new Uint8Array(deckState.analyser.fftSize);
    deckState.frequencyData = new Uint8Array(deckState.analyser.frequencyBinCount);
  }
}

/** Libera el grafo Web Audio cuando el motor nativo está disponible o activo (ahorro de RAM/CPU). */
export function silenceHtmlAudioDecks() {
  // Evita sesiones extra en el mezclador de Windows (HTMLAudio / WebView2)
  const decks = typeof audioDecks !== 'undefined' && Array.isArray(audioDecks)
    ? audioDecks
    : [primaryAudio, secondaryAudio].filter(Boolean);
  for (const deck of decks) {
    if (!deck) continue;
    try { deck.pause(); } catch (_) {}
    try {
      deck.muted = true;
      deck.volume = 0;
    } catch (_) {}
    try {
      // Quitar src evita que WebView2 mantenga clientes WASAPI vivos
      if (deck.src || deck.currentSrc) {
        deck.removeAttribute('src');
        deck.load();
      }
    } catch (_) {}
  }
}

export function releaseWebAudioIfPossible() {
  // Con motor nativo no debe quedar AudioContext / Biquad en WebView2
  if (!nativeAudioEnabled && !audioVars.nativeAudioActive) {
    // igual silenciar si el motor nativo está activo por otra vía
  }
  if (nativeAudioEnabled || audioVars.nativeAudioActive) {
    silenceHtmlAudioDecks();
  }
  if (!audioContext) return;
  if (!nativeAudioEnabled && !audioVars.nativeAudioActive) return;
  try {
    audioDecks.forEach(deck => {
      const deckState = getDeckState(deck);
      try { deckState.source?.disconnect(); } catch (_) {}
      try { deckState.analyser?.disconnect(); } catch (_) {}
      (deckState.filters || []).forEach(filter => {
        try { filter.disconnect(); } catch (_) {}
      });
      deckState.source = null;
      deckState.filters = [];
      deckState.analyser = null;
      deckState.analysisData = null;
    });
    const ctx = audioContext;
    audioContext = null;
    void ctx.close().catch(() => {});
  } catch (_) {
    audioContext = null;
  }
}

function routeDeckAudio(deck) {
  const deckState = getDeckState(deck);
  deckState.source.disconnect();
  deckState.filters.forEach(filter => filter.disconnect());
  deckState.analyser?.disconnect();

  let outputNode = deckState.source;
  if (equalizerEnabled) {
    outputNode.connect(deckState.filters[0]);
    for (let index = 0; index < deckState.filters.length - 1; index += 1) {
      deckState.filters[index].connect(deckState.filters[index + 1]);
    }
    outputNode = deckState.filters[deckState.filters.length - 1];
  }
  if (audioAnalysisEnabled && deckState.analyser) {
    outputNode.connect(deckState.analyser);
    deckState.analyser.connect(audioContext.destination);
  } else {
    outputNode.connect(audioContext.destination);
  }
}

export function syncAudioContextPlaybackState() {
  if (!audioContext || audioContext.state === 'closed') return;
  const hasPlayingDeck = audioDecks.some(deck => !deck.paused && !deck.ended);
  if (hasPlayingDeck && audioContext.state === 'suspended') {
    void audioContext.resume().catch(error => {
      console.error('No se pudo reanudar el contexto de audio:', error);
    });
  } else if (!hasPlayingDeck && audioContext.state === 'running') {
    void audioContext.suspend().catch(error => {
      console.error('No se pudo suspender el contexto de audio:', error);
    });
  }
}

export async function configureAudioAnalysis(enabled) {
  audioAnalysisEnabled = Boolean(enabled);
  if (nativeAudioEnabled) {
    if (enabled) ensureNativeEnergyListener();
    else disableNativeEnergyEmit();
    releaseWebAudioIfPossible();
    return true;
  }

  if (!enabled && !audioContext) {
    return false;
  }
  if (enabled && !audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    audioContext = new AudioContextClass();
  }

  for (const deck of audioDecks) {
    ensureDeckAudioNodes(deck);
    routeDeckAudio(deck);
  }
  syncAudioContextPlaybackState();
  return true;
}


/** Espectro de frecuencias normalizado [0–1] para Visual+ Wave Sound. */
export function getFrequencySpectrum(binCount = 64) {
  const count = Math.max(8, Math.min(256, binCount | 0));
  const out = new Float32Array(count);

  if (audioVars.nativeAudioActive || nativeAudioEnabled) {
    const energy = audioAnalysisEnabled ? Number(nativeAudioEnergy) || 0 : 0;
    // Fallback nativo: forma de espectro a partir de la energía global
    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const shape = Math.exp(-t * 2.2) * (0.55 + 0.45 * Math.sin(i * 0.7 + energy * 8));
      out[i] = Math.min(1, energy * shape * (0.7 + Math.random() * 0.3));
    }
    return out;
  }

  if (!audioAnalysisEnabled || !audioContext || audioContext.state !== 'running') return out;
  const deckState = getDeckState(audio);
  if (!deckState.analyser || audio.paused) return out;
  if (!deckState.frequencyData || deckState.frequencyData.length !== deckState.analyser.frequencyBinCount) {
    deckState.frequencyData = new Uint8Array(deckState.analyser.frequencyBinCount);
  }
  deckState.analyser.getByteFrequencyData(deckState.frequencyData);
  const src = deckState.frequencyData;
  const srcLen = src.length;
  // Usar más el rango bajo-medio (más musical para barras)
  const usable = Math.floor(srcLen * 0.75);
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor((i / count) * usable);
    const end = Math.floor(((i + 1) / count) * usable);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j += 1) {
      sum += src[j];
      n += 1;
    }
    const avg = n ? sum / n / 255 : 0;
    // Ligera curva para resaltar medios
    out[i] = Math.min(1, Math.pow(avg, 0.85) * 1.15);
  }
  return out;
}

export function getAudioLevel() {
  if (audioVars.nativeAudioActive || nativeAudioEnabled) {
    return audioAnalysisEnabled ? nativeAudioEnergy : 0;
  }
  if (!audioAnalysisEnabled || !audioContext || audioContext.state !== 'running') return 0;
  const deckState = getDeckState(audio);
  if (!deckState.analyser || !deckState.analysisData || audio.paused) return 0;
  deckState.analyser.getByteTimeDomainData(deckState.analysisData);
  let squaredSum = 0;
  for (let index = 0; index < deckState.analysisData.length; index += 1) {
    const sample = (deckState.analysisData[index] - 128) / 128;
    squaredSum += sample * sample;
  }
  return Math.min(1, Math.sqrt(squaredSum / deckState.analysisData.length) * 4);
}

export function setReplayGainEnabled(enabled) {
  replayGainEnabled = Boolean(enabled);
  audioDecks.forEach(deck => {
    const track = deck === audio ? state.activeQueue[state.currentTrackIndex] : null;
    getDeckState(deck).replayGainLevel = getReplayGainLevel(track);
    updateDeckVolume(deck);
  });
}

export function updateReplayGainForTrack(track) {
  const activeTrack = state.activeQueue[state.currentTrackIndex];
  const updatedPath = track?.file?.path?.toLocaleLowerCase();
  if (!updatedPath || activeTrack?.file?.path?.toLocaleLowerCase() !== updatedPath) return;
  getDeckState(audio).replayGainLevel = getReplayGainLevel(activeTrack);
  updateDeckVolume(audio);
}

export function setCrossfadeSettings(enabled, duration = crossfadeDuration, automaticOnly = crossfadeAutomaticOnly) {
  crossfadeEnabled = Boolean(enabled);
  crossfadeDuration = Math.max(1, Math.min(12, Number(duration) || 4));
  crossfadeAutomaticOnly = Boolean(automaticOnly);
  if (!crossfadeEnabled && audioVars.crossfadeInProgress) {
    try { cancelCrossfade(); } catch (_) {}
  }
  if (crossfadeEnabled) {
    cancelDeckRamp(audio, 'envelopeLevel');
    getDeckState(audio).envelopeLevel = 1;
    audioVars.trackFadeStarted = false;
    updateDeckVolume(audio);
  }
  if (!crossfadeEnabled && audioVars.crossfadeInProgress) cancelCrossfade();
}

export function setCrossfadeIndicatorEnabled(enabled) {
  audioVars.crossfadeIndicatorEnabled = Boolean(enabled);
  updateCrossfadeIndicator();
}

export function setPlaybackFadeSettings(fadeInEnabled, fadeInDuration, fadeOutEnabled, fadeOutDuration) {
  playbackFadeInEnabled = Boolean(fadeInEnabled);
  playbackFadeInDuration = Math.max(1, Math.min(5, Number(fadeInDuration) || 2));
  playbackFadeOutEnabled = Boolean(fadeOutEnabled);
  playbackFadeOutDuration = Math.max(1, Math.min(5, Number(fadeOutDuration) || 2));
  if (!playbackFadeInEnabled && !playbackFadeOutEnabled) {
    cancelDeckRamp(audio, 'envelopeLevel');
    getDeckState(audio).envelopeLevel = 1;
    audioVars.trackFadeStarted = false;
    updateDeckVolume(audio);
  }
}

export function setPauseFadeSettings(enabled, fadeInDuration = pauseFadeInDuration, fadeOutDuration = pauseFadeOutDuration) {
  pauseFadeEnabled = Boolean(enabled);
  pauseFadeInDuration = Math.max(0.5, Math.min(5, Number(fadeInDuration) || 1));
  pauseFadeOutDuration = Math.max(0.5, Math.min(5, Number(fadeOutDuration) || 1));
}

export async function listNativeOutputDevices() {
  if (!nativeAudioEnabled) return [];
  try {
    const list = await nativeInvoke('native_audio_list_output_devices');
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.error('listNativeOutputDevices:', error);
    return [];
  }
}

export async function setAudioOutputDevice(deviceId) {
  const id = deviceId ? String(deviceId) : '';
  if (nativeAudioEnabled) {
    try {
      const st = await nativeInvoke('native_audio_set_output_device', {
        deviceId: id || null
      });
      if (st && audioVars.nativeAudioActive) {
        applyNativeStatusToUi(st);
        // Mantener icono play/pausa alineado con el estado real tras cambiar dispositivo
        if (st.playing) {
          playIcon.className = 'ph-fill ph-pause';
          syncPlayingUI(true);
          startNativeProgressPoll();
        } else {
          playIcon.className = 'ph-fill ph-play';
          syncPlayingUI(false);
          stopNativeProgressPoll();
        }
      }
      return st;
    } catch (error) {
      console.error('native_audio_set_output_device:', error);
      if (audioVars.nativeAudioActive) throw error;
    }
  }
  if (audioDecks.some(deck => typeof deck.setSinkId !== 'function')) {
    throw new Error('La selección de dispositivo de salida no está disponible.');
  }
  const previousDeviceId = audio.sinkId || '';
  try {
    const outputChanges = audioDecks.map(deck => deck.setSinkId(id));
    if (audioContext && typeof audioContext.setSinkId === 'function') {
      outputChanges.push(audioContext.setSinkId(id));
    }
    await Promise.all(outputChanges);
  } catch (error) {
    const restoreChanges = audioDecks.map(deck => deck.setSinkId(previousDeviceId));
    if (audioContext && typeof audioContext.setSinkId === 'function') {
      restoreChanges.push(audioContext.setSinkId(previousDeviceId));
    }
    await Promise.allSettled(restoreChanges);
    throw error;
  }
}
