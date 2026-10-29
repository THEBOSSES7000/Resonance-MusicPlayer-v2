// Audio · Reproducción: crossfade, cola, cargar canción, play/pausa, siguiente/anterior.

import { audioDecks, currentArtistEl, currentTitleTextEl, playIcon, primaryAudio, progressContainer, timeCurrentEl, timeTotalEl } from './dom.js';
import { cancelCrossfade, cancelDeckRamp, getDeckState, getReplayGainLevel, otherDeck, rampDeckValue, setDeckTrack, updateDeckVolume } from './decks.js';
import { audioVars } from './sharedState.js';
import { applyNativeStatusToUi, canUseNativeAudio, nativeAudioEnabled, nativeFadeInSecs, nativeInvoke, nativeLoadTrack, nativeSeek, nativeShadow, nativeTogglePlay, startNativeProgressPoll, stopNativeProgressPoll } from './nativeEngine.js';
import { notifyDiscordPresence, updateWindowSongTitle, updateWindowsMediaMetadata, updateWindowsMediaPlayback, updateWindowsMediaPosition } from './windowIntegration.js';
import { resetProgressVisual, setProgressVisual, updateAudioQuality, updateCrossfadeIndicator, updateProgressTimes } from './progressUI.js';
import { paintPlayerCover, resetPlayerCoverToPlaceholder } from './playerCover.js';
import { ensureSongMetadata, persistPlaybackSession, renderQueue, showConfirmDialog, syncPlayingUI, updateFavIcon, updateLyricsUI, updateSyncedLyricsProgress } from '../ui.js';
import { getSongByIdOrPath, resolveAudioUrl, resolveCoverUrl, state } from '../state.js';
import { crossfadeAutomaticOnly, crossfadeDuration, crossfadeEnabled, masterVolume, pauseFadeEnabled, pauseFadeInDuration, pauseFadeOutDuration, playbackFadeInDuration, playbackFadeInEnabled, playbackFadeOutDuration, playbackFadeOutEnabled, updateLyricsButtonVisibility } from './webAudio.js';
import { loadWaveformForTrack } from './waveform.js';
import { ensureSongCover, ensureSongLyrics, ensureSongTechDetails } from '../scanner.js';
import { getPlaybackDuration, getPlaybackPosition, isPlaybackPaused, seekPlayback } from './position.js';
import { resetPlayCountSession } from './playCount.js';
import { needsHtmlAudioEffects, setPlaybackPitch, setPlaybackSpeed } from './effects.js';

export let audio = primaryAudio;

export function stopPlaybackForDeletedFile() {
  cancelCrossfade();
  if (audioVars.nativeAudioActive) {
    stopNativeProgressPoll();
    void nativeInvoke('native_audio_stop').catch(() => {});
    audioVars.nativeAudioActive = false;
  }
  audioDecks.forEach(deck => {
    deck.pause();
    deck.removeAttribute('src');
    deck.load();
  });
  audio = primaryAudio;
  currentTitleTextEl.textContent = 'Sin reproducción activa';
  currentArtistEl.textContent = 'Selecciona una canción';
  updateWindowSongTitle();
  currentArtistEl.classList.remove('is-active');
  updateAudioQuality(null);
  resetPlayerCoverToPlaceholder();
  timeCurrentEl.textContent = '0:00';
  timeTotalEl.textContent = '0:00';
  playIcon.className = 'ph-fill ph-play';
  resetProgressVisual();
  syncPlayingUI(false);
  notifyDiscordPresence(true, true);
}

function resetInactiveDeck() {
  const inactiveDeck = otherDeck(audio);
  inactiveDeck.pause();
  inactiveDeck.removeAttribute('src');
  inactiveDeck.load();
  const inactiveState = getDeckState(inactiveDeck);
  inactiveState.transitionLevel = 0;
  inactiveState.envelopeLevel = 1;
  inactiveState.replayGainLevel = 1;
  updateDeckVolume(inactiveDeck);
}

export async function crossfadeToNext(index) {
  if (audioVars.crossfadeInProgress || index < 0 || index >= state.activeQueue.length) return false;
  const nextTrack = state.activeQueue[index];
  if (audioVars.nativeAudioActive && canUseNativeAudio(nextTrack)) {
    return nativeCrossfadeToNext(index);
  }
  if (nativeAudioEnabled && canUseNativeAudio(nextTrack) && !audioVars.nativeAudioActive) {
    return false;
  }
  audioVars.crossfadeInProgress = true;
  const generation = ++audioVars.crossfadeGeneration;
  const outgoingDeck = audio;
  const incomingDeck = otherDeck(outgoingDeck);
  const outgoingState = getDeckState(outgoingDeck);
  const incomingState = getDeckState(incomingDeck);
  incomingDeck.pause();
  incomingState.transitionLevel = 0;
  incomingState.envelopeLevel = 1;
  updateDeckVolume(incomingDeck);

  try {
    await ensureSongMetadata(state.activeQueue[index]);
    if (generation !== audioVars.crossfadeGeneration) return true;
    await loadSong(index, false, true, incomingDeck, true, generation);
    if (generation !== audioVars.crossfadeGeneration) return true;
    await audio.play();
    syncPlayingUI(true);
    playIcon.className = "ph-fill ph-pause";

    const outgoingRemaining = Number.isFinite(outgoingDeck.duration)
      ? Math.max(0.25, outgoingDeck.duration - outgoingDeck.currentTime)
      : crossfadeDuration;
    const incomingDuration = Number.isFinite(audio.duration) ? audio.duration : crossfadeDuration * 2;
    const duration = Math.max(0.25, Math.min(crossfadeDuration, outgoingRemaining, incomingDuration / 2));
    const startTime = performance.now();
    audioVars.crossfadeVisualActive = true;
    updateCrossfadeIndicator();
    await new Promise(resolve => {
      audioVars.crossfadeAnimationResolve = resolve;
      const step = now => {
        if (!audioVars.crossfadeInProgress) return;
        const progress = Math.min(1, (now - startTime) / (duration * 1000));
        outgoingState.transitionLevel = 1 - progress;
        incomingState.transitionLevel = progress;
        updateDeckVolume(outgoingDeck);
        updateDeckVolume(incomingDeck);
        if (progress >= 1) {
          audioVars.rampAnimationId = null;
          audioVars.crossfadeAnimationResolve = null;
          resolve();
        } else {
          audioVars.rampAnimationId = requestAnimationFrame(step);
        }
      };
      audioVars.rampAnimationId = requestAnimationFrame(step);
    });

    if (generation !== audioVars.crossfadeGeneration || !audioVars.crossfadeInProgress) return true;
    outgoingDeck.pause();
    outgoingDeck.removeAttribute('src');
    outgoingDeck.load();
    outgoingState.transitionLevel = 0;
    incomingState.transitionLevel = 1;
    updateDeckVolume(outgoingDeck);
    updateDeckVolume(incomingDeck);
    audioVars.crossfadeInProgress = false;
    audioVars.crossfadeVisualActive = false;
    updateCrossfadeIndicator();
    return true;
  } catch (error) {
    if (generation !== audioVars.crossfadeGeneration) return true;
    console.error('No se pudo iniciar el fundido cruzado:', error);
    if (audio === incomingDeck) audio = outgoingDeck;
    incomingDeck.pause();
    incomingDeck.removeAttribute('src');
    incomingDeck.load();
    incomingState.transitionLevel = 0;
    outgoingState.transitionLevel = 1;
    updateDeckVolume(incomingDeck);
    updateDeckVolume(outgoingDeck);
    audioVars.crossfadeInProgress = false;
    audioVars.crossfadeVisualActive = false;
    updateCrossfadeIndicator();
    await loadSong(index, true, true);
    return false;
  }
}

async function nativeCrossfadeToNext(index) {
  if (audioVars.crossfadeInProgress || index < 0 || index >= state.activeQueue.length) return false;
  let track = state.activeQueue[index];
  const canonical = getSongByIdOrPath(track?.file?.path || track?.path || track?.id);
  if (canonical && canonical !== track) {
    if (track.isEnqueuedNext) canonical.isEnqueuedNext = true;
    state.activeQueue[index] = canonical;
    track = canonical;
  }
  if (track?.unavailable) {
    console.warn('[Resonance] Pista no disponible:', track.title || track.path);
    try {
      const { showConfirmDialog } = await import('../ui.js');
      await showConfirmDialog({
        title: 'Canción no disponible',
        message: 'El archivo no está en el disco (¿unidad desconectada o archivo movido?). Se mantiene en la biblioteca y en las playlists.',
        confirmText: 'Entendido',
        showCancel: false
      });
    } catch (_) {}
    return false;
  }
  const path = track?.file?.path || track?.path;
  if (!path || typeof path !== 'string') return false;

  audioVars.crossfadeInProgress = true;
  const generation = ++audioVars.crossfadeGeneration;
  audioVars.crossfadeVisualActive = true;
  audioVars.lyricsCrossfadeFreeze = false;
  updateCrossfadeIndicator();

  try {
    if (state.currentTrackIndex !== -1 && state.currentTrackIndex !== index) {
      const oldIndex = state.currentTrackIndex;
      if (index > oldIndex) {
        for (let i = oldIndex; i < index; i++) {
          const t = state.activeQueue[i];
          if (t && (state.playbackHistory.length === 0 || state.playbackHistory[0] !== t)) {
            state.playbackHistory.unshift(t);
          }
        }
      }
      if (state.playbackHistory.length > 100) {
        state.playbackHistory.length = 100;
      }
    }

    await ensureSongMetadata(track);
    if (generation !== audioVars.crossfadeGeneration) return true;

    const vol = typeof masterVolume === 'number' ? masterVolume : 0.8;
    const gain = getReplayGainLevel(track);
    const st = await nativeInvoke('native_audio_crossfade', {
      path,
      durationSecs: crossfadeDuration,
      volume: Math.max(0, Math.min(1, vol * gain))
    });
    if (generation !== audioVars.crossfadeGeneration) return true;

    audioVars.nativeAudioActive = true;
    audioVars.nativeLastEnded = false;
    state.currentTrackIndex = index;
    applyNativeStatusToUi(st);
    startNativeProgressPoll();

    if (st.durationSeconds > 0) track.duration = st.durationSeconds;

    paintPlayerCover(resolveCoverUrl(track), track);
    void loadWaveformForTrack(track);
    void Promise.all([
      ensureSongLyrics(track),
      ensureSongTechDetails(track),
      ensureSongCover(track)
    ]).then(([, , cover]) => {
      if (state.activeQueue[state.currentTrackIndex] !== track) return;
      try {
        updateAudioQuality(track);
        updateLyricsButtonVisibility(track);
        updateLyricsUI?.();
        paintPlayerCover(cover || resolveCoverUrl(track), track);
      } catch (_) {}
    }).catch(() => {});

    const titleClean = (track.title || '').trim();
    const artistClean = (track.artist || '').trim();
    updateWindowSongTitle(track);
    currentTitleTextEl.textContent = titleClean;
    currentArtistEl.textContent = artistClean || 'Desconocido';
    currentArtistEl.classList.toggle('is-active', Boolean(artistClean && artistClean !== 'Desconocido'));
    updateAudioQuality(track);
    void updateWindowsMediaMetadata(track);
    updateWindowsMediaPlayback(true, true);
    updateLyricsButtonVisibility(track);
    updateTitleMarquee();
    updateFavIcon();
    renderQueue();
    try {
      updateLyricsUI();
      updateSyncedLyricsProgress(Number(st?.positionSeconds) || 0);
    } catch (_) {}
    notifyDiscordPresence(true);
    playIcon.className = 'ph-fill ph-pause';
    syncPlayingUI(true);
    setDeckTrack(audio, track, false);
    getDeckState(audio).transitionLevel = 1;
    updateDeckVolume(audio);

    const gen = generation;
    window.setTimeout(() => {
      if (gen !== audioVars.crossfadeGeneration) return;
      // Failsafe: el icono no debe quedarse tras la duración configurada
      if (audioVars.crossfadeInProgress || audioVars.crossfadeVisualActive) {
        audioVars.crossfadeInProgress = false;
        audioVars.crossfadeVisualActive = false;
        updateCrossfadeIndicator();
      }
    }, Math.ceil(crossfadeDuration * 1000) + 150);

    return true;
  } catch (error) {
    if (generation !== audioVars.crossfadeGeneration) return true;
    console.error('Crossfade nativo falló:', error);
    audioVars.crossfadeInProgress = false;
    audioVars.crossfadeVisualActive = false;
    updateCrossfadeIndicator();
    await loadSong(index, true, true);
    return false;
  }
}

export function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function playNextInQueue(song, skipDuplicateConfirmation = false) {
  if (!song) return;
  const canonical = getSongByIdOrPath(song.file?.path || song.path || song.id) || song;

  const alreadyInQueue = state.activeQueue.some(s => s === canonical || s.id === canonical.id || (s.title === canonical.title && s.artist === canonical.artist));
  if (alreadyInQueue && !skipDuplicateConfirmation) {
    const proceed = await showConfirmDialog({
      title: "¿Agregar canción duplicada?",
      message: `La canción "${canonical.title}" ya se encuentra en la lista de reproducción. ¿Querés agregarla otra vez, o reemplazar la que ya está (la mueve a continuación y quita la anterior)?`,
      confirmText: "Agregar",
      cancelText: "Cancelar",
      alternateText: "Reemplazar"
    });
    if (proceed === false || proceed == null) return;
    if (proceed === 'alternate') {
      const current = state.currentTrackIndex;
      const sameSong = (s) => {
        if (!s) return false;
        if (s === canonical) return true;
        if (canonical.id != null && s.id != null && String(s.id) === String(canonical.id)) return true;
        const pa = String(s.file?.path || s.path || '').replace(/\\/g, '/').toLowerCase();
        const pb = String(canonical.file?.path || canonical.path || '').replace(/\\/g, '/').toLowerCase();
        return Boolean(pa && pb && pa === pb);
      };
      const nextQueue = [];
      let newCurrent = current;
      state.activeQueue.forEach((s, i) => {
        // Conservar la que está sonando; quitar otras copias
        if (i === current || !sameSong(s)) {
          nextQueue.push(s);
        } else if (i < current) {
          newCurrent -= 1;
        }
      });
      state.activeQueue = nextQueue;
      state.currentTrackIndex = Math.max(-1, Math.min(newCurrent, state.activeQueue.length - 1));
    }
  }

  // Usar la referencia canónica en lugar de clonar { ...song }
  canonical.isEnqueuedNext = true;

  if (state.activeQueue.length === 0 || state.currentTrackIndex === -1) {
    state.activeQueue = [canonical];
    loadSong(0, true);
    return;
  }

  let insertIndex = state.currentTrackIndex + 1;
  while (insertIndex < state.activeQueue.length && state.activeQueue[insertIndex].isEnqueuedNext === true) {
    insertIndex++;
  }

  state.activeQueue.splice(insertIndex, 0, canonical);
  renderQueue();
}

export async function addToQueue(song, skipDuplicateConfirmation = false) {
  if (!song) return;
  const canonical = getSongByIdOrPath(song.file?.path || song.path || song.id) || song;

  const alreadyInQueue = state.activeQueue.some(s => s === canonical || s.id === canonical.id || (s.title === canonical.title && s.artist === canonical.artist));
  if (alreadyInQueue && !skipDuplicateConfirmation) {
    const proceed = await showConfirmDialog({
      title: "¿Agregar canción duplicada?",
      message: `La canción "${canonical.title}" ya se encuentra en la cola de reproducción. ¿Estás seguro de que quieres agregarla?`,
      confirmText: "Agregar",
      cancelText: "Cancelar"
    });
    if (!proceed) return;
  }

  if (!alreadyInQueue) {
    canonical.isEnqueuedNext = false;
  }

  if (state.activeQueue.length === 0 || state.currentTrackIndex === -1) {
    state.activeQueue = [canonical];
    loadSong(0, true);
    return;
  }

  state.activeQueue.push(canonical);
  renderQueue();
}

export function removeFromQueue(index) {
  if (index < 0 || index >= state.activeQueue.length) return;
  if (index === state.currentTrackIndex) {
    nextSong();
  }
  state.activeQueue.splice(index, 1);
  if (index < state.currentTrackIndex) {
    state.currentTrackIndex--;
  }
  renderQueue();
}

export function updateTitleMarquee() {
  const box = document.getElementById('title-marquee-box');
  const titleEl = document.getElementById('current-title');
  if (!box || !titleEl) return;

  box.classList.remove('is-overflowing');
  titleEl.style.removeProperty('--marquee-dist');
  titleEl.style.removeProperty('--marquee-duration');

  requestAnimationFrame(() => {
    const overflow = titleEl.scrollWidth - box.clientWidth;
    if (overflow > 4) {
      box.classList.add('is-overflowing');
      titleEl.style.setProperty('--marquee-dist', `${overflow + 14}px`);
      const duration = Math.max(6, Math.min(16, overflow / 18));
      titleEl.style.setProperty('--marquee-duration', `${duration}s`);
    }
  });
}

/** autoPlay efectivo en cambios manuales (clic / siguiente / anterior). */
export function resolveManualAutoPlay(requestedAutoPlay = true) {
  if (!requestedAutoPlay) return false;
  if (localStorage.getItem('pn_behavior_next_while_paused') !== 'true') return true;
  // Sin pista actual: sí reproducir al elegir la primera
  if (state.currentTrackIndex < 0) return true;
  return !isPlaybackPaused();
}

export async function loadSong(index, autoPlay = true, recordHistory = true, targetDeck = audio, preserveCrossfade = false, crossfadeToken = null) {
  resetPlayCountSession();
  if (index < 0 || index >= state.activeQueue.length) return;
  if (!preserveCrossfade && audioVars.crossfadeInProgress) cancelCrossfade();

  if (recordHistory && state.currentTrackIndex !== -1) {
    const oldIndex = state.currentTrackIndex;
    const newIndex = index;

    if (newIndex > oldIndex) {
      for (let i = oldIndex; i < newIndex; i++) {
        const track = state.activeQueue[i];
        if (track) {
          if (state.playbackHistory.length === 0 || state.playbackHistory[0] !== track) {
            state.playbackHistory.unshift(track);
          }
        }
      }
    } else if (newIndex < oldIndex) {
      const upcomingSet = new Set(state.activeQueue.slice(newIndex));
      state.playbackHistory = state.playbackHistory.filter(t => !upcomingSet.has(t));
    }

    if (state.playbackHistory.length > 100) {
      state.playbackHistory.length = 100;
    }
  }

  // Asegurar que la pista en cola sea siempre la referencia canónica de state.localMusicFiles
  let track = state.activeQueue[index];
  const canonical = getSongByIdOrPath(track?.file?.path || track?.path || track?.id);
  if (canonical && canonical !== track) {
    if (track.isEnqueuedNext) canonical.isEnqueuedNext = true;
    state.activeQueue[index] = canonical;
    track = canonical;
  }
  track.isEnqueuedNext = false;

  const currentTrack = state.currentTrackIndex < 0
    ? null
    : state.activeQueue[state.currentTrackIndex];
  const trackChanged = !currentTrack ||
    currentTrack.id !== track.id ||
    (currentTrack.file?.path || currentTrack.audioUrl) !== (track.file?.path || track.audioUrl);
  if (preserveCrossfade) {
    await ensureSongMetadata(track);
    if (crossfadeToken !== audioVars.crossfadeGeneration) return;
  }
  state.currentTrackIndex = index;

  await ensureSongMetadata(track);
  if (preserveCrossfade && crossfadeToken !== audioVars.crossfadeGeneration) return;

  if (trackChanged) {
    setPlaybackSpeed(1);
    setPlaybackPitch(0);
  }
  const useNative = canUseNativeAudio(track) && targetDeck === audio && !preserveCrossfade && !needsHtmlAudioEffects();
  let audioSrc = null;
  if (useNative) {
    try {
      await nativeLoadTrack(track, Boolean(autoPlay));
    } catch (error) {
      console.error('Audio nativo falló, usando HTML Audio:', error);
      audioVars.nativeAudioActive = false;
      audioSrc = resolveAudioUrl(track);
      if (!audioSrc) return;
      targetDeck.src = audioSrc;
    }
  } else {
    audioVars.nativeAudioActive = false;
    stopNativeProgressPoll();
    audioSrc = resolveAudioUrl(track);
    if (!audioSrc) {
      console.error('No se pudo resolver la URL de audio de la pista:', track?.title);
      return;
    }
    targetDeck.src = audioSrc;
  }

  paintPlayerCover(resolveCoverUrl(track), track);

  const wavePath = track?.file?.path || track?.path || '';
  if (trackChanged || wavePath !== audioVars.waveformPeaksPath || !audioVars.waveformPeaks) {
    void loadWaveformForTrack(track);
  }

  void Promise.all([
    ensureSongLyrics(track),
    ensureSongTechDetails(track),
    ensureSongCover(track)
  ]).then(([, , cover]) => {
    if (state.activeQueue[state.currentTrackIndex] !== track) return;
    try {
      updateAudioQuality(track);
      updateLyricsButtonVisibility(track);
      updateLyricsUI?.();
      paintPlayerCover(cover || resolveCoverUrl(track), track);
    } catch (_) {}
  }).catch(err => console.warn('No se pudieron cargar letras/specs/carátula:', err));

  if (targetDeck !== audio) audio = targetDeck;
  setDeckTrack(targetDeck, track, autoPlay && !preserveCrossfade);
  if (preserveCrossfade) {
    getDeckState(targetDeck).transitionLevel = 0;
    updateDeckVolume(targetDeck);
  } else {
    resetInactiveDeck();
  }

  const titleClean = (track.title || "").trim();
  const artistClean = (track.artist || "").trim();

  updateWindowSongTitle(track);
  currentTitleTextEl.textContent = titleClean;
  currentArtistEl.textContent = artistClean || "Desconocido";
  currentArtistEl.classList.toggle('is-active', Boolean(artistClean && artistClean !== 'Desconocido'));
  updateAudioQuality(track);
  void updateWindowsMediaMetadata(track);
  updateWindowsMediaPlayback(Boolean(autoPlay && !preserveCrossfade), true);

  updateLyricsButtonVisibility(track);
  updateTitleMarquee();
  updateFavIcon();
  renderQueue();
  updateLyricsUI();
  notifyDiscordPresence(true);

  if (autoPlay) {
    if (audioVars.nativeAudioActive) {
      startNativeProgressPoll();
      playIcon.className = "ph-fill ph-pause";
      syncPlayingUI(true);
      updateWindowsMediaPlayback(true);
      updateWindowsMediaPosition(true);
      nativeInvoke('native_audio_status')
        .then(st => applyNativeStatusToUi(st))
        .catch(() => {});
    } else {
      audio.play().then(() => {
        playIcon.className = "ph-fill ph-pause";
        syncPlayingUI(true);
      }).catch(e => {
        console.error(e);
        syncPlayingUI(false);
      });
    }
  } else {
    playIcon.className = "ph-fill ph-play";
    syncPlayingUI(false);
  }
  persistPlaybackSession(autoPlay);
}

export function togglePlay() {
  if (state.activeQueue.length === 0) return;
  if (state.currentTrackIndex === -1) {
    loadSong(0, true);
    return;
  }
  if (audioVars.nativeAudioActive) {
    void nativeTogglePlay();
    return;
  }
  if (audio.paused) {
    const deckState = getDeckState(audio);
    if (pauseFadeEnabled) {
      cancelDeckRamp(audio, 'envelopeLevel');
      deckState.envelopeLevel = 0;
      updateDeckVolume(audio);
    }
    audio.play().then(() => {
      playIcon.className = 'ph-fill ph-pause';
      syncPlayingUI(true);
      if (pauseFadeEnabled) {
        void rampDeckValue(audio, 'envelopeLevel', 1, pauseFadeInDuration);
      }
    }).catch(e => console.error(e));
  } else {
    if (audioVars.crossfadeInProgress) {
      cancelCrossfade();
    }
    if (pauseFadeEnabled) {
      playIcon.className = 'ph-fill ph-play';
      syncPlayingUI(false);
      void rampDeckValue(audio, 'envelopeLevel', 0, pauseFadeOutDuration).then(() => {
        if (!playIcon.className.includes('ph-play')) {
          getDeckState(audio).envelopeLevel = 1;
          updateDeckVolume(audio);
          return;
        }
        audio.pause();
        cancelDeckRamp(audio, 'envelopeLevel');
        getDeckState(audio).envelopeLevel = 1;
        updateDeckVolume(audio);
      });
      return;
    }
    audio.pause();
    playIcon.className = 'ph-fill ph-play';
    syncPlayingUI(false);
  }
}

export async function nextSong(isAutoEnd = false) {
  if (state.activeQueue.length === 0) return;

  const keepPaused = !isAutoEnd && !resolveManualAutoPlay(true);

  if (isAutoEnd && state.repeatMode === 'one') {
    restartCurrentTrack();
    return;
  }

  if (state.currentTrackIndex + 1 < state.activeQueue.length) {
    const nextIdx = state.currentTrackIndex + 1;
    const canCrossfade = crossfadeEnabled
      && (!crossfadeAutomaticOnly || isAutoEnd)
      && !keepPaused;
    if (canCrossfade && await crossfadeToNext(nextIdx)) return;
    loadSong(nextIdx, !keepPaused, true);
  } else {
    if (state.repeatMode === 'all') {
      if (state.isShuffle) {
        state.activeQueue = shuffleArray(state.activeQueue);
      }
      loadSong(0, !keepPaused, true);
    } else if (state.repeatMode === 'one') {
      if (keepPaused) void seekPlayback(0);
      else restartCurrentTrack();
    } else {
      if (audioVars.nativeAudioActive) {
        stopNativeProgressPoll();
        void nativeInvoke('native_audio_pause', { fadeOutSecs: 0 }).catch(() => {});
        void seekPlayback(0);
        nativeShadow.paused = true;
      } else {
        audio.pause();
        audio.currentTime = 0;
      }
      playIcon.className = "ph-fill ph-play";
      syncPlayingUI(false);
    }
  }
}

export function seekBy(seconds) {
  const dur = getPlaybackDuration();
  if (!Number.isFinite(seconds) || !Number.isFinite(dur) || dur <= 0) return;
  if (audioVars.nativeAudioActive) {
    const base = getPlaybackPosition();
    void nativeSeek(Math.max(0, Math.min(dur, base + seconds)));
    return;
  }
  audio.currentTime = Math.max(0, Math.min(dur, audio.currentTime + seconds));
  const progress = audio.currentTime / dur;
  setProgressVisual(progress);
  progressContainer.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  updateProgressTimes(audio.currentTime, dur);
  updateWindowsMediaPosition(true);
  notifyDiscordPresence(true);
}

function restartCurrentTrack() {
  const deckState = getDeckState(audio);
  cancelDeckRamp(audio, 'envelopeLevel');
  deckState.envelopeLevel = playbackFadeInEnabled ? 0 : 1;
  audioVars.trackFadeStarted = false;
  updateDeckVolume(audio);
  if (audioVars.nativeAudioActive) {
    void (async () => {
      await seekPlayback(0);
      await nativeInvoke('native_audio_play', { fadeInSecs: nativeFadeInSecs() });
      nativeShadow.paused = false;
      startNativeProgressPoll();
      playIcon.className = 'ph-fill ph-pause';
      syncPlayingUI(true);
      updateWindowsMediaPlayback(true);
    })();
    return;
  }
  audio.currentTime = 0;
  audio.play().catch(error => console.error(error));
  if (playbackFadeInEnabled) void rampDeckValue(audio, 'envelopeLevel', 1, playbackFadeInDuration);
}

export function handleTrackEffects(deck) {
  if (deck !== audio || !Number.isFinite(deck.duration) || deck.duration <= 0) return;
  const remaining = deck.duration - deck.currentTime;
  const hasQueuedNext = state.repeatMode !== 'one' && state.currentTrackIndex + 1 < state.activeQueue.length;

  if (crossfadeEnabled && hasQueuedNext && !audioVars.crossfadeInProgress && remaining <= crossfadeDuration) {
    void crossfadeToNext(state.currentTrackIndex + 1);
    return;
  }

  if (
    playbackFadeOutEnabled &&
    (!crossfadeEnabled || !hasQueuedNext) &&
    !audioVars.trackFadeStarted &&
    remaining <= playbackFadeOutDuration
  ) {
    audioVars.trackFadeStarted = true;
    void rampDeckValue(deck, 'envelopeLevel', 0, Math.max(0.15, Math.min(playbackFadeOutDuration, remaining)));
  }
}

export function updateRepeatButton() {
  const button = document.getElementById('btn-repeat');
  if (!button) return;
  button.classList.toggle('active-toggle', state.repeatMode !== 'off');
  button.innerHTML = `<i class="ph ${state.repeatMode === 'one' ? 'ph-repeat-once' : 'ph-repeat'}"></i>`;
  button.title = state.repeatMode === 'all'
    ? 'Repetir cola completa'
    : state.repeatMode === 'one'
      ? 'Repetir una pista'
      : 'Repetición desactivada';
  const lyricsBtn = document.getElementById('lyrics-btn-repeat');
  if (lyricsBtn) {
    lyricsBtn.classList.toggle('active-toggle', state.repeatMode !== 'off');
    lyricsBtn.classList.toggle('active', state.repeatMode !== 'off');
    lyricsBtn.innerHTML = button.innerHTML;
    lyricsBtn.title = button.title;
  }
}

export function setShuffleEnabled(enabled) {
  state.isShuffle = Boolean(enabled);
  const button = document.getElementById('btn-shuffle');
  if (button) {
    button.classList.toggle('active-toggle', state.isShuffle);
    button.title = state.isShuffle ? 'Desactivar aleatorio' : 'Aleatorio';
  }

  if (state.isShuffle && state.currentTrackIndex >= 0 && state.activeQueue.length > 1) {
    const played = state.activeQueue.slice(0, state.currentTrackIndex + 1);
    const upcoming = state.activeQueue.slice(state.currentTrackIndex + 1);
    if (upcoming.length > 1) {
      state.activeQueue = [...played, ...shuffleArray(upcoming)];
      renderQueue();
    }
  }
}

export function setRepeatMode(mode) {
  if (!['off', 'all', 'one'].includes(mode)) {
    throw new Error(`Modo de repetición no válido: ${mode}`);
  }
  state.repeatMode = mode;
  updateRepeatButton();
}

export function prevSong() {
  if (state.activeQueue.length === 0) return;

  const goDirectToPrev = localStorage.getItem('pn_behavior_prev_direct') === 'true';
  const keepPaused = !resolveManualAutoPlay(true);
  if (!goDirectToPrev && getPlaybackPosition() > 3) {
    void seekPlayback(0);
    return;
  }

  if (state.playbackHistory.length > 0) {
    const lastPlayed = state.playbackHistory[0];
    const idx = state.activeQueue.indexOf(lastPlayed);
    if (idx !== -1) {
      loadSong(idx, !keepPaused, true);
      return;
    } else {
      state.playbackHistory.shift();
      state.activeQueue.splice(Math.max(0, state.currentTrackIndex), 0, lastPlayed);
      loadSong(Math.max(0, state.currentTrackIndex), !keepPaused, false);
      return;
    }
  }

  const prevIdx = (state.currentTrackIndex - 1 + state.activeQueue.length) % state.activeQueue.length;
  loadSong(prevIdx, !keepPaused, false);
}
