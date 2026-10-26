// Visual+ · Estado compartido
// Constantes, ajustes por defecto, referencias al DOM y el objeto `vp` con el estado mutable
// que comparten el motor (engine.js) y los temas (shooting_stars, reactive_particles, fireflies, rain).

export const MAX_TRAIL_LENGTH = 260;

export const DEFAULT_SETTINGS = {
  enabled: false,
  theme: 'shooting_stars',
  starCount: 120,
  starBrightness: 100,
  shootingStarCount: 2,
  shootingInterval: 4,
  shootingSpeed: 100,
  trailLength: 170,
  particleCount: 60,
  particleSpeed: 30,
  particleIntensity: 2,
  particleMinSize: 2,
  particleMaxSize: 6,
  particleOpacity: 55,
  particleColorMode: 'theme',
  particleColor: '#c084fc',
  particleSpawnWidth: 'full',
  particleGlow: true,
  firefliesEnabled: true,
  firefliesCount: 25,
  firefliesSize: 5,
  firefliesBrightness: 70,
  rainEnabled: true,
  rainCount: 80,
  rainDirection: 'vertical',
  rainBaseSpeed: 180,
  rainBaseOpacity: 45,
  rainDynamicEnabled: false,
  rainIntensityMultiplier: 1.5,
  rainMinDensity: 0.4
};

export const lyricsOverlay = document.getElementById('lyrics-overlay');

export const settingsOverlay = document.getElementById('settings-overlay');

export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Estado mutable compartido entre el motor y los temas. Se usa como vp.width, vp.context, etc.
export const vp = {
  canvas: null,
  context: null,
  trailCanvas: null,
  trailContext: null,
  width: 0,
  height: 0,
  pixelRatio: 1,
  enabled: false,
  theme: DEFAULT_SETTINGS.theme,
  starCount: DEFAULT_SETTINGS.starCount,
  starBrightness: DEFAULT_SETTINGS.starBrightness,
  shootingStarCount: DEFAULT_SETTINGS.shootingStarCount,
  shootingInterval: DEFAULT_SETTINGS.shootingInterval,
  shootingSpeed: DEFAULT_SETTINGS.shootingSpeed,
  trailLength: DEFAULT_SETTINGS.trailLength,
  particleCount: DEFAULT_SETTINGS.particleCount,
  particleSpeed: DEFAULT_SETTINGS.particleSpeed,
  particleIntensity: DEFAULT_SETTINGS.particleIntensity,
  particleMinSize: DEFAULT_SETTINGS.particleMinSize,
  particleMaxSize: DEFAULT_SETTINGS.particleMaxSize,
  particleOpacity: DEFAULT_SETTINGS.particleOpacity,
  particleColorMode: DEFAULT_SETTINGS.particleColorMode,
  particleColor: DEFAULT_SETTINGS.particleColor,
  particleSpawnWidth: DEFAULT_SETTINGS.particleSpawnWidth,
  particleGlow: DEFAULT_SETTINGS.particleGlow,
  firefliesEnabled: DEFAULT_SETTINGS.firefliesEnabled,
  firefliesCount: DEFAULT_SETTINGS.firefliesCount,
  firefliesSize: DEFAULT_SETTINGS.firefliesSize,
  firefliesBrightness: DEFAULT_SETTINGS.firefliesBrightness,
  rainEnabled: DEFAULT_SETTINGS.rainEnabled,
  rainCount: DEFAULT_SETTINGS.rainCount,
  rainDirection: DEFAULT_SETTINGS.rainDirection,
  rainBaseSpeed: DEFAULT_SETTINGS.rainBaseSpeed,
  rainBaseOpacity: DEFAULT_SETTINGS.rainBaseOpacity,
  rainDynamicEnabled: DEFAULT_SETTINGS.rainDynamicEnabled,
  rainIntensityMultiplier: DEFAULT_SETTINGS.rainIntensityMultiplier,
  rainMinDensity: DEFAULT_SETTINGS.rainMinDensity,
  intersecting: false,
  spawnCountdown: 4,
  audioLevelReader: () => 0,
  cachedThemeColor: ''
};
