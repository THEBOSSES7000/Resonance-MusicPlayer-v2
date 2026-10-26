// Visual+ · Lluvia (parte del tema «Atmosférico», theme = atmospheric)
// Puede reaccionar dinámicamente al nivel de audio.

import { randomBetween, vp } from './state.js';

export const MAX_RAIN_DROPS = 200;

export const rainDrops = Array.from({ length: MAX_RAIN_DROPS }, () => ({
  x: 0,
  y: 0,
  length: 0,
  speed: 0,
  opacity: 0
}));

export function resetRainDrop(drop, initialize = false) {
  drop.x = Math.random() * vp.width;
  drop.y = initialize ? Math.random() * vp.height : randomBetween(-vp.height * 0.2, -5);
  drop.length = randomBetween(7, 18);
  drop.speed = randomBetween(0.75, 1.3);
  drop.opacity = randomBetween(0.55, 1);
}

export function drawRain(dt) {
  if (!vp.rainEnabled) return;
  const audioLevel = vp.rainDynamicEnabled
    ? Math.max(0, Math.min(1, vp.audioLevelReader()))
    : 0;
  const visibleCount = vp.rainDynamicEnabled
    ? Math.floor(vp.rainCount * (vp.rainMinDensity + (1 - vp.rainMinDensity) * audioLevel))
    : vp.rainCount;
  const speedMultiplier = vp.rainDynamicEnabled ? 1 + vp.rainIntensityMultiplier * audioLevel : 1;
  const opacityMultiplier = vp.rainDynamicEnabled ? 0.6 + 0.4 * audioLevel : 1;
  const horizontalSpeed = vp.rainDirection === 'diagonal-left'
    ? -0.28
    : vp.rainDirection === 'diagonal-right' ? 0.28 : 0;

  vp.context.lineWidth = 1;
  vp.context.lineCap = 'round';
  for (let index = 0; index < visibleCount; index += 1) {
    const drop = rainDrops[index];
    const speed = vp.rainBaseSpeed * drop.speed * speedMultiplier;
    drop.y += speed * dt;
    drop.x += speed * horizontalSpeed * dt;
    if (drop.y - drop.length > vp.height) resetRainDrop(drop);
    if (drop.x < -20) drop.x = vp.width + 10;
    if (drop.x > vp.width + 20) drop.x = -10;
    vp.context.beginPath();
    vp.context.moveTo(drop.x, drop.y);
    vp.context.lineTo(drop.x + horizontalSpeed * drop.length, drop.y + drop.length);
    vp.context.strokeStyle = '#cbd8e8';
    vp.context.globalAlpha = vp.rainBaseOpacity / 100 * drop.opacity * opacityMultiplier;
    vp.context.stroke();
  }
  vp.context.globalAlpha = 1;
}
