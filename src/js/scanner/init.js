// Biblioteca · Inicialización del escáner.

import { activeLibraryScan, cancelLibraryScan, hideScanProgress, updateScanProgress } from './scanProgress.js';
import { processAudioFiles, rescanConfiguredMusic } from './processFiles.js';
import { isTauriRuntime } from './fileUtils.js';
import { addNativeMusicDirectory, clearCachedMetadataFromMemory, refreshLibraryMetadata, refreshNativeMusicLibrary } from './libraryRefresh.js';
import { saveNativeLibraryCache } from './libraryCache.js';
import { showConfirmDialog } from '../ui.js';
import { scannerVars } from './sharedState.js';

export function initScanner() {
  const nativeFolderInput = document.getElementById('native-folder-input');
  const btnQuickScan = document.getElementById('btn-quick-scan');

  btnQuickScan?.addEventListener('click', () => {
    if (activeLibraryScan) return;
    void rescanConfiguredMusic();
  });
  document.getElementById('btn-cancel-library-scan')?.addEventListener('click', () => {
    void cancelLibraryScan();
  });
  window.addEventListener('pn-add-native-music-directory', () => {
    if (isTauriRuntime()) addNativeMusicDirectory();
  });
  window.addEventListener('pn-native-library-changed', () => {
    if (isTauriRuntime()) refreshNativeMusicLibrary();
  });
  document.getElementById('btn-refresh-library-metadata')?.addEventListener('click', () => {
    void refreshLibraryMetadata();
  });
  window.addEventListener('pn-refresh-library-metadata', () => {
    void refreshLibraryMetadata();
  });
  window.addEventListener('pn-clear-library-cache-memory', clearCachedMetadataFromMemory);
  window.addEventListener('pn-save-library-cache', () => void saveNativeLibraryCache(false));
  if (isTauriRuntime() && window.__TAURI__.event?.listen) {
    let refreshTimer = null;
    void window.__TAURI__.event.listen('music-library-filesystem-changed', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refreshNativeMusicLibrary(), 500);
    }).catch(error => console.error('No se pudo escuchar el monitor de carpetas:', error));
  }

  nativeFolderInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files);
    event.target.value = '';
    if (!files || files.length === 0) return;

    const audioExtensions = ['.mp3', '.flac', '.wav', '.ogg', '.opus', '.m4a', '.mp4', '.aac'];
    const matchedFiles = files.filter(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return audioExtensions.includes(ext);
    });

    if (matchedFiles.length === 0) {
      await showConfirmDialog({
        title: "Sin archivos compatibles",
        message: "No se encontraron archivos de audio compatibles (.mp3, .flac, .wav, .m4a, etc.) en la carpeta seleccionada.",
        confirmText: "Entendido",
        showCancel: false
      });
      return;
    }

    const folderName = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : "Carpeta de Música";

    const proceed = await showConfirmDialog({
      title: "¿Cargar biblioteca de música?",
      message: `Se detectaron ${matchedFiles.length} canciones en "${folderName}". ¿Deseas incorporarlas a tu biblioteca de Resonance?`,
      confirmText: "Cargar",
      cancelText: "Cancelar"
    });

    if (!proceed) return;

    try {
      await processAudioFiles(matchedFiles, folderName);
    } catch (error) {
      console.error('No se pudo completar el escaneo de la biblioteca:', error);
      updateScanProgress({ label: 'No se pudo completar el escaneo', complete: true });
      scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 8000);
      await showConfirmDialog({
        title: "Error al escanear la música",
        message: "No se pudo completar la lectura de la carpeta. Revisa la consola para ver más detalles.",
        confirmText: "Entendido",
        showCancel: false
      });
    }
  });
}
