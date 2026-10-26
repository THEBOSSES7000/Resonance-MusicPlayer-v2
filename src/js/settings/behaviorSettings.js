// Ajustes · Ajustes de comportamiento de la app.

import { readStoredBoolean } from './appearance.js';
import { getPlayCountThresholdPercent, setPlayCountThresholdPercent, setRepeatMode, setShuffleEnabled } from '../audioPlayer.js';
import { showConfirmDialog } from '../ui.js';

export function initBehaviorSettings() {
  const discordRpcToggle = document.getElementById('toggle-discord-rpc');
  if (discordRpcToggle) {
    if (localStorage.getItem('pn_discord_rpc_enabled') === null) {
      localStorage.setItem('pn_discord_rpc_enabled', 'false');
    }
    discordRpcToggle.checked = readStoredBoolean('pn_discord_rpc_enabled');
  }

  const startupViewSelect = document.getElementById('startup-view');
  if (startupViewSelect) {
    const savedStartupView = localStorage.getItem('pn_startup_view');
    startupViewSelect.value = savedStartupView === 'all-music' ? 'all-music' : 'home';
    startupViewSelect.addEventListener('change', () => {
      localStorage.setItem('pn_startup_view', startupViewSelect.value === 'all-music' ? 'all-music' : 'home');
    });
  }

  const searchPlayBehaviorSelect = document.getElementById('search-play-behavior');
  if (searchPlayBehaviorSelect) {
    const saved = localStorage.getItem('pn_search_play_behavior');
    searchPlayBehaviorSelect.value = saved === 'replace_queue' ? 'replace_queue' : 'replace_current';
    searchPlayBehaviorSelect.addEventListener('change', () => {
      const v = searchPlayBehaviorSelect.value === 'replace_queue' ? 'replace_queue' : 'replace_current';
      localStorage.setItem('pn_search_play_behavior', v);
    });
  }

  const restorePlaybackSessionInput = document.getElementById('restore-playback-session');
  if (restorePlaybackSessionInput) {
    restorePlaybackSessionInput.checked = localStorage.getItem('pn_restore_playback_session') !== 'false';
    restorePlaybackSessionInput.addEventListener('change', () => {
      localStorage.setItem('pn_restore_playback_session', String(restorePlaybackSessionInput.checked));
    });
  }

  const prevDirectInput = document.getElementById('behavior-prev-direct');
  if (prevDirectInput) {
    prevDirectInput.checked = readStoredBoolean('pn_behavior_prev_direct');
    prevDirectInput.addEventListener('change', () => {
      localStorage.setItem('pn_behavior_prev_direct', String(prevDirectInput.checked));
    });
  }

  const nextWhilePausedInput = document.getElementById('behavior-next-while-paused');
  if (nextWhilePausedInput) {
    nextWhilePausedInput.checked = readStoredBoolean('pn_behavior_next_while_paused');
    nextWhilePausedInput.addEventListener('change', () => {
      localStorage.setItem('pn_behavior_next_while_paused', String(nextWhilePausedInput.checked));
    });
  }

  const sortPersistSelect = document.getElementById('behavior-sort-persist-mode');
  if (sortPersistSelect) {
    const allowed = new Set(['none', 'global', 'per_view', 'per_item']);
    const stored = localStorage.getItem('pn_sort_persist_mode') || 'global';
    sortPersistSelect.value = allowed.has(stored) ? stored : 'global';
    sortPersistSelect.addEventListener('change', () => {
      const value = allowed.has(sortPersistSelect.value) ? sortPersistSelect.value : 'global';
      localStorage.setItem('pn_sort_persist_mode', value);
      window.dispatchEvent(new CustomEvent('pn-sort-persist-mode-changed', { detail: { mode: value } }));
    });
  }

  const keepShuffleInput = document.getElementById('playback-keep-shuffle');
  if (keepShuffleInput) {
    keepShuffleInput.checked = readStoredBoolean('pn_keep_shuffle');
    keepShuffleInput.addEventListener('change', () => {
      const enabled = keepShuffleInput.checked;
      localStorage.setItem('pn_keep_shuffle', String(enabled));
      setShuffleEnabled(enabled);
    });
  }

  const playbackContinuousInput = document.getElementById('playback-continuous');
  if (playbackContinuousInput) {
    playbackContinuousInput.checked = localStorage.getItem('pn_playback_continuous') !== 'false';
    playbackContinuousInput.addEventListener('change', () => {
      localStorage.setItem('pn_playback_continuous', String(playbackContinuousInput.checked));
    });
  }

  const playCountThreshold = document.getElementById('play-count-threshold');
  const playCountThresholdValue = document.getElementById('play-count-threshold-value');
  if (playCountThreshold) {
    const value = getPlayCountThresholdPercent();
    playCountThreshold.value = String(value);
    if (playCountThresholdValue) playCountThresholdValue.value = `${value}%`;
    playCountThreshold.addEventListener('input', () => {
      const p = setPlayCountThresholdPercent(playCountThreshold.value);
      if (playCountThresholdValue) playCountThresholdValue.value = `${p}%`;
    });
  }

  const keepRepeatInput = document.getElementById('playback-keep-repeat');
  if (keepRepeatInput) {
    keepRepeatInput.checked = readStoredBoolean('pn_keep_repeat');
    keepRepeatInput.addEventListener('change', () => {
      const enabled = keepRepeatInput.checked;
      localStorage.setItem('pn_keep_repeat', String(enabled));
      setRepeatMode(enabled ? 'all' : 'off');
    });
  }

  const minimizeToTrayInput = document.getElementById('minimize-to-tray');
  if (minimizeToTrayInput) {
    minimizeToTrayInput.checked = readStoredBoolean('pn_minimize_to_tray');
    minimizeToTrayInput.addEventListener('change', async () => {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) {
        minimizeToTrayInput.checked = false;
        await showConfirmDialog({
          title: 'Bandeja del sistema no disponible',
          message: 'Esta función solo está disponible en la aplicación de escritorio.',
          confirmText: 'Entendido',
          showCancel: false
        });
        return;
      }
      const enabled = minimizeToTrayInput.checked;
      try {
        await invoke('set_minimize_to_tray', { enabled });
        localStorage.setItem('pn_minimize_to_tray', String(enabled));
      } catch (error) {
        console.error('No se pudo cambiar la opción de bandeja del sistema:', error);
        minimizeToTrayInput.checked = !enabled;
        await showConfirmDialog({
          title: 'No se pudo actualizar la bandeja',
          message: 'No se pudo aplicar el ajuste de minimizar a la bandeja del sistema.',
          confirmText: 'Entendido',
          showCancel: false
        });
      }
    });
  }
}
