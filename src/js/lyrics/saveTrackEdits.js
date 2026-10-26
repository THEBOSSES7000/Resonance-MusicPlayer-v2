// Letras · Guardado de ediciones de pista (etiquetas y carátula).

import { closeTrackEditor, dataUrlToBase64Parts, editTargetSong, refreshSongViews, setEditStatus } from './trackEditor.js';
import { getUi } from './uiBridge.js';
import { lyricsVars } from './sharedState.js';
import { isTauri, isTrackInLinkedMusicDirectory } from './utils.js';
import { parseLyricsText } from '../scanner.js';
import { getSongByIdOrPath, reindexSong, state } from '../state.js';
import { invalidateLyricsTranslationCache } from './translation.js';
import { getPlaybackPosition, isPlaybackPaused, loadSong, seekPlayback } from '../audioPlayer.js';

export async function saveTrackEdits() {
  if (!editTargetSong) return;
  const ui = await getUi();
  const song = editTargetSong;
  const title = document.getElementById('track-edit-title').value.trim();
  const artist = document.getElementById('track-edit-artist').value.trim();
  const album = document.getElementById('track-edit-album').value.trim();
  const year = document.getElementById('track-edit-year').value.trim();
  const trackNumber = document.getElementById('track-edit-track-number').value.trim();
  const discNumber = document.getElementById('track-edit-disc-number').value.trim();
  const genre = document.getElementById('track-edit-genre').value.trim();
  const lyricsRaw = document.getElementById('track-edit-lyrics').value;
  if (!title) {
    setEditStatus('El título no puede estar vacío.', true);
    return;
  }
  const oldFavKey = song.title + ':::' + song.artist;
  const newFavKey = title + ':::' + (artist || 'Desconocido');
  const proceed = await ui.showConfirmDialog({
    title: '¿Guardar cambios en el archivo?',
    message: 'Se escribirán los tags de "' + (song.file?.name || song.title) + '" en disco (título, artista, álbum, año, numeración, género, letra y portada).',
    confirmText: 'Guardar',
    cancelText: 'Cancelar',
  });
  if (!proceed) return;
  setEditStatus('Guardando en disco…');
  let coverBase64 = null;
  let coverMime = null;
  if (lyricsVars.editCoverDataUrl) {
    const parts = dataUrlToBase64Parts(lyricsVars.editCoverDataUrl);
    if (!parts) {
      setEditStatus('La imagen seleccionada no es JPG/PNG válida.', true);
      return;
    }
    coverBase64 = parts.base64;
    coverMime = parts.mime;
  }
  const filePath = song.file?.path;
  const canWriteToDisk = isTauri() && filePath && isTrackInLinkedMusicDirectory(filePath);
  if (isTauri() && filePath && !canWriteToDisk) {
    console.info('La pista está fuera de las carpetas vinculadas; los cambios no se escribirán en disco.');
  }
  if (canWriteToDisk) {
    try {
      await window.__TAURI__.core.invoke('update_track_tags', {
        update: {
          path: filePath,
          title, artist: artist || null, album: album || null, year: year || null,
          trackNumber: trackNumber || null,
          discNumber: discNumber || null,
          genre: genre || null,
          lyrics: lyricsRaw || null,
          coverBase64, coverMime,
          removeCover: lyricsVars.editCoverRemove && !lyricsVars.editCoverDataUrl,
        },
      });
    } catch (error) {
      console.error('Error escribiendo tags:', error);
      setEditStatus('No se pudo escribir en disco: ' + error, true);
      return;
    }
    song.title = title;
    song.artist = artist || 'Desconocido';
    song.album = album;
    song.year = year;
    song.trackNumber = trackNumber || song.trackNumber;
    song.discNumber = discNumber || song.discNumber;
    song.genre = genre || song.genre;
    song.lyrics = lyricsRaw.trim() ? parseLyricsText(lyricsRaw) : null;
    song.lyricsLoaded = true;
    if (lyricsVars.editCoverRemove && !lyricsVars.editCoverDataUrl) {
      if (song.coverUrl?.startsWith?.('blob:')) {
        try { URL.revokeObjectURL(song.coverUrl); } catch (_) {}
      }
      song.coverUrl = null;
      song.coverPath = 'none';
    } else if (lyricsVars.editCoverDataUrl) {
      if (song.coverUrl?.startsWith?.('blob:')) {
        try { URL.revokeObjectURL(song.coverUrl); } catch (_) {}
      }
      // En Tauri, pedir a Rust que actualice/genere el archivo en library-cache/covers
      // en lugar de dejar un Data URL Base64 gigante retenido en song.coverUrl.
      try {
        const scanned = await window.__TAURI__.core.invoke('scan_file_metadata', {
          path: filePath,
          includeLyrics: false
        });
        if (scanned?.coverPath) {
          song.coverPath = scanned.coverPath;
          song.coverUrl = null;
        } else {
          song.coverUrl = lyricsVars.editCoverDataUrl;
        }
      } catch {
        song.coverUrl = lyricsVars.editCoverDataUrl;
      }
    }
    song.metadataLoaded = true;
  } else {
    song.title = title;
    song.artist = artist || 'Desconocido';
    song.album = album;
    song.year = year;
    song.trackNumber = trackNumber || song.trackNumber;
    song.discNumber = discNumber || song.discNumber;
    song.genre = genre || song.genre;
    song.lyrics = lyricsRaw.trim() ? parseLyricsText(lyricsRaw) : null;
    song.lyricsLoaded = true;
    if (lyricsVars.editCoverRemove && !lyricsVars.editCoverDataUrl) {
      song.coverUrl = null;
      song.coverPath = 'none';
    } else if (lyricsVars.editCoverDataUrl) {
      song.coverUrl = lyricsVars.editCoverDataUrl;
    }
    try {
      localStorage.setItem('pn_meta_override_' + oldFavKey, JSON.stringify({ title: song.title, artist: song.artist, album: song.album }));
      if (song.lyrics) localStorage.setItem('pn_lyrics_override_' + newFavKey, lyricsRaw);
    } catch { /* ignore */ }
    setEditStatus(isTauri()
      ? 'La pista no pertenece a una carpeta vinculada; los cambios se aplicaron solo en esta sesión.'
      : 'Modo web: cambios aplicados solo en esta sesión (el navegador no puede escribir en disco).');
  }

  // Reindexar y sincronizar con la copia canónica si `song` era otra referencia
  reindexSong(song);
  const canonical = getSongByIdOrPath(song.file?.path || song.path || song.id);
  if (canonical && canonical !== song) {
    Object.assign(canonical, {
      title: song.title,
      artist: song.artist,
      album: song.album,
      year: song.year,
      trackNumber: song.trackNumber,
      discNumber: song.discNumber,
      genre: song.genre,
      lyrics: song.lyrics,
      lyricsLoaded: song.lyricsLoaded,
      coverPath: song.coverPath,
      coverUrl: song.coverUrl,
      metadataLoaded: true
    });
    reindexSong(canonical);
  }

  invalidateLyricsTranslationCache(song);
  try {
    const favKeys = new Set(JSON.parse(localStorage.getItem('pn_favorites_keys') || '[]'));
    if (favKeys.has(oldFavKey) && oldFavKey !== newFavKey) {
      favKeys.delete(oldFavKey);
      favKeys.add(newFavKey);
      localStorage.setItem('pn_favorites_keys', JSON.stringify([...favKeys]));
    }
    if (state.playCounts[oldFavKey] !== undefined && oldFavKey !== newFavKey) {
      state.playCounts[newFavKey] = state.playCounts[oldFavKey];
      delete state.playCounts[oldFavKey];
      localStorage.setItem('pn_play_counts', JSON.stringify(state.playCounts));
    }
  } catch { /* ignore */ }
  refreshSongViews(song);
  await ui.refreshSongDetailsIfOpen(song);

  // Si esta pista se está reproduciendo, reabrir el archivo tras reescribir tags.
  // Escribir portada/tags cambia el tamaño del encabezado (p.ej. ID3) y el decoder
  // puede quedar desfasado (~segundos de silencio o arranque tarde) hasta recargar.
  if (canWriteToDisk && filePath) {
    const current = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
    const currentPath = current?.file?.path || current?.path || '';
    const editedPath = String(filePath).replace(/\\/g, '/').toLowerCase();
    const sameTrack = current && (
      current === song ||
      current === canonical ||
      (current.id && song.id && current.id === song.id) ||
      (currentPath && currentPath.replace(/\\/g, '/').toLowerCase() === editedPath)
    );
    if (sameTrack) {
      try {
        const wasPaused = isPlaybackPaused();
        const resumeAt = Math.max(0, Number(getPlaybackPosition()) || 0);
        const idx = state.currentTrackIndex;
        await loadSong(idx, !wasPaused, false);
        if (resumeAt > 0.35) {
          try { await seekPlayback(resumeAt); } catch (_) {}
        }
      } catch (error) {
        console.warn('No se pudo recargar la pista tras editar metadata:', error);
      }
    }
  }

  closeTrackEditor();
  window.dispatchEvent(new Event('pn-save-library-cache'));
  await ui.showConfirmDialog({
    title: canWriteToDisk ? 'Cambios guardados' : 'Cambios aplicados',
    message: canWriteToDisk
      ? 'Metadatos y portada actualizados.'
      : 'Los cambios se aplicaron solo en esta sesión; el archivo en disco no se modificó.',
    confirmText: 'Entendido',
    showCancel: false
  });
}
