// Biblioteca · Compactar objetos de canción para reducir memoria retenida.

/**
 * Quita lo que no hace falta mantener en memoria en la lista general.
 * Las letras se cargan bajo demanda (como ya se hace al abrir letras).
 */
export function compactSong(song) {
  if (!song || typeof song !== 'object') return song;

  // Letras: no retener el texto completo de toda la biblioteca
  if (song.lyrics != null) {
    song.lyrics = null;
    song.lyricsLoaded = false;
  }

  // URL de audio web (blob): liberar la referencia
  if (song.audioUrl && typeof song.audioUrl === 'string' && song.audioUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(song.audioUrl); } catch (_) {}
    song.audioUrl = null;
  }

  return song;
}

/** Compacta toda la biblioteca en lotes para no bloquear el hilo principal. */
export function compactLibrarySongs(songs, { batchSize = 500 } = {}) {
  if (!Array.isArray(songs) || songs.length === 0) return Promise.resolve();
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + batchSize, songs.length);
      for (; i < end; i += 1) compactSong(songs[i]);
      if (i >= songs.length) {
        resolve();
        return;
      }
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(step, { timeout: 200 });
      } else {
        setTimeout(step, 0);
      }
    };
    step();
  });
}
