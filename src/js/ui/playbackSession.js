// UI · Persistencia y restauración de la sesión de reproducción.

import { audio, isPlaybackPaused, loadSong, stopPlaybackForDeletedFile } from '../audioPlayer.js';
import { state } from '../state.js';
import { renderQueue } from './queueHistory.js';
import { playFromContext } from './playback.js';

let playbackSessionPersistenceReady = false;

let preservePlaybackSnapshotWhileEmpty = false;

const PLAYBACK_SESSION_STORAGE_KEY = 'resonance_playback_session';

const LEGACY_PLAYBACK_SESSION_STORAGE_KEY = 'pn_playback_session';

function getPlaybackTrackReference(song) {
  return {
    path: song.file?.path || null,
    name: song.file?.name || null,
    title: song.title || '',
    artist: song.artist || '',
    album: song.album || ''
  };
}

export function persistPlaybackSession(isPlaying = !isPlaybackPaused()) {
  if (!playbackSessionPersistenceReady) return;
  if (state.currentTrackIndex < 0 || !state.activeQueue[state.currentTrackIndex]) {
    if (!preservePlaybackSnapshotWhileEmpty) {
      const emptySnapshot = {
        queue: [],
        currentIndex: -1,
        currentTime: 0,
        isPlaying: false,
        title: 'Cola de reproducción',
        contextId: null
      };
      try {
        localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, JSON.stringify(emptySnapshot));
      } catch (error) {
        console.error('No se pudo guardar la sesión vacía de reproducción:', error);
      }
    }
    return;
  }
  preservePlaybackSnapshotWhileEmpty = false;

  const snapshot = {
    queue: state.activeQueue.map(getPlaybackTrackReference),
    currentIndex: state.currentTrackIndex,
    currentTime: 0,
    isPlaying,
    title: state.activeQueueTitle,
    contextId: state.activeContextId
  };
  try {
    localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.error('No se pudo guardar la sesión de reproducción:', error);
  }
}

function getPlaybackTrackReferenceKey(reference) {
  if (reference.path) return `path:${String(reference.path).replaceAll('\\', '/').toLowerCase()}`;
  return `meta:${reference.name || ''}:${reference.title || ''}:${reference.artist || ''}:${reference.album || ''}`.toLowerCase();
}

export async function initializePlaybackSession() {
  playbackSessionPersistenceReady = false;

  const restoreEnabled = localStorage.getItem('pn_restore_playback_session') !== 'false';
  preservePlaybackSnapshotWhileEmpty = !restoreEnabled;
  let snapshot = null;
  if (restoreEnabled) {
    try {
      const currentSnapshot = localStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
      const legacySnapshot = currentSnapshot ? null : localStorage.getItem(LEGACY_PLAYBACK_SESSION_STORAGE_KEY);
      const storedSnapshot = currentSnapshot || legacySnapshot;
      snapshot = JSON.parse(storedSnapshot || 'null');
      if (legacySnapshot && snapshot) {
        localStorage.setItem(PLAYBACK_SESSION_STORAGE_KEY, legacySnapshot);
        localStorage.removeItem(LEGACY_PLAYBACK_SESSION_STORAGE_KEY);
      }
    } catch (error) {
      console.error('No se pudo leer la sesión de reproducción guardada:', error);
      localStorage.removeItem(PLAYBACK_SESSION_STORAGE_KEY);
      localStorage.removeItem(LEGACY_PLAYBACK_SESSION_STORAGE_KEY);
    }
  } else {
    state.activeQueue = [];
    state.activeQueueTitle = 'Cola de reproducción';
    state.activeContextId = null;
    state.currentTrackIndex = -1;
    stopPlaybackForDeletedFile();
    renderQueue();
    playbackSessionPersistenceReady = true;
    return;
  }

  const savedQueue = Array.isArray(snapshot?.queue) ? snapshot.queue : [];
  if (savedQueue.length > 0) {
    const tracksByReference = new Map(state.localMusicFiles.map(song => [
      getPlaybackTrackReferenceKey(getPlaybackTrackReference(song)),
      song
    ]));
    const restoredEntries = savedQueue
      .map((reference, index) => ({
        track: reference && typeof reference === 'object'
          ? tracksByReference.get(getPlaybackTrackReferenceKey(reference))
          : null,
        savedIndex: index
      }))
      .filter(entry => entry.track);
    const restoredQueue = restoredEntries.map(entry => entry.track);

    if (restoredQueue.length > 0) {
      state.activeQueue = restoredQueue;
      state.activeQueueTitle = snapshot.title || 'Cola de reproducción';
      state.activeContextId = snapshot.contextId || state.activeQueueTitle;
      state.currentTrackIndex = -1;
      const savedCurrentIndex = Math.max(0, Math.min(savedQueue.length - 1, Number(snapshot.currentIndex) || 0));
      const restoredCurrentIndex = restoredEntries.findIndex(entry => entry.savedIndex >= savedCurrentIndex);
      const currentIndex = restoredCurrentIndex >= 0 ? restoredCurrentIndex : restoredQueue.length - 1;
      const savedAudio = audio;
      const metadataReady = new Promise(resolve => {
        const cleanup = () => {
          savedAudio.removeEventListener('loadedmetadata', onLoaded);
          savedAudio.removeEventListener('error', onError);
        };
        const onLoaded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          console.error('No se pudo cargar el archivo de la sesión de reproducción guardada.');
          resolve();
        };
        savedAudio.addEventListener('loadedmetadata', onLoaded, { once: true });
        savedAudio.addEventListener('error', onError, { once: true });
      });
      await loadSong(currentIndex, false, false);
      await metadataReady;
      if (snapshot.isPlaying) {
        try {
          await audio.play();
        } catch (error) {
          console.error('No se pudo reanudar la reproducción guardada:', error);
        }
      }
    } else {
      console.warn('No se encontraron las canciones de la sesión guardada en las carpetas configuradas.');
    }
  }

  if (state.activeQueue.length === 0 && state.localMusicFiles.length > 0 && !snapshot) {
    playFromContext(state.localMusicFiles.slice(0, 25), 0, 'Recién agregadas', false);
  } else if (state.activeQueue.length === 0) {
    renderQueue();
  }

  playbackSessionPersistenceReady = true;
}

window.addEventListener('pagehide', () => persistPlaybackSession());
