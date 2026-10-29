const SETTINGS_PREFIX = 'pn_';
const NATIVE_WINDOW_BOUNDS_KEY = 'pn_window_bounds';
const SAVE_DEBOUNCE_MS = 250;
/** Datos de usuario voluminosos: no reescribir todo el settings.json con el debounce corto. */
const HEAVY_DATA_KEYS = new Set([
  'pn_playlists',
  'pn_favorites_keys',
  'pn_favorites_added_at',
  'pn_play_counts',
  'pn_song_play_counts',
  'pn_playback_history',
  'pn_history',
  'pn_recently_played',
  'pn_queue_snapshot',
  'pn_session_queue'
]);
const HEAVY_SAVE_DEBOUNCE_MS = 2000;

let saveTimer = null;
let heavySaveTimer = null;
let pendingSave = Promise.resolve();
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;
let lastChangedWasHeavy = false;

function isHeavyKey(key) {
  const k = String(key || '');
  if (HEAVY_DATA_KEYS.has(k)) return true;
  // Conteos / historial con prefijos variables
  return (
    k.startsWith('pn_play_count') ||
    k.startsWith('pn_history') ||
    k.startsWith('pn_playlist') && k !== 'pn_playlists_layout' && k !== 'pn_playlists_dynamic_filter'
  );
}

function getSettingsSnapshot(storage) {
  const settings = Object.fromEntries(
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter(key => key?.startsWith(SETTINGS_PREFIX) && key !== NATIVE_WINDOW_BOUNDS_KEY)
      .map(key => [key, storage.getItem(key)])
      .filter(([, value]) => value !== null)
  );
  if (Object.prototype.hasOwnProperty.call(settings, 'pn_discord_rpc_enabled')) {
    settings.discord_rpc_enabled = settings.pn_discord_rpc_enabled === 'true';
    delete settings.pn_discord_rpc_enabled;
  }
  return settings;
}

function reportPersistenceError(error) {
  console.error('No se pudo persistir la configuración local:', error);
  window.dispatchEvent(new CustomEvent('pn-settings-persistence-error', {
    detail: { message: error instanceof Error ? error.message : String(error) }
  }));
}

function queueSave(invoke, storage) {
  const settings = getSettingsSnapshot(storage);
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => invoke('save_app_settings', { settings }))
    .catch(error => {
      reportPersistenceError(error);
      throw error;
    });
  return pendingSave;
}

function scheduleSave(invoke, storage, heavy = false) {
  if (heavy) {
    lastChangedWasHeavy = true;
    window.clearTimeout(heavySaveTimer);
    heavySaveTimer = window.setTimeout(() => {
      heavySaveTimer = null;
      lastChangedWasHeavy = false;
      void queueSave(invoke, storage).catch(() => {});
    }, HEAVY_SAVE_DEBOUNCE_MS);
    return;
  }
  // Ajuste liviano: debounce corto (si hay guardado pesado pendiente, también lo adelanta)
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    window.clearTimeout(heavySaveTimer);
    heavySaveTimer = null;
    void queueSave(invoke, storage).catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

export async function initializeSettingsPersistence() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return false;

  const storage = window.localStorage;
  originalSetItem = Storage.prototype.setItem;
  originalRemoveItem = Storage.prototype.removeItem;
  originalClear = Storage.prototype.clear;

  const storedSettings = await invoke('load_app_settings');
  if (storedSettings !== null) {
    const discordRpcSetting = storedSettings.discord_rpc_enabled ??
      storedSettings.pn_discord_rpc_enabled;
    const visualPlusSetting = storedSettings.visual_plus ??
      (typeof storedSettings.pn_visual_plus === 'string'
        ? JSON.parse(storedSettings.pn_visual_plus)
        : storedSettings.pn_visual_plus);
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter(key => key?.startsWith(SETTINGS_PREFIX))
      .forEach(key => originalRemoveItem.call(storage, key));
    Object.entries(storedSettings)
      .filter(([key]) => ![
        'discord_rpc_enabled',
        'pn_discord_rpc_enabled',
        'visual_plus',
        'pn_visual_plus',
        NATIVE_WINDOW_BOUNDS_KEY
      ].includes(key))
      .forEach(([key, value]) => {
        // localStorage SOLO acepta strings; Tauri puede devolver number/bool/object
        const asString = typeof value === 'string' ? value : JSON.stringify(value);
        originalSetItem.call(storage, key, asString);
      });
    if (discordRpcSetting !== undefined) {
      originalSetItem.call(storage, 'pn_discord_rpc_enabled', String(discordRpcSetting));
    }
    if (visualPlusSetting !== undefined) {
      originalSetItem.call(storage, 'pn_visual_plus', JSON.stringify(visualPlusSetting));
    }
  }

  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this === storage && String(key).startsWith(SETTINGS_PREFIX)) {
      scheduleSave(invoke, storage, isHeavyKey(key));
    }
  };
  Storage.prototype.removeItem = function (key) {
    originalRemoveItem.call(this, key);
    if (this === storage && String(key).startsWith(SETTINGS_PREFIX)) {
      scheduleSave(invoke, storage, isHeavyKey(key));
    }
  };
  Storage.prototype.clear = function () {
    const containedSettings = this === storage &&
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .some(key => key?.startsWith(SETTINGS_PREFIX));
    originalClear.call(this);
    if (containedSettings) scheduleSave(invoke, storage, false);
  };

  window.__pnFlushSettingsToDisk = async () => {
    window.clearTimeout(saveTimer);
    window.clearTimeout(heavySaveTimer);
    saveTimer = null;
    heavySaveTimer = null;
    await queueSave(invoke, storage);
  };

  if (storedSettings === null) {
    await window.__pnFlushSettingsToDisk();
  }

  return true;
}
