const SETTINGS_PREFIX = 'pn_';
const NATIVE_WINDOW_BOUNDS_KEY = 'pn_window_bounds';
const SAVE_DEBOUNCE_MS = 250;

let saveTimer = null;
let pendingSave = Promise.resolve();
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;

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

function scheduleSave(invoke, storage) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
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
      scheduleSave(invoke, storage);
    }
  };
  Storage.prototype.removeItem = function (key) {
    originalRemoveItem.call(this, key);
    if (this === storage && String(key).startsWith(SETTINGS_PREFIX)) {
      scheduleSave(invoke, storage);
    }
  };
  Storage.prototype.clear = function () {
    const containedSettings = this === storage &&
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .some(key => key?.startsWith(SETTINGS_PREFIX));
    originalClear.call(this);
    if (containedSettings) scheduleSave(invoke, storage);
  };

  window.__pnFlushSettingsToDisk = async () => {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    await queueSave(invoke, storage);
  };

  if (storedSettings === null) {
    await window.__pnFlushSettingsToDisk();
  }
  return true;
}
