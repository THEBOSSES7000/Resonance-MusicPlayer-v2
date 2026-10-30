// Visual+ · Carga/guardado robusto (perfiles por modo, sin tirar la config).

import {
  migrateVisualPlusThemeId,
  snapshotThemeOptions,
  switchThemeWithProfiles,
  VISUAL_PLUS_THEME_OPTION_KEYS,
} from './visualPlusThemeProfiles.js';

const STORAGE_KEY = 'pn_visual_plus';

export const DEFAULT_VISUAL_PLUS = {
  enabled: false,
  theme: 'shooting_stars',
  sophisticatedLyrics: false,
  liquidSpeed: 100,
  liquidStatic: false,
  blurredSpeed: 100,
  blurredStatic: false,
  colorDiversity: 55,
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
  themeProfiles: {},
};

function safeParse(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch (_) {
    return null;
  }
}

/** Carga settings + perfiles. Nunca lanza. */
export function loadVisualPlusSettings() {
  let saved = null;
  try {
    saved = safeParse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    saved = null;
  }
  const settings = {
    ...DEFAULT_VISUAL_PLUS,
    ...(saved || {}),
    themeProfiles: {
      ...DEFAULT_VISUAL_PLUS.themeProfiles,
      ...((saved && saved.themeProfiles && typeof saved.themeProfiles === 'object')
        ? saved.themeProfiles
        : {}),
    },
  };
  settings.theme = migrateVisualPlusThemeId(settings.theme);
  settings.enabled = Boolean(settings.enabled);

  // Aplicar perfil del tema activo (fuente de verdad de ese modo)
  const profile = settings.themeProfiles[settings.theme];
  if (profile && typeof profile === 'object') {
    Object.assign(settings, profile);
  }
  return settings;
}

/** Guarda y actualiza el perfil del tema actual. */
export function saveVisualPlusSettings(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const theme = migrateVisualPlusThemeId(settings.theme || 'shooting_stars');
  const profiles = {
    ...(settings.themeProfiles && typeof settings.themeProfiles === 'object'
      ? settings.themeProfiles
      : {}),
  };
  profiles[theme] = snapshotThemeOptions(theme, settings);
  const toSave = {
    ...settings,
    theme,
    themeProfiles: profiles,
    enabled: Boolean(settings.enabled),
    wsColorMode: settings.wsColorMode || 'custom',
    wsColor: settings.wsColor || '#ffffff',
    wsGlowColorMode: settings.wsGlowColorMode || 'same',
    wsGlowColor: settings.wsGlowColor || '#6ea8ff',
    wsPeakGlow: settings.wsPeakGlow !== false,
  };
  delete toSave.needsUpgrade;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (err) {
    console.error('[Visual+] No se pudo guardar:', err);
  }
  try {
    const flush = window.__pnFlushSettingsToDisk;
    if (typeof flush === 'function') void flush().catch(() => {});
  } catch (_) {}
  return toSave;
}

export function switchAndSaveTheme(settings, nextTheme) {
  const next = switchThemeWithProfiles(settings, nextTheme);
  return saveVisualPlusSettings(next);
}

export { switchThemeWithProfiles, migrateVisualPlusThemeId, VISUAL_PLUS_THEME_OPTION_KEYS };
