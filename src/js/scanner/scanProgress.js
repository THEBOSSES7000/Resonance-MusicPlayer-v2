// Biblioteca · Progreso del escaneo de la biblioteca.

import { scannerVars } from './sharedState.js';
import { isTauriRuntime } from './fileUtils.js';

function syncScanToolbarActive() {
  document.querySelectorAll('.scan-toolbar').forEach(toolbar => {
    const progress = toolbar.querySelector('[data-scan-progress]');
    const stopBtn = toolbar.querySelector('.btn-scan-stop, #btn-cancel-library-scan');
    const active = Boolean(
      (progress && !progress.hidden) ||
      (stopBtn && !stopBtn.hidden)
    );
    toolbar.classList.toggle('is-active', active);
  });
}

/** Marca de tiempo del último repintado de la barra (para no repintar por cada canción). */
let lastProgressPaintAt = 0;
const PROGRESS_PAINT_INTERVAL_MS = 100;

export function updateScanProgress({ label, completed = 0, total = 0, indeterminate = false, complete = false }) {
  // Durante el escaneo se llama una vez por canción; repintar solo ~10 veces por segundo.
  // Siempre se pinta el primer, el último y los estados especiales.
  const isIntermediate = !complete && !indeterminate && total > 0 && completed > 0 && completed < total;
  if (isIntermediate) {
    const now = performance.now();
    if (now - lastProgressPaintAt < PROGRESS_PAINT_INTERVAL_MS) return;
    lastProgressPaintAt = now;
  }
  document.querySelectorAll('[data-scan-progress]').forEach(progress => {
    progress.hidden = false;
    progress.classList.toggle('is-indeterminate', indeterminate);
    const labelElement = progress.querySelector('.scan-progress-label');
    const fill = progress.querySelector('.scan-progress-fill');
    const bar = progress.querySelector('[role="progressbar"]');
    if (labelElement) labelElement.textContent = label;
    if (fill) fill.style.width = indeterminate ? '35%' : `${total ? Math.round(completed / total * 100) : complete ? 100 : 0}%`;
    if (bar) {
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(total || 100));
      bar.setAttribute('aria-valuenow', String(total ? completed : complete ? 100 : 0));
    }
  });
  syncScanToolbarActive();
}

export let activeLibraryScan = null;

let libraryScanDepth = 0;

export function beginLibraryScan() {
  if (!activeLibraryScan) {
    activeLibraryScan = { cancelled: false };
    libraryScanDepth = 0;
  }
  libraryScanDepth++;
  updateLibraryScanCancelButton();
  return activeLibraryScan;
}

export function finishLibraryScan(scan) {
  libraryScanDepth = Math.max(0, libraryScanDepth - 1);
  if (libraryScanDepth !== 0 || activeLibraryScan !== scan) return;
  activeLibraryScan = null;
  updateLibraryScanCancelButton();
  if (scan.cancelled) {
    updateScanProgress({ label: 'Escaneo detenido', complete: true });
    scannerVars.hideScanProgressTimer = setTimeout(hideScanProgress, 4000);
  }
}

function updateLibraryScanCancelButton() {
  const scanning = Boolean(activeLibraryScan);
  const cancelling = Boolean(activeLibraryScan?.cancelled);
  const stopBtn = document.getElementById('btn-cancel-library-scan');
  if (stopBtn) {
    stopBtn.hidden = !scanning;
    stopBtn.disabled = cancelling;
    stopBtn.title = cancelling ? 'Deteniendo…' : 'Detener escaneo';
  }
  // El botón de escanear no cambia de texto (evita el bug de texto duplicado)
  const quickScan = document.getElementById('btn-quick-scan');
  if (quickScan) {
    quickScan.disabled = scanning; // evita lanzar otro escaneo en paralelo
    const icon = quickScan.querySelector('i');
    if (icon) {
      icon.classList.toggle('spinning', scanning && !cancelling);
    }
  }
  syncScanToolbarActive();
}

export async function cancelLibraryScan() {
  if (!activeLibraryScan || activeLibraryScan.cancelled) return;
  activeLibraryScan.cancelled = true;
  updateLibraryScanCancelButton();
  updateScanProgress({ label: 'Deteniendo el escaneo...', indeterminate: true });
  if (isTauriRuntime()) {
    try {
      await window.__TAURI__.core.invoke('cancel_music_library_scan');
    } catch (error) {
      console.error('No se pudo detener el escaneo nativo de la biblioteca:', error);
    }
  }
}

export function hideScanProgress() {
  clearTimeout(scannerVars.hideScanProgressTimer);
  document.querySelectorAll('[data-scan-progress]').forEach(progress => {
    progress.hidden = true;
    progress.classList.remove('is-indeterminate');
  });
  updateLibraryScanCancelButton();
  syncScanToolbarActive();
}
