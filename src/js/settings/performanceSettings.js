// Ajustes · Monitor de rendimiento.

import { applyListCoverMode } from '../ui.js';

function formatPerformanceBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}

function formatPerformanceRate(bytesPerSecond) {
  return `${formatPerformanceBytes(bytesPerSecond)}/s`;
}

function renderPerformanceProcessList(processes, previousProcesses, elapsedSeconds) {
  const list = document.getElementById('performance-process-list');
  if (!list) return;
  list.replaceChildren();

  const columns = ['Proceso', 'CPU', 'RAM', 'Disco', 'GPU'];
  const header = document.createElement('div');
  header.className = 'performance-process-row performance-process-header';
  header.setAttribute('role', 'row');
  columns.forEach(label => {
    const cell = document.createElement('span');
    cell.setAttribute('role', 'columnheader');
    cell.textContent = label;
    header.appendChild(cell);
  });
  list.appendChild(header);

  processes.forEach(process => {
    const prior = previousProcesses.get(process.pid);
    const readDelta = prior ? Math.max(0, process.diskReadBytes - prior.diskReadBytes) : 0;
    const writeDelta = prior ? Math.max(0, process.diskWriteBytes - prior.diskWriteBytes) : 0;
    const diskRate = elapsedSeconds > 0 ? (readDelta + writeDelta) / elapsedSeconds : 0;
    const row = document.createElement('div');
    row.className = 'performance-process-row';
    row.setAttribute('role', 'row');
    [
      process.name || `Proceso ${process.pid}`,
      `${(Number(process.cpuPercent) || 0).toFixed(1)}%`,
      formatPerformanceBytes(process.memoryBytes),
      formatPerformanceRate(diskRate),
      Number.isFinite(process.gpuPercent) ? `${process.gpuPercent.toFixed(1)}%` : 'N/D'
    ].forEach((value, index) => {
      const cell = document.createElement('span');
      cell.setAttribute('role', 'cell');
      if (index === 0) cell.title = `PID ${process.pid}`;
      cell.textContent = value;
      row.appendChild(cell);
    });
    list.appendChild(row);
  });
}

export function initPerformanceSettings() {
  const monitorToggle = document.getElementById('performance-monitor-enabled');
  const overlayToggle = document.getElementById('performance-overlay-enabled');
  const smoothToggle = document.getElementById('performance-smooth-transitions');
  const disableAnimationsToggle = document.getElementById('performance-disable-animations');
  const monitor = document.getElementById('performance-monitor');
  const overlay = document.getElementById('performance-overlay');
  const overlayStatus = document.getElementById('performance-overlay-status');
  const status = document.getElementById('performance-monitor-status');
  if (!monitorToggle || !overlayToggle || !smoothToggle || !disableAnimationsToggle ||
      !monitor || !overlay || !status) return;

  const root = document.documentElement;
  const smoothSaved = localStorage.getItem('pn_performance_smooth_transitions') === 'true';
  const disableSaved = localStorage.getItem('pn_performance_disable_animations') === 'true';
  smoothToggle.checked = smoothSaved && !disableSaved;
  disableAnimationsToggle.checked = disableSaved;
  root.classList.toggle('pn-smooth-transitions', smoothToggle.checked);
  root.classList.toggle('pn-disable-animations', disableAnimationsToggle.checked);

  let pollingTimer = null;
  let pollInProgress = false;
  let previousProcesses = new Map();
  let previousTotals = null;
  let previousSampleAt = 0;
  const invoke = window.__TAURI__?.core?.invoke;
  const updateDiskRate = metrics => {
    const now = performance.now();
    const elapsedSeconds = previousSampleAt ? (now - previousSampleAt) / 1000 : 0;
    const processes = Array.isArray(metrics.processes) ? metrics.processes : [];
    const readBytes = Number(metrics.diskReadBytes) || 0;
    const writeBytes = Number(metrics.diskWriteBytes) || 0;
    const diskRate = previousTotals && elapsedSeconds > 0
      ? (Math.max(0, readBytes - previousTotals.readBytes) +
        Math.max(0, writeBytes - previousTotals.writeBytes)) / elapsedSeconds
      : 0;
    renderPerformanceProcessList(processes, previousProcesses, elapsedSeconds);
    previousProcesses = new Map(processes.map(process => [process.pid, process]));
    previousTotals = { readBytes, writeBytes };
    previousSampleAt = now;
    return { diskRate, elapsedSeconds };
  };
  const renderMetrics = metrics => {
    const cpu = Number(metrics.cpuPercent) || 0;
    const memory = Number(metrics.memoryBytes) || 0;
    const gpu = Number.isFinite(metrics.gpuPercent) ? `${metrics.gpuPercent.toFixed(1)}%` : 'No disponible';
    const { diskRate } = updateDiskRate(metrics);
    const cpuText = `${cpu.toFixed(1)}%`;
    const memoryText = formatPerformanceBytes(memory);
    const diskText = formatPerformanceRate(diskRate);
    document.getElementById('performance-total-cpu').textContent = cpuText;
    document.getElementById('performance-total-memory').textContent = memoryText;
    document.getElementById('performance-total-disk').textContent = diskText;
    document.getElementById('performance-total-gpu').textContent = gpu;
    document.getElementById('performance-overlay-cpu').textContent = cpuText;
    document.getElementById('performance-overlay-memory').textContent = memoryText;
    document.getElementById('performance-overlay-disk').textContent = diskText;
    document.getElementById('performance-overlay-gpu').textContent = gpu;
    const processCount = Array.isArray(metrics.processes) ? metrics.processes.length : 0;
    status.textContent = `${processCount} procesos vinculados en seguimiento.${metrics.gpuPercent == null ? ' GPU no disponible en este equipo o controlador.' : ''}`;
    if (overlayStatus) {
      overlayStatus.hidden = true;
      overlayStatus.textContent = '';
    }
  };
  const pollMetrics = async () => {
    if (!monitorToggle.checked || pollInProgress) return;
    if (!invoke) {
      status.textContent = 'El monitor de procesos requiere la aplicación de escritorio.';
      if (overlayStatus) {
        overlayStatus.textContent = 'Solo en escritorio';
        overlayStatus.hidden = false;
      }
      return;
    }
    pollInProgress = true;
    try {
      const metrics = await invoke('get_performance_metrics');
      renderMetrics(metrics);
    } catch (error) {
      console.error('No se pudo obtener el rendimiento de Resonance:', error);
      status.textContent = `No se pudieron leer las métricas de rendimiento: ${error}`;
      if (overlayStatus) {
        overlayStatus.textContent = 'Métricas no disponibles';
        overlayStatus.hidden = false;
      }
    } finally {
      pollInProgress = false;
    }
  };
  const setMonitorEnabled = enabled => {
    monitorToggle.checked = enabled;
    localStorage.setItem('pn_performance_monitor_enabled', String(enabled));
    monitor.hidden = !enabled;
    if (enabled) {
      previousProcesses = new Map();
      previousTotals = null;
      previousSampleAt = 0;
      status.textContent = 'Recopilando métricas de procesos...';
      if (overlayStatus && overlayToggle.checked) {
        overlayStatus.textContent = 'Midiendo…';
        overlayStatus.hidden = false;
      }
      void pollMetrics();
      // 2.5s basta para el overlay; 1s generaba más presión de sysinfo/IPC sin beneficio visible
      if (pollingTimer === null) pollingTimer = window.setInterval(() => void pollMetrics(), 2500);
    } else {
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
      pollingTimer = null;
      previousProcesses = new Map();
      previousTotals = null;
      previousSampleAt = 0;
      overlayToggle.checked = false;
      overlay.hidden = true;
      if (overlayStatus) overlayStatus.hidden = true;
      localStorage.setItem('pn_performance_overlay_enabled', 'false');
    }
  };

  monitorToggle.checked = localStorage.getItem('pn_performance_monitor_enabled') === 'true';
  overlayToggle.checked = localStorage.getItem('pn_performance_overlay_enabled') === 'true';
  overlay.hidden = !overlayToggle.checked;
  monitorToggle.addEventListener('change', () => setMonitorEnabled(monitorToggle.checked));
  overlayToggle.addEventListener('change', () => {
    if (overlayToggle.checked && !monitorToggle.checked) setMonitorEnabled(true);
    overlay.hidden = !overlayToggle.checked;
    if (overlayToggle.checked && overlayStatus && !overlayStatus.textContent) {
      overlayStatus.textContent = 'Midiendo…';
      overlayStatus.hidden = false;
    } else if (!overlayToggle.checked && overlayStatus) {
      overlayStatus.hidden = true;
    }
    localStorage.setItem('pn_performance_overlay_enabled', String(overlayToggle.checked));
  });
  if (monitorToggle.checked) setMonitorEnabled(true);
  if (overlayToggle.checked) {
    if (!monitorToggle.checked) setMonitorEnabled(true);
    overlay.hidden = false;
  }

  smoothToggle.addEventListener('change', () => {
    if (smoothToggle.checked) {
      disableAnimationsToggle.checked = false;
      localStorage.setItem('pn_performance_disable_animations', 'false');
      root.classList.remove('pn-disable-animations');
    }
    localStorage.setItem('pn_performance_smooth_transitions', String(smoothToggle.checked));
    root.classList.toggle('pn-smooth-transitions', smoothToggle.checked);
  });
  disableAnimationsToggle.addEventListener('change', () => {
    if (disableAnimationsToggle.checked) {
      smoothToggle.checked = false;
      localStorage.setItem('pn_performance_smooth_transitions', 'false');
      root.classList.remove('pn-smooth-transitions');
    }
    localStorage.setItem('pn_performance_disable_animations', String(disableAnimationsToggle.checked));
    root.classList.toggle('pn-disable-animations', disableAnimationsToggle.checked);
  });

  // Modo de carátula en listas
  const listCoverModeSelect = document.getElementById('list-cover-mode');
  if (listCoverModeSelect) {
    const savedMode = localStorage.getItem('pn_list_cover_mode') || 'individual';
    const valid = ['individual', 'album', 'icon', 'none'];
    listCoverModeSelect.value = valid.includes(savedMode) ? savedMode : 'individual';
    applyListCoverMode(listCoverModeSelect.value, { refresh: false });
    listCoverModeSelect.addEventListener('change', () => {
      applyListCoverMode(listCoverModeSelect.value, { refresh: true });
    });
  }

}
