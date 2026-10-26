// Biblioteca · Utilidades de archivos y detección de entorno.

export function getFileKey(file) {
  if (!file) return '';
  const normalizePath = path => path.replace(/\\/g, '/').toLowerCase();
  if (file.path) return normalizePath(file.path);
  const relativePath = normalizePath(file.webkitRelativePath || '');
  return relativePath || `${file.name.toLowerCase()}|${file.size}|${file.lastModified || 0}`;
}

export function isTauriRuntime() {
  return Boolean(window.__TAURI__?.core?.invoke && window.__TAURI__?.core?.convertFileSrc);
}

export function isNativeDiskPath(path) {
  return typeof path === 'string' && (/^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path) || path.startsWith('/'));
}

export function getFallbackMetadata(file) {
  const cleanName = file.name.replace(/\.[^.]*$/, '');
  const separator = [' - ', ' – ', ' — '].find(value => cleanName.includes(value));
  if (!separator) return { title: cleanName, artist: 'Desconocido' };
  const parts = cleanName.split(separator);
  return {
    title: parts.slice(1).join(separator).trim() || cleanName,
    artist: parts[0].trim() || 'Desconocido'
  };
}
