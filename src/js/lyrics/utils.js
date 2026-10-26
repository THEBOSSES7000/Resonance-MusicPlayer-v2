// Letras · Utilidades: entorno Tauri, directorios enlazados, duración y escape de HTML.

import { state } from '../state.js';

export function isTauri() {
  return Boolean(window.__TAURI__?.core?.invoke);
}

export function isTrackInLinkedMusicDirectory(filePath) {
  const normalizePath = path => {
    let normalized = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (/^[a-z]:/i.test(normalized) || normalized.startsWith('//')) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  };
  const candidate = normalizePath(filePath);
  return Boolean(candidate) && (state.nativeMusicDirectories || []).some(directory => {
    const root = normalizePath(directory.path);
    return candidate === root || candidate.startsWith(`${root}/`);
  });
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
