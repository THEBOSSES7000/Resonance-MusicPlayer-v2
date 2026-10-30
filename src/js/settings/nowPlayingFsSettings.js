// Ajustes · Ajustes del reproductor en pantalla completa (portada, letras, vinilo, volumen).

import { LYRIC_FONT_FAMILIES } from './lyricsSettings.js';

const NP_FS_COVER_KEY = 'pn_np_fs_cover_size';

const NP_FS_SYNC_KEY = 'pn_np_fs_sync_lyrics';

const NP_FS_ACTIVE_KEY = 'pn_np_fs_lyrics_active_size';

const NP_FS_INACTIVE_KEY = 'pn_np_fs_lyrics_inactive_size';

const NP_FS_GAP_KEY = 'pn_np_fs_lyrics_line_gap';

const NP_FS_LETTER_KEY = 'pn_np_fs_lyrics_letter_spacing';

const NP_FS_FONT_KEY = 'pn_np_fs_lyrics_font';

const NP_FS_ITALIC_KEY = 'pn_np_fs_lyrics_italic';

const NP_FS_ALIGN_KEY = 'pn_np_fs_lyrics_align';

const NP_FS_VINYL_KEY = 'pn_np_fs_vinyl_enabled';

const NP_FS_VOLUME_KEY = 'pn_np_fs_volume_bar';

function getNpFsCoverSize() {
  try {
    const v = localStorage.getItem(NP_FS_COVER_KEY);
    return v === 'large' ? 'large' : 'medium';
  } catch (_) {
    return 'medium';
  }
}

function isNpFsSyncLyrics() {
  try {
    const v = localStorage.getItem(NP_FS_SYNC_KEY);
    if (v === null || v === undefined) return true;
    return v === '1' || v === 'true';
  } catch (_) {
    return true;
  }
}

function applyNpFsCoverSize(size) {
  const selected = size === 'large' ? 'large' : 'medium';
  document.body.classList.toggle('np-fs-cover-large', selected === 'large');
  const select = document.getElementById('np-fs-cover-size');
  if (select) select.value = selected;
  try { localStorage.setItem(NP_FS_COVER_KEY, selected); } catch (_) {}
}

function updateNpFsCustomPanelVisibility() {
  const panel = document.getElementById('np-fs-lyrics-custom-settings');
  const syncInput = document.getElementById('np-fs-sync-lyrics');
  const sync = syncInput ? Boolean(syncInput.checked) : isNpFsSyncLyrics();
  if (panel) panel.hidden = sync;
}

function applyNpFsSyncLyrics(enabled) {
  const sync = Boolean(enabled);
  document.body.classList.toggle('np-fs-lyrics-custom', !sync);
  const input = document.getElementById('np-fs-sync-lyrics');
  if (input) input.checked = sync;
  try { localStorage.setItem(NP_FS_SYNC_KEY, sync ? '1' : '0'); } catch (_) {}
  updateNpFsCustomPanelVisibility();
  if (!sync) applyNpFsLyricsCustomFromStorage();
  else {
    // quitar overrides al sincronizar
    const root = document.documentElement;
    root.style.removeProperty('--np-fs-lyrics-active-size');
    root.style.removeProperty('--np-fs-lyrics-inactive-size');
    root.style.removeProperty('--np-fs-lyrics-line-gap');
    root.style.removeProperty('--np-fs-lyrics-letter-spacing');
    root.style.removeProperty('--np-fs-lyrics-font-family');
    root.style.removeProperty('--np-fs-lyrics-font-style');
    root.style.removeProperty('--np-fs-lyrics-align');
  }
}

function readNpFsNum(key, fallback) {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) ? n : fallback;
  } catch (_) {
    return fallback;
  }
}

function applyNpFsLyricsCustomFromStorage() {
  if (isNpFsSyncLyrics()) return;
  document.body.classList.add('np-fs-lyrics-custom');
  const active = readNpFsNum(NP_FS_ACTIVE_KEY, 42);
  const inactive = readNpFsNum(NP_FS_INACTIVE_KEY, 30);
  const gap = readNpFsNum(NP_FS_GAP_KEY, 28);
  const letter = readNpFsNum(NP_FS_LETTER_KEY, 0);
  let font = 'jakarta';
  let italic = false;
  let align = 'center';
  try {
    font = localStorage.getItem(NP_FS_FONT_KEY) || 'jakarta';
    italic = localStorage.getItem(NP_FS_ITALIC_KEY) === '1';
    align = localStorage.getItem(NP_FS_ALIGN_KEY) || 'center';
  } catch (_) {}
  if (!Object.prototype.hasOwnProperty.call(LYRIC_FONT_FAMILIES, font)) font = 'jakarta';
  if (!['left', 'center', 'right'].includes(align)) align = 'center';

  const root = document.documentElement;
  root.style.setProperty('--np-fs-lyrics-active-size', `${active}px`);
  root.style.setProperty('--np-fs-lyrics-inactive-size', `${inactive}px`);
  root.style.setProperty('--np-fs-lyrics-line-gap', `${gap}px`);
  root.style.setProperty('--np-fs-lyrics-letter-spacing', `${letter}px`);
  root.style.setProperty('--np-fs-lyrics-font-family', (typeof LYRIC_FONT_FAMILIES !== 'undefined' && LYRIC_FONT_FAMILIES[font]) ? LYRIC_FONT_FAMILIES[font] : 'inherit');
  root.style.setProperty('--np-fs-lyrics-font-style', italic ? 'italic' : 'normal');
  root.style.setProperty('--np-fs-lyrics-align', align);
  document.body.dataset.npFsLyricsAlign = align;

  const setVal = (id, value) => {
    const el = document.getElementById(id);
    const out = document.getElementById(`${id}-value`);
    if (el) el.value = String(value);
    if (out) out.textContent = `${value}px`;
  };
  setVal('np-fs-active-size', active);
  setVal('np-fs-inactive-size', inactive);
  setVal('np-fs-line-gap', gap);
  setVal('np-fs-letter-spacing', letter);
  const fontSelect = document.getElementById('np-fs-font-family');
  if (fontSelect) fontSelect.value = font;
  const italicInput = document.getElementById('np-fs-italic');
  if (italicInput) italicInput.checked = italic;
  document.querySelectorAll('#np-fs-alignment [data-alignment]').forEach((btn) => {
    const on = btn.getAttribute('data-alignment') === align;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  document.body.classList.add('np-fs-lyrics-custom');
}

function bindNpFsSettings() {
  const coverSelect = document.getElementById('np-fs-cover-size');
  coverSelect?.addEventListener('change', () => applyNpFsCoverSize(coverSelect.value));

  const volumeSelect = document.getElementById('np-fs-volume-bar');
  volumeSelect?.addEventListener('change', () => {
    applyNpFsVolumeBarMode(volumeSelect.value);
    updateNpFsVinylVolumeConflicts();
  });

  const vinylInput = document.getElementById('np-fs-vinyl-enabled');
  vinylInput?.addEventListener('change', () => applyNpFsVinylEnabled(vinylInput.checked));

  const syncInput = document.getElementById('np-fs-sync-lyrics');
  syncInput?.addEventListener('change', () => applyNpFsSyncLyrics(syncInput.checked));

  const bindRange = (id, key, cssVar) => {
    const el = document.getElementById(id);
    if (!el) return;
    const out = document.getElementById(`${id}-value`);
    const apply = () => {
      const v = Number(el.value) || 0;
      if (out) out.textContent = `${v}px`;
      try { localStorage.setItem(key, String(v)); } catch (_) {}
      if (!isNpFsSyncLyrics()) {
        document.documentElement.style.setProperty(cssVar, `${v}px`);
        document.body.classList.add('np-fs-lyrics-custom');
      }
    };
    el.addEventListener('input', apply);
    el.addEventListener('change', apply);
  };
  bindRange('np-fs-active-size', NP_FS_ACTIVE_KEY, '--np-fs-lyrics-active-size');
  bindRange('np-fs-inactive-size', NP_FS_INACTIVE_KEY, '--np-fs-lyrics-inactive-size');
  bindRange('np-fs-line-gap', NP_FS_GAP_KEY, '--np-fs-lyrics-line-gap');
  bindRange('np-fs-letter-spacing', NP_FS_LETTER_KEY, '--np-fs-lyrics-letter-spacing');

  document.getElementById('np-fs-font-family')?.addEventListener('change', (e) => {
    const font = e.target.value;
    const selected = Object.prototype.hasOwnProperty.call(LYRIC_FONT_FAMILIES, font) ? font : 'jakarta';
    try { localStorage.setItem(NP_FS_FONT_KEY, selected); } catch (_) {}
    if (!isNpFsSyncLyrics()) {
      document.documentElement.style.setProperty('--np-fs-lyrics-font-family', LYRIC_FONT_FAMILIES[selected]);
      document.body.classList.add('np-fs-lyrics-custom');
    }
  });

  document.getElementById('np-fs-italic')?.addEventListener('change', (e) => {
    const on = Boolean(e.target.checked);
    try { localStorage.setItem(NP_FS_ITALIC_KEY, on ? '1' : '0'); } catch (_) {}
    if (!isNpFsSyncLyrics()) {
      document.documentElement.style.setProperty('--np-fs-lyrics-font-style', on ? 'italic' : 'normal');
      document.body.classList.add('np-fs-lyrics-custom');
    }
  });

  document.querySelectorAll('#np-fs-alignment [data-alignment]').forEach(btn => {
    btn.addEventListener('click', () => {
      const align = btn.dataset.alignment || 'center';
      document.querySelectorAll('#np-fs-alignment [data-alignment]').forEach(b => {
        const on = b === btn;
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('active', on);
      });
      try { localStorage.setItem(NP_FS_ALIGN_KEY, align); } catch (_) {}
      if (!isNpFsSyncLyrics()) {
        document.documentElement.style.setProperty('--np-fs-lyrics-align', align);
        document.body.dataset.npFsLyricsAlign = align;
        document.body.classList.add('np-fs-lyrics-custom');
      }
    });
  });
}

export function isNpFsVinylEnabled() {
  try { return localStorage.getItem(NP_FS_VINYL_KEY) === 'true'; } catch (_) { return false; }
}

function isVolumeRightConflict() {
  const mode = getNpFsVolumeBarMode();
  if (mode === 'right') return true;
  // auto no bloquea el switch de entrada; al resolver placement se evita "right"
  return false;
}

export function applyNpFsVinylEnabled(enabled) {
  let on = Boolean(enabled);
  if (on && isVolumeRightConflict()) on = false;
  try { localStorage.setItem(NP_FS_VINYL_KEY, on ? 'true' : 'false'); } catch (_) {}
  document.body.classList.toggle('np-fs-vinyl-enabled', on);
  const input = document.getElementById('np-fs-vinyl-enabled');
  if (input) input.checked = on;
  updateNpFsVinylVolumeConflicts();
  try {
    if (typeof window.__pnApplyNpFsVolumeBar === 'function') window.__pnApplyNpFsVolumeBar();
  } catch (_) {}
}

export function updateNpFsVinylVolumeConflicts() {
  const vinylOn = isNpFsVinylEnabled();
  const volRight = getNpFsVolumeBarMode() === 'right';
  const vinylRow = document.getElementById('np-fs-vinyl-setting-row');
  const vinylInput = document.getElementById('np-fs-vinyl-enabled');
  const hint = document.getElementById('np-fs-vinyl-conflict-hint');
  const volSelect = document.getElementById('np-fs-volume-bar');

  // Vinilo bloqueado si volumen está a la derecha
  const blockVinyl = volRight;
  if (vinylRow) vinylRow.classList.toggle('is-disabled', blockVinyl);
  if (vinylInput) {
    vinylInput.disabled = blockVinyl;
    if (blockVinyl && vinylInput.checked) {
      vinylInput.checked = false;
      try { localStorage.setItem(NP_FS_VINYL_KEY, 'false'); } catch (_) {}
      document.body.classList.remove('np-fs-vinyl-enabled');
    }
  }
  if (hint) hint.hidden = !blockVinyl;

  // Opción "right" del select bloqueada si vinilo activo
  if (volSelect) {
    const rightOpt = volSelect.querySelector('option[value="right"]');
    if (rightOpt) {
      rightOpt.disabled = vinylOn;
      rightOpt.textContent = vinylOn
        ? 'Vertical derecha (no disponible con vinilo)'
        : 'Vertical derecha';
    }
    if (vinylOn && volSelect.value === 'right') {
      applyNpFsVolumeBarMode('left');
    }
  }
}

function getNpFsVolumeBarMode() {
  try {
    const v = localStorage.getItem(NP_FS_VOLUME_KEY);
    if (['off', 'auto', 'left', 'right', 'bottom'].includes(v)) return v;
  } catch (_) {}
  return 'off';
}

function resolveNpFsVolumePlacement(mode) {
  const m = mode || getNpFsVolumeBarMode();
  if (m === 'off') return 'off';
  let placement = m;
  if (m === 'auto') {
    if (document.body.classList.contains('np-fs-centered')) placement = 'bottom';
    else if (document.body.classList.contains('np-fs-swapped')) placement = 'right';
    else placement = 'left';
  }
  // Con vinilo activo no usar derecha (el disco sobresale por ese lado)
  try {
    if ((placement === 'right') && (localStorage.getItem(NP_FS_VINYL_KEY) === 'true')) {
      placement = document.body.classList.contains('np-fs-centered') ? 'bottom' : 'left';
    }
  } catch (_) {}
  return placement;
}

function applyNpFsVolumeBarMode(mode) {
  const selected = ['off', 'auto', 'left', 'right', 'bottom'].includes(mode) ? mode : 'off';
  try { localStorage.setItem(NP_FS_VOLUME_KEY, selected); } catch (_) {}
  try { localStorage.setItem('pn_np_fs_volume_bar', selected); } catch (_) {}
  const select = document.getElementById('np-fs-volume-bar');
  if (select) select.value = selected;
  document.body.dataset.npFsVolume = selected;
  try {
    if (typeof window.__pnApplyNpFsVolumeBar === 'function') {
      window.__pnApplyNpFsVolumeBar();
    } else if (typeof applyNpFsVolumeBar === 'function') {
      applyNpFsVolumeBar();
    }
  } catch (err) {
    console.warn('applyNpFsVolumeBarMode', err);
  }
}

export function initNowPlayingFsSettings() {
  const adaptLyricsToggle = document.getElementById('np-fs-adapt-lyrics');
  if (adaptLyricsToggle) {
    adaptLyricsToggle.checked = localStorage.getItem('pn_now_playing_fs_adapt_lyrics') === 'true';
    adaptLyricsToggle.addEventListener('change', () => {
      localStorage.setItem('pn_now_playing_fs_adapt_lyrics', String(adaptLyricsToggle.checked));
      try {
        import('../ui/nowPlayingFs.js').then(m => m.syncNowPlayingFsLayoutForLyrics?.());
      } catch (_) {}
    });
  }

  applyNpFsCoverSize(getNpFsCoverSize());
  applyNpFsSyncLyrics(isNpFsSyncLyrics());
  if (!isNpFsSyncLyrics()) applyNpFsLyricsCustomFromStorage();
  else updateNpFsCustomPanelVisibility();
  applyNpFsVolumeBarMode(getNpFsVolumeBarMode());
  applyNpFsVinylEnabled(isNpFsVinylEnabled());
  updateNpFsVinylVolumeConflicts();
  try {
    if (!isNpFsSyncLyrics()) {
      document.body.dataset.npFsLyricsAlign = localStorage.getItem(NP_FS_ALIGN_KEY) || 'center';
    } else {
      document.body.dataset.npFsLyricsAlign = localStorage.getItem('pn_lyrics_alignment') || 'center';
    }
  } catch (_) {}
  bindNpFsSettings();
}
