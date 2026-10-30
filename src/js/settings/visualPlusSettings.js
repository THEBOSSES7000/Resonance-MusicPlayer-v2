// Ajustes · Ajustes de Visual+ (temas, estrellas, partículas, luciérnagas, lluvia, degradado líquido).

import { readStoredBoolean } from './appearance.js';
import { LYRIC_FILL_DIRECTIONS, applyActiveRowAnimation, applyActiveRowFillDirection } from './lyricsSettings.js';
import { refreshLiquidBackgroundState } from '../../visual_plus/blurred_background.js';
import { refreshImmersiveBackgroundState } from '../../visual_plus/liquid_background.js';

const DEFAULT_VISUAL_PLUS_SETTINGS = {
  enabled: false,
  theme: 'shooting_stars',
  liquidSpeed: 100,
  liquidStatic: false,
  blurredSpeed: 100,
  blurredStatic: false,
  colorDiversity: 55,
  sophisticatedLyrics: false,
  starCount: 120,
  starBrightness: 100,
  starAudioReactive: false,
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
  wsGlowColor: '#6ea8ff'
};

function migrateVisualPlusTheme(theme) {
  if (theme === 'liquid_immersive') return 'liquid';
  if (theme === 'liquid_gradient') return 'blurred';
  return theme;
}

function readVisualPlusSettings() {
  const storedValue = localStorage.getItem('pn_visual_plus');
  if (storedValue === null) return { ...DEFAULT_VISUAL_PLUS_SETTINGS };
  const saved = JSON.parse(storedValue);
  const settings = { ...DEFAULT_VISUAL_PLUS_SETTINGS, ...saved };
  settings.theme = migrateVisualPlusTheme(settings.theme);
  // Migrar opciones viejas de Onda PS3 → Ondas
  if (!settings.ps3BgColorMode && settings.ps3ColorMode) settings.ps3BgColorMode = settings.ps3ColorMode === 'custom' ? 'custom' : settings.ps3ColorMode;
  if (!settings.ps3WaveColorMode && settings.ps3ColorMode) settings.ps3WaveColorMode = settings.ps3ColorMode;
  if (!settings.ps3BgColor && settings.ps3Color) settings.ps3BgColor = settings.ps3Color;
  if (!settings.ps3WaveColor && settings.ps3Color) settings.ps3WaveColor = settings.ps3Color;
  if (typeof settings.ps3AudioReactive !== 'boolean') settings.ps3AudioReactive = true;
  if (!settings.ps3BgColorMode) settings.ps3BgColorMode = 'classic';
  if (!settings.ps3WaveColorMode) settings.ps3WaveColorMode = 'classic';
  if (settings.liquidSpeed != null) settings.liquidSpeed = Math.round(Number(settings.liquidSpeed)) || 100;
  if (settings.blurredSpeed != null) settings.blurredSpeed = Math.round(Number(settings.blurredSpeed)) || 100;
  if (settings.colorDiversity != null) settings.colorDiversity = Math.round(Number(settings.colorDiversity));
  if (typeof settings.blurredStatic !== 'boolean') settings.blurredStatic = false;
  if (typeof settings.liquidStatic !== 'boolean') settings.liquidStatic = false;
  if (settings.ps3BgColorMode == null) settings.ps3BgColorMode = 'classic';
  if (settings.ps3WaveColorMode == null) settings.ps3WaveColorMode = 'classic';
  if (settings.ps3BgColor == null) settings.ps3BgColor = '#0a1a66';
  if (settings.ps3WaveColor == null) settings.ps3WaveColor = '#4a8cff';
  if (typeof settings.ps3AudioReactive !== 'boolean') settings.ps3AudioReactive = true;
  if (!settings.wsStyle) settings.wsStyle = 'bars';
  if (!settings.wsPosition) settings.wsPosition = 'bottom';
  if (!settings.wsColorMode) settings.wsColorMode = 'custom';
  if (!settings.wsColor) settings.wsColor = '#ffffff';
  if (settings.wsBarCount == null) settings.wsBarCount = 48;
  if (settings.wsSize == null) settings.wsSize = 100;
  if (settings.wsReactivity == null) settings.wsReactivity = 70;
  if (settings.wsIntensity == null) settings.wsIntensity = 70;
  if (typeof settings.wsPeakGlow !== 'boolean') settings.wsPeakGlow = true;
  if (settings.wsOpacity == null) settings.wsOpacity = 85;
  if (settings.wsPeakGlowIntensity == null) settings.wsPeakGlowIntensity = 100;
  if (typeof settings.wsUiVeil !== 'boolean') settings.wsUiVeil = false;
  if (settings.wsUiVeilOpacity == null) settings.wsUiVeilOpacity = 30;
  if (!settings.wsGlowColorMode) settings.wsGlowColorMode = 'same';
  if (!settings.wsGlowColor) settings.wsGlowColor = '#6ea8ff';
  if (settings.wsStyle === 'dots') settings.wsStyle = 'bars';
  if (typeof settings.enabled !== 'boolean' ||
      !['shooting_stars', 'reactive_particles', 'atmospheric', 'ps3_wave', 'wave_sound', 'liquid', 'blurred', 'liquid_gradient', 'liquid_immersive'].includes(settings.theme) ||
      typeof settings.sophisticatedLyrics !== 'boolean' ||
      !Number.isInteger(settings.starCount) || settings.starCount < 20 || settings.starCount > 200 ||
      !Number.isInteger(settings.starBrightness) || settings.starBrightness < 10 || settings.starBrightness > 100 ||
      !Number.isInteger(settings.shootingStarCount) || settings.shootingStarCount < 1 || settings.shootingStarCount > 8 ||
      !Number.isInteger(settings.shootingInterval) || settings.shootingInterval < 1 || settings.shootingInterval > 10 ||
      !Number.isInteger(settings.shootingSpeed) || settings.shootingSpeed < 50 || settings.shootingSpeed > 200 ||
      !Number.isInteger(settings.liquidSpeed) || settings.liquidSpeed < 25 || settings.liquidSpeed > 200 ||
      typeof settings.liquidStatic !== 'boolean' ||
      typeof settings.blurredStatic !== 'boolean' ||
      !Number.isInteger(settings.blurredSpeed) || settings.blurredSpeed < 25 || settings.blurredSpeed > 200 ||
      (settings.colorDiversity != null && (!Number.isFinite(Number(settings.colorDiversity)) || Number(settings.colorDiversity) < 0 || Number(settings.colorDiversity) > 100)) ||
      !Number.isInteger(settings.trailLength) || settings.trailLength < 80 || settings.trailLength > 260 ||
      !Number.isInteger(settings.particleCount) || settings.particleCount < 20 || settings.particleCount > 150 ||
      !Number.isInteger(settings.particleSpeed) || settings.particleSpeed < 10 || settings.particleSpeed > 80 ||
      !Number.isFinite(settings.particleIntensity) || settings.particleIntensity < 0 || settings.particleIntensity > 3 ||
      !Number.isInteger(settings.particleMinSize) || settings.particleMinSize < 1 || settings.particleMinSize > 8 ||
      !Number.isInteger(settings.particleMaxSize) || settings.particleMaxSize < 1 || settings.particleMaxSize > 12 ||
      settings.particleMinSize > settings.particleMaxSize ||
      !Number.isInteger(settings.particleOpacity) || settings.particleOpacity < 10 || settings.particleOpacity > 100 ||
      !['theme', 'artwork', 'custom'].includes(settings.particleColorMode) ||
      !/^#[0-9a-f]{6}$/i.test(settings.particleColor) ||
      !['full', 'center'].includes(settings.particleSpawnWidth) ||
      typeof settings.particleGlow !== 'boolean' ||
      typeof settings.firefliesEnabled !== 'boolean' ||
      !Number.isInteger(settings.firefliesCount) || settings.firefliesCount < 5 || settings.firefliesCount > 80 ||
      !Number.isInteger(settings.firefliesSize) || settings.firefliesSize < 2 || settings.firefliesSize > 8 ||
      !Number.isInteger(settings.firefliesBrightness) || settings.firefliesBrightness < 0 || settings.firefliesBrightness > 100 ||
      typeof settings.rainEnabled !== 'boolean' ||
      !Number.isInteger(settings.rainCount) || settings.rainCount < 20 || settings.rainCount > 200 ||
      !['vertical', 'diagonal-left', 'diagonal-right'].includes(settings.rainDirection) ||
      !Number.isInteger(settings.rainBaseSpeed) || settings.rainBaseSpeed < 60 || settings.rainBaseSpeed > 500 ||
      !Number.isInteger(settings.rainBaseOpacity) || settings.rainBaseOpacity < 10 || settings.rainBaseOpacity > 100 ||
      typeof settings.rainDynamicEnabled !== 'boolean' ||
      !Number.isFinite(settings.rainIntensityMultiplier) || settings.rainIntensityMultiplier < 0.5 || settings.rainIntensityMultiplier > 3 ||
      !Number.isFinite(settings.rainMinDensity) || settings.rainMinDensity < 0.2 || settings.rainMinDensity > 1) {
    throw new Error('La configuración de Visual+ no es válida.');
  }
  return { ...settings, needsUpgrade: Object.keys(saved).length !== Object.keys(DEFAULT_VISUAL_PLUS_SETTINGS).length };
}

function persistVisualPlusSettings(settings) {
  delete settings.needsUpgrade;
  localStorage.setItem('pn_visual_plus', JSON.stringify(settings));
  try { refreshLiquidBackgroundState(); } catch (_) {}
  try { refreshImmersiveBackgroundState(); } catch (_) {}
  document.dispatchEvent(new CustomEvent('pn-visual-plus-settings-changed', {
    detail: settings
  }));
  const flush = window.__pnFlushSettingsToDisk;
  if (flush) {
    void flush().catch(error => {
      console.error('No se pudo guardar la configuración de Visual+:', error);
    });
  }
}

export function initVisualPlusSettings() {
  const enabledToggle = document.getElementById('toggle-visual-plus');
  const themeSelect = document.getElementById('visual-plus-theme');
  if (!enabledToggle || !themeSelect) return;
  const sophisticatedLyricsToggle = document.getElementById('visual-plus-sophisticated-lyrics');
  const starAudioReactiveToggle = document.getElementById('visual-plus-star-audio-reactive');
  const liquidStaticToggle = document.getElementById('visual-plus-liquid-static');
  const ps3BgColorModeSelect = document.getElementById('visual-plus-ps3-bg-color-mode');
  const ps3BgColorInput = document.getElementById('visual-plus-ps3-bg-color');
  const ps3WaveColorModeSelect = document.getElementById('visual-plus-ps3-wave-color-mode');
  const ps3WaveColorInput = document.getElementById('visual-plus-ps3-wave-color');
  const ps3AudioReactiveToggle = document.getElementById('visual-plus-ps3-audio-reactive');
  const wsStyleSelect = document.getElementById('visual-plus-ws-style');
  const wsPositionSelect = document.getElementById('visual-plus-ws-position');
  const wsColorModeSelect = document.getElementById('visual-plus-ws-color-mode');
  const wsColorInput = document.getElementById('visual-plus-ws-color');
  const wsPeakGlowToggle = document.getElementById('visual-plus-ws-peak-glow');
  const wsUiVeilToggle = document.getElementById('visual-plus-ws-ui-veil');
  const wsGlowColorModeSelect = document.getElementById('visual-plus-ws-glow-color-mode');
  const wsGlowColorInput = document.getElementById('visual-plus-ws-glow-color');
  const blurredStaticToggle = document.getElementById('visual-plus-blurred-static');
  const visualPlusActiveRowToggle = document.getElementById('visual-plus-active-row-animation-enabled');
  const lyricsFillDirectionSelect = document.getElementById('visual-plus-lyrics-fill-direction');
  const visualPlusFillDirectionSettings = document.getElementById('visual-plus-lyrics-fill-direction-settings');
  const starsSettings = document.getElementById('visual-plus-stars-settings');
  const particlesSettings = document.getElementById('visual-plus-particles-settings');
  const atmosphericSettings = document.getElementById('visual-plus-atmospheric-settings');
  const firefliesEnabledToggle = document.getElementById('visual-plus-fireflies-enabled');
  const rainEnabledToggle = document.getElementById('visual-plus-rain-enabled');
  const rainDirectionSelect = document.getElementById('visual-plus-rain-direction');
  const rainDynamicEnabledToggle = document.getElementById('visual-plus-rain-dynamic-enabled');
  const rainDynamicToggleRow = document.getElementById('visual-plus-rain-dynamic-toggle-row');
  const rainDynamicSettings = document.getElementById('visual-plus-rain-dynamic-settings');
  const particleColorModeSelect = document.getElementById('visual-plus-particle-color-mode');
  const particleColorInput = document.getElementById('visual-plus-particle-color');
  const particleColorRow = document.getElementById('visual-plus-particle-custom-color-row');
  const particleSpawnWidthSelect = document.getElementById('visual-plus-particle-spawn-width');
  const particleGlowToggle = document.getElementById('visual-plus-particle-glow');

  let settings;
  const needsDefault = localStorage.getItem('pn_visual_plus') === null;
  let shouldSave = needsDefault;
  try {
    settings = readVisualPlusSettings();
  } catch (error) {
    console.error('No se pudo leer la configuración de Visual+:', error);
    window.dispatchEvent(new CustomEvent('pn-settings-persistence-error', {
      detail: { message: error instanceof Error ? error.message : String(error) }
    }));
    settings = { ...DEFAULT_VISUAL_PLUS_SETTINGS };
    shouldSave = true;
  }
  if (settings.needsUpgrade) {
    delete settings.needsUpgrade;
    shouldSave = true;
  }
  enabledToggle.checked = settings.enabled;
  const normalizedTheme = settings.theme === 'liquid_immersive' ? 'liquid' : settings.theme === 'liquid_gradient' ? 'blurred' : settings.theme;
  settings.theme = normalizedTheme;
  themeSelect.value = normalizedTheme;
  themeSelect.disabled = !settings.enabled;
  if (starAudioReactiveToggle) starAudioReactiveToggle.checked = Boolean(settings.starAudioReactive);
  const activeRowAnimationEnabled = readStoredBoolean('pn_lyrics_active_row_animation_enabled');
  if (visualPlusActiveRowToggle) visualPlusActiveRowToggle.checked = activeRowAnimationEnabled;
  if (visualPlusFillDirectionSettings) visualPlusFillDirectionSettings.hidden = !activeRowAnimationEnabled;
  if (sophisticatedLyricsToggle) {
    if (!activeRowAnimationEnabled && settings.sophisticatedLyrics) {
      settings = { ...settings, sophisticatedLyrics: false };
      shouldSave = true;
    }
    sophisticatedLyricsToggle.checked = settings.sophisticatedLyrics;
    sophisticatedLyricsToggle.disabled = !activeRowAnimationEnabled;
  }
  if (particleColorModeSelect) particleColorModeSelect.value = settings.particleColorMode;
  if (particleColorInput) particleColorInput.value = settings.particleColor;
  if (particleSpawnWidthSelect) particleSpawnWidthSelect.value = settings.particleSpawnWidth;
  if (particleGlowToggle) particleGlowToggle.checked = settings.particleGlow;
  if (firefliesEnabledToggle) firefliesEnabledToggle.checked = settings.firefliesEnabled;
  if (rainEnabledToggle) rainEnabledToggle.checked = settings.rainEnabled;
  if (rainDirectionSelect) rainDirectionSelect.value = settings.rainDirection;
  if (rainDynamicEnabledToggle) rainDynamicEnabledToggle.checked = settings.rainDynamicEnabled;

  const fillDirection = LYRIC_FILL_DIRECTIONS.includes(
    localStorage.getItem('pn_lyrics_active_row_fill_direction')
  ) ? localStorage.getItem('pn_lyrics_active_row_fill_direction') : 'horizontal';
  if (lyricsFillDirectionSelect) lyricsFillDirectionSelect.value = fillDirection;
  document.documentElement.dataset.lyricsSophisticatedLyrics = String(settings.sophisticatedLyrics);
  document.dispatchEvent(new CustomEvent('pn-lyrics-active-row-animation-changed'));

  document.addEventListener('pn-lyrics-fill-direction-changed', event => {
    if (lyricsFillDirectionSelect) lyricsFillDirectionSelect.value = event.detail.direction;
  });
  lyricsFillDirectionSelect?.addEventListener('change', () => {
    const direction = LYRIC_FILL_DIRECTIONS.includes(lyricsFillDirectionSelect.value)
      ? lyricsFillDirectionSelect.value
      : 'horizontal';
    applyActiveRowFillDirection(direction);
  });
  ps3BgColorModeSelect?.addEventListener('change', () => {
    settings = { ...settings, ps3BgColorMode: ps3BgColorModeSelect.value };
    if (ps3BgColorInput) {
      ps3BgColorInput.disabled = !settings.enabled || settings.theme !== 'ps3_wave' || settings.ps3BgColorMode !== 'custom';
    }
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  ps3WaveColorModeSelect?.addEventListener('change', () => {
    settings = { ...settings, ps3WaveColorMode: ps3WaveColorModeSelect.value };
    if (ps3WaveColorInput) {
      ps3WaveColorInput.disabled = !settings.enabled || settings.theme !== 'ps3_wave' || settings.ps3WaveColorMode !== 'custom';
    }
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  ps3BgColorInput?.addEventListener('input', () => {
    settings = { ...settings, ps3BgColor: ps3BgColorInput.value };
    persistVisualPlusSettings(settings);
  });
  ps3WaveColorInput?.addEventListener('input', () => {
    settings = { ...settings, ps3WaveColor: ps3WaveColorInput.value };
    persistVisualPlusSettings(settings);
  });
  ps3AudioReactiveToggle?.addEventListener('change', () => {
    settings = { ...settings, ps3AudioReactive: Boolean(ps3AudioReactiveToggle.checked) };
    persistVisualPlusSettings(settings);
  });
  wsStyleSelect?.addEventListener('change', () => {
    settings = { ...settings, wsStyle: wsStyleSelect.value };
    persistVisualPlusSettings(settings);
  });
  wsPositionSelect?.addEventListener('change', () => {
    settings = { ...settings, wsPosition: wsPositionSelect.value };
    persistVisualPlusSettings(settings);
  });
  wsColorModeSelect?.addEventListener('change', () => {
    const mode = wsColorModeSelect.value || 'custom';
    settings = { ...settings, wsColorMode: mode };
    if (wsColorInput) {
      wsColorInput.disabled = !settings.enabled || settings.theme !== 'wave_sound' || mode !== 'custom';
    }
    persistVisualPlusSettings(settings);
  });
  wsColorInput?.addEventListener('input', () => {
    // Al mover el picker, forzar modo personalizado para que sí se aplique
    settings = { ...settings, wsColor: wsColorInput.value, wsColorMode: 'custom' };
    if (wsColorModeSelect) wsColorModeSelect.value = 'custom';
    persistVisualPlusSettings(settings);
  });
  wsColorInput?.addEventListener('change', () => {
    settings = { ...settings, wsColor: wsColorInput.value, wsColorMode: 'custom' };
    if (wsColorModeSelect) wsColorModeSelect.value = 'custom';
    persistVisualPlusSettings(settings);
  });
  wsPeakGlowToggle?.addEventListener('change', () => {
    settings = { ...settings, wsPeakGlow: Boolean(wsPeakGlowToggle.checked) };
    const glowRow = document.getElementById('visual-plus-ws-peak-glow-intensity-row');
    if (glowRow) glowRow.hidden = !settings.wsPeakGlow;
    persistVisualPlusSettings(settings);
  });
  wsUiVeilToggle?.addEventListener('change', () => {
    settings = { ...settings, wsUiVeil: Boolean(wsUiVeilToggle.checked) };
    const veilRow = document.getElementById('visual-plus-ws-ui-veil-opacity-row');
    if (veilRow) veilRow.hidden = !settings.wsUiVeil;
    persistVisualPlusSettings(settings);
  });
  wsGlowColorModeSelect?.addEventListener('change', () => {
    settings = { ...settings, wsGlowColorMode: wsGlowColorModeSelect.value };
    if (wsGlowColorInput) {
      wsGlowColorInput.disabled = !settings.enabled || settings.theme !== 'wave_sound' || settings.wsGlowColorMode !== 'custom';
    }
    persistVisualPlusSettings(settings);
  });
  wsGlowColorInput?.addEventListener('input', () => {
    settings = { ...settings, wsGlowColor: wsGlowColorInput.value };
    persistVisualPlusSettings(settings);
  });
  liquidStaticToggle?.addEventListener('change', () => {
    settings = { ...settings, liquidStatic: Boolean(liquidStaticToggle.checked) };
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  blurredStaticToggle?.addEventListener('change', () => {
    settings = { ...settings, blurredStatic: Boolean(blurredStaticToggle.checked) };
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  sophisticatedLyricsToggle?.addEventListener('change', () => {
    if (!readStoredBoolean('pn_lyrics_active_row_animation_enabled')) {
      sophisticatedLyricsToggle.checked = false;
      return;
    }
    settings = { ...settings, sophisticatedLyrics: sophisticatedLyricsToggle.checked };
    document.documentElement.dataset.lyricsSophisticatedLyrics = String(settings.sophisticatedLyrics);
    document.dispatchEvent(new CustomEvent('pn-lyrics-active-row-animation-changed'));
    persistVisualPlusSettings(settings);
  });
  visualPlusActiveRowToggle?.addEventListener('change', () => {
    applyActiveRowAnimation(visualPlusActiveRowToggle.checked);
  });
  document.addEventListener('pn-lyrics-active-row-animation-changed', () => {
    const isEnabled = readStoredBoolean('pn_lyrics_active_row_animation_enabled');
    if (visualPlusActiveRowToggle) visualPlusActiveRowToggle.checked = isEnabled;
    if (visualPlusFillDirectionSettings) visualPlusFillDirectionSettings.hidden = !isEnabled;
    if (sophisticatedLyricsToggle) {
      sophisticatedLyricsToggle.disabled = !isEnabled;
      if (!isEnabled && settings.sophisticatedLyrics) {
        settings = { ...settings, sophisticatedLyrics: false };
        sophisticatedLyricsToggle.checked = false;
        document.documentElement.dataset.lyricsSophisticatedLyrics = 'false';
        persistVisualPlusSettings(settings);
      }
    }
  });

  const rangeControls = [
    ['visual-plus-star-count', 'visual-plus-star-count-value', 'starCount', value => String(value)],
    ['visual-plus-star-brightness', 'visual-plus-star-brightness-value', 'starBrightness', value => `${value}%`],
    ['visual-plus-shooting-count', 'visual-plus-shooting-count-value', 'shootingStarCount', value => String(value)],
    ['visual-plus-shooting-interval', 'visual-plus-shooting-interval-value', 'shootingInterval', value => `${value} s`],
    ['visual-plus-shooting-speed', 'visual-plus-shooting-speed-value', 'shootingSpeed', value => `${value}%`],
    ['visual-plus-liquid-speed', 'visual-plus-liquid-speed-value', 'liquidSpeed', value => `${value}%`],
    ['visual-plus-ps3-speed', 'visual-plus-ps3-speed-value', 'ps3Speed', value => `${value}%`],
    ['visual-plus-ws-bar-count', 'visual-plus-ws-bar-count-value', 'wsBarCount', value => `${value}`],
    ['visual-plus-ws-size', 'visual-plus-ws-size-value', 'wsSize', value => `${value}%`],
    ['visual-plus-ws-reactivity', 'visual-plus-ws-reactivity-value', 'wsReactivity', value => `${value}%`],
    ['visual-plus-ws-intensity', 'visual-plus-ws-intensity-value', 'wsIntensity', value => `${value}%`],
    ['visual-plus-ws-opacity', 'visual-plus-ws-opacity-value', 'wsOpacity', value => `${value}%`],
    ['visual-plus-ws-peak-glow-intensity', 'visual-plus-ws-peak-glow-intensity-value', 'wsPeakGlowIntensity', value => `${value}%`],
    ['visual-plus-ws-ui-veil-opacity', 'visual-plus-ws-ui-veil-opacity-value', 'wsUiVeilOpacity', value => `${value}%`],
    ['visual-plus-ps3-amplitude', 'visual-plus-ps3-amplitude-value', 'ps3Amplitude', value => `${value}`],
    ['visual-plus-ps3-particle-count', 'visual-plus-ps3-particle-count-value', 'ps3ParticleCount', value => `${value}`],
    ['visual-plus-ps3-brightness', 'visual-plus-ps3-brightness-value', 'ps3Brightness', value => `${value}%`],
    ['visual-plus-blurred-speed', 'visual-plus-blurred-speed-value', 'blurredSpeed', value => `${value}%`],
    ['visual-plus-color-diversity', 'visual-plus-color-diversity-value', 'colorDiversity', value => `${value}%`],
    ['visual-plus-trail-length', 'visual-plus-trail-length-value', 'trailLength', value => `${value} px`],
    ['visual-plus-particle-count', 'visual-plus-particle-count-value', 'particleCount', value => String(value)],
    ['visual-plus-particle-speed', 'visual-plus-particle-speed-value', 'particleSpeed', value => `${value} px/s`],
    ['visual-plus-particle-intensity', 'visual-plus-particle-intensity-value', 'particleIntensity', value => String(value)],
    ['visual-plus-particle-min-size', 'visual-plus-particle-min-size-value', 'particleMinSize', value => `${value} px`],
    ['visual-plus-particle-max-size', 'visual-plus-particle-max-size-value', 'particleMaxSize', value => `${value} px`],
    ['visual-plus-particle-opacity', 'visual-plus-particle-opacity-value', 'particleOpacity', value => `${value}%`],
    ['visual-plus-fireflies-count', 'visual-plus-fireflies-count-value', 'firefliesCount', value => String(value)],
    ['visual-plus-fireflies-size', 'visual-plus-fireflies-size-value', 'firefliesSize', value => `${value} px`],
    ['visual-plus-fireflies-brightness', 'visual-plus-fireflies-brightness-value', 'firefliesBrightness', value => `${value}%`],
    ['visual-plus-rain-count', 'visual-plus-rain-count-value', 'rainCount', value => String(value)],
    ['visual-plus-rain-speed', 'visual-plus-rain-speed-value', 'rainBaseSpeed', value => `${value} px/s`],
    ['visual-plus-rain-opacity', 'visual-plus-rain-opacity-value', 'rainBaseOpacity', value => `${value}%`],
    ['visual-plus-rain-intensity', 'visual-plus-rain-intensity-value', 'rainIntensityMultiplier', value => String(value)],
    ['visual-plus-rain-min-density', 'visual-plus-rain-min-density-value', 'rainMinDensity', value => `${Math.round(value * 100)}%`]
  ];
  const updateRangeControl = (input, output, key, formatValue) => {
    input.value = String(settings[key]);
    const isParticleSetting = key.startsWith('particle');
    const isFireflySetting = key.startsWith('fireflies');
    const isRainSetting = key.startsWith('rain');
    const isPs3Setting = key.startsWith('ps3');
    const isWsSetting = key.startsWith('ws');
    const isLiquidSetting = key === 'liquidSpeed' || key === 'liquidStatic' || key === 'blurredSpeed' || key === 'blurredStatic' || key === 'colorDiversity';
    input.disabled = !settings.enabled ||
      (isParticleSetting && settings.theme !== 'reactive_particles') ||
      (isPs3Setting && settings.theme !== 'ps3_wave') ||
      (isWsSetting && settings.theme !== 'wave_sound') ||
      (isFireflySetting && (settings.theme !== 'atmospheric' || !settings.firefliesEnabled)) ||
      (isRainSetting && (settings.theme !== 'atmospheric' || !settings.rainEnabled ||
        (key.startsWith('rainIntensity') || key.startsWith('rainMinDensity')) && !settings.rainDynamicEnabled)) ||
      (isLiquidSetting && (
        ((key === 'liquidSpeed' || key === 'liquidStatic') && settings.theme !== 'liquid' && settings.theme !== 'liquid_immersive') ||
        ((key === 'blurredSpeed' || key === 'blurredStatic' || key === 'colorDiversity') && settings.theme !== 'blurred' && settings.theme !== 'liquid_gradient') ||
        (key === 'liquidSpeed' && settings.liquidStatic) ||
        (key === 'blurredSpeed' && settings.blurredStatic)
      )) ||
      (!isParticleSetting && !isFireflySetting && !isRainSetting && !isLiquidSetting && !isPs3Setting && !isWsSetting && settings.theme !== 'shooting_stars');
    output.value = formatValue(settings[key]);
    output.textContent = formatValue(settings[key]);
  };
  const visualPlusOptions = document.getElementById('visual-plus-options');
  const syncEffectOptions = () => {
    const particlesSelected = settings.theme === 'reactive_particles';
    const atmosphericSelected = settings.theme === 'atmospheric';
    if (visualPlusOptions) visualPlusOptions.hidden = !settings.enabled;
    if (themeSelect) themeSelect.disabled = !settings.enabled;
    // Ocultar paneles de efecto si Visual+ está apagado
    if (starsSettings) starsSettings.hidden = !settings.enabled || settings.theme !== 'shooting_stars';
    const ps3Settings = document.getElementById('visual-plus-ps3-settings');
    if (ps3Settings) ps3Settings.hidden = !settings.enabled || settings.theme !== 'ps3_wave';
    const wsSettings = document.getElementById('visual-plus-ws-settings');
    if (wsSettings) wsSettings.hidden = !settings.enabled || settings.theme !== 'wave_sound';
    const glowIntensityRow = document.getElementById('visual-plus-ws-peak-glow-intensity-row');
    if (glowIntensityRow) glowIntensityRow.hidden = !settings.wsPeakGlow || settings.theme !== 'wave_sound' || !settings.enabled;
    const veilOpacityRow = document.getElementById('visual-plus-ws-ui-veil-opacity-row');
    if (veilOpacityRow) veilOpacityRow.hidden = !settings.wsUiVeil || settings.theme !== 'wave_sound' || !settings.enabled;
    const themeId = settings.theme === 'liquid_immersive' ? 'liquid' : settings.theme === 'liquid_gradient' ? 'blurred' : settings.theme;
    const isLiquidOnly = themeId === 'liquid';
    const isBlurredOnly = themeId === 'blurred';
    const liquidSettings = document.getElementById('visual-plus-liquid-settings');
    if (liquidSettings) liquidSettings.hidden = !settings.enabled || !isLiquidOnly;
    const blurredSettings = document.getElementById('visual-plus-blurred-settings');
    if (blurredSettings) blurredSettings.hidden = !settings.enabled || !isBlurredOnly;
    const liquidSpeedRow = document.getElementById('visual-plus-liquid-speed-row');
    if (liquidSpeedRow) liquidSpeedRow.hidden = Boolean(settings.liquidStatic);
    const blurredSpeedRow = document.getElementById('visual-plus-blurred-speed-row');
    if (blurredSpeedRow) blurredSpeedRow.hidden = Boolean(settings.blurredStatic);
    const diversityRow = document.getElementById('visual-plus-color-diversity-row');
    if (diversityRow) diversityRow.hidden = !settings.enabled || !isBlurredOnly;
    if (liquidStaticToggle) {
      liquidStaticToggle.disabled = !settings.enabled || !isLiquidOnly;
    }
    if (particlesSettings) particlesSettings.hidden = !settings.enabled || !particlesSelected;
    if (atmosphericSettings) atmosphericSettings.hidden = !settings.enabled || !atmosphericSelected;
    if (particleColorRow) particleColorRow.hidden = settings.particleColorMode !== 'custom';
    if (rainDynamicToggleRow) rainDynamicToggleRow.hidden = !settings.rainEnabled;
    if (rainDynamicSettings) rainDynamicSettings.hidden = !settings.rainEnabled || !settings.rainDynamicEnabled;
    rangeControls.forEach(([inputId, outputId, key, formatValue]) => {
      const input = document.getElementById(inputId);
      const output = document.getElementById(outputId);
      if (input && output) updateRangeControl(input, output, key, formatValue);
    });
    [particleColorModeSelect, particleColorInput, particleSpawnWidthSelect, particleGlowToggle]
      .filter(Boolean)
      .forEach(control => {
        control.disabled = !settings.enabled || !particlesSelected ||
          (control === particleColorInput && settings.particleColorMode !== 'custom');
      });
    [firefliesEnabledToggle, rainEnabledToggle, rainDirectionSelect, rainDynamicEnabledToggle]
      .filter(Boolean)
      .forEach(control => {
        control.disabled = !settings.enabled || !atmosphericSelected ||
          (control === rainDynamicEnabledToggle && !settings.rainEnabled);
      });
    rangeControls
      .filter(([, , key]) => key.startsWith('fireflies') || key.startsWith('rain'))
      .forEach(([inputId, outputId, key, formatValue]) => {
        const input = document.getElementById(inputId);
        const output = document.getElementById(outputId);
        if (input && output) updateRangeControl(input, output, key, formatValue);
      });
  };
  rangeControls.forEach(([inputId, outputId, key, formatValue]) => {
    const input = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (!input || !output) return;
    updateRangeControl(input, output, key, formatValue);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      if (key === 'particleMinSize' && settings.particleMinSize > settings.particleMaxSize) {
        settings.particleMaxSize = settings.particleMinSize;
      } else if (key === 'particleMaxSize' && settings.particleMaxSize < settings.particleMinSize) {
        settings.particleMinSize = settings.particleMaxSize;
      }
      syncEffectOptions();
      document.dispatchEvent(new CustomEvent('pn-visual-plus-settings-changed', {
        detail: { ...settings }
      }));
    });
    input.addEventListener('change', () => persistVisualPlusSettings(settings));
  });
  particleColorModeSelect?.addEventListener('change', () => {
    settings.particleColorMode = particleColorModeSelect.value;
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  particleColorInput?.addEventListener('input', () => {
    settings.particleColor = particleColorInput.value;
    document.dispatchEvent(new CustomEvent('pn-visual-plus-settings-changed', {
      detail: { ...settings }
    }));
  });
  particleColorInput?.addEventListener('change', () => persistVisualPlusSettings(settings));
  particleSpawnWidthSelect?.addEventListener('change', () => {
    settings.particleSpawnWidth = particleSpawnWidthSelect.value;
    persistVisualPlusSettings(settings);
  });
  particleGlowToggle?.addEventListener('change', () => {
    settings.particleGlow = particleGlowToggle.checked;
    persistVisualPlusSettings(settings);
  });
  firefliesEnabledToggle?.addEventListener('change', () => {
    settings.firefliesEnabled = firefliesEnabledToggle.checked;
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  rainEnabledToggle?.addEventListener('change', () => {
    settings.rainEnabled = rainEnabledToggle.checked;
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  rainDirectionSelect?.addEventListener('change', () => {
    settings.rainDirection = rainDirectionSelect.value;
    persistVisualPlusSettings(settings);
  });
  rainDynamicEnabledToggle?.addEventListener('change', () => {
    settings.rainDynamicEnabled = rainDynamicEnabledToggle.checked;
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });

  starAudioReactiveToggle?.addEventListener('change', () => {
    settings = { ...settings, starAudioReactive: Boolean(starAudioReactiveToggle.checked) };
    persistVisualPlusSettings(settings);
  });
  enabledToggle.addEventListener('change', () => {

    settings = { ...settings, enabled: enabledToggle.checked };
    themeSelect.disabled = !settings.enabled;
  if (starAudioReactiveToggle) starAudioReactiveToggle.checked = Boolean(settings.starAudioReactive);
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  themeSelect.addEventListener('change', () => {
    settings = {
      ...settings,
      theme: themeSelect.value
    };
    syncEffectOptions();
    persistVisualPlusSettings(settings);
  });
  syncEffectOptions();
  if (shouldSave) persistVisualPlusSettings(settings);
}
