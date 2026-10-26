// Audio · Estado mutable compartido entre módulos (se usa como audioVars.nombre).

/** Resolución fija alineada a AIMP (~200 divisiones en la barra). */
export const WAVEFORM_PEAK_COUNT = 200;

// Variables que se reasignan desde más de un módulo. Se leen y escriben como audioVars.nombre.
export const audioVars = {
  nativeAudioActive: false,
  nativeLastEnded: false,
  playCountedForCurrentTrack: false,
  isSeeking: false,
  pendingSeekSeconds: null,
  activeSeekPointerId: null,
  resumeAfterSeeking: false,
  queuedTaskbarProgress: null,
  taskbarProgressInFlight: false,
  lastSentTaskbarPercent: -2,
  lastSentTaskbarPaused: null,
  lastSentWindowsPlaying: null,
  nativeArtworkGeneration: 0,
  lastNativePositionUpdate: 0,
  waveformBarCount: WAVEFORM_PEAK_COUNT,
  waveformMode: 'bars',
  waveformPeaks: null,
  waveformPeaksPath: null,
  waveformPeaksRequestId: 0,
  showRemainingTime: false,
  crossfadeIndicatorEnabled: localStorage.getItem('pn_audio_crossfade_indicator_enabled') !== 'false',
  crossfadeVisualActive: false,
  sleepTimerMode: null,
  sleepTimerRemainingTracks: 0,
  sleepTimerDeadline: 0,
  sleepTimerInterval: null,
  playbackRate: Math.min(2, Math.max(0.5, Number(localStorage.getItem('pn_playback_rate')) || 1)),
  preservePitch: localStorage.getItem('pn_playback_preserve_pitch') !== 'false',
  playbackPitch: Math.min(12, Math.max(-12, Number(localStorage.getItem('pn_playback_pitch')) || 0)),
  prevVolume: 0.8,
  crossfadeInProgress: false,
  lyricsCrossfadeFreeze: false,
  trackFadeStarted: false,
  rampAnimationId: null,
  crossfadeAnimationResolve: null,
  crossfadeGeneration: 0
};
