// Ajustes · Escáner de ReplayGain.

import { state } from '../state.js';
import { updateReplayGainForTrack } from '../audioPlayer.js';
import { showConfirmDialog } from '../ui.js';

export function initReplayGainScanner() {
  const scanButton = document.getElementById('btn-scan-missing-replaygain');
  const cancelButton = document.getElementById('btn-cancel-replaygain-scan');
  const progress = document.getElementById('rg-scan-progress');
  const status = document.getElementById('rg-scan-status');
  const progressTrack = document.getElementById('rg-scan-progress-track');
  const progressFill = document.getElementById('rg-scan-progress-fill');
  const notice = document.getElementById('rg-scan-notice');
  if (!scanButton || !cancelButton || !progress || !status || !progressTrack || !progressFill || !notice) return;

  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke || !tauri?.event?.listen) {
    scanButton.disabled = true;
    notice.textContent = 'El análisis ReplayGain solo está disponible en la aplicación de escritorio.';
    return;
  }

  let isScanning = false;
  let scanned = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  let firstFailure = '';
  const setProgress = (current, maximum) => {
    const percent = maximum > 0 ? Math.min(100, (current / maximum) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    progressTrack.setAttribute('aria-valuenow', String(Math.round(percent)));
  };
  const finishScan = (cancelled, eventError = null) => {
    isScanning = false;
    scanButton.disabled = false;
    cancelButton.disabled = false;
    cancelButton.hidden = true;
    if (eventError) {
      notice.textContent = eventError;
      status.textContent = 'No se pudo completar el análisis.';
      return;
    }
    const result = `${scanned} calculadas, ${skipped} omitidas y ${failed} con error.`;
    status.textContent = cancelled ? `Análisis cancelado. ${result}` : `Análisis finalizado. ${result}`;
    if (failed > 0) notice.textContent = `Primer error: ${firstFailure}. Consulta la consola para ver todos los archivos.`;
  };
  const updateLibraryGain = (rawPath, gainDb) => {
    if (!Number.isFinite(gainDb) || !rawPath) return;
    const path = rawPath.toLocaleLowerCase();
    const song = state.localMusicFiles.find(track =>
      track.file?.path?.toLocaleLowerCase() === path
    );
    if (!song) return;
    song.replayGainDb = gainDb;
    const updateMatchingTracks = tracks => {
      tracks.forEach(track => {
        if (track.file?.path?.toLocaleLowerCase() === path) {
          track.replayGainDb = gainDb;
          updateReplayGainForTrack(track);
        }
      });
    };
    updateMatchingTracks(state.activeQueue);
    state.playlists.forEach(playlist => updateMatchingTracks(playlist.songs || []));
    updateReplayGainForTrack(song);
    window.dispatchEvent(new Event('pn-save-library-cache'));
  };

  const progressListenerReady = tauri.event.listen('replaygain-batch-progress', event => {
    const payload = event?.payload;
    if (!payload || !isScanning) return;
    const current = Number(payload.current) || 0;
    total = Number(payload.total) || total;
    if (payload.error) {
      failed += 1;
      firstFailure ||= `${payload.trackName || 'Análisis'}: ${payload.error}`;
      console.error(`ReplayGain: ${payload.trackName || 'Análisis'}: ${payload.error}`);
    } else if (payload.skipped) {
      skipped += 1;
      updateLibraryGain(payload.path, payload.gainDb);
    } else if (Number.isFinite(payload.gainDb)) {
      scanned += 1;
      updateLibraryGain(payload.path, payload.gainDb);
    }

    if (payload.finished) {
      if (payload.error) finishScan(Boolean(payload.cancelled), payload.error);
      else finishScan(Boolean(payload.cancelled));
      return;
    }
    status.textContent = `Analizando ${current} de ${total} canciones sin ganancia...`;
    setProgress(current, total);
  }).then(() => true).catch(error => {
    console.error('No se pudo escuchar el progreso ReplayGain:', error);
    scanButton.disabled = true;
    notice.textContent = 'No se pudo recibir el progreso del análisis.';
    return false;
  });

  scanButton.addEventListener('click', async () => {
    if (isScanning) return;
    if (!await progressListenerReady) return;
    notice.textContent = '';
    const pending = state.localMusicFiles.filter(song =>
      song.file?.isNativeFile &&
      song.file.path &&
      (song.replayGainDb == null || !Number.isFinite(Number(song.replayGainDb)))
    );
    if (pending.length === 0) {
      const hasNativeTracks = state.localMusicFiles.some(song => song.file?.isNativeFile && song.file.path);
      await showConfirmDialog({
        title: hasNativeTracks ? 'ReplayGain actualizado' : 'Sin canciones para analizar',
        message: hasNativeTracks
          ? 'Todas las canciones ya tienen ReplayGain.'
          : 'No hay canciones locales disponibles para analizar.',
        confirmText: 'Aceptar',
        showCancel: false
      });
      return;
    }

    total = pending.length;
    scanned = 0;
    failed = 0;
    skipped = 0;
    firstFailure = '';
    isScanning = true;
    scanButton.disabled = true;
    cancelButton.hidden = false;
    cancelButton.disabled = false;
    progress.hidden = false;
    setProgress(0, total);
    status.textContent = `Analizando 0 de ${total} canciones sin ganancia...`;
    try {
      await tauri.core.invoke('scan_missing_replay_gain', {
        paths: pending.map(song => song.file.path)
      });
    } catch (error) {
      finishScan(false, String(error));
    }
  });

  cancelButton.hidden = true;
  cancelButton.addEventListener('click', async () => {
    if (!isScanning) return;
    cancelButton.disabled = true;
    status.textContent = 'Cancelando análisis...';
    try {
      await tauri.core.invoke('cancel_replay_gain_scan');
    } catch (error) {
      cancelButton.disabled = false;
      notice.textContent = `No se pudo cancelar el análisis: ${error}`;
    }
  });
}
