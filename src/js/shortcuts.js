import { state } from './state.js';
import {
  nextSong,
  prevSong,
  setAppVolume,
  setRepeatMode,
  setShuffleEnabled,
  seekBy,
  togglePlay
} from './audioPlayer.js';
import {
  addCurrentSongToPlaylist,
  showLyricsCompactPlayerImmediately,
  toggleCurrentSongFavorite,
  toggleNowPlayingFullscreenFromShortcut,
  resumeLyricsAutoScrollAtActiveLine,
  cycleNowPlayingFsLayout
} from './ui.js';
import { toggleLyricsTranslation } from './lyrics.js';

const STORAGE_KEY = 'pn_shortcuts';
const SHORTCUT_ACTIONS = {
  playPause: { label: 'Reproducir / Pausar', local: 'Space', global: 'MediaPlayPause' },
  nextTrack: { label: 'Siguiente canción', local: 'Ctrl+ArrowRight', global: null },
  prevTrack: { label: 'Canción anterior', local: 'Ctrl+ArrowLeft', global: null },
  toggleCurrentFavorite: { label: 'Agregar / quitar canción actual de favoritos', local: 'Ctrl+Shift+V', global: null },
  addCurrentSongToPlaylist: { label: 'Agregar canción actual a una playlist', local: 'Ctrl+Shift+A', global: null },
  seekForward10: { label: 'Adelantar 10 segundos', local: 'Ctrl+Alt+ArrowRight', global: null },
  seekBackward10: { label: 'Retroceder 10 segundos', local: 'Ctrl+Alt+ArrowLeft', global: null },
  volumeUp: { label: 'Subir volumen', local: 'Ctrl+ArrowUp', global: null },
  volumeDown: { label: 'Bajar volumen', local: 'Ctrl+ArrowDown', global: null },
  mute: { label: 'Silenciar / Activar sonido', local: 'Ctrl+Shift+M', global: null },
  shuffle: { label: 'Alternar aleatorio', local: 'Ctrl+Shift+S', global: null },
  repeat: { label: 'Cambiar modo de repetición', local: 'Ctrl+Shift+R', global: null },
  queue: { label: 'Abrir / Cerrar cola', local: 'Ctrl+Shift+Q', global: null },
  lyrics: { label: 'Abrir / Cerrar letras', local: 'Ctrl+Shift+L', global: null },
  lyricsCompactPlayer: { label: 'Ocultar interfaz (letras / pantalla completa)', local: 'Ctrl+Shift+P', global: null },
  nowPlayingFullscreen: { label: 'Abrir / cerrar pantalla completa', local: 'Ctrl+Shift+F', global: null },
  cycleFsLayout: { label: 'Cambiar diseño de pantalla completa', local: 'Ctrl+Shift+D', global: null },
  pinLyricsLine: { label: 'Fijar línea activa de la letra', local: 'Ctrl+Shift+J', global: null },
  toggleLyricsTranslation: { label: 'Activar / desactivar letras traducidas', local: 'Ctrl+Shift+T', global: null }
};
const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);
const MEDIA_KEYS = new Set([
  'MediaPlayPause',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute'
]);
let shortcuts = readShortcuts();
let recordingSlot = null;
let lastUnmutedVolume = 80;
let isSavingShortcuts = false;

function readShortcuts() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch (error) {
    console.error('No se pudieron leer los atajos guardados:', error);
    stored = null;
  }

  return Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, defaults]) => {
    const saved = stored?.[action];
    const local = saved && Object.hasOwn(saved, 'local') ? saved.local : defaults.local;
    const global = saved && Object.hasOwn(saved, 'global') ? saved.global : defaults.global;
    return [action, {
      local: isValidStoredShortcut(local) ? local : null,
      global: isValidStoredShortcut(global) ? global : null
    }];
  }));
}

function isValidStoredShortcut(shortcut) {
  if (shortcut === null) return true;
  if (typeof shortcut !== 'string' || !/^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/.test(shortcut)) return false;
  const keys = shortcut.split('+');
  const modifiers = new Set(['Ctrl', 'Alt', 'Shift']);
  return !modifiers.has(keys.at(-1)) && keys.slice(0, -1).every(key => modifiers.has(key));
}

function setStatus(message, isError = false) {
  const status = document.getElementById('shortcuts-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function formatKey(key) {
  if (key === 'Space') return 'Espacio';
  if (key === 'ArrowLeft') return '←';
  if (key === 'ArrowRight') return '→';
  if (key === 'ArrowUp') return '↑';
  if (key === 'ArrowDown') return '↓';
  if (key === 'MediaPlayPause') return 'Reproducir / pausar';
  if (key === 'MediaTrackNext') return 'Pista siguiente';
  if (key === 'MediaTrackPrevious') return 'Pista anterior';
  if (key === 'AudioVolumeUp') return 'Subir volumen';
  if (key === 'AudioVolumeDown') return 'Bajar volumen';
  if (key === 'AudioVolumeMute') return 'Silenciar';
  return key;
}

function renderSlot(slot, action, type) {
  slot.setAttribute('role', 'cell');
  const shortcut = shortcuts[action][type];
  const recordButton = document.createElement('button');
  recordButton.type = 'button';
  recordButton.className = 'shortcut-record-button';
  recordButton.dataset.shortcutRecord = type;
  recordButton.dataset.action = action;
  recordButton.setAttribute('aria-label', `Grabar atajo ${type === 'local' ? 'local' : 'global'} para ${SHORTCUT_ACTIONS[action].label}`);

  if (recordingSlot?.action === action && recordingSlot.type === type) {
    recordButton.classList.add('is-recording');
    recordButton.textContent = 'Presiona combinación...';
  } else if (shortcut) {
    shortcut.split('+').forEach(key => {
      const keycap = document.createElement('kbd');
      keycap.textContent = formatKey(key);
      recordButton.append(keycap);
    });
  } else {
    recordButton.textContent = 'Sin asignar';
    recordButton.classList.add('is-unassigned');
  }

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'shortcut-clear-button';
  clearButton.textContent = '×';
  clearButton.disabled = !shortcut;
  clearButton.title = 'Eliminar este atajo';
  clearButton.setAttribute('aria-label', `Eliminar atajo ${type === 'local' ? 'local' : 'global'} de ${SHORTCUT_ACTIONS[action].label}`);
  clearButton.dataset.shortcutClear = type;
  clearButton.dataset.action = action;
  slot.replaceChildren(recordButton, clearButton);
}

function renderShortcuts() {
  document.querySelectorAll('[data-shortcut-action]').forEach(row => {
    const action = row.dataset.shortcutAction;
    row.querySelectorAll('[data-shortcut-slot]').forEach(slot => {
      renderSlot(slot, action, slot.dataset.shortcutSlot);
    });
  });
}

function getGlobalBindings(configuration) {
  return Object.entries(configuration)
    .filter(([, binding]) => binding.global)
    .map(([action, binding]) => ({ action, shortcut: binding.global }));
}

async function saveShortcuts(nextShortcuts) {
  if (isSavingShortcuts) throw new Error('Ya se están actualizando los atajos.');
  isSavingShortcuts = true;
  document.querySelectorAll('.shortcuts-settings button').forEach(button => {
    button.disabled = true;
  });
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (invoke) {
      await invoke('set_global_shortcuts', { bindings: getGlobalBindings(nextShortcuts) });
    }
    shortcuts = nextShortcuts;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
    setStatus('Atajos actualizados.');
  } finally {
    isSavingShortcuts = false;
    renderShortcuts();
    document.querySelectorAll('.shortcuts-toolbar button').forEach(button => {
      button.disabled = false;
    });
  }
}

function normalizePrimaryKey(event) {
  if (MEDIA_KEYS.has(event.key)) return event.key;
  if (event.code.startsWith('Key')) return event.code.slice(3);
  if (event.code.startsWith('Digit')) return event.code.slice(5);
  return event.code;
}

function getRecordedShortcut(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const primary = normalizePrimaryKey(event);
  if (!primary) return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return [...modifiers, primary].join('+');
}

function isShortcutConflict(shortcut, action, type) {
  return Object.entries(shortcuts).some(([otherAction, binding]) =>
    otherAction !== action && binding[type] === shortcut
  );
}

async function recordShortcut(event) {
  if (isSavingShortcuts) {
    event.preventDefault();
    return;
  }
  const { action, type } = recordingSlot;
  if (event.key === 'Escape') {
    event.preventDefault();
    recordingSlot = null;
    renderShortcuts();
    setStatus('Grabación cancelada.');
    return;
  }

  const shortcut = getRecordedShortcut(event);
  if (!shortcut) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();

  if (isShortcutConflict(shortcut, action, type)) {
    setStatus('Esa combinación ya está asignada a otra acción.', true);
    return;
  }

  const nextShortcuts = {
    ...shortcuts,
    [action]: { ...shortcuts[action], [type]: shortcut }
  };
  try {
    await saveShortcuts(nextShortcuts);
    recordingSlot = null;
  } catch (error) {
    console.error('No se pudo guardar el atajo:', error);
    setStatus('No se pudo registrar el atajo. Revisa que la combinación esté disponible.', true);
  }
  renderShortcuts();
}

function isEditableTarget(target) {
  return target instanceof Element &&
    (Boolean(target.closest('input, textarea, select')) || target.isContentEditable);
}

function dispatchShortcut(action) {
  switch (action) {
    case 'playPause':
      togglePlay();
      break;
    case 'nextTrack':
      void nextSong(false);
      break;
    case 'prevTrack':
      prevSong();
      break;
    case 'toggleCurrentFavorite':
      toggleCurrentSongFavorite();
      break;
    case 'addCurrentSongToPlaylist':
      addCurrentSongToPlaylist();
      break;
    case 'seekForward10':
      seekBy(10);
      break;
    case 'seekBackward10':
      seekBy(-10);
      break;
    case 'volumeUp': {
      const volume = Number(document.getElementById('volume-range')?.value ?? 80);
      setAppVolume(volume + 5);
      break;
    }
    case 'volumeDown': {
      const volume = Number(document.getElementById('volume-range')?.value ?? 80);
      setAppVolume(volume - 5);
      break;
    }
    case 'mute': {
      const currentVolume = Number(document.getElementById('volume-range')?.value ?? 80);
      if (currentVolume > 0) {
        lastUnmutedVolume = currentVolume;
        setAppVolume(0);
      } else {
        setAppVolume(lastUnmutedVolume || 80);
      }
      break;
    }
    case 'shuffle':
      setShuffleEnabled(!state.isShuffle);
      break;
    case 'repeat':
      setRepeatMode(state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off');
      break;
    case 'queue':
      document.getElementById('btn-toggle-queue')?.click();
      break;
    case 'pinLyricsLine':
      resumeLyricsAutoScrollAtActiveLine();
      break;
    case 'toggleLyricsTranslation':
      toggleLyricsTranslation();
      break;
    case 'lyrics':
      document.getElementById('btn-lyrics')?.click();
      break;
    case 'lyricsCompactPlayer':
      showLyricsCompactPlayerImmediately();
      break;
    case 'nowPlayingFullscreen':
      toggleNowPlayingFullscreenFromShortcut();
      break;
    case 'cycleFsLayout':
      cycleNowPlayingFsLayout();
      break;
    default:
      console.error(`Acción de atajo desconocida: ${action}`);
  }
}

function shortcutFromEvent(event) {
  const primary = MEDIA_KEYS.has(event.key) ? event.key : normalizePrimaryKey(event);
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  return [...modifiers, primary].join('+');
}

function initLocalShortcuts() {
  window.addEventListener('keydown', event => {
    if (recordingSlot) {
      void recordShortcut(event);
      return;
    }
    if (isEditableTarget(event.target) || event.repeat || event.metaKey) return;

    const shortcut = shortcutFromEvent(event);
    const match = Object.entries(shortcuts).find(([, binding]) => binding.local === shortcut);
    if (!match) return;
    event.preventDefault();
    dispatchShortcut(match[0]);
  });
}

function initGlobalShortcuts() {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke || !tauri?.event?.listen) return;

  void (async () => {
    try {
      await tauri.event.listen('global-shortcut-action', event => {
        dispatchShortcut(event.payload);
      });
      await tauri.core.invoke('set_global_shortcuts', {
        bindings: getGlobalBindings(shortcuts)
      });
    } catch (error) {
      console.error('No se pudieron activar los atajos globales:', error);
      setStatus('No se pudieron registrar los atajos globales. Revisa sus combinaciones.', true);
    }
  })();
}

export function initShortcuts() {
  const list = document.querySelector('.shortcuts-list');
  if (!list) return;

  renderShortcuts();
  list.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const recordButton = event.target.closest('[data-shortcut-record]');
    if (recordButton) {
      recordingSlot = {
        action: recordButton.dataset.action,
        type: recordButton.dataset.shortcutRecord
      };
      renderShortcuts();
      setStatus('Presiona una combinación de teclas. Escape cancela la grabación.');
      return;
    }

    const clearButton = event.target.closest('[data-shortcut-clear]');
    if (!clearButton) return;
    const { action, shortcutClear: type } = clearButton.dataset;
    const nextShortcuts = {
      ...shortcuts,
      [action]: { ...shortcuts[action], [type]: null }
    };
    void saveShortcuts(nextShortcuts).catch(error => {
      console.error('No se pudo eliminar el atajo:', error);
      setStatus('No se pudo eliminar el atajo.', true);
    });
  });

  document.getElementById('btn-clear-all-shortcuts')?.addEventListener('click', () => {
    recordingSlot = null;
    const cleared = Object.fromEntries(Object.keys(SHORTCUT_ACTIONS).map(action => [
      action, { local: null, global: null }
    ]));
    void saveShortcuts(cleared).catch(error => {
      console.error('No se pudieron borrar los atajos:', error);
      setStatus('No se pudieron borrar los atajos.', true);
    });
  });

  document.getElementById('btn-reset-shortcuts')?.addEventListener('click', () => {
    recordingSlot = null;
    const defaults = Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, binding]) => [
      action, { local: binding.local, global: binding.global }
    ]));
    void saveShortcuts(defaults).catch(async error => {
      console.warn('No se pudo restaurar el atajo global predeterminado; se conservarán los atajos locales:', error);
      const localDefaults = Object.fromEntries(Object.entries(SHORTCUT_ACTIONS).map(([action, binding]) => [
        action, { local: binding.local, global: null }
      ]));
      try {
        await saveShortcuts(localDefaults);
        setStatus('Atajos locales predeterminados restaurados. El atajo global no está disponible en este sistema.');
      } catch (fallbackError) {
        console.error('No se pudieron restablecer los atajos:', fallbackError);
        setStatus('No se pudieron restablecer los atajos.', true);
      }
    });
  });

  initLocalShortcuts();
  initGlobalShortcuts();
}
