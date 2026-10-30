// Ajustes · Perfiles de opciones por modo Visual+ (compartido atajos / menú).

const DEFAULTS = {
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
  rainMinDensity: 0.4,
  ps3BgColorMode: 'classic',
  ps3BgColor: '#0a1a66',
  ps3WaveColorMode: 'classic',
  ps3WaveColor: '#4a8cff',
  ps3Speed: 100,
  ps3Amplitude: 70,
  ps3ParticleCount: 50,
  ps3Brightness: 100,
  ps3AudioReactive: true,
  wsStyle: 'bars',
  wsPosition: 'bottom',
  wsColorMode: 'custom',
  wsColor: '#ffffff',
  wsBarCount: 48,
  wsSize: 100,
  wsReactivity: 70,
  wsIntensity: 70,
  wsPeakGlow: true,
  wsOpacity: 85,
  wsPeakGlowIntensity: 100,
  wsUiVeil: false,
  wsUiVeilOpacity: 30,
  wsGlowColorMode: 'same',
  wsGlowColor: '#6ea8ff',
  liquidSpeed: 100,
  liquidStatic: false,
  blurredSpeed: 100,
  blurredStatic: false,
  colorDiversity: 55,
};

export const VISUAL_PLUS_THEME_OPTION_KEYS = {
  shooting_stars: [
    'starCount', 'starBrightness', 'shootingStarCount', 'shootingInterval',
    'shootingSpeed', 'trailLength',
  ],
  reactive_particles: [
    'particleCount', 'particleSpeed', 'particleIntensity', 'particleMinSize',
    'particleMaxSize', 'particleOpacity', 'particleColorMode', 'particleColor',
    'particleSpawnWidth', 'particleGlow',
  ],
  atmospheric: [
    'firefliesEnabled', 'firefliesCount', 'firefliesSize', 'firefliesBrightness',
    'rainEnabled', 'rainCount', 'rainDirection', 'rainBaseSpeed', 'rainBaseOpacity',
    'rainDynamicEnabled', 'rainIntensityMultiplier', 'rainMinDensity',
  ],
  ps3_wave: [
    'ps3BgColorMode', 'ps3BgColor', 'ps3WaveColorMode', 'ps3WaveColor',
    'ps3Speed', 'ps3Amplitude', 'ps3ParticleCount', 'ps3Brightness', 'ps3AudioReactive',
  ],
  wave_sound: [
    'wsStyle', 'wsPosition', 'wsColorMode', 'wsColor', 'wsBarCount', 'wsSize',
    'wsReactivity', 'wsIntensity', 'wsPeakGlow', 'wsOpacity', 'wsPeakGlowIntensity',
    'wsUiVeil', 'wsUiVeilOpacity', 'wsGlowColorMode', 'wsGlowColor',
  ],
  liquid: ['liquidSpeed', 'liquidStatic'],
  blurred: ['blurredSpeed', 'blurredStatic', 'colorDiversity'],
};

export function migrateVisualPlusThemeId(theme) {
  if (theme === 'liquid_immersive') return 'liquid';
  if (theme === 'liquid_gradient') return 'blurred';
  return theme || 'shooting_stars';
}

export function snapshotThemeOptions(theme, settings) {
  const id = migrateVisualPlusThemeId(theme);
  const keys = VISUAL_PLUS_THEME_OPTION_KEYS[id] || [];
  const snap = {};
  for (const key of keys) {
    if (settings[key] !== undefined) snap[key] = settings[key];
  }
  return snap;
}

/** Guarda opciones del tema actual y restaura las del siguiente. */
export function switchThemeWithProfiles(settings, nextTheme) {
  const current = migrateVisualPlusThemeId(settings?.theme || 'shooting_stars');
  const next = migrateVisualPlusThemeId(nextTheme || 'shooting_stars');
  const profiles = {
    ...(settings?.themeProfiles && typeof settings.themeProfiles === 'object'
      ? settings.themeProfiles
      : {}),
  };
  profiles[current] = snapshotThemeOptions(current, settings || {});

  const restored = profiles[next] && typeof profiles[next] === 'object' ? profiles[next] : {};
  const merged = {
    ...(settings || {}),
    themeProfiles: profiles,
    theme: next,
  };
  const keys = VISUAL_PLUS_THEME_OPTION_KEYS[next] || [];
  for (const key of keys) {
    if (restored[key] !== undefined) merged[key] = restored[key];
    else if (DEFAULTS[key] !== undefined) merged[key] = DEFAULTS[key];
  }
  return merged;
}
