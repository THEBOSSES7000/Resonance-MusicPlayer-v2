/**
 * Lyrics providers — multi-source search for synced / plain lyrics.
 * Inspired by MusicResync (https://github.com/DynamycSound/MusicResync).
 *
 * Only providers that do NOT require rotating API keys are included.
 *
 * Normalized result shape:
 * {
 *   provider, providerLabel, trackName, artistName, albumName,
 *   duration, syncedLyrics, plainLyrics, id
 * }
 */

import { isTauri } from './utils.js';

const USER_AGENT = 'ResonanceMusicPlayer/2.0 (https://github.com/THEBOSSES7000/Resonance-MusicPlayer-v2)';

function normalizeResult(r) {
  return {
    provider: r.provider || 'unknown',
    providerLabel: r.providerLabel || r.provider || 'Unknown',
    trackName: r.trackName || r.title || 'Sin título',
    artistName: r.artistName || r.artist || 'Desconocido',
    albumName: r.albumName || r.album || null,
    duration: Number(r.duration) || 0,
    syncedLyrics: r.syncedLyrics || null,
    plainLyrics: r.plainLyrics || null,
    id: r.id ?? null,
  };
}

function msToLrc(ms) {
  const totalCs = Math.floor(Number(ms) / 10);
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

/** Convert LyricsPlus JSON ({ lyrics: [{ time: ms, text }] }) to LRC string. */
function lyricsPlusToLrc(data) {
  const lines = Array.isArray(data?.lyrics) ? data.lyrics : null;
  if (!lines?.length) return null;
  const out = [];
  for (const line of lines) {
    const text = (line.text || '').trim();
    if (!text) continue;
    const ms = Number(line.time) || 0;
    out.push(`${msToLrc(ms)} ${text}`);
  }
  return out.length ? out.join('\n') : null;
}

async function fetchJson(url, options = {}) {
  const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── LRCLib ─────────────────────────────────────────────────────────────────

async function searchLrclib({ title, artist }) {
  let data;
  if (isTauri() && window.__TAURI__?.core?.invoke) {
    try {
      data = await window.__TAURI__.core.invoke('search_lrclib_lyrics', {
        request: { track_name: title, artist_name: artist },
      });
    } catch (err) {
      console.warn('[lyrics] lrclib tauri failed, trying fetch', err);
      data = null;
    }
  }
  if (!Array.isArray(data)) {
    const q = encodeURIComponent(`${title} ${artist}`.trim());
    // Prefer q= which returns more hits (MusicResync style)
    try {
      data = await fetchJson(`https://lrclib.net/api/search?q=${q}`);
    } catch {
      const url =
        'https://lrclib.net/api/search?track_name=' +
        encodeURIComponent(title) +
        '&artist_name=' +
        encodeURIComponent(artist);
      data = await fetchJson(url);
    }
  }
  if (!Array.isArray(data)) return [];
  return data.map((item) =>
    normalizeResult({
      provider: 'lrclib',
      providerLabel: 'LRCLib',
      trackName: item.trackName || item.name,
      artistName: item.artistName,
      albumName: item.albumName,
      duration: item.duration,
      syncedLyrics: item.syncedLyrics || null,
      plainLyrics: item.plainLyrics || null,
      id: item.id,
    })
  );
}

// ─── LyricsPlus ─────────────────────────────────────────────────────────────

const LYRICSPLUS_MIRRORS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.binimum.org',
];

async function searchLyricsPlus({ title, artist, durationSec }) {
  if (!title || !artist) return [];

  // Prefer Rust command (no CORS issues, correct parsing)
  if (isTauri() && window.__TAURI__?.core?.invoke) {
    try {
      const data = await window.__TAURI__.core.invoke('search_lyricsplus_lyrics', {
        request: {
          title,
          artist,
          duration_sec: durationSec > 0 ? durationSec : null,
        },
      });
      if (Array.isArray(data) && data.length) {
        return data.map(normalizeResult);
      }
      // empty array = no match; still try JS mirrors as backup
    } catch (err) {
      console.warn('[lyrics] lyricsplus tauri failed, trying fetch', err);
    }
  }

  const params = new URLSearchParams({ title, artist });
  if (durationSec > 0) params.set('duration', String(Math.round(durationSec)));

  for (const base of LYRICSPLUS_MIRRORS) {
    try {
      const data = await fetchJson(`${base}/v2/lyrics/get?${params.toString()}`);
      const synced = lyricsPlusToLrc(data);
      if (!synced) continue;
      const meta = data.metadata || {};
      return [
        normalizeResult({
          provider: 'lyricsplus',
          providerLabel: 'LyricsPlus',
          trackName: meta.title || title,
          artistName: artist,
          albumName: null,
          duration: durationSec || 0,
          syncedLyrics: synced,
          plainLyrics: null,
          id: null,
        }),
      ];
    } catch (err) {
      console.warn('[lyrics] lyricsplus mirror failed', base, err);
    }
  }
  return [];
}

// ─── Deezer ─────────────────────────────────────────────────────────────────

async function searchDeezer({ title, artist, durationSec }) {
  if (!title) return [];

  // Deezer pipe/auth almost always need the Rust side (CORS)
  if (isTauri() && window.__TAURI__?.core?.invoke) {
    try {
      const data = await window.__TAURI__.core.invoke('search_deezer_lyrics', {
        request: {
          title,
          artist: artist || '',
          duration_sec: durationSec > 0 ? durationSec : null,
        },
      });
      if (Array.isArray(data)) return data.map(normalizeResult);
      return [];
    } catch (err) {
      console.warn('[lyrics] deezer tauri failed', err);
      return [];
    }
  }

  // Browser fallback: public search only (no synced lyrics without JWT/CORS)
  try {
    const q = encodeURIComponent(`${title} ${artist || ''}`.trim());
    const data = await fetchJson(`https://api.deezer.com/search?q=${q}&limit=5`);
    const tracks = Array.isArray(data?.data) ? data.data : [];
    // Without pipe access we cannot get synced lines from the browser reliably
    return tracks.slice(0, 3).map((t) =>
      normalizeResult({
        provider: 'deezer',
        providerLabel: 'Deezer',
        trackName: t.title,
        artistName: t.artist?.name || artist || 'Desconocido',
        albumName: t.album?.title || null,
        duration: t.duration || durationSec || 0,
        syncedLyrics: null,
        plainLyrics: null,
        id: t.id,
      })
    ).filter(() => false); // don't surface empty-lyrics hits
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const PROVIDERS = [
  { id: 'lrclib', label: 'LRCLib', search: searchLrclib },
  { id: 'lyricsplus', label: 'LyricsPlus', search: searchLyricsPlus },
  { id: 'deezer', label: 'Deezer', search: searchDeezer },
];

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

/**
 * Search one or more providers in parallel.
 * @param {{ title: string, artist: string, durationSec?: number }} query
 * @param {string[]|'all'} providerIds
 */
export async function searchAllProviders(query, providerIds = 'all') {
  const list =
    providerIds === 'all' || !providerIds?.length
      ? PROVIDERS
      : PROVIDERS.filter((p) => providerIds.includes(p.id));

  const settled = await Promise.allSettled(
    list.map(async (p) => {
      try {
        const hits = await p.search(query);
        return Array.isArray(hits) ? hits : [];
      } catch (err) {
        console.warn(`[lyrics] ${p.id} failed:`, err);
        return [];
      }
    })
  );

  const all = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value.length) all.push(...s.value);
  }
  return all;
}
