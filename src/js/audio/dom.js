// Audio · Referencias a elementos del DOM del reproductor.

export const primaryAudio = new Audio();

export const secondaryAudio = new Audio();

export const audioDecks = [primaryAudio, secondaryAudio];

export const playIcon = document.getElementById('play-icon');

const currentTitleEl = document.getElementById('current-title');

export const currentTitleTextEl = document.getElementById('current-title-text');

export const currentArtistEl = document.getElementById('current-artist');

export const audioQualityEl = document.getElementById('player-audio-quality');

export const playerCoverArt = document.getElementById('player-cover-art');

export const timeCurrentEl = document.getElementById('time-current');

export const timeTotalEl = document.getElementById('time-total');

export const progressFill = document.getElementById('progress-fill');

export const progressContainer = document.getElementById('progress-container');

export const crossfadeIndicator = document.getElementById('crossfade-indicator');

export const progressWaveTrack = document.getElementById('progress-wave-track');

export const progressWavePlayed = document.getElementById('progress-wave-played');

export const playbackBar = document.querySelector('.playback-bar');

export const playbackRow = document.querySelector('.playback-row');

// Elementos de volumen
export const volumeRange = document.getElementById('volume-range');

export const volIcon = document.getElementById('vol-icon');

export const volumeBox = document.getElementById('volume-box');

export const volumeTooltip = document.getElementById('volume-tooltip');

export const volumePercentage = document.getElementById('volume-percentage');

export const btnLyrics = document.getElementById('btn-lyrics');

export const expandedCoverImg = document.getElementById('expanded-cover-img');

export const expandedCoverPlaceholder = document.getElementById('expanded-cover-placeholder');
