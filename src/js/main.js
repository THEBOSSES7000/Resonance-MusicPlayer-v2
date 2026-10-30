import { initAudioPlayer, updateTitleMarquee, togglePlay, nextSong, prevSong } from './audioPlayer.js';
import { initScanner, initializeMusicLibrary } from './scanner.js';
import { initUI, navigateToView, renderGrids, renderQueue, renderPlaylistsUI, updateFavoritesCount } from './ui.js';
import { initSettings, renderDirectories } from './settings.js';
import { initResizers } from './resizers.js';
import { initShortcuts } from './shortcuts.js';

function initWindowChrome() {
  const currentWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!currentWindow) return;

  const minimizeButton = document.getElementById('window-minimize');
  const maximizeButton = document.getElementById('window-maximize');
  const closeButton = document.getElementById('window-close');
  const titlebar = document.getElementById('window-titlebar');

  const runWindowAction = action => {
    void action().catch(error => console.error('No se pudo completar la acción de ventana:', error));
  };
  let windowBoundsSaveTimer = null;

  const saveWindowBounds = async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    if (await currentWindow.isMinimized()) return;
    const [position, size, maximized] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.outerSize(),
      currentWindow.isMaximized()
    ]);
    if (size.width <= 200 || size.height <= 200 || size.width < 760 || size.height < 540) return;
    await invoke('save_window_bounds', {
      bounds: {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized
      }
    });
  };

  const scheduleWindowBoundsSave = () => {
    window.clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = window.setTimeout(() => {
      windowBoundsSaveTimer = null;
      void saveWindowBounds().catch(error => {
        console.error('No se pudo guardar el tamaño y la posición de la ventana:', error);
      });
    }, 500);
  };

  const flushWindowBoundsSave = async () => {
    window.clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
    await saveWindowBounds();
  };

  const updateMaximizeButton = async () => {
    try {
      const isMaximized = await currentWindow.isMaximized();
      const icon = maximizeButton.querySelector('i');
      icon.className = isMaximized ? 'ph ph-copy' : 'ph ph-square';
      maximizeButton.title = isMaximized ? 'Restaurar' : 'Maximizar';
      maximizeButton.setAttribute('aria-label', maximizeButton.title);
    } catch (error) {
      console.error('No se pudo actualizar el control de maximizado:', error);
    }
  };

  // Marca <body> cuando la ventana está minimizada (el sondeo de progreso y los fondos animados lo usan para ahorrar CPU/GPU).
  const updateMinimizedState = async () => {
    try {
      const minimized = await currentWindow.isMinimized();
      document.body.classList.toggle('window-minimized', Boolean(minimized));
    } catch (_) {}
  };

  minimizeButton.addEventListener('click', () => runWindowAction(() =>
    localStorage.getItem('pn_minimize_to_tray') === 'true'
      ? currentWindow.hide()
      : currentWindow.minimize()
  ));
  maximizeButton.addEventListener('click', () => {
    runWindowAction(async () => {
      await currentWindow.toggleMaximize();
      await updateMaximizeButton();
    });
  });
  closeButton.addEventListener('click', () => runWindowAction(async () => {
    await flushWindowBoundsSave();
    await window.__pnFlushSettingsToDisk?.();
    await currentWindow.close();
  }));
  titlebar.addEventListener('mousedown', event => {
    if (event.button !== 0 || event.target.closest('.window-titlebar-controls')) return;
    runWindowAction(() => currentWindow.startDragging());
  });
  titlebar.addEventListener('dblclick', event => {
    if (event.target.closest('.window-titlebar-controls')) return;
    runWindowAction(async () => {
      await currentWindow.toggleMaximize();
      await updateMaximizeButton();
    });
  });
  window.addEventListener('resize', () => {
    void updateMaximizeButton();
    void updateMinimizedState();
  });
  if (typeof currentWindow.onMoved === 'function') {
    void currentWindow.onMoved(scheduleWindowBoundsSave).catch(error => {
      console.error('No se pudo observar el movimiento de la ventana:', error);
    });
  }
  if (typeof currentWindow.onResized === 'function') {
    void currentWindow.onResized(() => {
      scheduleWindowBoundsSave();
      void updateMinimizedState();
    }).catch(error => {
      console.error('No se pudo observar el cambio de tamaño de la ventana:', error);
    });
  }
  void saveWindowBounds().catch(error => {
    console.error('No se pudo guardar el tamaño y la posición iniciales de la ventana:', error);
  });
  document.documentElement.dataset.tauriWindowChrome = 'true';
  void updateMaximizeButton();

  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    void invoke('set_minimize_to_tray', {
      enabled: localStorage.getItem('pn_minimize_to_tray') === 'true'
    }).catch(error => console.error('No se pudo configurar la bandeja del sistema:', error));
  }
  const listen = window.__TAURI__?.event?.listen;
  if (listen) {
    void listen('tray-playback-action', event => {
      if (event.payload === 'play-pause') togglePlay();
      else if (event.payload === 'next') void nextSong(false);
      else if (event.payload === 'previous') prevSong();
    }).catch(error => console.error('No se pudieron escuchar los controles de la bandeja:', error));
  }
}

// Inicialización de subsistemas (aislada: un fallo no deja la ventana sin controles)
function safeInit(label, fn) {
  try {
    return fn();
  } catch (error) {
    console.error(`Fallo en ${label}:`, error);
    return undefined;
  }
}

safeInit('windowChrome', initWindowChrome);
safeInit('audioPlayer', initAudioPlayer);
safeInit('scanner', initScanner);
safeInit('ui', initUI);
safeInit('settings', initSettings);
safeInit('shortcuts', initShortcuts);
safeInit('resizers', initResizers);

// Cerrar overlays huérfanos que puedan bloquear clics / título
try {
  document.querySelectorAll('.modal-overlay.open, #confirm-modal-overlay.open, .custom-context-menu.open').forEach(el => {
    el.classList.remove('open');
  });
  const lyricsOverlay = document.getElementById('lyrics-overlay');
  if (lyricsOverlay) lyricsOverlay.classList.remove('open');
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay) settingsOverlay.classList.remove('open');
  document.body.classList.remove(
    'settings-overlay-open',
    'lyrics-overlay-open',
    'now-playing-fs',
    'lyrics-chrome-hidden',
    'lyrics-focus-mode'
  );
} catch (_) {}

// Renderizado inicial al arrancar
safeInit('renderGrids', renderGrids);
safeInit('renderDirectories', renderDirectories);
safeInit('renderQueue', renderQueue);
safeInit('renderPlaylistsUI', renderPlaylistsUI);
safeInit('updateFavoritesCount', updateFavoritesCount);
safeInit('navigateToView', () => navigateToView(localStorage.getItem('pn_startup_view') === 'all-music' ? 'all-music' : 'home', null, false));

// Módulos no críticos para el primer frame: diferir tras pintar la UI
function deferNonCriticalModules() {
  const run = () => {
    void import('./discordRpc.js')
      .then((mod) => { try { mod.initDiscordRpc?.(); } catch (e) { console.error('initDiscordRpc:', e); } })
      .catch((e) => console.error('discordRpc load:', e));
    void import('./lyrics.js')
      .then((mod) => { try { mod.initLyricsFeatures?.(); } catch (e) { console.error('initLyricsFeatures:', e); } })
      .catch((e) => console.error('lyrics load:', e));
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2500 });
  } else {
    window.setTimeout(run, 1);
  }
}

deferNonCriticalModules();

void initializeMusicLibrary().catch(error => {
  console.error('initializeMusicLibrary:', error);
});

// Recalcular carrusel si el usuario redimensiona la ventana
window.addEventListener('resize', () => {
  updateTitleMarquee();
});