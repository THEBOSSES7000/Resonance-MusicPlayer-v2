// Ajustes · Inicialización de todos los ajustes (initSettings).

import { initNowPlayingFsSettings } from './nowPlayingFsSettings.js';
import { initAppearanceSettings } from './appearance.js';
import { initAudioSettings, refreshAudioOutputDevices } from './audioSettings.js';
import { initBehaviorSettings } from './behaviorSettings.js';
import { initVisualPlusSettings } from './visualPlusSettings.js';
import { initPerformanceSettings } from './performanceSettings.js';
import { initSettingTooltips } from './tooltips.js';
import { initLibrarySettings } from './librarySettings.js';
import { settingsOverlay } from './dom.js';
import { state } from '../state.js';
import { closeLyricsView, toggleExpandedCover } from '../ui.js';

let restoreExpandedCoverAfterSettings = false;

export function initSettings() {
  try { initNowPlayingFsSettings(); } catch (error) {
    console.error('Fallo en ajustes de pantalla completa:', error);
  }
  initAppearanceSettings();
  initAudioSettings();
  initBehaviorSettings();
  initVisualPlusSettings();
  initPerformanceSettings();
  initSettingTooltips();
  initLibrarySettings();

  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    if (settingsOverlay.classList.contains('open')) return;
    restoreExpandedCoverAfterSettings = state.isCoverExpanded;
    if (restoreExpandedCoverAfterSettings) toggleExpandedCover(false);
    try { closeLyricsView(); } catch (_) {}
    settingsOverlay.classList.add('open');
    document.body.classList.add('settings-overlay-open');
    document.getElementById('custom-context-menu')?.classList.remove('open');
    document.getElementById('discord-rpc-context-menu')?.classList.remove('open');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    if (!settingsOverlay.classList.contains('open')) return;
    settingsOverlay.classList.remove('open');
    document.body.classList.remove('settings-overlay-open');
    if (restoreExpandedCoverAfterSettings) toggleExpandedCover(true);
    restoreExpandedCoverAfterSettings = false;
  });

  document.getElementById('btn-add-directory').addEventListener('click', () => {
    if (window.__TAURI__?.core?.invoke) {
      window.dispatchEvent(new Event('pn-add-native-music-directory'));
      return;
    }
    document.getElementById('native-folder-input').click();
  });

  const tabBtns = document.querySelectorAll('.settings-tab-btn');
  const tabContents = document.querySelectorAll('.settings-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetContent = document.getElementById(target);
      if (!targetContent) {
        console.error(`No existe el contenido de configuración para la pestaña "${target}".`);
        return;
      }
      targetContent.classList.add('active');
      if (target === 'tab-audio') void refreshAudioOutputDevices();
    });
  });
}
