// Ajustes · Ajustes de apariencia: tema, escala, barra del reproductor y estilos de progreso.

import { themeOptions } from './dom.js';
import { configureProgressWaveform, setProgressStyle } from '../audioPlayer.js';
import { applyFavoritesDisplayName, applyListTrackNumbersVisibility } from '../ui.js';
import { LYRIC_SETTINGS, applyActiveRowAnimation, applyActiveRowFillDirection, applyLyricAlignment, applyLyricItalic, applyLyricSettings, applyLyricsFont, applyLyricsMotion, applyLyricsTransition, applyWordTimedLyricsAnimation, initLyricsFocusModeSettings } from './lyricsSettings.js';

const AVAILABLE_THEMES = ['purple', 'purple-aurora', 'blue', 'blue-boreal', 'teal', 'teal-jade'];

const PROGRESS_STYLES = ['solid', 'waveform'];

const INTERFACE_SCALES = [75, 85, 100, 110, 125];

const PLAYER_RIGHT_CONTROL_SIZES = ['small', 'normal', 'large'];

const VOLUME_SLIDER_LENGTHS = ['small', 'medium'];

const LYRIC_TRANSLATION_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it'];

export function readStoredBoolean(key, defaultValue = false) {
  const value = localStorage.getItem(key);
  return value === null ? defaultValue : value === 'true';
}

export function readStoredDuration(key, fallback, min, max) {
  const storedValue = localStorage.getItem(key);
  if (storedValue === null) return fallback;
  const value = Number(storedValue);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function applyInterfaceScale() {
  const scaleSelect = document.getElementById('interface-scale');
  const storedScale = Number(localStorage.getItem('pn_interface_scale') || 100);
  const scale = INTERFACE_SCALES.includes(storedScale) ? storedScale : 100;
  const fitMode = localStorage.getItem('pn_interface_fit') === 'shrink' ? 'shrink' : 'adapt';
  const autoScale = fitMode === 'shrink' ? Math.max(0.88, Math.min(1, window.innerWidth / 1100)) : 1;
  document.documentElement.style.setProperty('--ui-scale', String((scale / 100 * autoScale).toFixed(3)));
  document.documentElement.dataset.interfaceFit = fitMode;
  if (scaleSelect) scaleSelect.value = String(scale);
  document.querySelectorAll('#interface-fit-options [data-fit-mode]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.fitMode === fitMode));
  });
}

function applyPlayerBarSettings() {
  const hideQueueInput = document.getElementById('hide-queue-ui');
  const showAudioQualityInput = document.getElementById('show-player-audio-quality');
  const showPlayerSourceInput = document.getElementById('show-player-source');
  const showVolumePercentageInput = document.getElementById('show-volume-percentage');
  const showSleepTimerInput = document.getElementById('show-player-sleep-timer');
  const showPlaybackSpeedInput = document.getElementById('show-player-speed-control');
  const showPlaybackPitchInput = document.getElementById('show-player-pitch-control');
  const controlsSizeSelect = document.getElementById('player-right-controls-size');
  const volumeLengthSelect = document.getElementById('player-volume-length');
  const hideQueue = readStoredBoolean('pn_hide_queue_ui');
  const showAudioQuality = readStoredBoolean('pn_show_player_audio_quality', true);
  const showPlayerSource = readStoredBoolean('pn_show_player_source');
  const showVolumePercentage = readStoredBoolean('pn_show_volume_percentage');
  const showSleepTimer = readStoredBoolean('pn_show_player_sleep_timer', true);
  const showPlaybackSpeed = readStoredBoolean('pn_show_player_speed_control', true);
  const showPlaybackPitch = readStoredBoolean('pn_show_player_pitch_control', true);
  const storedControlsSize = localStorage.getItem('pn_player_right_controls_size') || 'normal';
  const controlsSize = PLAYER_RIGHT_CONTROL_SIZES.includes(storedControlsSize) ? storedControlsSize : 'normal';
  const storedVolumeLength = localStorage.getItem('pn_player_volume_length') || 'small';
  const volumeLength = VOLUME_SLIDER_LENGTHS.includes(storedVolumeLength) ? storedVolumeLength : 'small';

  document.documentElement.dataset.queueUiHidden = String(hideQueue);
  document.documentElement.dataset.playerAudioQuality = String(showAudioQuality);
  document.documentElement.dataset.playerSource = String(showPlayerSource);
  document.documentElement.dataset.playerVolumePercentage = String(showVolumePercentage);
  document.documentElement.dataset.playerSleepTimer = String(showSleepTimer);
  document.documentElement.dataset.playerSpeedControl = String(showPlaybackSpeed);
  document.documentElement.dataset.playerPitchControl = String(showPlaybackPitch);
  document.documentElement.dataset.playerRightControlsSize = controlsSize;
  document.documentElement.style.setProperty('--player-volume-slider-scale', volumeLength === 'medium' ? '1.4' : '1');

  if (hideQueueInput) hideQueueInput.checked = hideQueue;
  if (showAudioQualityInput) showAudioQualityInput.checked = showAudioQuality;
  if (showPlayerSourceInput) showPlayerSourceInput.checked = showPlayerSource;
  if (showVolumePercentageInput) showVolumePercentageInput.checked = showVolumePercentage;
  if (showSleepTimerInput) showSleepTimerInput.checked = showSleepTimer;
  if (showPlaybackSpeedInput) showPlaybackSpeedInput.checked = showPlaybackSpeed;
  if (showPlaybackPitchInput) showPlaybackPitchInput.checked = showPlaybackPitch;
  if (controlsSizeSelect) controlsSizeSelect.value = controlsSize;
  if (volumeLengthSelect) volumeLengthSelect.value = volumeLength;
}

function applyTheme(theme) {
  const selectedTheme = AVAILABLE_THEMES.includes(theme) ? theme : 'purple';
  if (selectedTheme === 'purple') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = selectedTheme;
  }
  localStorage.setItem('pn_theme', selectedTheme);
  themeOptions?.querySelectorAll('[data-theme]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.theme === selectedTheme));
  });
}

function applyProgressStyle(style) {
  const selectedStyle = PROGRESS_STYLES.includes(style) ? style : 'solid';
  setProgressStyle(selectedStyle);
  localStorage.setItem('pn_progress_style', selectedStyle);
  document.getElementById('waveform-settings')?.classList.toggle('is-visible', selectedStyle === 'waveform');
  document.querySelectorAll('#progress-style-options [data-progress-style]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.progressStyle === selectedStyle));
  });
  syncTopProgressAvailability();
}

function syncTopProgressAvailability() {
  const isClassic = (localStorage.getItem('pn_progress_style') || 'solid') === 'solid';
  const useTopProgress = readStoredBoolean('pn_progress_at_top');
  document.getElementById('bottom-player')?.classList.toggle('progress-at-top', isClassic && useTopProgress);
  const option = document.querySelector('.progress-at-top-option');
  if (option) option.hidden = !isClassic;
  const input = document.getElementById('progress-at-top');
  if (input) input.checked = useTopProgress;
}

function applyTopProgress(enabled) {
  localStorage.setItem('pn_progress_at_top', String(Boolean(enabled)));
  syncTopProgressAvailability();
}

function applyWaveformSettings() {
  const mode = localStorage.getItem('pn_waveform_mode') === 'smooth' ? 'smooth' : 'bars';
  const splitTimes = readStoredBoolean('pn_waveform_split_times');
  // Cantidad de barras fija (estilo AIMP); ocultar control legacy si sigue en el DOM
  const countRow = document.querySelector('label.setting-range-row[for="waveform-bar-count"]');
  if (countRow) countRow.hidden = true;
  const splitTimesInput = document.getElementById('waveform-times-below');
  if (splitTimesInput) splitTimesInput.checked = splitTimes;
  document.querySelectorAll('#waveform-mode-options [data-waveform-mode]').forEach(option => {
    option.setAttribute('aria-pressed', String(option.dataset.waveformMode === mode));
  });
  configureProgressWaveform(mode, splitTimes);
}

export function initAppearanceSettings() {
  const vibrantAccentsInput = document.getElementById('vibrant-accents-enabled');
  const applyVibrantAccents = enabled => {
    const isEnabled = Boolean(enabled);
    if (vibrantAccentsInput) vibrantAccentsInput.checked = isEnabled;
    document.documentElement.toggleAttribute('data-vibrant-accents', isEnabled);
    if (isEnabled) document.documentElement.dataset.vibrantAccents = 'true';
    localStorage.setItem('pn_vibrant_accents', String(isEnabled));
  };
  applyVibrantAccents(readStoredBoolean('pn_vibrant_accents'));
  vibrantAccentsInput?.addEventListener('change', () => {
    applyVibrantAccents(vibrantAccentsInput.checked);
  });

  const showTitlebarBrand = document.getElementById('show-sidebar-brand');
  const titlebarBrandPreferenceKey = 'pn_show_resonance_brand';
  const applyTitlebarBrand = enabled => {
    const isEnabled = Boolean(enabled);
    document.documentElement.dataset.brandPosition = isEnabled ? 'titlebar' : 'sidebar';
    if (showTitlebarBrand) showTitlebarBrand.checked = isEnabled;
    localStorage.setItem(titlebarBrandPreferenceKey, String(isEnabled));
  };
  applyTitlebarBrand(localStorage.getItem(titlebarBrandPreferenceKey) !== 'false');
  showTitlebarBrand?.addEventListener('change', () => applyTitlebarBrand(showTitlebarBrand.checked));

  const showListTrackNumbers = document.getElementById('show-list-track-numbers');
  if (showListTrackNumbers) {
    const savedNums = localStorage.getItem('pn_show_list_track_numbers');
    showListTrackNumbers.checked = savedNums === null ? true : savedNums === 'true';
    applyListTrackNumbersVisibility(showListTrackNumbers.checked, { refresh: false });
    showListTrackNumbers.addEventListener('change', () => {
      applyListTrackNumbersVisibility(showListTrackNumbers.checked, { refresh: true });
    });
  }

  applyInterfaceScale();
  document.getElementById('interface-scale')?.addEventListener('change', event => {
    const selectedScale = Number(event.currentTarget.value);
    localStorage.setItem('pn_interface_scale', String(INTERFACE_SCALES.includes(selectedScale) ? selectedScale : 100));
    applyInterfaceScale();
  });
  document.querySelectorAll('#interface-fit-options [data-fit-mode]').forEach(option => {
    option.addEventListener('click', () => {
      localStorage.setItem('pn_interface_fit', option.dataset.fitMode);
      applyInterfaceScale();
    });
  });
  window.addEventListener('resize', applyInterfaceScale);

  applyPlayerBarSettings();
  initLyricsFocusModeSettings();
  document.getElementById('hide-queue-ui')?.addEventListener('change', event => {
    localStorage.setItem('pn_hide_queue_ui', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('show-player-audio-quality')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_player_audio_quality', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('show-player-source')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_player_source', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('show-player-sleep-timer')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_player_sleep_timer', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('show-player-speed-control')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_player_speed_control', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('show-player-pitch-control')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_player_pitch_control', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  const renameFavoritesInput = document.getElementById('rename-favorites-label');
  if (renameFavoritesInput) {
    renameFavoritesInput.checked = readStoredBoolean('pn_rename_favorites_label');
    applyFavoritesDisplayName();
    renameFavoritesInput.addEventListener('change', () => {
      localStorage.setItem('pn_rename_favorites_label', String(renameFavoritesInput.checked));
      applyFavoritesDisplayName();
    });
  }
  document.getElementById('show-volume-percentage')?.addEventListener('change', event => {
    localStorage.setItem('pn_show_volume_percentage', String(event.currentTarget.checked));
    applyPlayerBarSettings();
  });
  document.getElementById('player-right-controls-size')?.addEventListener('change', event => {
    const size = PLAYER_RIGHT_CONTROL_SIZES.includes(event.currentTarget.value) ? event.currentTarget.value : 'normal';
    localStorage.setItem('pn_player_right_controls_size', size);
    applyPlayerBarSettings();
  });
  document.getElementById('player-volume-length')?.addEventListener('change', event => {
    const length = VOLUME_SLIDER_LENGTHS.includes(event.currentTarget.value) ? event.currentTarget.value : 'small';
    localStorage.setItem('pn_player_volume_length', length);
    applyPlayerBarSettings();
  });

  applyTheme(localStorage.getItem('pn_theme') || 'purple');
  themeOptions?.querySelectorAll('[data-theme]').forEach(option => {
    option.addEventListener('click', () => applyTheme(option.dataset.theme));
  });

  applyProgressStyle(localStorage.getItem('pn_progress_style') || 'solid');
  document.querySelectorAll('#progress-style-options [data-progress-style]').forEach(option => {
    option.addEventListener('click', () => applyProgressStyle(option.dataset.progressStyle));
  });
  applyTopProgress(readStoredBoolean('pn_progress_at_top'));
  document.getElementById('progress-at-top')?.addEventListener('change', event => {
    applyTopProgress(event.currentTarget.checked);
  });
  applyWaveformSettings();
  document.querySelectorAll('#waveform-mode-options [data-waveform-mode]').forEach(option => {
    option.addEventListener('click', () => {
      localStorage.setItem('pn_waveform_mode', option.dataset.waveformMode);
      applyWaveformSettings();
    });
  });
  document.getElementById('waveform-times-below')?.addEventListener('change', event => {
    localStorage.setItem('pn_waveform_split_times', String(event.currentTarget.checked));
    applyWaveformSettings();
  });

  LYRIC_SETTINGS.forEach(({ id }) => {
    const input = document.getElementById(id);
    if (!input) return;
    const savedValue = localStorage.getItem(`pn_${id}`);
    if (savedValue !== null) {
      const value = Number(savedValue);
      if (Number.isFinite(value)) input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), value)));
    }
    input.addEventListener('input', applyLyricSettings);
  });
  applyLyricSettings();

  const translationEnabledInput = document.getElementById('lyrics-translation-enabled');
  const translationLanguageSelect = document.getElementById('lyrics-translation-language');
  const storedTranslationLanguage = localStorage.getItem('pn_lyrics_translation_language') || 'es';
  const translationLanguage = LYRIC_TRANSLATION_LANGUAGES.includes(storedTranslationLanguage)
    ? storedTranslationLanguage
    : 'es';
  const applyLyricsTranslationSettings = () => {
    const enabled = readStoredBoolean('pn_lyrics_translation_enabled');
    if (translationEnabledInput) translationEnabledInput.checked = enabled;
    if (translationLanguageSelect) {
      translationLanguageSelect.value = translationLanguageSelect.value || translationLanguage;
      translationLanguageSelect.disabled = !enabled;
    }
  };
  if (translationEnabledInput) translationEnabledInput.checked = readStoredBoolean('pn_lyrics_translation_enabled');
  if (translationLanguageSelect) translationLanguageSelect.value = translationLanguage;
  applyLyricsTranslationSettings();
  translationEnabledInput?.addEventListener('change', event => {
    localStorage.setItem('pn_lyrics_translation_enabled', String(event.currentTarget.checked));
    applyLyricsTranslationSettings();
    document.dispatchEvent(new CustomEvent('pn-lyrics-translation-settings-changed', {
      detail: { enabled: event.currentTarget.checked }
    }));
  });
  translationLanguageSelect?.addEventListener('change', event => {
    const language = LYRIC_TRANSLATION_LANGUAGES.includes(event.currentTarget.value)
      ? event.currentTarget.value
      : 'es';
    localStorage.setItem('pn_lyrics_translation_language', language);
    event.currentTarget.value = language;
    document.dispatchEvent(new CustomEvent('pn-lyrics-translation-settings-changed', {
      detail: { enabled: readStoredBoolean('pn_lyrics_translation_enabled'), language, languageChanged: true }
    }));
  });

  const savedAlignment = localStorage.getItem('pn_lyrics_sync_alignment') || 'center';
  applyLyricAlignment(savedAlignment);
  document.querySelectorAll('#lyrics-sync-alignment [data-alignment]').forEach(button => {
    button.addEventListener('click', () => applyLyricAlignment(button.dataset.alignment));
  });

  applyLyricsFont(localStorage.getItem('pn_lyrics_font_family') || 'jakarta');
  document.getElementById('lyrics-font-family')?.addEventListener('change', event => {
    applyLyricsFont(event.currentTarget.value);
  });
  applyLyricsMotion(localStorage.getItem('pn_lyrics_sync_motion') || 'scale');
  document.getElementById('lyrics-sync-motion')?.addEventListener('change', event => {
    applyLyricsMotion(event.currentTarget.value);
  });
  applyLyricsTransition(localStorage.getItem('pn_lyrics_sync_transition') || 'intermediate');
  document.getElementById('lyrics-sync-transition')?.addEventListener('change', event => {
    applyLyricsTransition(event.currentTarget.value);
  });
  applyLyricItalic(readStoredBoolean('pn_lyrics_italic'));
  document.getElementById('lyrics-italic-enabled')?.addEventListener('change', event => {
    applyLyricItalic(event.currentTarget.checked);
  });
  applyActiveRowAnimation(readStoredBoolean('pn_lyrics_active_row_animation_enabled'));
  document.getElementById('lyrics-active-row-animation-enabled')?.addEventListener('change', event => {
    applyActiveRowAnimation(event.currentTarget.checked);
  });
  applyActiveRowFillDirection(localStorage.getItem('pn_lyrics_active_row_fill_direction') || 'horizontal');
  document.getElementById('lyrics-active-row-fill-direction')?.addEventListener('change', event => {
    applyActiveRowFillDirection(event.currentTarget.value);
  });
  applyWordTimedLyricsAnimation(readStoredBoolean('pn_lyrics_word_timing_animation'));
  document.getElementById('lyrics-word-timing-enabled')?.addEventListener('change', event => {
    applyWordTimedLyricsAnimation(event.currentTarget.checked);
  });

  document.getElementById('btn-reset-lyrics-settings')?.addEventListener('click', () => {
    LYRIC_SETTINGS.forEach(({ id }) => {
      const input = document.getElementById(id);
      if (input) input.value = input.defaultValue;
    });
    applyLyricSettings();
    applyLyricAlignment('center');
    applyLyricsFont('jakarta');
    applyLyricsMotion('scale');
    applyLyricsTransition('intermediate');
    applyLyricItalic(false);
    applyActiveRowAnimation(false);
    applyActiveRowFillDirection('horizontal');
    applyWordTimedLyricsAnimation(false);
  });
}
