// Visual+ · Tema «Estrellas fugaces» (theme = shooting_stars)
// Estrellas titilantes de fondo y estrellas fugaces con estela.

import { MAX_TRAIL_LENGTH, randomBetween, vp } from './state.js';

export const MAX_STARS = 200;

export const MAX_SHOOTING_STARS = 8;

const STAR_COLOR = '#ffffff';

export const stars = Array.from({ length: MAX_STARS }, () => ({
  x: 0,
  y: 0,
  size: 1,
  alpha: 0,
  baseMaxAlpha: 0,
  maxAlpha: 0,
  speed: 0,
  phase: 0
}));

export const shootingStars = Array.from({ length: MAX_SHOOTING_STARS }, () => ({
  x: 0,
  y: 0,
  dx: 0,
  dy: 0,
  speed: 0,
  trailLength: 0,
  age: 0,
  lifetime: 0,
  active: false
}));

export function fillStar(star, randomizePosition = false) {
  if (randomizePosition) {
    star.x = Math.random() * vp.width;
    star.y = Math.random() * vp.height;
  }
  star.size = randomBetween(0.7, 2.4);
  star.alpha = 0;
  star.baseMaxAlpha = randomBetween(0.22, 0.82);
  star.maxAlpha = star.baseMaxAlpha * vp.starBrightness / 100;
  star.speed = randomBetween(0.45, 1.7);
  star.phase = randomBetween(0, Math.PI * 2);
}

function spawnShootingStar() {
  let star = null;
  for (let index = 0; index < MAX_SHOOTING_STARS; index += 1) {
    if (!shootingStars[index].active) {
      star = shootingStars[index];
      break;
    }
  }
  if (!star) return;

  const angle = randomBetween(Math.PI / 5.15, Math.PI / 4);
  star.x = randomBetween(vp.width * 0.4, vp.width);
  star.y = randomBetween(-50, vp.height * 0.3);
  star.speed = randomBetween(420, 620) * vp.shootingSpeed / 100;
  star.dx = -Math.cos(angle);
  star.dy = Math.sin(angle);
  star.trailLength = randomBetween(Math.min(100, vp.trailLength), vp.trailLength);
  star.age = 0;
  star.lifetime = randomBetween(1.3, 2.1);
  star.active = true;
}

export function drawStaticStars(dt) {
  for (let index = 0; index < vp.starCount; index += 1) {
    const star = stars[index];
    star.phase += star.speed * dt;
    star.alpha = star.maxAlpha * (0.58 + Math.sin(star.phase) * 0.42);
    vp.context.globalAlpha = star.alpha;
    if (star.size <= 1.5) {
      vp.context.fillStyle = STAR_COLOR;
      vp.context.fillRect(star.x, star.y, star.size, star.size);
    } else {
      vp.context.beginPath();
      vp.context.arc(star.x, star.y, star.size * 0.5, 0, Math.PI * 2);
      vp.context.fillStyle = STAR_COLOR;
      vp.context.fill();
    }
    if (star.alpha <= 0.02) fillStar(star, true);
  }
}

export function drawShootingStars(dt) {
  vp.spawnCountdown -= dt;
  if (vp.spawnCountdown <= 0) {
    spawnShootingStar();
    vp.spawnCountdown = randomBetween(vp.shootingInterval * 0.75, vp.shootingInterval * 1.25);
  }

  for (let index = 0; index < vp.shootingStarCount; index += 1) {
    const star = shootingStars[index];
    if (!star.active) continue;

    star.age += dt;
    star.x += star.dx * star.speed * dt;
    star.y += star.dy * star.speed * dt;
    if (star.age >= star.lifetime) {
      star.active = false;
      continue;
    }
    const fadeIn = Math.min(1, star.age / 0.28);
    const fadeOut = Math.min(1, (star.lifetime - star.age) / 0.42);
    const distancePastEdge = Math.max(0, -star.x, star.y - vp.height);
    const edgeFade = 1 - Math.min(1, distancePastEdge / MAX_TRAIL_LENGTH);
    const opacity = Math.min(fadeIn, fadeOut, edgeFade);
    if (opacity <= 0 || star.x < -MAX_TRAIL_LENGTH || star.y > vp.height + MAX_TRAIL_LENGTH) {
      star.active = false;
      continue;
    }

    const tailX = star.x - star.dx * star.trailLength;
    const tailY = star.y - star.dy * star.trailLength;
    const angle = Math.atan2(star.dy, star.dx);
    vp.context.save();
    vp.context.translate(tailX, tailY);
    vp.context.rotate(angle);
    vp.context.globalAlpha = opacity;
    vp.context.drawImage(vp.trailCanvas, 0, -1, star.trailLength, 2);
    vp.context.restore();

    vp.context.beginPath();
    vp.context.arc(star.x, star.y, 1.7, 0, Math.PI * 2);
    vp.context.fillStyle = STAR_COLOR;
    vp.context.globalAlpha = opacity;
    vp.context.shadowColor = STAR_COLOR;
    vp.context.shadowBlur = 8;
    vp.context.fill();
    vp.context.shadowBlur = 0;
  }
}
