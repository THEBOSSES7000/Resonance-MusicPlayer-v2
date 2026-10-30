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

const ADDED_DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric' };
const addedDateFormatter = new Intl.DateTimeFormat('es-ES', ADDED_DATE_OPTIONS);

/**
 * Fecha de agregado ("5 sept 2025"). Reutiliza un único formateador: crear uno por canción
 * (toLocaleDateString con opciones) tardaba ~0,05 ms cada vez y se notaba con decenas de miles de archivos.
 */
export function formatAddedDate(timestamp) {
  const date = new Date(timestamp || Date.now());
  if (Number.isNaN(date.getTime())) return date.toLocaleDateString('es-ES', ADDED_DATE_OPTIONS);
  return addedDateFormatter.format(date);
}
