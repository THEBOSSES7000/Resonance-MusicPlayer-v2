// Ajustes · Ajustes de audio: dispositivo de salida, crossfade, fades, volumen y ecualizador.

import { audioDeviceSelect, audioDeviceStatus } from './dom.js';
import { audio, configureEqualizer, listNativeOutputDevices, setAudioOutputDevice, setCrossfadeIndicatorEnabled, setCrossfadeSettings, setPauseFadeSettings, setPlaybackFadeSettings, setReplayGainEnabled } from '../audioPlayer.js';
import { EQUALIZER_FREQUENCIES, EQUALIZER_INPUT_IDS, applyEqualizerGains, buildEqualizerGraphic, loadUserEqPresets, readEqualizerGains, saveUserEqPresets } from './equalizer.js';
import { readStoredBoolean, readStoredDuration } from './appearance.js';
import { initReplayGainScanner } from './replayGainSettings.js';

let currentOutputDeviceId = '';

const z20 = () => Array(20).fill(0);

const EQUALIZER_PRESETS = {
  flat: z20(),
  rock: [5, 4, 3, 1, -1, -2, -1, 0, 1, 2, 2, 3, 3, 4, 4, 4, 3, 3, 2, 1],
  pop: [-1, 0, 1, 2, 3, 3, 2, 1, 0, 1, 2, 2, 1, 0, -1, 0, 1, 1, 0, -1],
  jazz: [3, 3, 2, 1, 1, 0, 1, 2, 1, 0, -1, 0, 1, 2, 2, 2, 2, 2, 2, 1],
  classical: [4, 3, 2, 2, 1, 0, 0, -1, -1, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 1],
  vocal: [-2, -2, -1, 0, 1, 2, 3, 4, 4, 3, 2, 2, 3, 2, 1, 0, 0, -1, -1, -2],
  bass: [7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};

const EQUALIZER_BUILTIN_LABELS = {
  flat: 'Plano',
  rock: 'Rock',
  pop: 'Pop',
  jazz: 'Jazz',
  classical: 'Clásica',
  vocal: 'Voces',
  bass: 'Refuerzo de graves'
};

export async function refreshAudioOutputDevices() {
  if (!audioDeviceSelect || !audioDeviceStatus) return;

  try {
    // Preferir enumeración nativa (WASAPI / cpal) — independiente del WebView
    let outputs = await listNativeOutputDevices();
    if (!outputs.length && navigator.mediaDevices?.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      outputs = devices
        .filter(device => device.kind === 'audiooutput' && device.deviceId)
        .map((device, index) => ({
          id: device.deviceId,
          name: device.label || `Dispositivo de salida ${index + 1}`,
          isDefault: false
        }));
    }

    const savedDeviceId = localStorage.getItem('pn_audio_output_device') || '';
    audioDeviceSelect.replaceChildren(new Option('Sistema predeterminado', ''));
    outputs.forEach(device => {
      const label = device.isDefault ? `${device.name} (predeterminado)` : device.name;
      audioDeviceSelect.add(new Option(label, device.id));
    });

    const selectionIsAvailable = outputs.some(device => device.id === savedDeviceId);
    const selectedDeviceId = selectionIsAvailable ? savedDeviceId : '';
    audioDeviceSelect.value = selectedDeviceId;
    if (currentOutputDeviceId !== selectedDeviceId) {
      await setAudioOutputDevice(selectedDeviceId);
      currentOutputDeviceId = selectedDeviceId;
    }
    if (savedDeviceId && !selectionIsAvailable) {
      localStorage.removeItem('pn_audio_output_device');
    }
    audioDeviceSelect.disabled = false;
    audioDeviceStatus.textContent = outputs.length === 0
      ? 'No se encontraron dispositivos; se usa el predeterminado del sistema (WASAPI compartido).'
      : 'Salida nativa WASAPI en modo compartido: el resto del sistema sigue sonando. «Sistema predeterminado» restaura la salida de Windows.';
  } catch (error) {
    console.error('No se pudieron cargar los dispositivos de salida:', error);
    audioDeviceSelect.disabled = true;
    audioDeviceStatus.textContent = 'No se pudieron cargar los dispositivos; se mantiene la salida actual.';
  }
}

export function initAudioSettings() {
  audioDeviceSelect?.addEventListener('change', async () => {
    if (typeof audio.setSinkId !== 'function') return;
    const requestedDeviceId = audioDeviceSelect.value;
    audioDeviceSelect.disabled = true;
    audioDeviceStatus.textContent = 'Cambiando dispositivo de salida...';
    try {
      await setAudioOutputDevice(requestedDeviceId);
      currentOutputDeviceId = requestedDeviceId;
      if (requestedDeviceId) localStorage.setItem('pn_audio_output_device', requestedDeviceId);
      else localStorage.removeItem('pn_audio_output_device');
      audioDeviceStatus.textContent = 'Dispositivo de salida actualizado.';
    } catch (error) {
      console.error('No se pudo cambiar el dispositivo de salida:', error);
      audioDeviceStatus.textContent = 'No se pudo cambiar la salida; se conserva el dispositivo anterior.';
      audioDeviceSelect.value = currentOutputDeviceId;
    } finally {
      audioDeviceSelect.disabled = false;
    }
  });

  navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioOutputDevices);

  const equalizerEnabled = document.getElementById('audio-equalizer-enabled');
  const equalizerPreset = document.getElementById('audio-equalizer-preset');
  const equalizerControls = document.getElementById('audio-equalizer-controls');
  const eqAddBtn = document.getElementById('audio-equalizer-preset-add');
  const eqRenameBtn = document.getElementById('audio-equalizer-preset-rename');
  const eqDeleteBtn = document.getElementById('audio-equalizer-preset-delete');
  buildEqualizerGraphic();

  let userEqPresets = loadUserEqPresets();
  const storedGains = EQUALIZER_FREQUENCIES.map((_, index) => {
    const value = Number(localStorage.getItem(`pn_audio_eq_${index}`));
    return Number.isFinite(value) ? Math.max(-15, Math.min(15, value)) : 0;
  });
  let customGains = EQUALIZER_FREQUENCIES.map((_, index) => {
    const customValue = localStorage.getItem(`pn_audio_eq_custom_${index}`);
    const value = Number(customValue);
    return Number.isFinite(value) ? Math.max(-15, Math.min(15, value)) : storedGains[index];
  });

  const refreshPresetSelect = (selectValue) => {
    if (!equalizerPreset) return;
    equalizerPreset.replaceChildren();
    Object.entries(EQUALIZER_BUILTIN_LABELS).forEach(([key, label]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      equalizerPreset.appendChild(opt);
    });
    userEqPresets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = `user:${p.id}`;
      opt.textContent = p.name;
      equalizerPreset.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Personalizado';
    equalizerPreset.appendChild(customOpt);
    const wanted = selectValue || localStorage.getItem('pn_audio_eq_preset') || 'flat';
    const exists = [...equalizerPreset.options].some(o => o.value === wanted);
    equalizerPreset.value = exists ? wanted : 'flat';
    const isUser = equalizerPreset.value.startsWith('user:');
    if (eqDeleteBtn) eqDeleteBtn.hidden = !isUser;
    if (eqRenameBtn) eqRenameBtn.disabled = !isUser;
  };

  const gainsForPresetKey = key => {
    if (EQUALIZER_PRESETS[key]) return EQUALIZER_PRESETS[key].slice();
    if (key === 'custom') return customGains.slice();
    if (key.startsWith('user:')) {
      const id = key.slice(5);
      const found = userEqPresets.find(p => p.id === id);
      return found ? found.gains.slice() : z20();
    }
    return z20();
  };

  refreshPresetSelect();
  applyEqualizerGains(gainsForPresetKey(equalizerPreset?.value || 'flat'));

  const applyEqualizer = async () => {
    const gains = readEqualizerGains();
    gains.forEach((gain, index) => localStorage.setItem(`pn_audio_eq_${index}`, String(gain)));
    try {
      await configureEqualizer(Boolean(equalizerEnabled?.checked), gains);
    } catch (error) {
      console.error('No se pudo aplicar el ecualizador:', error);
    }
  };

  const equalizerDependent = document.getElementById('equalizer-dependent-options');
  const syncEqualizerDependentUi = () => {
    const on = Boolean(equalizerEnabled?.checked);
    if (equalizerDependent) equalizerDependent.hidden = !on;
    if (equalizerControls) {
      equalizerControls.classList.toggle('is-disabled', !on);
      equalizerControls.querySelectorAll('input[type="range"]').forEach(input => {
        input.disabled = !on;
      });
    }
  };
  if (equalizerEnabled && equalizerControls) {
    equalizerEnabled.checked = readStoredBoolean('pn_audio_eq_enabled');
    syncEqualizerDependentUi();
    equalizerEnabled.addEventListener('change', async () => {
      localStorage.setItem('pn_audio_eq_enabled', String(equalizerEnabled.checked));
      syncEqualizerDependentUi();
      await applyEqualizer();
    });

    EQUALIZER_INPUT_IDS.forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        const gains = readEqualizerGains();
        applyEqualizerGains(gains);
        customGains = gains.slice();
        gains.forEach((gain, index) => {
          localStorage.setItem(`pn_audio_eq_custom_${index}`, String(gain));
        });
        if (equalizerPreset) equalizerPreset.value = 'custom';
        localStorage.setItem('pn_audio_eq_preset', 'custom');
        if (eqDeleteBtn) eqDeleteBtn.hidden = true;
        if (eqRenameBtn) eqRenameBtn.disabled = true;
        void applyEqualizer();
      });
    });

    equalizerPreset?.addEventListener('change', () => {
      const preset = equalizerPreset.value;
      localStorage.setItem('pn_audio_eq_preset', preset);
      applyEqualizerGains(gainsForPresetKey(preset));
      const isUser = preset.startsWith('user:');
      if (eqDeleteBtn) eqDeleteBtn.hidden = !isUser;
      if (eqRenameBtn) eqRenameBtn.disabled = !isUser;
      void applyEqualizer();
    });

    eqAddBtn?.addEventListener('click', () => {
      const baseName = equalizerPreset?.selectedOptions?.[0]?.textContent || 'Perfil';
      const name = window.prompt('Nombre del nuevo perfil', `${baseName} (copia)`);
      if (!name || !name.trim()) return;
      const id = `p${Date.now().toString(36)}`;
      const gains = readEqualizerGains();
      userEqPresets.push({ id, name: name.trim().slice(0, 48), gains: gains.slice() });
      saveUserEqPresets(userEqPresets);
      const key = `user:${id}`;
      localStorage.setItem('pn_audio_eq_preset', key);
      refreshPresetSelect(key);
      applyEqualizerGains(gains);
      void applyEqualizer();
    });

    eqRenameBtn?.addEventListener('click', () => {
      const key = equalizerPreset?.value || '';
      if (!key.startsWith('user:')) return;
      const id = key.slice(5);
      const preset = userEqPresets.find(p => p.id === id);
      if (!preset) return;
      const name = window.prompt('Nuevo nombre del perfil', preset.name);
      if (!name || !name.trim()) return;
      preset.name = name.trim().slice(0, 48);
      saveUserEqPresets(userEqPresets);
      refreshPresetSelect(key);
    });

    eqDeleteBtn?.addEventListener('click', () => {
      const key = equalizerPreset?.value || '';
      if (!key.startsWith('user:')) return;
      const id = key.slice(5);
      if (!window.confirm('¿Eliminar este perfil personalizado?')) return;
      userEqPresets = userEqPresets.filter(p => p.id !== id);
      saveUserEqPresets(userEqPresets);
      localStorage.setItem('pn_audio_eq_preset', 'custom');
      refreshPresetSelect('custom');
      applyEqualizerGains(customGains);
      void applyEqualizer();
    });

    // Restaurar último preset/gains en UI y motor aunque el EQ esté desactivado
    void applyEqualizer();
  }

  const replayGainEnabled = document.getElementById('audio-replaygain-enabled');
  const replayGainDependent = document.getElementById('replaygain-dependent-options');
  if (replayGainEnabled) {
    replayGainEnabled.checked = readStoredBoolean('pn_audio_replaygain_enabled');
    if (replayGainDependent) replayGainDependent.hidden = !replayGainEnabled.checked;
    setReplayGainEnabled(replayGainEnabled.checked);
    replayGainEnabled.addEventListener('change', () => {
      localStorage.setItem('pn_audio_replaygain_enabled', String(replayGainEnabled.checked));
      if (replayGainDependent) replayGainDependent.hidden = !replayGainEnabled.checked;
      setReplayGainEnabled(replayGainEnabled.checked);
    });
  }

  initReplayGainScanner();

  const crossfadeEnabled = document.getElementById('audio-crossfade-enabled');
  const crossfadeDependent = document.getElementById('crossfade-dependent-options');
  const crossfadeDuration = document.getElementById('audio-crossfade-duration');
  const crossfadeOutput = document.getElementById('audio-crossfade-duration-value');
  const crossfadeAutomaticOnly = document.getElementById('audio-crossfade-natural-only');
  const crossfadeIndicatorEnabled = document.getElementById('audio-crossfade-indicator-enabled');
  const crossfadeIndicatorSetting = document.getElementById('crossfade-indicator-setting');
  const crossfadeIndicatorSwitch = document.getElementById('crossfade-indicator-switch');
  const syncCrossfadeIndicatorAvailability = () => {
    /* Las opciones viven en #crossfade-dependent-options (hidden si crossfade off) */
    if (crossfadeIndicatorEnabled) crossfadeIndicatorEnabled.disabled = false;
    crossfadeIndicatorSetting?.classList.remove('is-disabled');
    crossfadeIndicatorSwitch?.classList.remove('is-disabled');
    crossfadeIndicatorSetting?.removeAttribute('aria-disabled');
  };
  if (crossfadeIndicatorEnabled) {
    crossfadeIndicatorEnabled.checked = readStoredBoolean('pn_audio_crossfade_indicator_enabled', true);
    setCrossfadeIndicatorEnabled(crossfadeIndicatorEnabled.checked);
    crossfadeIndicatorEnabled.addEventListener('change', () => {
      if (crossfadeIndicatorEnabled.disabled) return;
      localStorage.setItem('pn_audio_crossfade_indicator_enabled', String(crossfadeIndicatorEnabled.checked));
      setCrossfadeIndicatorEnabled(crossfadeIndicatorEnabled.checked);
    });
  }
  if (crossfadeEnabled && crossfadeDuration) {
    crossfadeEnabled.checked = readStoredBoolean('pn_audio_crossfade_enabled');
    crossfadeDuration.value = String(readStoredDuration('pn_audio_crossfade_duration', 4, 1, 12));
    if (crossfadeAutomaticOnly) {
      crossfadeAutomaticOnly.checked = readStoredBoolean('pn_audio_crossfade_natural_only');
      crossfadeAutomaticOnly.disabled = !crossfadeEnabled.checked;
    }
    const applyCrossfade = () => {
      const duration = Number(crossfadeDuration.value);
      if (crossfadeOutput) crossfadeOutput.value = `${duration} s`;
      localStorage.setItem('pn_audio_crossfade_duration', String(duration));
      if (crossfadeDependent) crossfadeDependent.hidden = !crossfadeEnabled.checked;
      if (crossfadeAutomaticOnly) {
        crossfadeAutomaticOnly.disabled = false;
        localStorage.setItem('pn_audio_crossfade_natural_only', String(crossfadeAutomaticOnly.checked));
      }
      setCrossfadeSettings(crossfadeEnabled.checked, duration, crossfadeAutomaticOnly?.checked);
      syncCrossfadeIndicatorAvailability();
    };
    crossfadeEnabled.addEventListener('change', () => {
      localStorage.setItem('pn_audio_crossfade_enabled', String(crossfadeEnabled.checked));
      applyCrossfade();
    });
    crossfadeDuration.addEventListener('input', applyCrossfade);
    crossfadeAutomaticOnly?.addEventListener('change', applyCrossfade);
    applyCrossfade();
  }

  const fadeInEnabled = document.getElementById('playback-fade-in-enabled');
  const fadeInDuration = document.getElementById('playback-fade-in-duration');
  const fadeInOutput = document.getElementById('playback-fade-in-duration-value');
  const fadeOutEnabled = document.getElementById('playback-fade-out-enabled');
  const fadeOutDuration = document.getElementById('playback-fade-out-duration');
  const fadeOutOutput = document.getElementById('playback-fade-out-duration-value');
  if (fadeInEnabled && fadeInDuration && fadeOutEnabled && fadeOutDuration) {
    const legacyEnabled = readStoredBoolean('pn_playback_fade_enabled');
    const legacyDuration = readStoredDuration('pn_playback_fade_duration', 2, 1, 5);
    fadeInEnabled.checked = readStoredBoolean('pn_playback_fade_in_enabled', legacyEnabled);
    fadeOutEnabled.checked = readStoredBoolean('pn_playback_fade_out_enabled', legacyEnabled);
    fadeInDuration.value = String(readStoredDuration('pn_playback_fade_in_duration', legacyDuration, 1, 5));
    fadeOutDuration.value = String(readStoredDuration('pn_playback_fade_out_duration', legacyDuration, 1, 5));
    const fadeInOptions = document.getElementById('playback-fade-in-options');
    const fadeOutOptions = document.getElementById('playback-fade-out-options');
    const applyPlaybackFades = () => {
      const fadeInSeconds = Number(fadeInDuration.value);
      const fadeOutSeconds = Number(fadeOutDuration.value);
      if (fadeInOutput) fadeInOutput.value = `${fadeInSeconds} s`;
      if (fadeOutOutput) fadeOutOutput.value = `${fadeOutSeconds} s`;
      if (fadeInOptions) fadeInOptions.hidden = !fadeInEnabled.checked;
      if (fadeOutOptions) fadeOutOptions.hidden = !fadeOutEnabled.checked;
      localStorage.setItem('pn_playback_fade_in_enabled', String(fadeInEnabled.checked));
      localStorage.setItem('pn_playback_fade_out_enabled', String(fadeOutEnabled.checked));
      localStorage.setItem('pn_playback_fade_in_duration', String(fadeInSeconds));
      localStorage.setItem('pn_playback_fade_out_duration', String(fadeOutSeconds));
      setPlaybackFadeSettings(fadeInEnabled.checked, fadeInSeconds, fadeOutEnabled.checked, fadeOutSeconds);
    };
    fadeInEnabled.addEventListener('change', applyPlaybackFades);
    fadeOutEnabled.addEventListener('change', applyPlaybackFades);
    fadeInDuration.addEventListener('input', applyPlaybackFades);
    fadeOutDuration.addEventListener('input', applyPlaybackFades);
    applyPlaybackFades();
  }

  const pauseFadeEnabled = document.getElementById('playback-pause-fade-enabled');
  const pauseFadeOutDuration = document.getElementById('playback-pause-fade-out-duration');
  const pauseFadeInDuration = document.getElementById('playback-pause-fade-in-duration');
  const pauseFadeOutOutput = document.getElementById('playback-pause-fade-out-duration-value');
  const pauseFadeInOutput = document.getElementById('playback-pause-fade-in-duration-value');
  const pauseFadeOptions = document.getElementById('playback-pause-fade-options');
  if (pauseFadeEnabled && pauseFadeOutDuration && pauseFadeInDuration) {
    pauseFadeEnabled.checked = readStoredBoolean('pn_playback_pause_fade_enabled', false);
    pauseFadeOutDuration.value = String(readStoredDuration('pn_playback_pause_fade_out_duration', 1, 0.5, 5));
    pauseFadeInDuration.value = String(readStoredDuration('pn_playback_pause_fade_in_duration', 1, 0.5, 5));
    const applyPauseFade = () => {
      const outSecs = Number(pauseFadeOutDuration.value);
      const inSecs = Number(pauseFadeInDuration.value);
      if (pauseFadeOutOutput) pauseFadeOutOutput.value = `${outSecs} s`;
      if (pauseFadeInOutput) pauseFadeInOutput.value = `${inSecs} s`;
      if (pauseFadeOptions) pauseFadeOptions.hidden = !pauseFadeEnabled.checked;
      localStorage.setItem('pn_playback_pause_fade_enabled', String(pauseFadeEnabled.checked));
      localStorage.setItem('pn_playback_pause_fade_out_duration', String(outSecs));
      localStorage.setItem('pn_playback_pause_fade_in_duration', String(inSecs));
      setPauseFadeSettings(pauseFadeEnabled.checked, inSecs, outSecs);
    };
    pauseFadeEnabled.addEventListener('change', applyPauseFade);
    pauseFadeOutDuration.addEventListener('input', applyPauseFade);
    pauseFadeInDuration.addEventListener('input', applyPauseFade);
    applyPauseFade();
  }
}
