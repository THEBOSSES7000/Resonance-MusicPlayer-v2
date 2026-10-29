// Letras · Inicialización de las funciones de letras.

import { initShootingStars } from '../../visual_plus/engine.js';
import { configureAudioAnalysis, getAudioLevel } from '../audioPlayer.js';
import * as webAudioModule from '../audio/webAudio.js';

const getFrequencySpectrum = typeof webAudioModule.getFrequencySpectrum === 'function'
  ? webAudioModule.getFrequencySpectrum
  : (binCount = 64) => new Float32Array(Math.max(8, binCount | 0));

import { initLiquidGradientBackground } from '../../visual_plus/blurred_background.js';
import { initLiquidImmersiveBackground } from '../../visual_plus/liquid_background.js';
import { handleLyricsTranslationSettingsChanged, handleLyricsViewUpdated, toggleLyricsTranslation, updateLyricsTranslationControls } from './translation.js';
import { lyricsVars } from './sharedState.js';
import { markLyricsPointerMovement, updateLyricsResyncVisibility } from './scrollResync.js';
import { getUi } from './uiBridge.js';
import { applyLyricsToSong, closeLyricsSearch, lyricsResults, lyricsTargetSong, searchLyricsNow, setLyricsSearchFilter, setLyricsProviderFilter, setLyricsStatus } from './lyricsSearch.js';
import { closeTrackEditor, handleCoverFileSelect, renderEditCoverPreview } from './trackEditor.js';
import { saveTrackEdits } from './saveTrackEdits.js';

export function initLyricsFeatures() {
  initShootingStars(getAudioLevel, configureAudioAnalysis, getFrequencySpectrum);
  try { initLiquidGradientBackground(); } catch (_) {}
  try { initLiquidImmersiveBackground(); } catch (_) {}
  document.getElementById('track-edit-more-toggle')?.addEventListener('click', event => {
    const button = event.currentTarget;
    const fields = document.getElementById('track-edit-more-fields');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    fields.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.innerHTML = expanded
      ? '<i class="ph ph-caret-up"></i> Mostrar menos'
      : '<i class="ph ph-caret-down"></i> Mostrar más';
  });
  document.addEventListener('pn-lyrics-view-updated', handleLyricsViewUpdated);
  document.addEventListener('pn-lyrics-translation-settings-changed', handleLyricsTranslationSettingsChanged);
  document.addEventListener('pn-lyrics-auto-scroll-changed', event => {
    lyricsVars.lyricsAutoScrollEnabled = event.detail.enabled;
    updateLyricsResyncVisibility();
  });
  document.getElementById('lyrics-translation-toggle')?.addEventListener('click', toggleLyricsTranslation);
  document.getElementById('lyrics-resync')?.addEventListener('click', () => {
    void getUi().then(ui => ui.resumeLyricsAutoScrollAtActiveLine());
  });
  const lyricsOverlay = document.getElementById('lyrics-overlay');
  lyricsOverlay?.addEventListener('mousemove', markLyricsPointerMovement, { passive: true });
  lyricsOverlay?.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch') markLyricsPointerMovement();
  }, { passive: true });
  lyricsOverlay?.addEventListener('pointerleave', () => {
    lyricsVars.lyricsPointerRecentlyMoved = false;
    if (lyricsVars.lyricsPointerIdleTimer !== null) {
      window.clearTimeout(lyricsVars.lyricsPointerIdleTimer);
      lyricsVars.lyricsPointerIdleTimer = null;
    }
    updateLyricsResyncVisibility();
  });
  const lyricsScrollContainer = document.getElementById('lyrics-scroll-container');
  lyricsScrollContainer?.addEventListener('wheel', () => {
    void getUi().then(ui => ui.suspendLyricsAutoScroll());
  }, { passive: true });
  lyricsScrollContainer?.addEventListener('touchmove', () => {
    void getUi().then(ui => ui.suspendLyricsAutoScroll());
  }, { passive: true });
  lyricsScrollContainer?.addEventListener('pointerdown', event => {
    const bounds = lyricsScrollContainer.getBoundingClientRect();
    if (event.clientX >= bounds.right - 24) {
      void getUi().then(ui => ui.suspendLyricsAutoScroll());
    }
  });
  document.addEventListener('keydown', event => {
    if (!document.getElementById('lyrics-overlay')?.classList.contains('open') ||
        !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.target?.isContentEditable) return;
    void getUi().then(ui => ui.suspendLyricsAutoScroll());
  });
  updateLyricsTranslationControls(false);

  document.getElementById('lyrics-search-close')?.addEventListener('click', closeLyricsSearch);
  function closeLyricsFilterMenus(exceptId = null) {
    const pairs = [
      ['lyrics-search-filter-menu', 'lyrics-search-filter-toggle'],
      ['lyrics-search-provider-menu', 'lyrics-search-provider-toggle'],
    ];
    for (const [menuId, toggleId] of pairs) {
      if (exceptId && menuId === exceptId) continue;
      const menu = document.getElementById(menuId);
      const toggle = document.getElementById(toggleId);
      if (menu) menu.hidden = true;
      toggle?.setAttribute('aria-expanded', 'false');
    }
  }

  document.getElementById('lyrics-search-modal')?.addEventListener('click', event => {
    if (event.target.id === 'lyrics-search-modal') closeLyricsSearch();
    if (!event.target.closest('.lyrics-search-filter')) {
      closeLyricsFilterMenus();
    }
  });

  document.getElementById('lyrics-search-filter-toggle')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = document.getElementById('lyrics-search-filter-menu');
    const toggle = document.getElementById('lyrics-search-filter-toggle');
    if (!menu || !toggle) return;
    const willOpen = menu.hidden;
    closeLyricsFilterMenus();
    if (willOpen) {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  document.getElementById('lyrics-search-provider-toggle')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = document.getElementById('lyrics-search-provider-menu');
    const toggle = document.getElementById('lyrics-search-provider-toggle');
    if (!menu || !toggle) return;
    const willOpen = menu.hidden;
    closeLyricsFilterMenus();
    if (willOpen) {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
  });

  document.getElementById('lyrics-search-filter-menu')?.addEventListener('click', event => {
    const typeOpt = event.target.closest('[data-lyrics-filter]');
    if (typeOpt) setLyricsSearchFilter(typeOpt.dataset.lyricsFilter);
  });

  document.getElementById('lyrics-search-provider-menu')?.addEventListener('click', event => {
    const provOpt = event.target.closest('[data-lyrics-provider]');
    if (provOpt) setLyricsProviderFilter(provOpt.dataset.lyricsProvider);
  });
  document.getElementById('lyrics-search-btn')?.addEventListener('click', () => void searchLyricsNow());
  document.getElementById('track-edit-close')?.addEventListener('click', closeTrackEditor);
  document.getElementById('track-edit-modal')?.addEventListener('click', event => {
    if (event.target.id === 'track-edit-modal') closeTrackEditor();
  });
  document.getElementById('track-edit-save')?.addEventListener('click', () => void saveTrackEdits());
  document.getElementById('track-edit-cover-pick')?.addEventListener('click', () => {
    document.getElementById('track-edit-cover-input')?.click();
  });
  document.getElementById('track-edit-cover-input')?.addEventListener('change', event => {
    handleCoverFileSelect(event.target.files?.[0]);
    event.target.value = '';
  });
  document.getElementById('btn-track-edit-cover-remove')?.addEventListener('click', () => {
    lyricsVars.editCoverDataUrl = null;
    lyricsVars.editCoverRemove = true;
    renderEditCoverPreview();
  });
  document.getElementById('lyrics-search-results')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || !lyricsTargetSong) return;
    const item = lyricsResults[Number(button.dataset.index)];
    if (!item) return;
    const raw = item.syncedLyrics || item.plainLyrics || '';
    if (button.dataset.action === 'copy') {
      try {
        await navigator.clipboard.writeText(raw || 'Sin letra disponible');
        setLyricsStatus('Letra copiada al portapapeles.');
      } catch {
        setLyricsStatus('No se pudo copiar al portapapeles.', true);
      }
      return;
    }
    if (button.dataset.action === 'apply') {
      if (!raw.trim()) {
        setLyricsStatus('Ese resultado no trae letra.', true);
        return;
      }
      const ok = await applyLyricsToSong(lyricsTargetSong, raw, item.providerLabel || item.provider || 'proveedor');
      if (ok) setLyricsStatus('Letra aplicada a la pista.');
    }
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('lyrics-search-modal')?.classList.contains('open')) closeLyricsSearch();
    if (document.getElementById('track-edit-modal')?.classList.contains('open')) closeTrackEditor();
  });
}
