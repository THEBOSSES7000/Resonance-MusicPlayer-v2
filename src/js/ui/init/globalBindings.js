// UI · Eventos globales: cierre de menús, volumen, persistencia de orden, letras, carga de artista y editor de perfil.

import { getNowPlayingFsLayout } from '../nowPlayingFs.js';
import { artistLoadMoreButton, customContextMenu, profileEditorModal, profileEditorPhotoInput, profileEditorStatus } from '../dom.js';
import { closeCustomContextMenu } from '../contextMenu.js';
import { syncLyricsDockVolumeFromMain } from '../lyricsDock.js';
import { loadFolderSortMode, loadPlaylistsViewSortMode, loadTrackSortModeForView } from '../sorting.js';
import { audio, getPlaybackPosition } from '../../audioPlayer.js';
import { state } from '../../state.js';
import { stopLyricsActiveRowAnimation, updateActiveRowFill, updateSyncedLyricsProgress } from '../lyricsRender.js';
import { uiVars } from '../sharedState.js';
import { ARTIST_TRACK_PAGE_SIZE, renderPlaylistDetailView } from '../playlistDetail.js';
import { bindArtistSearchPanel, closeProfileEditor, prepareProfilePhoto, saveProfileEditor, setProfileEditorPhoto } from '../profileEditor.js';

let lyricsPlaybackListenersInitialized = false;

/** Eventos globales: cierre de menús, volumen, persistencia de orden, letras, carga de artista y editor de perfil. */
export function bindGlobalEvents() {
  // Solo restaurar preferencia de layout; no activar pantalla completa al arrancar
  try {
    document.body.classList.remove('now-playing-fs');
    const layout = getNowPlayingFsLayout();
    document.body.classList.toggle('np-fs-swapped', layout === 'swapped');
    document.body.classList.toggle('np-fs-centered', layout === 'centered');
  } catch (_) {}
  // Cerrar menú contextual de pantalla completa al clicar fuera
  document.addEventListener('pointerdown', (e) => {
    try {
      if (!customContextMenu || !customContextMenu.classList.contains('open')) return;
      if (e.target && customContextMenu.contains(e.target)) return;
      if (e.target?.closest?.('#lyrics-focus-more-btn')) return;
      closeCustomContextMenu();
    } catch (_) {}
  }, true);

  // Volumen en pantalla completa (Now Playing FS)
  const npFsVol = document.getElementById('np-fs-volume-range');
  const mainVol = document.getElementById('volume-range');
  npFsVol?.addEventListener('input', () => {
    if (!mainVol) return;
    mainVol.value = npFsVol.value;
    mainVol.dispatchEvent(new Event('input', { bubbles: true }));
    syncLyricsDockVolumeFromMain();
  });
  document.getElementById('np-fs-volume-mute')?.addEventListener('click', () => {
    const muteBtn = document.getElementById('player-mute-btn') || document.getElementById('btn-mute');
    if (muteBtn) muteBtn.click();
    else if (mainVol) {
      const cur = Number(mainVol.value) || 0;
      if (cur > 0) {
        mainVol.dataset.prevVolume = String(cur);
        mainVol.value = '0';
      } else {
        mainVol.value = mainVol.dataset.prevVolume || '80';
      }
      mainVol.dispatchEvent(new Event('input', { bubbles: true }));
    }
    syncLyricsDockVolumeFromMain();
  });
  mainVol?.addEventListener('input', () => syncLyricsDockVolumeFromMain());



    window.addEventListener('pn-sort-persist-mode-changed', () => {
    loadTrackSortModeForView();
    loadFolderSortMode();
    loadPlaylistsViewSortMode();
  });

  if (!lyricsPlaybackListenersInitialized) {
    lyricsPlaybackListenersInitialized = true;
    audio.addEventListener('play', () => {
      if (state.isLyricsOpen) {
        updateSyncedLyricsProgress(getPlaybackPosition());
      }
    });
    audio.addEventListener('pause', () => {
      updateActiveRowFill(getPlaybackPosition());
      stopLyricsActiveRowAnimation();
    });
  }

  artistLoadMoreButton?.addEventListener('click', () => {
    if (state.currentView !== 'artist' || uiVars.isLoadingMoreTrackRows) return;
    const previousVisibleCount = uiVars.detailVisibleCount;
    uiVars.detailVisibleCount += ARTIST_TRACK_PAGE_SIZE;
    uiVars.isLoadingMoreTrackRows = true;
    void renderPlaylistDetailView({ append: true, previousVisibleCount })
      .catch(error => console.error('No se pudieron cargar más canciones del artista:', error))
      .finally(() => { uiVars.isLoadingMoreTrackRows = false; });
  });

  document.getElementById('profile-editor-close')?.addEventListener('click', closeProfileEditor);
  document.getElementById('profile-editor-cancel')?.addEventListener('click', closeProfileEditor);
  document.getElementById('profile-editor-save')?.addEventListener('click', saveProfileEditor);
  document.getElementById('profile-editor-photo-pick')?.addEventListener('click', () => profileEditorPhotoInput?.click());
  document.getElementById('profile-editor-photo-remove')?.addEventListener('click', () => {
    uiVars.profileEditorPhotoData = null;
    setProfileEditorPhoto(null);
  });
  profileEditorPhotoInput?.addEventListener('change', async () => {
    const file = profileEditorPhotoInput.files?.[0];
    if (!file) return;
    profileEditorStatus.hidden = true;
    try {
      uiVars.profileEditorPhotoData = await prepareProfilePhoto(file);
      setProfileEditorPhoto(uiVars.profileEditorPhotoData);
    } catch (error) {
      profileEditorStatus.textContent = error.message || 'No se pudo procesar la imagen.';
      profileEditorStatus.hidden = false;
    }
  });
  profileEditorModal?.addEventListener('click', event => {
    if (event.target === profileEditorModal) event.stopPropagation();
  });
  bindArtistSearchPanel();
}
