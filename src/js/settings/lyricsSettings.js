// Ajustes · Ajustes de letras: fuente, alineación, movimiento, transición y relleno.

import { readStoredBoolean } from './appearance.js';

export const LYRIC_SETTINGS = [
  { id: 'lyrics-active-size', property: '--lyrics-sync-active-size', unit: 'px' },
  { id: 'lyrics-inactive-size', property: '--lyrics-sync-inactive-size', unit: 'px' },
  { id: 'lyrics-line-gap', property: '--lyrics-line-gap', unit: 'px' },
  { id: 'lyrics-sync-letter-spacing', property: '--lyrics-sync-letter-spacing', unit: 'px' },
  { id: 'lyrics-plain-size', property: '--lyrics-plain-size', unit: 'px' },
  { id: 'lyrics-plain-line-height', property: '--lyrics-plain-line-height', unit: 'px' },
  { id: 'lyrics-plain-letter-spacing', property: '--lyrics-plain-letter-spacing', unit: 'px' }
];

const LYRIC_ALIGNMENT_OPTIONS = ['left', 'center', 'right'];

const LYRIC_MOTION_OPTIONS = ['scale', 'slide', 'continuous-slide', 'none'];

const LYRIC_TRANSITION_OPTIONS = ['very-smooth', 'intermediate', 'fast'];

const LYRIC_TRANSITION_DURATIONS = {
  'very-smooth': '800ms',
  intermediate: '420ms',
  fast: '180ms'
};

export const LYRIC_FONT_FAMILIES = {
  jakarta: '"Plus Jakarta Sans", sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  trebuchet: '"Trebuchet MS", sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  verdana: 'Verdana, Geneva, sans-serif',
  courier: '"Courier New", monospace'
};

export function applyLyricSettings() {
  let activeSize = 38;
  let inactiveSize = 31;
  LYRIC_SETTINGS.forEach(({ id, property, unit }) => {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    if (!input) return;
    const value = Number(input.value);
    if (id === 'lyrics-active-size') activeSize = value;
    if (id === 'lyrics-inactive-size') inactiveSize = value;
    document.documentElement.style.setProperty(property, `${value}${unit}`);
    if (output) output.value = `${value}${unit}`;
    localStorage.setItem(`pn_${id}`, String(value));
  });
  document.documentElement.style.setProperty(
    '--lyrics-active-scale',
    String(activeSize / Math.max(1, inactiveSize))
  );
  document.documentElement.style.setProperty(
    '--lyrics-inactive-text-scale',
    String(inactiveSize / Math.max(1, activeSize))
  );
  document.dispatchEvent(new CustomEvent('pn-lyrics-visual-settings-changed'));
}

export function applyLyricAlignment(alignment) {
  const selectedAlignment = LYRIC_ALIGNMENT_OPTIONS.includes(alignment) ? alignment : 'center';
  document.documentElement.style.setProperty('--lyrics-sync-text-align', selectedAlignment);
  document.documentElement.style.setProperty(
    '--lyrics-sync-transform-origin',
    `${selectedAlignment === 'center' ? 'center' : selectedAlignment} center`
  );
  document.documentElement.dataset.lyricsAlignment = selectedAlignment;
  localStorage.setItem('pn_lyrics_sync_alignment', selectedAlignment);
  document.querySelectorAll('#lyrics-sync-alignment [data-alignment]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.alignment === selectedAlignment));
  });
}

export function applyLyricsFont(font) {
  const selectedFont = Object.prototype.hasOwnProperty.call(LYRIC_FONT_FAMILIES, font)
    ? font
    : 'jakarta';
  document.documentElement.style.setProperty('--lyrics-font-family', LYRIC_FONT_FAMILIES[selectedFont]);
  const select = document.getElementById('lyrics-font-family');
  if (select) select.value = selectedFont;
  localStorage.setItem('pn_lyrics_font_family', selectedFont);
}

export function applyLyricsMotion(motion) {
  const selectedMotion = LYRIC_MOTION_OPTIONS.includes(motion) ? motion : 'scale';
  document.documentElement.dataset.lyricsMotion = selectedMotion;
  const select = document.getElementById('lyrics-sync-motion');
  if (select) select.value = selectedMotion;
  localStorage.setItem('pn_lyrics_sync_motion', selectedMotion);
}

export function applyLyricsTransition(transition) {
  const selectedTransition = LYRIC_TRANSITION_OPTIONS.includes(transition)
    ? transition
    : 'intermediate';
  document.documentElement.style.setProperty(
    '--lyrics-line-transition-duration',
    LYRIC_TRANSITION_DURATIONS[selectedTransition]
  );
  const select = document.getElementById('lyrics-sync-transition');
  if (select) select.value = selectedTransition;
  localStorage.setItem('pn_lyrics_sync_transition', selectedTransition);
}

export function applyLyricItalic(enabled) {
  const isItalic = Boolean(enabled);
  document.documentElement.style.setProperty('--lyrics-font-style', isItalic ? 'italic' : 'normal');
  localStorage.setItem('pn_lyrics_italic', String(isItalic));
  const input = document.getElementById('lyrics-italic-enabled');
  if (input) input.checked = isItalic;
}

export const LYRIC_FILL_DIRECTIONS = ['horizontal', 'vertical', 'letters', 'words'];

export function applyActiveRowAnimation(enabled) {
  const isEnabled = Boolean(enabled);
  const input = document.getElementById('lyrics-active-row-animation-enabled');
  const visualPlusInput = document.getElementById('visual-plus-active-row-animation-enabled');
  const sophisticatedInput = document.getElementById('visual-plus-sophisticated-lyrics');
  const directionSettings = document.getElementById('lyrics-fill-direction-settings');
  const wordTimingSetting = document.getElementById('lyrics-word-timing-setting');
  if (input) input.checked = isEnabled;
  if (visualPlusInput) visualPlusInput.checked = isEnabled;
  if (sophisticatedInput) {
    sophisticatedInput.disabled = !isEnabled;
    if (!isEnabled) sophisticatedInput.checked = false;
  }
  if (directionSettings) directionSettings.hidden = !isEnabled;
  if (wordTimingSetting) wordTimingSetting.hidden = !isEnabled;
  document.documentElement.dataset.lyricsActiveRowAnimation = String(isEnabled);
  localStorage.setItem('pn_lyrics_active_row_animation_enabled', String(isEnabled));
  document.dispatchEvent(new CustomEvent('pn-lyrics-active-row-animation-changed'));
}

export function applyActiveRowFillDirection(direction) {
  const selectedDirection = LYRIC_FILL_DIRECTIONS.includes(direction) ? direction : 'horizontal';
  [
    document.getElementById('lyrics-active-row-fill-direction'),
    document.getElementById('visual-plus-lyrics-fill-direction')
  ].forEach(input => {
    if (input) input.value = selectedDirection;
  });
  document.documentElement.dataset.lyricsActiveRowFillDirection = selectedDirection;
  localStorage.setItem('pn_lyrics_active_row_fill_direction', selectedDirection);
  document.dispatchEvent(new CustomEvent('pn-lyrics-fill-direction-changed', {
    detail: { direction: selectedDirection }
  }));
  document.dispatchEvent(new CustomEvent('pn-lyrics-active-row-animation-changed'));
}

export function applyWordTimedLyricsAnimation(enabled) {
  const isEnabled = Boolean(enabled);
  const input = document.getElementById('lyrics-word-timing-enabled');
  if (input) input.checked = isEnabled;
  document.documentElement.dataset.lyricsWordTimingAnimation = String(isEnabled);
  localStorage.setItem('pn_lyrics_word_timing_animation', String(isEnabled));
  document.dispatchEvent(new CustomEvent('pn-lyrics-active-row-animation-changed'));
}

export function initLyricsFocusModeSettings() {
  const autoCloseInput = document.getElementById('lyrics-auto-close-empty-enabled');
  const hideChromeInput = document.getElementById('lyrics-hide-chrome-enabled');
  const hideChromeTimeoutSelect = document.getElementById('lyrics-hide-chrome-timeout');
  const hideChromeTimeoutRow = document.getElementById('lyrics-hide-chrome-timeout-row');

  if (autoCloseInput) {
    autoCloseInput.checked = readStoredBoolean('pn_lyrics_auto_close_empty', true);
    autoCloseInput.addEventListener('change', () => {
      localStorage.setItem('pn_lyrics_auto_close_empty', String(autoCloseInput.checked));
    });
  }

  const applyHideChromeTimeout = (value) => {
    const selected = ['5', '10', '15'].includes(String(value)) ? String(value) : '10';
    if (hideChromeTimeoutSelect) hideChromeTimeoutSelect.value = selected;
    localStorage.setItem('pn_lyrics_hide_chrome_timeout', selected);
    // compat con código antiguo de enfoque
    localStorage.setItem('pn_lyrics_focus_mode_timeout', selected === '15' ? '10' : selected);
  };

  const storedHideTimeout =
    localStorage.getItem('pn_lyrics_hide_chrome_timeout')
    || localStorage.getItem('pn_lyrics_focus_mode_timeout')
    || '10';
  applyHideChromeTimeout(storedHideTimeout);

  const syncHideChromeRow = () => {
    const on = hideChromeInput ? hideChromeInput.checked : readStoredBoolean('pn_lyrics_hide_chrome_enabled', false);
    if (hideChromeTimeoutRow) hideChromeTimeoutRow.style.display = on ? '' : 'none';
  };

  if (hideChromeInput) {
    hideChromeInput.checked = readStoredBoolean('pn_lyrics_hide_chrome_enabled', false);
    hideChromeInput.addEventListener('change', () => {
      localStorage.setItem('pn_lyrics_hide_chrome_enabled', String(hideChromeInput.checked));
      syncHideChromeRow();
      document.dispatchEvent(new Event('pn-lyrics-focus-settings-changed'));
    });
  }
  hideChromeTimeoutSelect?.addEventListener('change', () => {
    applyHideChromeTimeout(hideChromeTimeoutSelect.value);
    document.dispatchEvent(new Event('pn-lyrics-focus-settings-changed'));
  });
  syncHideChromeRow();
}
