// Ajustes · Ajustes de biblioteca: caché y copias de seguridad (acciones).

import { openPlaylistExportPicker, showConfirmDialog } from '../ui.js';
import { exportSettingsBackup, importSettingsBackup } from './backup.js';
import { readStoredBoolean } from './appearance.js';

function formatCacheSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

async function updateLibraryCacheSize() {
  const sizeElement = document.getElementById('library-cache-size');
  if (!sizeElement) return;
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    sizeElement.textContent = 'Solo escritorio';
    return;
  }
  try {
    const size = await invoke('get_library_cache_size');
    sizeElement.textContent = formatCacheSize(size);
  } catch (error) {
    console.error('No se pudo medir la caché de biblioteca:', error);
    sizeElement.textContent = 'No disponible';
  }
}

export function initLibrarySettings() {
  const scanOnStartupInput = document.getElementById('scan-music-on-startup');
  const watchDirectoriesInput = document.getElementById('watch-music-directories');
  const scanOnlyNewMusicInput = document.getElementById('scan-only-new-music');
  const cacheStatus = document.getElementById('library-cache-status');
  const storageLocationSelect = document.getElementById('storage-location-select');
  const storagePath = document.getElementById('current-storage-path');
  const storageStatus = document.getElementById('storage-location-status');
  const openStorageFolderButton = document.getElementById('btn-open-storage-folder');
  const backupStatus = document.getElementById('backup-settings-status');
  let currentStorageMode = null;
  document.getElementById('btn-export-playlists')?.addEventListener('click', openPlaylistExportPicker);
  document.getElementById('btn-export-settings-modal')?.addEventListener('click', () => {
    void exportSettingsBackup(backupStatus);
  });
  const backupFileInput = document.getElementById('settings-backup-file-input');
  document.getElementById('btn-import-settings-trigger')?.addEventListener('click', () => {
    backupFileInput?.click();
  });
  backupFileInput?.addEventListener('change', async event => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await importSettingsBackup(file, backupStatus);
  });
  window.addEventListener('pn-settings-persistence-error', event => {
    if (backupStatus) {
      backupStatus.textContent = `No se pudieron guardar los ajustes en disco: ${event.detail?.message || 'error desconocido'}`;
    }
  });
  if (storageLocationSelect && storagePath) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) {
      storagePath.textContent = 'Solo escritorio';
      storageLocationSelect.disabled = true;
      if (openStorageFolderButton) openStorageFolderButton.disabled = true;
    } else {
      void invoke('get_storage_info').then(info => {
        currentStorageMode = info.mode;
        storageLocationSelect.value = info.mode;
        storagePath.textContent = info.path;
        storageLocationSelect.disabled = false;
        if (openStorageFolderButton) openStorageFolderButton.disabled = false;
      }).catch(error => {
        console.error('No se pudo consultar la ubicación de los datos:', error);
        storagePath.textContent = 'No disponible';
        if (openStorageFolderButton) openStorageFolderButton.disabled = true;
        if (storageStatus) storageStatus.textContent = 'No se pudo consultar la ubicación actual de los datos.';
      });

      openStorageFolderButton?.addEventListener('click', async () => {
        openStorageFolderButton.disabled = true;
        try {
          await invoke('open_storage_directory');
        } catch (error) {
          console.error('No se pudo abrir la carpeta de datos:', error);
          await showConfirmDialog({
            title: 'No se pudo abrir la carpeta',
            message: error instanceof Error ? error.message : String(error),
            confirmText: 'Entendido',
            showCancel: false
          });
        } finally {
          openStorageFolderButton.disabled = false;
        }
      });

      storageLocationSelect.addEventListener('change', async () => {
        const requestedMode = storageLocationSelect.value;
        if (!currentStorageMode || requestedMode === currentStorageMode) {
          storageLocationSelect.value = currentStorageMode || 'appdata';
          return;
        }
        storageLocationSelect.disabled = true;
        const confirmed = await showConfirmDialog({
          title: '¿Cambiar ubicación de datos?',
          message: '¿Deseas mover todos tus datos y configuraciones actuales a la nueva carpeta?',
          confirmText: 'Mover y cambiar',
          cancelText: 'Cancelar'
        });
        if (!confirmed) {
          storageLocationSelect.value = currentStorageMode;
          storageLocationSelect.disabled = false;
          return;
        }

        try {
          const newPath = await invoke('set_storage_location', {
            usePortable: requestedMode === 'portable',
            moveExistingFiles: true
          });
          currentStorageMode = requestedMode;
          storageLocationSelect.value = requestedMode;
          storagePath.textContent = newPath;
          if (storageStatus) storageStatus.textContent = 'Los datos y configuraciones se trasladaron correctamente.';
          await updateLibraryCacheSize();
          await showConfirmDialog({
            title: 'Ubicación actualizada',
            message: `Los datos se trasladaron correctamente a:\n${newPath}`,
            confirmText: 'Aceptar',
            showCancel: false
          });
        } catch (error) {
          console.error('No se pudo cambiar la ubicación de los datos:', error);
          storageLocationSelect.value = currentStorageMode;
          if (storageStatus) storageStatus.textContent = 'No se pudo cambiar la ubicación de los datos.';
          await showConfirmDialog({
            title: 'No se pudo cambiar la ubicación',
            message: error instanceof Error ? error.message : String(error),
            confirmText: 'Entendido',
            showCancel: false
          });
        } finally {
          storageLocationSelect.disabled = false;
        }
      });
    }
  }
  if (scanOnStartupInput) {
    scanOnStartupInput.checked = readStoredBoolean('pn_scan_music_on_startup', true);
    scanOnStartupInput.addEventListener('change', () => {
      localStorage.setItem('pn_scan_music_on_startup', String(scanOnStartupInput.checked));
    });
  }
  if (scanOnlyNewMusicInput) {
    scanOnlyNewMusicInput.checked = readStoredBoolean('pn_scan_only_new_music');
    scanOnlyNewMusicInput.addEventListener('change', () => {
      localStorage.setItem('pn_scan_only_new_music', String(scanOnlyNewMusicInput.checked));
    });
  }
  if (watchDirectoriesInput) {
    watchDirectoriesInput.checked = readStoredBoolean('pn_watch_music_directories');
    watchDirectoriesInput.addEventListener('change', async () => {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) {
        watchDirectoriesInput.checked = false;
        return;
      }
      const enabled = watchDirectoriesInput.checked;
      try {
        await invoke('configure_music_watcher', { enabled });
        localStorage.setItem('pn_watch_music_directories', String(enabled));
        if (cacheStatus) cacheStatus.textContent = enabled
          ? 'Monitoreo de carpetas activado.'
          : 'Monitoreo de carpetas desactivado.';
      } catch (error) {
        console.error('No se pudo actualizar el monitoreo de carpetas:', error);
        watchDirectoriesInput.checked = !enabled;
        await showConfirmDialog({
          title: 'No se pudo actualizar el monitoreo',
          message: 'No se pudieron monitorear las carpetas vinculadas. Revisa que sigan disponibles.',
          confirmText: 'Entendido',
          showCancel: false
        });
      }
    });
  }
  document.getElementById('btn-clear-library-cache')?.addEventListener('click', async () => {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    try {
      await invoke('clear_library_cache');
      window.dispatchEvent(new Event('pn-clear-library-cache-memory'));
      if (cacheStatus) cacheStatus.textContent = 'Caché de biblioteca, metadatos e imágenes eliminados.';
      await updateLibraryCacheSize();
    } catch (error) {
      console.error('No se pudo limpiar la caché de biblioteca:', error);
      if (cacheStatus) cacheStatus.textContent = 'No se pudo limpiar la caché de biblioteca.';
      await showConfirmDialog({
        title: 'No se pudo limpiar la caché',
        message: 'Ocurrió un error al borrar los datos guardados. Revisa la consola para más detalles.',
        confirmText: 'Entendido',
        showCancel: false
      });
    }
  });
  window.addEventListener('pn-library-cache-updated', () => void updateLibraryCacheSize());
  void updateLibraryCacheSize();
}
