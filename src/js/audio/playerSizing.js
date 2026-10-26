// Audio · Tamaño y altura mínima del reproductor.

import { playbackBar, progressContainer } from './dom.js';
import { audioVars } from './sharedState.js';

export function updatePlayerMinimumHeight() {
  const isWaveform = progressContainer.dataset.progressStyle === 'waveform';
  const isSplit = isWaveform && audioVars.showRemainingTime;
  document.documentElement.style.setProperty(
    '--player-min-height',
    isSplit ? '108px' : (isWaveform ? '96px' : '84px')
  );
}

function updatePlayerSizing() {
  if (!playbackBar) return;
  const root = document.documentElement;
  const configuredHeight = Number.parseFloat(getComputedStyle(root).getPropertyValue('--player-height')) || 88;
  const stacked = window.matchMedia('(max-width: 940px)').matches;
  const compact = window.matchMedia('(max-width: 520px)').matches;
  const midSize = window.matchMedia('(max-width: 1100px)').matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const height = stacked ? Math.max(configuredHeight, 144) : configuredHeight;
  const scale = stacked
    ? clamp(0.9 + (height - 144) * 0.002, 0.9, 1.1)
    : clamp(1 + (height - 88) * 0.0025, 0.92, 1.22);
  const setPx = (name, value) => root.style.setProperty(name, `${value.toFixed(2)}px`);
  const setScaled = (name, base) => setPx(name, base * scale);
  const coverSize = stacked
    ? clamp(height * 0.4, 34, 72)
    : clamp(72 + (height - 88) * 0.22, 64, 92);
  const controlsGap = compact
    ? clamp(window.innerWidth * 0.022, 0.35 * 16, 0.7 * 16)
    : stacked
      ? clamp(window.innerWidth * 0.02, 0.55 * 16, 1 * 16)
      : midSize
        ? clamp(window.innerWidth * 0.01, 0.45 * 16, 0.9 * 16)
        : 1.1 * 16;
  const iconSize = compact ? 1 * 16 : stacked ? 1.12 * 16 : 1.25 * 16;
  const playSize = compact ? 32 : stacked ? 34 : 38;
  const rightGap = compact ? 0.4 * 16 : stacked || midSize ? 0.65 * 16 : 1.1 * 16;
  const leftGap = compact ? 0.45 * 16 : stacked || midSize ? 0.65 * 16 : 12;
  const columnGap = compact ? 0.35 * 16
    : stacked ? 0.75 * 16
      : midSize ? 0.8 * 16
        : clamp(window.innerWidth * 0.02, 0.75 * 16, 1.5 * 16);
  const inlinePadding = compact ? 0.55 * 16 : stacked || midSize ? 1 * 16
    : clamp(window.innerWidth * 0.02, 0.75 * 16, 1.5 * 16);

  setPx('--player-cover-size', coverSize);
  setScaled('--player-cover-icon-size', 24);
  setScaled('--player-meta-gap', 2);
  setScaled('--player-title-gap', 6);
  setScaled('--player-fav-size', 1.15 * 16);
  setScaled('--player-title-size', (compact ? 0.78 : 0.88) * 16);
  setScaled('--player-artist-size', (compact ? 0.68 : 0.75) * 16);
  setScaled('--player-left-gap', leftGap);
  setScaled('--player-center-gap', (stacked ? 0.15 : 0.375) * 16);
  setScaled('--player-controls-gap', controlsGap);
  setScaled('--player-icon-size', iconSize);
  setScaled('--player-play-size', playSize);
  setScaled('--player-play-icon-size', 1.15 * 16);
  setScaled('--player-progress-gap', (compact ? 0.35 : stacked ? 0.55 : 0.75) * 16);
  setScaled('--player-time-size', (compact ? 0.62 : 0.72) * 16);
  setScaled('--player-time-width', 32);
  setScaled('--player-progress-height', 4);
  setScaled('--player-progress-hover-height', 6);
  setScaled('--player-wave-height', 22);
  setScaled('--player-wave-hover-height', 24);
  setScaled('--player-wave-split-height', 24);
  setScaled('--player-wave-split-time-height', 14);
  setScaled('--player-wave-split-gap', 2);
  setScaled('--player-wave-split-time-size', 0.66 * 16);
  setScaled('--player-right-gap', rightGap);
  setScaled('--player-volume-gap', 8);
  setScaled('--player-volume-icon-size', compact ? 1 * 16 : 1.2 * 16);
  setScaled('--player-volume-slider-width', compact ? 42 : 70);
  setScaled('--player-column-gap', columnGap);
  setScaled('--player-inline-padding', inlinePadding);
  setScaled('--player-vertical-padding', Math.max(10, 6 * scale));
  setScaled('--player-row-gap', stacked ? 0.2 * 16 : 0);
}

updatePlayerSizing();

window.addEventListener('resize', updatePlayerSizing);

if (typeof ResizeObserver !== 'undefined' && playbackBar) {
  const playerResizeObserver = new ResizeObserver(updatePlayerSizing);
  playerResizeObserver.observe(playbackBar.closest('.bottom-player'));
}
