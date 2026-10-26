function safeJsonParse(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

export const state = {
  localMusicFiles: [],
  /** Índice O(1): soporta búsqueda por path normalizado y por id numérico/string */
  songsById: new Map(),
  activeQueue: [],
  activeQueueTitle: "Cola de reproducción",
  activeContextId: null,
  playbackHistory: [],
  isHistoryOpen: false,
  isCoverExpanded: false,
  currentTrackIndex: -1,
  isShuffle: localStorage.getItem('pn_keep_shuffle') === 'true',
  repeatMode: localStorage.getItem('pn_keep_repeat') === 'true' ? 'all' : 'off',
  playlists: safeJsonParse(localStorage.getItem('pn_playlists'), []),
  quickAccess: safeJsonParse(localStorage.getItem('pn_quick_access'), []),
  configuredFolders: safeJsonParse(localStorage.getItem('pn_folders_info'), []),
  nativeMusicDirectories: [],
  playCounts: safeJsonParse(localStorage.getItem('pn_play_counts'), {}),
  isQueueOpen: true,
  queueVisibleCount: 25,
  musicVisibleCount: 50,
  isLyricsOpen: false,
  playlistSortMode: localStorage.getItem('pn_sort_mode') || 'custom',
  playlistTrackDragReorderEnabled: localStorage.getItem('pn_playlist_track_drag_reorder') !== 'false',
  queueTrackDragReorderEnabled: localStorage.getItem('pn_queue_track_drag_reorder') !== 'false',
  playlistsViewSortMode: localStorage.getItem('pn_sort_playlists_hub') || localStorage.getItem('pn_sort_playlists_view') || 'name',
  playlistsViewLayout: localStorage.getItem('pn_playlists_layout') || 'standard',
  trackSortMode: localStorage.getItem('pn_sort_tracks_global')
    || localStorage.getItem('pn_sort_tracks_music')
    || 'custom',
  folderSortMode: localStorage.getItem('pn_sort_folders') || 'name',
  currentView: 'home',
  viewHistory: [],
  searchQuery: '',
  searchTab: 'songs',
  artistName: null,
  artistSortMode: localStorage.getItem('pn_sort_tracks_artist') || 'plays',
  albumTitle: null,
  albumArtistName: null,
  albumSortMode: localStorage.getItem('pn_sort_album') || 'track',
  currentPlaylistId: null,
  currentFolderId: null,
  editingPlaylistId: null,
  editingFolderId: null
};

/** Índice secundario O(1) por "título:::artista" para evitar .find() lineales al hidratar playlists */
const songsByTitleArtist = new Map();

/** Caché acotada de rutas de carátula -> URL de asset para reutilizar la misma referencia de string en V8 */
const coverSrcCache = new Map();
const MAX_COVER_SRC_CACHE = 1500;

/** Cola acotada para revocar ObjectURLs de audio en modo web (evita retener Blobs de canciones anteriores) */
const activeWebAudioBlobs = [];
const MAX_ACTIVE_AUDIO_BLOBS = 3;

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function normalizePathKey(path) {
  if (typeof path !== 'string' || !path) return '';
  return path.replace(/\\/g, '/').toLowerCase();
}

function titleArtistKey(title, artist) {
  const t = String(title || '').trim().toLowerCase();
  const a = String(artist || '').trim().toLowerCase();
  return t || a ? `${t}:::${a}` : '';
}

/** Clave estable para play counts / favoritos: path normalizado, con fallback title:::artist. */
export function playCountKey(song) {
  if (!song) return null;
  const path = song.file?.path || song.path;
  if (typeof path === 'string' && path) {
    return `path:${normalizePathKey(path)}`;
  }
  const title = song.title || '';
  const artist = song.artist || '';
  if (title || artist) return `${title}:::${artist}`;
  return null;
}

export function incrementPlayCount(song) {
  if (!song) return;
  const primary = playCountKey(song);
  if (!primary) return;

  // Migrar conteo legacy title:::artist → path si aplica
  const legacy = `${song.title || ''}:::${song.artist || ''}`;
  let count = state.playCounts[primary] || 0;
  if (primary.startsWith('path:') && legacy && state.playCounts[legacy]) {
    count = Math.max(count, state.playCounts[legacy] || 0);
    delete state.playCounts[legacy];
  }
  count += 1;
  state.playCounts[primary] = count;
  song.playCount = count;

  // Sincronizar también en la instancia canónica de la biblioteca si `song` era un clon
  const canonical = getSongByIdOrPath(song.file?.path || song.path || song.id);
  if (canonical && canonical !== song) {
    canonical.playCount = count;
  }

  try {
    localStorage.setItem('pn_play_counts', JSON.stringify(state.playCounts));
  } catch (_) {}
}

export function getPlayCount(song) {
  if (!song) return 0;
  const primary = playCountKey(song);
  if (primary && state.playCounts[primary]) return state.playCounts[primary];
  const legacy = `${song.title || ''}:::${song.artist || ''}`;
  return state.playCounts[legacy] || 0;
}

/** Clave estable: path > id */
export function songLookupKey(song) {
  if (!song) return null;
  const path = song.file?.path || song.path;
  if (typeof path === 'string' && path) return normalizePathKey(path);
  if (song.id != null && song.id !== '') return String(song.id);
  return null;
}

export function rebuildSongsIndex() {
  state.songsById.clear();
  songsByTitleArtist.clear();

  for (const song of state.localMusicFiles) {
    const key = songLookupKey(song);
    if (key) state.songsById.set(key, song);
    if (song.id != null && song.id !== '') {
      state.songsById.set(String(song.id), song);
    }
    const taKey = titleArtistKey(song.title, song.artist);
    if (taKey && !songsByTitleArtist.has(taKey)) {
      songsByTitleArtist.set(taKey, song);
    }
  }
}

export function reindexSong(song) {
  if (!song) return;
  const key = songLookupKey(song);
  if (key) state.songsById.set(key, song);
  if (song.id != null && song.id !== '') {
    state.songsById.set(String(song.id), song);
  }
  const taKey = titleArtistKey(song.title, song.artist);
  if (taKey) {
    songsByTitleArtist.set(taKey, song);
  }
}

export function removeSongFromIndex(song) {
  if (!song) return;
  const key = songLookupKey(song);
  if (key) state.songsById.delete(key);
  if (song.id != null) state.songsById.delete(String(song.id));
  const taKey = titleArtistKey(song.title, song.artist);
  if (taKey && songsByTitleArtist.get(taKey) === song) {
    songsByTitleArtist.delete(taKey);
  }
}

export function getSongByIdOrPath(idOrPath) {
  if (idOrPath == null || idOrPath === '') return null;
  const raw = String(idOrPath);
  const direct = state.songsById.get(raw);
  if (direct) return direct;
  const normalized = normalizePathKey(raw);
  return normalized ? (state.songsById.get(normalized) || null) : null;
}

function convertDiskPathToAssetUrl(path) {
  const normalizedKey = normalizePathKey(path);
  if (coverSrcCache.has(normalizedKey)) {
    return coverSrcCache.get(normalizedKey);
  }
  const convert = window.__TAURI__?.core?.convertFileSrc;
  if (typeof convert !== 'function') return null;
  try {
    const src = convert(path);
    if (coverSrcCache.size >= MAX_COVER_SRC_CACHE) {
      const oldestKey = coverSrcCache.keys().next().value;
      if (oldestKey !== undefined) coverSrcCache.delete(oldestKey);
    }
    coverSrcCache.set(normalizedKey, src);
    return src;
  } catch (error) {
    console.warn('No se pudo convertir la carátula:', path, error);
    return null;
  }
}

export function clearCoverUrlCache() {
  coverSrcCache.clear();
}

export function resolveCoverUrl(song) {
  if (!song) return null;

  // Si ya se determinó que la pista no tiene carátula, evitar reintentos
  if (song.coverPath === 'none') return null;

  const isUsableUrl = value =>
    typeof value === 'string' && (
      value.startsWith('blob:') ||
      value.startsWith('data:') ||
      value.startsWith('http://') ||
      value.startsWith('https://') ||
      value.startsWith('asset:') ||
      value.includes('asset.localhost') ||
      value.includes('tauri://')
    );

  const isDiskPath = value =>
    typeof value === 'string' &&
    value.length > 0 &&
    value !== 'none' &&
    !isUsableUrl(value);

  if (isUsableUrl(song.coverUrl)) return song.coverUrl;

  const diskCandidates = [song.coverPath, song.coverUrl].filter(isDiskPath);
  if (diskCandidates.length && typeof window !== 'undefined' && window.__TAURI__?.core?.convertFileSrc) {
    for (const path of diskCandidates) {
      const src = convertDiskPathToAssetUrl(path);
      if (src) {
        song.coverPath = song.coverPath || path;
        song.coverUrl = src;
        return src;
      }
    }
  }

  try {
    const path = song.file?.path || song.path;
    if (path) {
      const lib = getSongByIdOrPath(path);
      if (lib && lib !== song) {
        if (lib.coverPath === 'none') {
          song.coverPath = 'none';
          return null;
        }
        if (isUsableUrl(lib.coverUrl)) {
          song.coverUrl = lib.coverUrl;
          song.coverPath = lib.coverPath || song.coverPath;
          return lib.coverUrl;
        }
        if (isDiskPath(lib.coverPath) && window.__TAURI__?.core?.convertFileSrc) {
          const src = convertDiskPathToAssetUrl(lib.coverPath);
          if (src) {
            song.coverPath = lib.coverPath;
            song.coverUrl = src;
            lib.coverUrl = src;
            return src;
          }
        }
      }
    }
  } catch (_) { /* ignore */ }

  return null;
}

function trackWebAudioBlob(song, blobUrl) {
  const existingIdx = activeWebAudioBlobs.findIndex(entry => entry.song === song);
  if (existingIdx !== -1) activeWebAudioBlobs.splice(existingIdx, 1);

  activeWebAudioBlobs.push({ song, blobUrl });
  while (activeWebAudioBlobs.length > MAX_ACTIVE_AUDIO_BLOBS) {
    const oldest = activeWebAudioBlobs.shift();
    if (oldest?.blobUrl) {
      try { URL.revokeObjectURL(oldest.blobUrl); } catch (_) {}
      if (oldest.song && oldest.song.audioUrl === oldest.blobUrl) {
        oldest.song.audioUrl = null;
      }
    }
  }
}

export function resolveAudioUrl(song) {
  if (!song) return null;
  if (song.audioUrl) return song.audioUrl;
  if (song.file?.audioUrl) {
    song.audioUrl = song.file.audioUrl;
    return song.audioUrl;
  }
  const path = song.file?.path || song.path;
  if (path && song.file?.isNativeFile !== false && typeof window !== 'undefined' && window.__TAURI__?.core?.convertFileSrc) {
    try {
      if (song.file?.isNativeFile || (typeof path === 'string' && !path.startsWith('blob:'))) {
        // No guardar audioUrl permanentemente en miles de objetos si es nativo; devolver al vuelo
        return window.__TAURI__.core.convertFileSrc(path);
      }
    } catch (error) {
      console.warn('No se pudo resolver audioUrl:', error);
    }
  }
  if (song.file && typeof song.file.slice === 'function' && !song.file.isNativeFile) {
    try {
      const blobUrl = URL.createObjectURL(song.file);
      song.audioUrl = blobUrl;
      trackWebAudioBlob(song, blobUrl);
      return blobUrl;
    } catch (error) {
      console.warn('No se pudo crear blob de audio:', error);
    }
  }
  return null;
}

/** Referencia mínima para persistir playlists (sin clonar la biblioteca). */
export function compactSongRef(song) {
  if (!song) return null;
  return {
    id: song.id,
    path: song.file?.path || song.path || null,
    title: song.title || '',
    artist: song.artist || ''
  };
}

export function resolveSongRef(ref) {
  if (!ref) return null;

  // 1. Priorizar siempre la instancia canónica en state.songsById (evita retener clones { ...song })
  const path = ref.path || ref.file?.path;
  if (path) {
    const foundByPath = getSongByIdOrPath(path);
    if (foundByPath) {
      if (ref.isEnqueuedNext) foundByPath.isEnqueuedNext = true;
      return foundByPath;
    }
  }
  if (ref.id != null && ref.id !== '') {
    const foundById = getSongByIdOrPath(ref.id);
    if (foundById) {
      if (ref.isEnqueuedNext) foundById.isEnqueuedNext = true;
      return foundById;
    }
  }

  // 2. Búsqueda O(1) por título y artista en lugar de .find() lineal
  if (ref.title || ref.artist) {
    const taKey = titleArtistKey(ref.title, ref.artist);
    const foundByTa = taKey ? songsByTitleArtist.get(taKey) : null;
    if (foundByTa) {
      if (ref.isEnqueuedNext) foundByTa.isEnqueuedNext = true;
      return foundByTa;
    }
  }

  // 3. Fallback si aún no se indexó la biblioteca pero ya es un objeto de pista válido
  if (ref.file && (ref.metadataLoaded !== undefined || ref.isUnresolvedM3U)) {
    return ref;
  }

  return null;
}

export function persistPlaylists() {
  try {
    const compact = (state.playlists || []).map(playlist => ({
      ...playlist,
      songs: (playlist.songs || [])
        .map(song => compactSongRef(song))
        .filter(Boolean)
    }));
    localStorage.setItem('pn_playlists', JSON.stringify(compact));
  } catch (error) {
    console.warn('No se pudieron guardar las playlists compactas:', error);
  }
}

/** Tras cargar la biblioteca, apunta playlist.songs a los objetos canónicos reales. */
export function hydratePlaylists() {
  if (!Array.isArray(state.playlists)) {
    state.playlists = [];
    return;
  }
  state.playlists = state.playlists.map(playlist => ({
    ...playlist,
    songs: (playlist.songs || [])
      .map(ref => resolveSongRef(ref))
      .filter(Boolean)
  }));
}

export function hydrateQueueAndHistory() {
  state.activeQueue = (state.activeQueue || [])
    .map(ref => resolveSongRef(ref) || ref)
    .filter(Boolean);
  state.playbackHistory = (state.playbackHistory || [])
    .map(ref => resolveSongRef(ref) || ref)
    .filter(Boolean);
}