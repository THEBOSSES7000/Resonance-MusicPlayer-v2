// Visual+ · Luciérnagas (parte del tema «Atmosférico», theme = atmospheric)

import { randomBetween, vp } from './state.js';

export const MAX_FIREFLIES = 80;

const FIREFLY_COLORS = ['#7CFF6B', '#A8FF80', '#C6FFB3'];

export const fireflies = Array.from({ length: MAX_FIREFLIES }, () => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  size: 0,
  phase: 0,
  brightness: 0,
  color: FIREFLY_COLORS[0]
}));

export function resetFirefly(firefly, initialize = false) {
  firefly.x = Math.random() * vp.width;
  firefly.y = vp.height * randomBetween(0.55, 0.98);
  if (initialize) firefly.y = vp.height * randomBetween(0.58, 0.98);
  firefly.vx = randomBetween(-9, 9);
  firefly.vy = randomBetween(-5, 3);
  firefly.size = randomBetween(vp.firefliesSize * 0.55, vp.firefliesSize);
  firefly.phase = randomBetween(0, Math.PI * 2);
  firefly.brightness = randomBetween(0.55, 1);
  firefly.color = FIREFLY_COLORS[Math.floor(Math.random() * FIREFLY_COLORS.length)];
}

export function drawFireflies(dt) {
  if (!vp.firefliesEnabled) return;
  const maximumBrightness = vp.firefliesBrightness / 100;
  for (let index = 0; index < vp.firefliesCount; index += 1) {
    const firefly = fireflies[index];
    firefly.phase += dt * (0.65 + firefly.brightness * 0.5);
    const pause = Math.sin(firefly.phase * 0.37) > 0.88 ? 0.18 : 1;
    firefly.x += (firefly.vx + Math.sin(firefly.phase) * 4) * pause * dt;
    firefly.y += (firefly.vy + Math.cos(firefly.phase * 0.72) * 2) * pause * dt;
    if (firefly.x < -firefly.size) firefly.x = vp.width + firefly.size;
    if (firefly.x > vp.width + firefly.size) firefly.x = -firefly.size;
    firefly.y = Math.max(vp.height * 0.48, Math.min(vp.height * 0.99, firefly.y));

    const flicker = 0.22 + 0.78 * ((Math.sin(firefly.phase) + 1) * 0.5) *
      (0.72 + 0.28 * ((Math.sin(firefly.phase * 0.43 + firefly.brightness * 5) + 1) * 0.5));
    vp.context.beginPath();
    vp.context.arc(firefly.x, firefly.y, firefly.size * 1.8, 0, Math.PI * 2);
    vp.context.fillStyle = firefly.color;
    vp.context.globalAlpha = maximumBrightness * flicker * firefly.brightness * 0.2;
    vp.context.shadowColor = firefly.color;
    vp.context.shadowBlur = firefly.size * 5 * maximumBrightness;
    vp.context.fill();
    vp.context.beginPath();
    vp.context.arc(firefly.x, firefly.y, Math.max(0.8, firefly.size * 0.45), 0, Math.PI * 2);
    vp.context.globalAlpha = maximumBrightness * flicker * firefly.brightness;
    vp.context.shadowBlur = 0;
    vp.context.fill();
  }
  vp.context.globalAlpha = 1;
}
