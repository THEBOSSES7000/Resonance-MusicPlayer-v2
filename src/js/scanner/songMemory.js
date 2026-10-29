// Biblioteca · Compactar objetos de canción para reducir memoria retenida.

/**
 * Quita campos pesados o temporales que no hacen falta en la lista general.
 * Las letras y buffers se cargan bajo demanda (como ya se hace al abrir letras).
 */
export function compactSong(song) {
  if (!song || typeof song !== 'object') return song;

  // Letras: no retener texto completo de toda la biblioteca
  if (song.lyrics != null) {
    song.lyrics = null;
    song.lyricsLoaded = false;
  }

  // data: URLs de carátula son enormes; si ya hay path de caché no hace falta
  if (typeof song.coverUrl === 'string' && song.coverUrl.startsWith('data:image/')) {
    // Se conservará hasta que el guardado de caché la materialice; no tocar aquí si es el único cover
  }

  // URL de audio web / blobs
  if (song.audioUrl && typeof song.audioUrl === 'string' && song.audioUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(song.audioUrl); } catch (_) {}
    song.audioUrl = null;
  }

  // Campos de escaneo temporal
  if ('rawTagDump' in song) delete song.rawTagDump;
  if ('pictureData' in song) delete song.pictureData;
  if ('_metadataRaw' in song) delete song._metadataRaw;

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
