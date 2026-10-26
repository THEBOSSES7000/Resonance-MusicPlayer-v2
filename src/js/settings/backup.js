// Ajustes · Copia de seguridad de ajustes: crear, validar, exportar e importar.

import { showConfirmDialog } from '../ui.js';

const SETTINGS_BACKUP_CATEGORIES = ['preferences', 'shortcuts', 'folders', 'playlists', 'favorites'];

const SETTINGS_BACKUP_EXCLUDED_PREFERENCE_KEYS = new Set([
  'pn_shortcuts',
  'pn_folders_info',
  'pn_playlists',
  'pn_favorites_keys'
]);

const SETTINGS_BACKUP_CATEGORY_LABELS = {
  preferences: 'preferencias',
  shortcuts: 'atajos de teclado',
  folders: 'carpetas y descripciones',
  playlists: 'playlists',
  favorites: 'favoritos'
};

const SETTINGS_BACKUP_FORMAT = 'resonance-settings-backup';

const SETTINGS_BACKUP_VERSION = 1;

function parseBackupJsonValue(value, label, validator) {
  if (typeof value !== 'string') {
    throw new Error(`La categoría ${label} no contiene datos válidos.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`La categoría ${label} contiene datos JSON dañados.`);
  }
  if (!validator(parsed)) {
    throw new Error(`La categoría ${label} tiene un formato no compatible.`);
  }
  return parsed;
}

function validateSettingsBackup(backup) {
  if (!backup || backup.format !== SETTINGS_BACKUP_FORMAT ||
      backup.version !== SETTINGS_BACKUP_VERSION ||
      !backup.categories || typeof backup.categories !== 'object' ||
      Array.isArray(backup.categories)) {
    throw new Error('El archivo no es una copia de seguridad compatible de Resonance.');
  }

  const categories = backup.categories;
  if (categories.preferences !== undefined) {
    const values = categories.preferences.values;
    if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.entries(values).some(([key, value]) =>
          !key.startsWith('pn_') || SETTINGS_BACKUP_EXCLUDED_PREFERENCE_KEYS.has(key) ||
          typeof value !== 'string'
        )) {
      throw new Error('La categoría de preferencias está dañada o contiene claves inválidas.');
    }
  }
  if (categories.shortcuts !== undefined) {
    parseBackupJsonValue(categories.shortcuts.value, 'atajos', value =>
      value !== null && typeof value === 'object' && !Array.isArray(value) &&
      Object.values(value).every(binding =>
        binding && typeof binding === 'object' && !Array.isArray(binding) &&
        ['local', 'global'].every(key => binding[key] === null || typeof binding[key] === 'string')
      )
    );
  }
  if (categories.folders !== undefined) {
    if (!categories.folders || typeof categories.folders !== 'object' ||
        !Array.isArray(categories.folders.musicDirectories)) {
      throw new Error('La categoría de carpetas está dañada.');
    }
    parseBackupJsonValue(categories.folders.metadata, 'carpetas', Array.isArray);
    if (categories.folders.musicDirectories.some(directory =>
      !directory || typeof directory.path !== 'string' || typeof directory.name !== 'string'
    )) {
      throw new Error('La categoría contiene una carpeta de música no válida.');
    }
  }
  if (categories.playlists !== undefined) {
    parseBackupJsonValue(categories.playlists.value, 'playlists', Array.isArray);
  }
  if (categories.favorites !== undefined) {
    parseBackupJsonValue(categories.favorites.value, 'favoritos', value =>
      Array.isArray(value) && value.every(key => typeof key === 'string')
    );
  }

  const available = SETTINGS_BACKUP_CATEGORIES.filter(category =>
    Object.hasOwn(categories, category)
  );
  if (available.length === 0) throw new Error('La copia no contiene categorías para importar.');
  return available;
}

function openSettingsBackupCategoryDialog(mode, availableCategories = SETTINGS_BACKUP_CATEGORIES) {
  const modal = document.getElementById('settings-backup-modal');
  const title = document.getElementById('settings-backup-title');
  const description = document.getElementById('settings-backup-description');
  const confirmButton = document.getElementById('btn-confirm-settings-backup');
  const cancelButton = document.getElementById('btn-cancel-settings-backup');
  const checkboxes = [...modal.querySelectorAll('[data-backup-category]')];
  const isImport = mode === 'import';
  title.textContent = isImport ? 'Importar configuración' : 'Exportar configuración';
  description.textContent = isImport
    ? 'Elige qué categorías reemplazar. Las demás conservarán sus datos actuales.'
    : 'Selecciona las categorías que quieres incluir en el archivo de respaldo.';
  confirmButton.textContent = isImport ? 'Importar categorías' : 'Exportar configuración';
  checkboxes.forEach(checkbox => {
    const available = availableCategories.includes(checkbox.dataset.backupCategory);
    checkbox.closest('label').hidden = !available;
    checkbox.checked = available;
  });
  confirmButton.disabled = false;
  modal.classList.add('open');

  return new Promise(resolve => {
    const cleanup = result => {
      modal.classList.remove('open');
      confirmButton.removeEventListener('click', onConfirm);
      cancelButton.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onConfirm = () => {
      const selected = checkboxes
        .filter(checkbox => !checkbox.closest('label').hidden && checkbox.checked)
        .map(checkbox => checkbox.dataset.backupCategory);
      if (selected.length > 0) cleanup(selected);
    };
    const onCancel = () => cleanup(null);
    confirmButton.addEventListener('click', onConfirm);
    cancelButton.addEventListener('click', onCancel);
  });
}

function createSettingsBackup(selectedCategories, musicDirectories = []) {
  const selected = new Set(selectedCategories);
  const localSettings = Object.fromEntries(
    Object.keys(localStorage)
      .filter(key => key.startsWith('pn_'))
      .map(key => [key, localStorage.getItem(key)])
      .filter(([, value]) => value !== null)
  );
  const categories = {};
  if (selected.has('preferences')) {
    categories.preferences = {
      values: Object.fromEntries(Object.entries(localSettings).filter(([key]) =>
        !SETTINGS_BACKUP_EXCLUDED_PREFERENCE_KEYS.has(key)
      ))
    };
  }
  if (selected.has('shortcuts')) {
    categories.shortcuts = { value: localSettings.pn_shortcuts || '{}' };
  }
  if (selected.has('folders')) {
    categories.folders = {
      metadata: localSettings.pn_folders_info || '[]',
      musicDirectories
    };
  }
  if (selected.has('playlists')) {
    categories.playlists = { value: localSettings.pn_playlists || '[]' };
  }
  if (selected.has('favorites')) {
    categories.favorites = { value: localSettings.pn_favorites_keys || '[]' };
  }
  return {
    format: SETTINGS_BACKUP_FORMAT,
    version: SETTINGS_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    categories
  };
}

function downloadSettingsBackup(contents) {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `resonance-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportSettingsBackup(statusElement) {
  const selectedCategories = await openSettingsBackupCategoryDialog('export');
  if (!selectedCategories) return;
  const invoke = window.__TAURI__?.core?.invoke;
  try {
    const musicDirectories = selectedCategories.includes('folders') && invoke
      ? await invoke('get_music_directories')
      : [];
    const backup = createSettingsBackup(selectedCategories, musicDirectories);
    const contents = JSON.stringify(backup, null, 2);
    if (invoke) {
      const saved = await invoke('save_settings_backup', { contents });
      if (!saved) return;
    } else {
      downloadSettingsBackup(contents);
    }
    if (statusElement) statusElement.textContent = 'La copia de seguridad se exportó correctamente.';
  } catch (error) {
    console.error('No se pudo exportar la configuración:', error);
    if (statusElement) statusElement.textContent = 'No se pudo exportar la configuración.';
    await showConfirmDialog({
      title: 'No se pudo exportar la configuración',
      message: error instanceof Error ? error.message : String(error),
      confirmText: 'Entendido',
      showCancel: false
    });
  }
}

function replaceLocalSettingsCategory(category, payload) {
  if (category === 'preferences') {
    Object.keys(localStorage)
      .filter(key => key.startsWith('pn_') && !SETTINGS_BACKUP_EXCLUDED_PREFERENCE_KEYS.has(key))
      .forEach(key => localStorage.removeItem(key));
    Object.entries(payload.values).forEach(([key, value]) => localStorage.setItem(key, value));
  } else if (category === 'shortcuts') {
    localStorage.setItem('pn_shortcuts', payload.value);
  } else if (category === 'folders') {
    localStorage.setItem('pn_folders_info', payload.metadata);
  } else if (category === 'playlists') {
    localStorage.setItem('pn_playlists', payload.value);
  } else if (category === 'favorites') {
    localStorage.setItem('pn_favorites_keys', payload.value);
  }
}

export async function importSettingsBackup(file, statusElement) {
  try {
    if (file.size > 32 * 1024 * 1024) {
      throw new Error('El archivo de respaldo supera el tamaño máximo de 32 MiB.');
    }
    const backup = JSON.parse(await file.text());
    const availableCategories = validateSettingsBackup(backup);
    const selectedCategories = await openSettingsBackupCategoryDialog('import', availableCategories);
    if (!selectedCategories) return;

    const categoryNames = selectedCategories
      .map(category => SETTINGS_BACKUP_CATEGORY_LABELS[category])
      .join(', ');
    const confirmed = await showConfirmDialog({
      title: '¿Importar configuración?',
      message: `Se reemplazarán únicamente estas categorías: ${categoryNames}. Las demás permanecerán sin cambios.`,
      confirmText: 'Importar',
      cancelText: 'Cancelar'
    });
    if (!confirmed) return;

    const invoke = window.__TAURI__?.core?.invoke;
    if (selectedCategories.includes('folders') && invoke) {
      await invoke('replace_music_directories', {
        directories: backup.categories.folders.musicDirectories
      });
    }
    selectedCategories.forEach(category => {
      replaceLocalSettingsCategory(category, backup.categories[category]);
    });
    if (window.__pnFlushSettingsToDisk) {
      await window.__pnFlushSettingsToDisk();
    }
    if (statusElement) statusElement.textContent = 'La configuración seleccionada se importó correctamente.';
    await showConfirmDialog({
      title: 'Configuración importada',
      message: 'Los datos seleccionados se reemplazaron correctamente. Resonance se reiniciará para aplicar los cambios.',
      confirmText: 'Reiniciar ahora',
      showCancel: false
    });
    window.location.reload();
  } catch (error) {
    console.error('No se pudo importar la configuración:', error);
    if (statusElement) statusElement.textContent = 'No se pudo importar la configuración.';
    await showConfirmDialog({
      title: 'No se pudo importar la configuración',
      message: error instanceof Error ? error.message : String(error),
      confirmText: 'Entendido',
      showCancel: false
    });
  }
}
