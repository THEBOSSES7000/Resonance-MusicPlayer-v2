// Letras · Acceso diferido a ui.js (evita dependencias circulares) y metadatos bajo demanda.

import { ensureSongLyrics, parseLyricsText } from '../scanner.js';

// Import diferido de ui.js (rompe el ciclo ESM). Se resuelve en la primera llamada.
let uiModulePromise = null;

export function getUi() {
  if (!uiModulePromise) uiModulePromise = import('../ui.js');
  return uiModulePromise;
}

// Aplica overrides locales guardados (modo web) y asegura metadatos leídos.
export async function ensureMetadataForTarget(song) {
  if (!song) return;
  try {
    const ui = await getUi();
    if (!song.metadataLoaded && ui.ensureSongMetadata) await ui.ensureSongMetadata(song);
    if (!song.lyricsLoaded) await ensureSongLyrics(song);
  } catch { /* ignore */ }
  try {
    const metaRaw = localStorage.getItem('pn_meta_override_' + song.title + ':::' + song.artist);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta.title) song.title = meta.title;
      if (meta.artist) song.artist = meta.artist;
      if (meta.album !== undefined) song.album = meta.album;
    }
    const lyrRaw = localStorage.getItem('pn_lyrics_override_' + song.title + ':::' + song.artist);
    if (lyrRaw && !song.lyrics) {
      const parsed = parseLyricsText(lyrRaw);
      if (parsed) {
        song.lyrics = parsed;
        song.lyricsLoaded = true;
      }
    }
  } catch { /* ignore */ }
}
