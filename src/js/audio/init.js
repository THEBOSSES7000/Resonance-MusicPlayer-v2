// Audio · Inicialización del reproductor y controles emergentes.

import { cancelSleepTimer, handleSleepTimerTrackEnd, pauseForSleepTimer, updateSleepTimerStatus } from './sleepTimer.js';
import { audioVars } from './sharedState.js';
import { incrementPlayCount, resolveCoverUrl, state } from '../state.js';
import { setPlaybackPitch, setPlaybackSpeed, setPreservePitch } from './effects.js';
import { initializeProgressWaveforms } from './waveform.js';
import { initWindowsMediaControlListener, notifyDiscordPresence, updateTaskbarPlaybackProgress, updateWindowSongTitle, updateWindowsMediaPlayback, updateWindowsMediaPosition } from './windowIntegration.js';
import { audioDecks, currentArtistEl, currentTitleTextEl, playIcon, progressContainer, volIcon, volumeBox, volumeRange } from './dom.js';
import { lastProgressRatio, setProgressVisual, updateAudioQuality, updateProgressTimes, updateSeekPosition } from './progressUI.js';
import { paintPlayerCover } from './playerCover.js';
import { audio, handleTrackEffects, nextSong, prevSong, setRepeatMode, setShuffleEnabled, togglePlay, updateRepeatButton, updateTitleMarquee } from './playback.js';
import { navigateToView, persistPlaybackSession, renderGrids, syncPlayingUI, updateSyncedLyricsProgress } from '../ui.js';
import { getPlaybackDuration, getPlaybackPosition, isPlaybackPaused, seekPlayback } from './position.js';
import { masterVolume, setAppVolume, showVolumeTooltip, syncAudioContextPlaybackState } from './webAudio.js';
import { maybeCountPlayFromProgress } from './playCount.js';
import { cancelCrossfade } from './decks.js';
import { applyNativeStatusToUi, nativeInvoke, startNativeProgressPoll } from './nativeEngine.js';

function initPlayerPopoverControls() {
  const sleepPopover = document.getElementById('sleep-timer-popover');
  const speedPopover = document.getElementById('playback-speed-popover');
  const sleepButton = document.getElementById('btn-sleep-timer');
  const speedButton = document.getElementById('btn-playback-speed');
  const sleepMode = document.getElementById('sleep-timer-mode');
  const sleepUnit = document.getElementById('sleep-timer-unit');
  const sleepValue = document.getElementById('sleep-timer-value');
  const sleepValueRow = document.getElementById('sleep-timer-value-row');

  const setPopoverOpen = (button, popover, open) => {
    if (!button || !popover) return;
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  sleepButton?.addEventListener('click', event => {
    event.stopPropagation();
    setPopoverOpen(speedButton, speedPopover, false);
    setPopoverOpen(sleepButton, sleepPopover, sleepPopover.hidden);
    updateSleepTimerStatus();
  });
  speedButton?.addEventListener('click', event => {
    event.stopPropagation();
    setPopoverOpen(sleepButton, sleepPopover, false);
    setPopoverOpen(speedButton, speedPopover, speedPopover.hidden);
  });
  [sleepPopover, speedPopover].forEach(popover => {
    popover?.addEventListener('click', event => event.stopPropagation());
  });
  document.addEventListener('click', () => {
    setPopoverOpen(sleepButton, sleepPopover, false);
    setPopoverOpen(speedButton, speedPopover, false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    setPopoverOpen(sleepButton, sleepPopover, false);
    setPopoverOpen(speedButton, speedPopover, false);
  });

  const updateSleepInputs = () => {
    const mode = sleepMode?.value || 'time';
    if (sleepValueRow) sleepValueRow.hidden = mode === 'end';
    if (sleepUnit) {
      sleepUnit.hidden = mode === 'end';
      const timeMode = mode === 'time';
      sleepUnit.querySelector('option[value="minutes"]').hidden = !timeMode;
      sleepUnit.querySelector('option[value="hours"]').hidden = !timeMode;
      sleepUnit.querySelector('option[value="tracks"]').hidden = timeMode;
      sleepUnit.value = timeMode ? 'minutes' : 'tracks';
    }
  };
  sleepMode?.addEventListener('change', updateSleepInputs);
  updateSleepInputs();
  document.getElementById('btn-start-sleep-timer')?.addEventListener('click', () => {
    cancelSleepTimer();
    audioVars.sleepTimerMode = sleepMode?.value || 'time';
    if (audioVars.sleepTimerMode === 'time') {
      const amount = Number(sleepValue?.value);
      if (!Number.isFinite(amount) || amount < 1) {
        audioVars.sleepTimerMode = null;
        updateSleepTimerStatus();
        return;
      }
      const multiplier = sleepUnit?.value === 'hours' ? 60 * 60 * 1000 : 60 * 1000;
      audioVars.sleepTimerDeadline = Date.now() + amount * multiplier;
      audioVars.sleepTimerInterval = setInterval(() => {
        if (Date.now() >= audioVars.sleepTimerDeadline) pauseForSleepTimer();
        else updateSleepTimerStatus();
      }, 1000);
    } else if (audioVars.sleepTimerMode === 'tracks') {
      const amount = Number(sleepValue?.value);
      if (!Number.isSafeInteger(amount) || amount < 1) {
        audioVars.sleepTimerMode = null;
        updateSleepTimerStatus();
        return;
      }
      audioVars.sleepTimerRemainingTracks = amount;
    } else if (state.activeQueue.length === 0 || state.currentTrackIndex < 0) {
      audioVars.sleepTimerMode = null;
      const status = document.getElementById('sleep-timer-status');
      if (status) status.textContent = 'Reproduce una lista antes de activar esta opción.';
      return;
    }
    sleepButton?.classList.add('active-toggle');
    updateSleepTimerStatus();
  });
  document.getElementById('btn-cancel-sleep-timer')?.addEventListener('click', cancelSleepTimer);

  const speedSlider = document.getElementById('playback-speed');
  const pitchSlider = document.getElementById('playback-pitch');
  const pitchCheckbox = document.getElementById('playback-preserve-pitch');
  speedSlider?.addEventListener('input', () => setPlaybackSpeed(Number(speedSlider.value)));
  pitchSlider?.addEventListener('input', () => setPlaybackPitch(Number(pitchSlider.value)));
  pitchCheckbox?.addEventListener('change', () => setPreservePitch(pitchCheckbox.checked));
  setPlaybackSpeed(audioVars.playbackRate);
  setPlaybackPitch(audioVars.playbackPitch);
  setPreservePitch(audioVars.preservePitch);
}

export function initAudioPlayer() {
  initializeProgressWaveforms();
  setPlaybackSpeed(audioVars.playbackRate);
  setPreservePitch(audioVars.preservePitch);
  initWindowsMediaControlListener();
  window.addEventListener('pn-library-cache-cleared', () => {
    const track = state.currentTrackIndex < 0 ? null : state.activeQueue[state.currentTrackIndex];
    if (!track) return;
    currentTitleTextEl.textContent = track.title;
    currentArtistEl.textContent = track.artist || 'Desconocido';
    updateWindowSongTitle(track);
    currentArtistEl.classList.toggle('is-active', Boolean(track.artist && track.artist !== 'Desconocido'));
    updateAudioQuality(track);
    paintPlayerCover(resolveCoverUrl(track), track);
    updateTitleMarquee();
    syncPlayingUI(!isPlaybackPaused());
  });
  window.addEventListener('resize', () => setProgressVisual(lastProgressRatio));

  document.getElementById('play-pause-btn').addEventListener('click', togglePlay);
  document.getElementById('btn-next').addEventListener('click', () => nextSong(false));
  document.getElementById('btn-prev').addEventListener('click', prevSong);
  initPlayerPopoverControls();

  const btnShuffle = document.getElementById('btn-shuffle');
  btnShuffle.classList.toggle('active-toggle', state.isShuffle);
  btnShuffle.title = state.isShuffle ? 'Desactivar aleatorio' : 'Aleatorio';
  btnShuffle.addEventListener('click', () => {
    setShuffleEnabled(!state.isShuffle);
  });

  const btnRepeat = document.getElementById('btn-repeat');
  updateRepeatButton();
  btnRepeat.addEventListener('click', () => {
    if (state.repeatMode === 'off') {
      setRepeatMode('all');
    } else if (state.repeatMode === 'all') {
      setRepeatMode('one');
    } else {
      setRepeatMode('off');
    }
  });

  currentArtistEl.addEventListener('click', () => {
    const artistName = state.currentTrackIndex !== -1
      ? state.activeQueue[state.currentTrackIndex]?.artist
      : '';
    const primaryArtist = String(artistName || '').split(/\s*(?:,|&|\bfeat(?:uring)?\.?|\bft\.?|\bwith\b)\s*/i)[0].trim();
    if (primaryArtist && primaryArtist !== 'Desconocido') {
      navigateToView('artist', { artistName: primaryArtist });
    }
  });

  if (volIcon) {
    volIcon.addEventListener('click', () => {
      if (masterVolume > 0) {
        audioVars.prevVolume = masterVolume;
        setAppVolume(0);
      } else {
        setAppVolume((audioVars.prevVolume || 0.8) * 100);
      }
    });
  }

  if (volumeRange) {
    volumeRange.addEventListener('input', (e) => {
      setAppVolume(Number(e.target.value));
    });
    volumeRange.addEventListener('mouseenter', () => {
      if (document.documentElement.dataset.playerVolumePercentage !== 'true') {
        showVolumeTooltip(masterVolume * 100);
      }
    });
  }

  if (volumeBox) {
    volumeBox.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = e.deltaY < 0 ? 5 : -5;
      const current = Math.round(masterVolume * 100);
      setAppVolume(current + step);
    }, { passive: false });
  }

  const savedVol = localStorage.getItem('pn_volume');
  const parsedSavedVol = savedVol === null ? 80 : Number(savedVol);
  const initialVolume = Number.isFinite(parsedSavedVol)
    ? Math.max(0, Math.min(100, parsedSavedVol))
    : 80;
  if (volumeRange) volumeRange.value = String(initialVolume);
  setAppVolume(initialVolume, false);
  if (window.__pnFlushSettingsToDisk) {
    void window.__pnFlushSettingsToDisk().catch(error => {
      console.error('No se pudo guardar el volumen restaurado:', error);
    });
  }

  audioDecks.forEach(deck => {
    deck.addEventListener('timeupdate', () => {
      if (deck !== audio || audioVars.nativeAudioActive) return;
      notifyDiscordPresence();
      if (!audioVars.isSeeking) {
        updateProgressTimes(deck.currentTime, deck.duration);
        maybeCountPlayFromProgress(deck.currentTime, deck.duration);
      }
      if (deck.duration) {
        const pct = (deck.currentTime / deck.duration) * 100;
        if (!audioVars.isSeeking) {
          setProgressVisual(pct / 100);
          progressContainer.setAttribute('aria-valuenow', String(Math.round(pct)));
        }
      }
      if (state.isLyricsOpen) {
        updateSyncedLyricsProgress(deck.currentTime);
      }
      if (!audioVars.isSeeking) handleTrackEffects(deck);
    });

    deck.addEventListener('loadedmetadata', () => {
      if (deck !== audio || audioVars.nativeAudioActive) return;
      updateProgressTimes(deck.currentTime, deck.duration);
      setProgressVisual(0);
      progressContainer.setAttribute('aria-valuemin', '0');
      progressContainer.setAttribute('aria-valuemax', '100');
      progressContainer.setAttribute('aria-valuenow', '0');
      if (state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]) {
        state.activeQueue[state.currentTrackIndex].duration = deck.duration;
        updateAudioQuality(state.activeQueue[state.currentTrackIndex]);
      }
      updateWindowsMediaPlayback(!deck.paused);
      updateWindowsMediaPosition(true);
      notifyDiscordPresence(true);
    });

    deck.addEventListener('ended', () => {
      if (deck !== audio || audioVars.nativeAudioActive) return;
      if (state.currentTrackIndex !== -1 && state.activeQueue[state.currentTrackIndex]) {
        const currentTrack = state.activeQueue[state.currentTrackIndex];
        if (!audioVars.playCountedForCurrentTrack) {
          incrementPlayCount(currentTrack);
          audioVars.playCountedForCurrentTrack = true;
          renderGrids();
        }
      }
      if (handleSleepTimerTrackEnd()) return;
      if (localStorage.getItem('pn_playback_continuous') !== 'false' || state.repeatMode !== 'off') {
        nextSong(true);
        return;
      }
      audio.pause();
      audio.currentTime = 0;
      playIcon.className = 'ph-fill ph-play';
      syncPlayingUI(false);
    });

    deck.addEventListener('play', () => {
      if (audioVars.nativeAudioActive) return;
      syncAudioContextPlaybackState();
      if (deck === audio) {
        notifyDiscordPresence(true);
        syncPlayingUI(true);
        updateWindowsMediaPlayback(true);
        updateTaskbarPlaybackProgress();
      }
    });
    deck.addEventListener('pause', () => {
      if (audioVars.nativeAudioActive) return;
      syncAudioContextPlaybackState();
      if (deck === audio) {
        notifyDiscordPresence(true);
        syncPlayingUI(false);
        updateWindowsMediaPlayback(false);
        updateTaskbarPlaybackProgress();
        persistPlaybackSession(false);
      }
    });
  });

  progressContainer.setAttribute('role', 'slider');
  progressContainer.setAttribute('tabindex', '0');
  progressContainer.setAttribute('aria-label', 'Posición de reproducción');
  progressContainer.setAttribute('aria-valuemin', '0');
  progressContainer.setAttribute('aria-valuemax', '100');
  progressContainer.setAttribute('aria-valuenow', '0');

  progressContainer.addEventListener('pointerdown', event => {
    const dur = getPlaybackDuration();
    if (event.button !== 0 || !Number.isFinite(dur) || dur <= 0) return;
    event.preventDefault();
    audioVars.resumeAfterSeeking = !isPlaybackPaused();
    if (audioVars.resumeAfterSeeking) {
      if (audioVars.crossfadeInProgress) cancelCrossfade();
      if (audioVars.nativeAudioActive) {
        void nativeInvoke('native_audio_pause').then(st => applyNativeStatusToUi(st)).catch(() => {});
      } else {
        audio.pause();
      }
      playIcon.className = "ph-fill ph-play";
      syncPlayingUI(false);
    }

    audioVars.isSeeking = true;
    audioVars.pendingSeekSeconds = null;
    audioVars.activeSeekPointerId = event.pointerId;
    progressContainer.setPointerCapture(event.pointerId);
    progressContainer.classList.add('is-seeking');
    updateSeekPosition(event.clientX, { commit: false });
  });
  progressContainer.addEventListener('pointermove', event => {
    if (!audioVars.isSeeking || event.pointerId !== audioVars.activeSeekPointerId) return;
    updateSeekPosition(event.clientX);
  });

  const finishSeeking = event => {
    if (!audioVars.isSeeking || event.pointerId !== audioVars.activeSeekPointerId) return;
    updateSeekPosition(event.clientX, { commit: true });
    audioVars.isSeeking = false;
    audioVars.activeSeekPointerId = null;
    progressContainer.classList.remove('is-seeking');
    if (progressContainer.hasPointerCapture(event.pointerId)) {
      progressContainer.releasePointerCapture(event.pointerId);
    }
    const shouldResume = audioVars.resumeAfterSeeking;
    audioVars.resumeAfterSeeking = false;
    if (shouldResume) {
      if (audioVars.nativeAudioActive) {
        void nativeInvoke('native_audio_play', { fadeInSecs: 0 })
          .then(st => {
            applyNativeStatusToUi(st);
            startNativeProgressPoll();
            playIcon.className = "ph-fill ph-pause";
            syncPlayingUI(true);
            updateWindowsMediaPlayback(true);
          })
          .catch(error => {
            console.error('No se pudo reanudar la reproducción después de buscar:', error);
            playIcon.className = "ph-fill ph-play";
            syncPlayingUI(false);
          });
      } else {
        audio.play().then(() => {
          playIcon.className = "ph-fill ph-pause";
          syncPlayingUI(true);
        }).catch(error => {
          console.error('No se pudo reanudar la reproducción después de buscar:', error);
          playIcon.className = "ph-fill ph-play";
          syncPlayingUI(false);
        });
      }
    }
    notifyDiscordPresence(true);
  };
  progressContainer.addEventListener('pointerup', finishSeeking);
  progressContainer.addEventListener('pointercancel', finishSeeking);

  progressContainer.addEventListener('keydown', event => {
    const dur = getPlaybackDuration();
    if (!Number.isFinite(dur) || dur <= 0) return;
    let time = getPlaybackPosition();
    if (event.key === 'ArrowRight') time += 5;
    else if (event.key === 'ArrowLeft') time -= 5;
    else if (event.key === 'Home') time = 0;
    else if (event.key === 'End') time = dur;
    else return;
    event.preventDefault();
    const clampedTime = Math.max(0, Math.min(dur, time));
    if (audioVars.nativeAudioActive) {
      void seekPlayback(clampedTime);
    } else {
      audio.currentTime = clampedTime;
    }
    const rect = progressContainer.getBoundingClientRect();
    updateSeekPosition(rect.left + (clampedTime / dur) * rect.width);
    notifyDiscordPresence(true);
  });
}
