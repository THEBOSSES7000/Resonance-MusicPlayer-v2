import { fetchJsonWithTimeout } from '../net/fetchTimeout.js';
/**
 * Proveedores de información de artista.
 * Devuelve resultados normalizados para el editor de perfil.
 */

const LASTFM_API_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('pn_api_lastfm')) || '83cdb62766dbde114c39fc2ef5b282f2';
const FANART_API_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('pn_api_fanart')) || '63e812af8fca6d904be09fea2a108db4';
/** Key pública de prueba documentada por TheAudioDB (tier free). */
const AUDIODB_API_KEY = (typeof localStorage !== 'undefined' && localStorage.getItem('pn_api_audiodb')) || '123';
const USER_AGENT = 'ResonanceMusicPlayer/2.0 (https://github.com/THEBOSSES7000/Resonance-MusicPlayer-v2)';

function isTauri() {
  return Boolean(window.__TAURI__?.core?.invoke);
}

export const ARTIST_PROVIDERS = [
  { id: 'musicbrainz', label: 'MusicBrainz' },
  { id: 'lastfm', label: 'Last.fm' },
  { id: 'wikipedia', label: 'Wikipedia' },
  { id: 'deezer', label: 'Deezer' },
  { id: 'theaudiodb', label: 'TheAudioDB' },
  { id: 'fanart', label: 'Fanart.tv' },
];

function normalize(r) {
  return {
    provider: r.provider || 'unknown',
    providerLabel: r.providerLabel || r.provider || 'Unknown',
    name: r.name || '',
    description: (r.description || '').trim(),
    origin: (r.origin || '').trim(),
    type: (r.type || '').trim(),
    genres: Array.isArray(r.genres)
      ? r.genres.map((g) => String(g).trim()).filter(Boolean)
      : [],
    photo: r.photo || null,
    url: r.url || null,
  };
}

async function fetchJson(url, options = {}) {
  return fetchJsonWithTimeout(url, options);
}

// Cola + backoff para MusicBrainz (límite ~1 req/s; 503 = rate limit)
let mbQueue = Promise.resolve();
let mbLastAt = 0;
const mbArtistCache = Object.create(null);

async function fetchMusicBrainzJson(url, retries = 2) {
  const run = async () => {
    const wait = Math.max(0, 1100 - (Date.now() - mbLastAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLastAt = Date.now();
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { fetchWithTimeout } = await import('../net/fetchTimeout.js');
        const res = await fetchWithTimeout(url, { headers });
        if (res.status === 503 || res.status === 429) {
          lastErr = new Error(`HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
          continue;
        }
      }
    }
    throw lastErr || new Error('MusicBrainz failed');
  };
  const result = mbQueue.then(run, run);
  mbQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** Resolve top MusicBrainz artist hit → { id, name, raw, list }. Cached per name. */
async function resolveMusicBrainzArtist(artistName) {
  const key = String(artistName || '').trim().toLocaleLowerCase();
  if (!key) return null;
  if (mbArtistCache[key]) return mbArtistCache[key];

  const pending = (async () => {
    const url =
      'https://musicbrainz.org/ws/2/artist/?query=artist:' +
      encodeURIComponent(artistName) +
      '&fmt=json&limit=5';
    const data = await fetchMusicBrainzJson(url);
    const artists = Array.isArray(data?.artists) ? data.artists : [];
    if (!artists.length) return null;
    const a = artists[0];
    return { id: a.id, name: a.name || artistName, raw: a, list: artists };
  })();

  mbArtistCache[key] = pending;
  try {
    const resolved = await pending;
    mbArtistCache[key] = resolved;
    return resolved;
  } catch (err) {
    delete mbArtistCache[key];
    throw err;
  }
}

// ─── MusicBrainz ────────────────────────────────────────────────────────────

async function searchMusicBrainz(artistName) {
  // Reutiliza la misma resolución encolada (Fanart no dispara otro hit)
  const resolved = await resolveMusicBrainzArtist(artistName);
  const artists = resolved?.list || (resolved?.raw ? [resolved.raw] : []);
  const results = [];
  for (const artist of artists.slice(0, 4)) {
    const origin = String(artist.area?.name || artist.country || '').trim();
    const type = String(artist.type || '').trim();
    const sourceGenres = Array.isArray(artist.tags) && artist.tags.length
      ? artist.tags
      : Array.isArray(artist.genres)
        ? artist.genres
        : [];
    const genres = sourceGenres
      .map((item) => ({ name: String(item?.name || '').trim(), count: Number(item?.count) || 0 }))
      .filter((item) => item.name)
      .sort((a, b) => b.count - a.count)
      .map((item) => item.name)
      .slice(0, 12);

    results.push(
      normalize({
        provider: 'musicbrainz',
        providerLabel: 'MusicBrainz',
        name: artist.name || artistName,
        description: String(artist.disambiguation || '').trim()
          ? `(${String(artist.disambiguation).trim()})`
          : '',
        origin,
        type,
        genres,
        photo: null,
        url: artist.id ? `https://musicbrainz.org/artist/${artist.id}` : null,
      })
    );
  }
  return results;
}

// ─── Last.fm ────────────────────────────────────────────────────────────────

async function searchLastfm(artistName) {
  const url =
    'https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=' +
    encodeURIComponent(artistName) +
    '&api_key=' +
    LASTFM_API_KEY +
    '&format=json&autocorrect=1';
  const data = await fetchJson(url);
  const artist = data?.artist;
  if (!artist?.name) return [];

  let description = '';
  const summary = artist.bio?.summary || artist.bio?.content || '';
  if (summary) {
    description = String(summary)
      .replace(/<a[^>]*>.*?<\/a>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*Read more on Last\.fm\.?\s*$/i, '')
      .trim();
  }

  const tags = Array.isArray(artist.tags?.tag)
    ? artist.tags.tag.map((t) => String(t.name || '').trim()).filter(Boolean)
    : [];

  let photo = null;
  const images = Array.isArray(artist.image) ? artist.image : [];
  for (const size of ['extralarge', 'large', 'medium', 'small']) {
    const hit = images.find((img) => img.size === size && img['#text']);
    if (hit?.['#text'] && !hit['#text'].includes('2a96cbd8b46e442fc41c2b86b821562f')) {
      photo = hit['#text'].replace(/^http:/, 'https:');
      break;
    }
  }

  return [
    normalize({
      provider: 'lastfm',
      providerLabel: 'Last.fm',
      name: artist.name,
      description,
      origin: '',
      type: '',
      genres: tags.slice(0, 12),
      photo,
      url: artist.url || null,
    }),
  ];
}

// ─── Wikipedia ──────────────────────────────────────────────────────────────

async function searchWikipedia(artistName) {
  const languages = ['es', 'en'];
  const results = [];
  for (const language of languages) {
    try {
      const url =
        `https://${language}.wikipedia.org/api/rest_v1/page/summary/` +
        encodeURIComponent(artistName.replace(/\s+/g, '_'));
      const data = await fetchJson(url);
      if (!data || data.type === 'https://mediawiki.org/api/rest_v1/errors/not_found') continue;
      if (data.type === 'disambiguation') continue;
      const description = String(data.extract || data.description || '').trim();
      const photo = data.thumbnail?.source || data.originalimage?.source || null;
      if (!description && !photo) continue;
      results.push(
        normalize({
          provider: 'wikipedia',
          providerLabel: `Wikipedia (${language})`,
          name: data.title || artistName,
          description,
          origin: '',
          type: '',
          genres: [],
          photo: photo ? String(photo).replace(/^http:/, 'https:') : null,
          url: data.content_urls?.desktop?.page || null,
        })
      );
    } catch {
      // next language
    }
  }
  return results;
}

// ─── Deezer ─────────────────────────────────────────────────────────────────

async function searchDeezer(artistName) {
  if (isTauri()) {
    try {
      const data = await window.__TAURI__.core.invoke('search_deezer_artists', {
        query: artistName,
      });
      if (Array.isArray(data)) return data.map(normalize);
      return [];
    } catch (err) {
      console.warn('[artistProviders] deezer tauri failed', err);
      return [];
    }
  }

  try {
    const url = 'https://api.deezer.com/search/artist?q=' + encodeURIComponent(artistName) + '&limit=4';
    const data = await fetchJson(url);
    const artists = Array.isArray(data?.data) ? data.data : [];
    return artists.slice(0, 3).map((a) =>
      normalize({
        provider: 'deezer',
        providerLabel: 'Deezer',
        name: a.name || artistName,
        description: a.nb_fan ? `${Number(a.nb_fan).toLocaleString('es')} fans en Deezer` : '',
        origin: '',
        type: '',
        genres: [],
        photo: a.picture_xl || a.picture_big || a.picture_medium || null,
        url: a.link || null,
      })
    );
  } catch (err) {
    console.warn('[artistProviders] deezer fetch failed', err);
    return [];
  }
}

// ─── TheAudioDB ─────────────────────────────────────────────────────────────

async function searchTheAudioDb(artistName) {
  const url =
    `https://www.theaudiodb.com/api/v1/json/${AUDIODB_API_KEY}/search.php?s=` +
    encodeURIComponent(artistName);
  const data = await fetchJson(url);
  const artists = Array.isArray(data?.artists) ? data.artists : [];
  if (!artists.length) return [];

  return artists.slice(0, 3).map((a) => {
    const genres = [a.strGenre, a.strStyle, a.strMood]
      .map((g) => String(g || '').trim())
      .filter(Boolean);
    // Prefer Spanish bio when present, else English
    const description = String(
      a.strBiographyES || a.strBiographyEN || a.strBiography || ''
    ).trim();
    const photo =
      a.strArtistThumb ||
      a.strArtistFanart ||
      a.strArtistFanart2 ||
      a.strArtistFanart3 ||
      null;

    return normalize({
      provider: 'theaudiodb',
      providerLabel: 'TheAudioDB',
      name: a.strArtist || artistName,
      description,
      origin: String(a.strCountry || a.strCountryCode || '').trim(),
      type: String(a.strGender || a.strArtistType || '').trim(),
      genres: [...new Set(genres)].slice(0, 12),
      photo: photo ? String(photo).replace(/^http:/, 'https:') : null,
      url: a.idArtist
        ? `https://www.theaudiodb.com/artist/${a.idArtist}`
        : null,
    });
  });
}

// ─── Fanart.tv (requires MusicBrainz ID) ────────────────────────────────────

function pickBestFanartUrl(images) {
  if (!Array.isArray(images) || !images.length) return null;
  const sorted = [...images].sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0));
  const url = sorted[0]?.url;
  return url ? String(url).replace(/^http:/, 'https:') : null;
}

async function searchFanart(artistName) {
  // Fanart.tv music API is keyed by MusicBrainz artist MBID
  let mbid = null;
  let displayName = artistName;
  try {
    const resolved = await resolveMusicBrainzArtist(artistName);
    if (!resolved?.id) return [];
    mbid = resolved.id;
    displayName = resolved.name || artistName;
  } catch (err) {
    console.warn('[artistProviders] fanart MB resolve failed', err);
    return [];
  }

  const url =
    `https://webservice.fanart.tv/v3/music/${mbid}?api_key=${FANART_API_KEY}`;
  const data = await fetchJson(url);

  // Prefer portrait-style thumbs; fall back to backgrounds
  const photo =
    pickBestFanartUrl(data.artistthumb) ||
    pickBestFanartUrl(data.artistbackground) ||
    pickBestFanartUrl(data.artist4kbackground) ||
    null;

  if (!photo) return [];

  const thumbCount = Array.isArray(data.artistthumb) ? data.artistthumb.length : 0;
  const bgCount = Array.isArray(data.artistbackground) ? data.artistbackground.length : 0;
  const description =
    thumbCount || bgCount
      ? `Fanart disponible: ${thumbCount} retrato(s), ${bgCount} fondo(s)`
      : '';

  return [
    normalize({
      provider: 'fanart',
      providerLabel: 'Fanart.tv',
      name: data.name || displayName,
      description,
      origin: '',
      type: '',
      genres: [],
      photo,
      url: `https://fanart.tv/artist/${mbid}`,
    }),
  ];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Busca el artista en todos los proveedores en paralelo.
 * @param {string} artistName
 * @returns {Promise<Array>}
 */
export async function searchAllArtistProviders(artistName) {
  const name = String(artistName || '').trim();
  if (!name) return [];

  // Prefetch MusicBrainz una sola vez (compartido por MB + Fanart.tv)
  try {
    await resolveMusicBrainzArtist(name);
  } catch (err) {
    console.warn('[artistProviders] musicbrainz prefetch failed:', err);
  }

  const jobs = [
    ['musicbrainz', searchMusicBrainz],
    ['lastfm', searchLastfm],
    ['wikipedia', searchWikipedia],
    ['deezer', searchDeezer],
    ['theaudiodb', searchTheAudioDb],
    ['fanart', searchFanart],
  ];

  const settled = await Promise.allSettled(
    jobs.map(async ([id, fn]) => {
      try {
        return await fn(name);
      } catch (err) {
        console.warn(`[artistProviders] ${id} failed:`, err);
        return [];
      }
    })
  );

  const all = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) all.push(...s.value);
  }
  return all.sort((a, b) => scoreResult(b) - scoreResult(a));
}

function scoreResult(r) {
  let s = 0;
  if (r.description) s += 3;
  if (r.photo) s += 4; // priorizar proveedores con buena foto
  if (r.origin) s += 1;
  if (r.type) s += 1;
  if (r.genres?.length) s += 1;
  // Bonus a proveedores de artwork
  if (r.provider === 'fanart' || r.provider === 'theaudiodb') s += 2;
  return s;
}
