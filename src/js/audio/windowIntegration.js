// Audio · Integración con Windows y Discord: título, barra de tareas y controles multimedia.

import { resolveCoverUrl, state } from '../state.js';
import { getPlaybackDuration, getPlaybackPosition, isPlaybackPaused, seekPlayback } from './position.js';
import { audioVars } from './sharedState.js';
import { audio, nextSong, prevSong, togglePlay } from './playback.js';

export function updateWindowSongTitle(_track = null) {
  // Título fijo: no se cambia por canción (sin setTitle / sin permiso en capabilities).
  const title = 'Resonance';
  const titleElement = document.getElementById('window-app-title');
  if (titleElement && titleElement.textContent !== title) titleElement.textContent = title;
  if (document.title !== title) document.title = title;
}

export function notifyDiscordPresence(force = false, clearTrack = false) {
  const track = clearTrack || state.currentTrackIndex < 0
    ? null
    : state.activeQueue[state.currentTrackIndex];
  document.dispatchEvent(new CustomEvent('pn-discord-presence-update', {
    detail: {
      title: track?.title || '',
      artist: track?.artist || '',
      album: track?.album || '',
      filePath: track?.file?.path || '',
      playing: Boolean(track && !isPlaybackPaused()),
      positionSeconds: track ? getPlaybackPosition() : 0,
      durationSeconds: track ? getPlaybackDuration() : 0,
      force
    }
  }));
}

export function updateTaskbarPlaybackProgress() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;

  const trackIsLoaded = state.currentTrackIndex >= 0 &&
    Boolean(state.activeQueue[state.currentTrackIndex]) &&
    (audioVars.nativeAudioActive || Boolean(audio.currentSrc || audio.src));
  const duration = getPlaybackDuration();
  const position = getPlaybackPosition();
  const progress = trackIsLoaded && Number.isFinite(duration) && duration > 0
    ? Math.round(Math.max(0, Math.min(1, position / duration)) * 100)
    : (trackIsLoaded ? 0 : null);
  const paused = Boolean(trackIsLoaded && isPlaybackPaused());

  updateWindowsMediaPosition();

  // Evitar IPC redundante cada 250ms si el porcentaje entero y el estado de pausa no cambiaron
  const normalizedPercent = progress === null ? -1 : progress;
  if (normalizedPercent === audioVars.lastSentTaskbarPercent && paused === audioVars.lastSentTaskbarPaused) {
    return;
  }
  audioVars.lastSentTaskbarPercent = normalizedPercent;
  audioVars.lastSentTaskbarPaused = paused;

  audioVars.queuedTaskbarProgress = { progress, paused };
  if (audioVars.taskbarProgressInFlight) return;

  audioVars.taskbarProgressInFlight = true;
  void (async () => {
    try {
      while (audioVars.queuedTaskbarProgress) {
        const next = audioVars.queuedTaskbarProgress;
        audioVars.queuedTaskbarProgress = null;
        await invoke('set_taskbar_playback_progress', next);
      }
    } catch (error) {
      console.error('No se pudo actualizar el progreso de la barra de tareas:', error);
      audioVars.queuedTaskbarProgress = null;
    } finally {
      audioVars.taskbarProgressInFlight = false;
      if (audioVars.queuedTaskbarProgress) updateTaskbarPlaybackProgress();
    }
  })();
}

export function updateWindowsMediaPosition(force = false) {
  const invoke = window.__TAURI__?.core?.invoke;
  const track = state.currentTrackIndex < 0 ? null : state.activeQueue[state.currentTrackIndex];
  const duration = getPlaybackDuration();
  const position = getPlaybackPosition();
  if (!invoke || !track || !Number.isFinite(duration) || duration <= 0) return;
  const now = performance.now();
  if (!force && now - audioVars.lastNativePositionUpdate < 1000) return;
  audioVars.lastNativePositionUpdate = now;
  void invoke('seek_windows_media_position', {
    positionSeconds: position,
    durationSeconds: duration
  }).catch(() => {});
}

export function updateWindowsMediaPlayback(playing, force = false) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  const isPlaying = Boolean(playing);
  if (!force && audioVars.lastSentWindowsPlaying === isPlaying) return;
  audioVars.lastSentWindowsPlaying = isPlaying;

  void invoke('update_windows_media_playback', {
    playing: isPlaying,
    positionSeconds: getPlaybackPosition(),
    durationSeconds: getPlaybackDuration()
  }).catch(error => {
    console.error('No se pudo actualizar el estado multimedia de Windows:', error);
  });
}

/**
 * Envía metadatos a SMTC de Windows.
 * Si hay `coverPath` local en disco, se pasa directamente la ruta a Rust para evitar
 * hacer fetch() + Blob + FileReader.readAsDataURL (varios MB en Base64 en el heap de V8).
 */
export async function updateWindowsMediaMetadata(track) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return;
  const generation = ++audioVars.nativeArtworkGeneration;

  // Preferir siempre ruta en disco: Rust lee el archivo (sin Base64 ni FileReader en el heap de V8).
  let diskCoverPath = null;
  if (track.coverPath && track.coverPath !== 'none' && !String(track.coverPath).startsWith('data:')) {
    diskCoverPath = track.coverPath;
  }

  // data: muy pequeña (placeholder): sin FileReader.
  // blob: se omite — no materializar varios MB en Base64 en el renderer.
  let artworkBase64 = null;
  if (!diskCoverPath) {
    const coverUrl = resolveCoverUrl(track);
    if (typeof coverUrl === 'string' && coverUrl.startsWith('data:image/')) {
      const payload = coverUrl.split(',')[1] || '';
      if (payload.length > 0 && payload.length <= 96 * 1024) {
        artworkBase64 = payload;
      }
    }
  }

  if (generation !== audioVars.nativeArtworkGeneration ||
      state.activeQueue[state.currentTrackIndex] !== track) return;
  void invoke('update_windows_media_metadata', {
    metadata: {
      title: track.title || 'Desconocido',
      artist: track.artist || 'Desconocido',
      album: track.album || '',
      artworkPath: diskCoverPath,
      artworkBase64
    }
  }).catch(error => {
    console.error('No se pudieron actualizar los metadatos multimedia de Windows:', error);
  });
}

export function initWindowsMediaControlListener() {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return;
  void listen('windows-media-control', event => {
    const { action, positionSeconds } = event.payload || {};
    if (action === 'play' && isPlaybackPaused()) togglePlay();
    else if (action === 'pause' && !isPlaybackPaused()) togglePlay();
    else if (action === 'next') void nextSong(false);
    else if (action === 'previous') prevSong();
    else if (action === 'seek' && Number.isFinite(positionSeconds)) {
      void seekPlayback(positionSeconds);
      updateWindowsMediaPosition(true);
      notifyDiscordPresence(true);
    }
  }).catch(error => {
    console.error('No se pudieron escuchar los controles multimedia de Windows:', error);
  });
}
