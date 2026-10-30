// Biblioteca · Sincronización puntual con SQLite (sin reescribir toda la biblioteca).

function invoke(cmd, args) {
  const fn = window.__TAURI__?.core?.invoke;
  if (!fn) return Promise.resolve(null);
  return fn(cmd, args);
}

/** Actualiza solo campos cambiados de una pista en SQLite. */
export function dbUpdateTrackFields(song, fields = {}) {
  const path = song?.file?.path || song?.path || fields.path;
  if (!path) return Promise.resolve();
  return invoke('db_update_track_fields', {
    path,
    isFavorite: fields.isFavorite ?? (fields.is_favorite ?? null),
    unavailable: fields.unavailable ?? null,
    favoriteAddedAt: fields.favoriteAddedAt ?? null,
    newPath: fields.newPath ?? null,
    title: fields.title ?? null,
    artist: fields.artist ?? null,
    album: fields.album ?? null,
    duration: fields.duration ?? null,
    coverUrl: fields.coverUrl ?? null,
    playCount: fields.playCount ?? null,
  }).catch(err => {
    console.warn('[dbSync] db_update_track_fields:', err);
  });
}

/** Upsert completo de una pista (tras reubicar / metadatos nuevos). */
export function dbUpsertTrack(song) {
  const path = song?.file?.path || song?.path;
  if (!path) return Promise.resolve();
  const track = {
    path,
    name: song.file?.name || song.name || null,
    directoryPath: song.file?.directoryPath || null,
    relativePath: song.file?.webkitRelativePath || song.relativePath || '',
    size: song.file?.size || 0,
    lastModified: song.file?.lastModified || 0,
    metadataParserVersion: song.metadataParserVersion || 0,
    title: song.title || null,
    artist: song.artist || null,
    album: song.album || null,
    trackNumber: song.trackNumber ?? null,
    coverUrl: song.coverPath || (typeof song.coverUrl === 'string' ? song.coverUrl : null),
    duration: song.duration || 0,
    sampleRate: song.sampleRate ?? null,
    channels: song.channels ?? null,
    bitDepth: song.bitDepth ?? null,
    codec: song.codec || null,
    genre: song.genre || null,
    replayGainDb: song.replayGainDb ?? null,
    isFavorite: Boolean(song.isFavorite),
    unavailable: Boolean(song.unavailable),
    metadataLoaded: Boolean(song.metadataLoaded),
    favoriteAddedAt: song.favoriteAddedAt ?? null,
    playCount: song.playCount || 0,
  };
  return invoke('db_upsert_track', { track }).catch(err => {
    console.warn('[dbSync] db_upsert_track:', err);
  });
}
