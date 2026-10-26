// Reproductor de audio. Este archivo solo reexporta la API pública; el código vive en js/audio/*.js.

export { audio, stopPlaybackForDeletedFile, shuffleArray, playNextInQueue, addToQueue, removeFromQueue, updateTitleMarquee, resolveManualAutoPlay, loadSong, togglePlay, nextSong, seekBy, setShuffleEnabled, setRepeatMode, prevSong } from './audio/playback.js';
export { setPlayCountThresholdPercent, getPlayCountThresholdPercent } from './audio/playCount.js';
export { getPlaybackPosition, getPlaybackDuration, isPlaybackPaused, seekPlayback } from './audio/position.js';
export { paintPlayerCover } from './audio/playerCover.js';
export { updateWindowSongTitle } from './audio/windowIntegration.js';
export { resetProgressVisual, setProgressStyle } from './audio/progressUI.js';
export { configureProgressWaveform } from './audio/waveform.js';
export { EQUALIZER_FREQUENCIES, showVolumeTooltip, setAppVolume, configureEqualizer, configureAudioAnalysis, getAudioLevel, setReplayGainEnabled, updateReplayGainForTrack, setCrossfadeSettings, setCrossfadeIndicatorEnabled, setPlaybackFadeSettings, setPauseFadeSettings, listNativeOutputDevices, setAudioOutputDevice } from './audio/webAudio.js';
export { initAudioPlayer } from './audio/init.js';
