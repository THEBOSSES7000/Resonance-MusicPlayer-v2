// M3U/M3U8 parsing, including Resonance playlist metadata.

export function pathBasename(path) {
  return String(path || '').replace(/\\/g, '/').split('/').pop() || '';
}

export function splitArtistTitleText(text) {
  let raw = String(text || '')
    .replace(/\.[^.]+$/, '')
    .trim()
    .replace(/^\s*\d{1,3}(?:[._-]\d{1,3})?\s*[-–—.)]\s*/, '')
    .replace(/^\s*\d{1,3}(?:[._-]\d{1,3})?\s+/, '')
    .trim();
  if (!raw) return null;

  const spaced = raw.match(/^(.+?)\s+[-–—|~]+\s+(.+)$/);
  if (!spaced) return null;
  const left = spaced[1].trim();
  const right = spaced[2].trim();
  if (!left || !right) return null;
  return /^\d{1,4}$/.test(left)
    ? { artist: '', title: right }
    : { artist: left, title: right };
}

function unescapeM3UValue(value) {
  return String(value || '').replace(/\\(\\|n)/gi, (_, escaped) => escaped === '\\' ? '\\' : '\n');
}

export function parseM3UPlaylist(text, fallbackName = 'Playlist') {
  const metadata = { id: null, name: fallbackName, description: '', cover: null };
  const content = String(text || '').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^#EXT-RESONANCE-(ID|NAME|DESC|COVER): ?(.*)$/i);
    if (!match) continue;
    const [, key, value] = match;
    if (key.toUpperCase() === 'ID' && value.trim()) metadata.id = value.trim();
    if (key.toUpperCase() === 'NAME' && value.trim()) metadata.name = unescapeM3UValue(value.trim());
    if (key.toUpperCase() === 'DESC') metadata.description = unescapeM3UValue(value);
    if (key.toUpperCase() === 'COVER' && value.trim()) {
      const cover = value.trim();
      metadata.cover = /^data:image\//i.test(cover)
        ? cover
        : `data:image/webp;base64,${cover}`;
    }
  }
  return { ...metadata, entries: parseM3UEntries(content) };
}

export function parseM3UEntries(text) {
  const entries = [];
  let currentExtInf = null;
  String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#EXTINF:')) {
      const comma = trimmed.indexOf(',');
      if (comma < 0) return;
      const duration = Number(trimmed.slice(8, comma));
      const displayName = trimmed.slice(comma + 1).trim();
      const split = splitArtistTitleText(displayName);
      currentExtInf = {
        duration: Number.isFinite(duration) ? duration : 0,
        displayName,
        artist: split?.artist || '',
        title: split?.title || displayName
      };
      return;
    }
    if (trimmed.startsWith('#')) return;
    let sourcePath = trimmed;
    if (/^file:\/\//i.test(sourcePath)) {
      try {
        const fileUrl = new URL(sourcePath);
        const urlPath = decodeURIComponent(fileUrl.pathname);
        sourcePath = fileUrl.hostname && fileUrl.hostname !== 'localhost'
          ? `\\\\${fileUrl.hostname}${urlPath}`
          : urlPath;
        if (/^\/[a-z]:/i.test(sourcePath)) sourcePath = sourcePath.slice(1);
      } catch (_) {
        sourcePath = sourcePath.replace(/^file:\/\//i, '');
      }
    }
    sourcePath = sourcePath.replace(/\//g, '\\');
    const filename = pathBasename(trimmed);
    const fallbackTitle = filename.replace(/\.[^.]+$/, '');
    entries.push({
      sourcePath,
      filename,
      duration: currentExtInf?.duration || 0,
      artist: currentExtInf?.artist || '',
      title: currentExtInf?.title || fallbackTitle,
      displayName: currentExtInf?.displayName || fallbackTitle
    });
    currentExtInf = null;
  });
  return entries;
}

function normalizeM3UPath(path) {
  const value = String(path || '').replace(/^file:\/\//i, '').replace(/\//g, '\\');
  let root = '';
  let remainder = value;
  const drive = value.match(/^([a-z]:)\\/i);
  const unc = value.match(/^\\\\([^\\]+)\\([^\\]+)(?:\\|$)/);
  if (drive) {
    root = `${drive[1]}\\`;
    remainder = value.slice(root.length);
  } else if (unc) {
    root = `\\\\${unc[1]}\\${unc[2]}\\`;
    remainder = value.slice(unc[0].length);
  } else if (value.startsWith('\\')) {
    root = '\\';
    remainder = value.slice(1);
  }
  const parts = [];
  remainder.split('\\').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!root) parts.push(part);
      return;
    }
    parts.push(part);
  });
  return `${root}${parts.join('\\')}`.toLocaleLowerCase();
}

function absoluteM3UPath(entryPath, playlistPath) {
  const path = String(entryPath || '').replace(/^file:\/\//i, '');
  if (/^(?:[a-z]:\\|\\\\)/i.test(path)) return path;
  const parent = String(playlistPath || '').replace(/[\\/][^\\/]*$/, '');
  return parent ? `${parent}\\${path.replace(/\//g, '\\')}` : path;
}

export function findM3ULibraryTrack(entry, tracks, playlistPath = '') {
  const absolutePath = normalizeM3UPath(absoluteM3UPath(entry.sourcePath, playlistPath));
  const sourcePath = normalizeM3UPath(entry.sourcePath);
  const relativePath = sourcePath;
  const filename = pathBasename(entry.filename || entry.sourcePath).toLocaleLowerCase();
  const pathOf = song => song.file?.path || song.path || '';
  let match = tracks.find(song => normalizeM3UPath(pathOf(song)) === absolutePath);
  if (match) return match;
  match = tracks.find(song => normalizeM3UPath(song.relativePath || song.file?.webkitRelativePath || '') === relativePath);
  if (match) return match;
  match = tracks.find(song => {
    const songFilename = song.file?.name || pathBasename(pathOf(song));
    return String(songFilename).toLocaleLowerCase() === filename;
  });
  if (match) return match;
  return tracks.find(song => normalizeM3UPath(pathOf(song)) === sourcePath) || null;
}
