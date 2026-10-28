// UI · Perfil de artista: retratos, MusicBrainz/Wikipedia y cabecera.

import { EMPTY_PIXEL_GIF, bindLazyCover, clearContainerCovers } from './covers.js';
import { getProfileOverride } from './profileEditor.js';
import { uiVars } from './sharedState.js';
import { artistAlbumsGrid, artistBioToggle, artistDisambiguation, artistFacts, artistRelatedGrid, artistTagsContainer, playlistHeroCover, playlistHeroDesc } from './dom.js';
import { state } from '../state.js';
import { navigateToView } from './navigation.js';
import { artistsFromCredit } from './libraryEntities.js';

export const mbArtistCache = Object.create(null);

export const artistPortraitCache = Object.create(null);

const ARTIST_CACHE_LIMIT = 60;

export function loadArtistPortraits(container) {
  if (!container) return;
  container.querySelectorAll('.library-artist-avatar img[data-artist-name]').forEach(image => {
    void fetchArtistPortraitFromWikipedia(image.dataset.artistName).then(imageUrl => {
      if (!imageUrl || !image.isConnected) return;
      setArtistPortraitImage(image, imageUrl);
    });
  });
}

function setArtistPortraitImage(image, imageUrl, retryWithFreshCache = true) {
  image.addEventListener('load', () => {
    image.classList.add('is-loaded');
    image.previousElementSibling.hidden = true;
  }, { once: true });
  image.addEventListener('error', () => {
    image.src = EMPTY_PIXEL_GIF;
    image.removeAttribute('src');
    if (!retryWithFreshCache || !image.isConnected) return;
    const artistName = image.dataset.artistName;
    delete artistPortraitCache[artistName];
    try {
      localStorage.removeItem(`artist_portrait_${artistName}`);
    } catch {
      // Retry from the network even if the cached value cannot be removed.
    }
    void fetchArtistPortraitFromWikipedia(artistName).then(freshImageUrl => {
      if (freshImageUrl && image.isConnected) {
        setArtistPortraitImage(image, freshImageUrl, false);
      }
    });
  }, { once: true });
  image.src = imageUrl;
}

function usableArtistImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl || imageUrl.includes('2a96cbd8b46e442fc41c2b86b821562f')) return null;
  try {
    const url = new URL(imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}

function getBoundedArtistCacheValue(cache, key) {
  if (!Object.prototype.hasOwnProperty.call(cache, key)) return undefined;
  const value = cache[key];
  delete cache[key];
  cache[key] = value;
  return value;
}

function setBoundedArtistCacheValue(cache, key, value) {
  delete cache[key];
  const keys = Object.keys(cache);
  if (keys.length >= ARTIST_CACHE_LIMIT) delete cache[keys[0]];
  cache[key] = value;
}

async function fetchArtistPortraitFromWikipedia(artistName) {
  const profilePhoto = getProfileOverride('artist', artistName)?.photo;
  if (profilePhoto) {
    setBoundedArtistCacheValue(artistPortraitCache, artistName, profilePhoto);
    return profilePhoto;
  }
  const cachedPortrait = getBoundedArtistCacheValue(artistPortraitCache, artistName);
  if (cachedPortrait) return cachedPortrait;
  try {
    const saved = localStorage.getItem(`artist_portrait_${artistName}`);
    if (saved) {
      const imageUrl = usableArtistImageUrl(saved);
      if (imageUrl) {
        setBoundedArtistCacheValue(artistPortraitCache, artistName, imageUrl);
        return imageUrl;
      }
    }
  } catch {
    // Continue to the network when local storage is unavailable.
  }

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    try {
      for (const language of ['es', 'en']) {
        const response = await fetch(
          `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName.replace(/\s+/g, '_'))}`,
          { headers: { Accept: 'application/json' }, signal: controller.signal }
        );
        if (!response.ok) continue;
        const data = await response.json();
        const imageUrl = usableArtistImageUrl(data?.thumbnail?.source || data?.originalimage?.source);
        if (!imageUrl) continue;
        try {
          localStorage.setItem(`artist_portrait_${artistName}`, imageUrl);
        } catch {
          // Keep the portrait in memory if local storage is unavailable.
        }
        return imageUrl;
      }
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
    return null;
  })();
  setBoundedArtistCacheValue(artistPortraitCache, artistName, pending);
  const imageUrl = await pending;
  if (imageUrl) setBoundedArtistCacheValue(artistPortraitCache, artistName, imageUrl);
  else delete artistPortraitCache[artistName];
  return imageUrl;
}

function getCachedMbArtist(artistName) {
  const cachedArtist = getBoundedArtistCacheValue(mbArtistCache, artistName);
  if (cachedArtist) return cachedArtist;
  try {
    const saved = localStorage.getItem(`mb_artist_${artistName}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        setBoundedArtistCacheValue(mbArtistCache, artistName, parsed);
        return parsed;
      }
    }
  } catch {
    // Ignore unavailable or invalid cached data and fetch a fresh response.
  }
  return null;
}

function queueMusicBrainzRequest(url) {
  const request = uiVars.musicBrainzRequestQueue.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - uiVars.lastMusicBrainzRequestAt));
    if (delay > 0) await new Promise(resolve => window.setTimeout(resolve, delay));
    uiVars.lastMusicBrainzRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      return await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Resonance/1.0.0 (https://github.com/tu-usuario/resonance)'
        },
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeout);
    }
  });
  uiVars.musicBrainzRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function fetchArtistInfoFromMusicBrainz(artistName) {
  const cached = getCachedMbArtist(artistName);
  if (cached) return cached;
  const pendingArtist = getBoundedArtistCacheValue(mbArtistCache, artistName);
  if (pendingArtist) return pendingArtist;

  const pending = (async () => {
    const metadata = {
      type: '',
      origin: '',
      activity: '',
      disambiguation: '',
      genres: [],
      available: false
    };
    try {
      const response = await queueMusicBrainzRequest(
        `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json`
      );
      if (!response.ok) return metadata;
      const data = await response.json();
      const artist = Array.isArray(data?.artists) ? data.artists[0] : null;
      if (!artist) return metadata;

      metadata.type = String(artist.type || '').trim();
      metadata.origin = String(artist.area?.name || artist.country || '').trim();
      metadata.disambiguation = String(artist.disambiguation || '').trim();
      const lifeSpan = artist['life-span'] || {};
      const begin = String(lifeSpan.begin || '').trim();
      const end = String(lifeSpan.end || '').trim();
      metadata.activity = begin
        ? `${begin} – ${end || (!lifeSpan.ended ? 'Presente' : '?')}`
        : end;
      const sourceGenres = Array.isArray(artist.tags) && artist.tags.length
        ? artist.tags
        : Array.isArray(artist.genres) ? artist.genres : [];
      metadata.genres = sourceGenres
        .map(item => ({
          name: String(item?.name || '').trim(),
          count: Number(item?.count) || 0
        }))
        .filter(item => item.name)
        .sort((a, b) => b.count - a.count)
        .map(item => item.name);
      metadata.available = true;
    } catch {
      return metadata;
    }
    if (metadata.available) {
      try {
        localStorage.setItem(`mb_artist_${artistName}`, JSON.stringify(metadata));
      } catch {
        // Keep the in-memory cache if local storage is unavailable.
      }
    }
    return metadata;
  })();
  setBoundedArtistCacheValue(mbArtistCache, artistName, pending);
  const metadata = await pending;
  setBoundedArtistCacheValue(mbArtistCache, artistName, metadata);
  return metadata;
}

export function renderArtistAlbums(songs) {
  if (!artistAlbumsGrid) return;
  const albums = new Map();
  songs.forEach(song => {
    const title = String(song.album || '').trim();
    if (!title) return;
    const key = title.toLocaleLowerCase();
    if (!albums.has(key)) albums.set(key, { title, coverSong: song });
    else if (!albums.get(key).coverSong) albums.get(key).coverSong = song;
  });
  clearContainerCovers(artistAlbumsGrid);
  artistAlbumsGrid.replaceChildren();
  if (!albums.size) {
    artistAlbumsGrid.innerHTML = '<p class="artist-section-empty">No hay álbumes identificados para este artista.</p>';
  } else {
    albums.forEach(album => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'artist-album-card';
      const customCover = getProfileOverride('album', state.artistName, album.title)?.photo;
      card.innerHTML = `<span class="artist-album-cover"><i class="ph ph-disc"></i><img alt="" /></span><strong></strong>`;
      const img = card.querySelector('img');
      const discIcon = card.querySelector('.ph-disc');
      if (img) {
        if (customCover) bindLazyCover(img, customCover, album.title);
        else if (album.coverSong) bindLazyCover(img, album.coverSong, album.title);
        img.addEventListener('load', () => { if (discIcon) discIcon.hidden = true; }, { once: true });
      }
      card.querySelector('strong').textContent = album.title;
      card.addEventListener('click', () => navigateToView('album-detail', {
        artistName: state.artistName,
        albumTitle: album.title
      }));
      artistAlbumsGrid.appendChild(card);
    });
  }
}

export function renderRelatedArtists(artistName, songs) {
  if (!artistRelatedGrid) return;
  const libraryArtists = new Map();
  state.localMusicFiles.forEach(song => artistsFromCredit(song.artist).forEach(name => {
    const key = name.toLocaleLowerCase();
    if (!libraryArtists.has(key)) libraryArtists.set(key, name);
  }));
  const collaborators = new Map();
  songs.forEach(song => artistsFromCredit(song.artist).forEach(name => {
    if (name.toLocaleLowerCase() === artistName.toLocaleLowerCase()) return;
    const libraryName = libraryArtists.get(name.toLocaleLowerCase());
    if (libraryName) collaborators.set(libraryName.toLocaleLowerCase(), libraryName);
  }));
  artistRelatedGrid.replaceChildren();
  if (!collaborators.size) {
    artistRelatedGrid.innerHTML = '<p class="artist-section-empty">No se encontraron otros artistas de la biblioteca en las mismas canciones.</p>';
    return;
  }
  collaborators.forEach(name => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'artist-related-card';
    card.innerHTML = '<i class="ph ph-user-circle"></i><span></span>';
    card.querySelector('span').textContent = name;
    card.addEventListener('click', () => navigateToView('artist', { artistName: name }));
    artistRelatedGrid.appendChild(card);
  });
}

export async function applyArtistHeroMetadata(artistName) {
  let [metadata, wikipediaPortraitUrl] = await Promise.all([
    fetchArtistInfoFromMusicBrainz(artistName),
    fetchArtistPortraitFromWikipedia(artistName)
  ]);
  if (state.currentView !== 'artist' || state.artistName !== artistName) return;
  const override = getProfileOverride('artist', artistName);
  if (override) {
    metadata = {
      ...metadata,
      type: Object.prototype.hasOwnProperty.call(override, 'type') ? override.type : metadata.type,
      origin: Object.prototype.hasOwnProperty.call(override, 'origin') ? override.origin : metadata.origin,
      activity: Object.prototype.hasOwnProperty.call(override, 'activity') ? override.activity : metadata.activity,
      disambiguation: Object.prototype.hasOwnProperty.call(override, 'context') ? override.context : metadata.disambiguation,
      genres: Object.prototype.hasOwnProperty.call(override, 'genres') ? override.genres : metadata.genres,
      available: metadata.available || Boolean(override.description || override.origin || override.activity || override.type || override.context || override.genres?.length)
    };
    if (override.photo) wikipediaPortraitUrl = override.photo;
  }
  const genres = Array.isArray(metadata.genres) ? metadata.genres : [];
  const artistImageUrls = [...new Set([
    wikipediaPortraitUrl
  ].filter(Boolean))];
  clearContainerCovers(playlistHeroCover);
  playlistHeroCover.replaceChildren();
  if (artistImageUrls.length) {
    const heroImage = document.createElement('img');
    heroImage.className = 'playlist-hero-cover-img artist-hero-image';
    heroImage.alt = `Fotografía de ${artistName}`;
    let imageIndex = 0;
    heroImage.addEventListener('error', () => {
      imageIndex += 1;
      if (imageIndex < artistImageUrls.length) {
        heroImage.src = artistImageUrls[imageIndex];
        return;
      }
      const fallbackIcon = document.createElement('i');
      fallbackIcon.className = 'ph ph-user-circle';
      playlistHeroCover.replaceChildren(fallbackIcon);
    });
    heroImage.src = artistImageUrls[imageIndex];
    playlistHeroCover.appendChild(heroImage);
  } else {
    const fallbackIcon = document.createElement('i');
    fallbackIcon.className = 'ph ph-user-circle';
    playlistHeroCover.appendChild(fallbackIcon);
  }
  if (metadata.available) {
    playlistHeroDesc.textContent = '';
    playlistHeroDesc.style.display = 'none';
    if (artistDisambiguation) {
      artistDisambiguation.textContent = '';
      artistDisambiguation.hidden = true;
    }
    if (artistFacts) {
      artistFacts.replaceChildren();
      const facts = [
        ['Origen', metadata.origin],
        ['Tipo', metadata.type]
      ].filter(([, value]) => value);
      artistFacts.hidden = facts.length === 0;
      facts.forEach(([label, value]) => {
        const item = document.createElement('span');
        item.className = 'artist-fact';
        const name = document.createElement('strong');
        name.textContent = `${label}: `;
        item.append(name, document.createTextNode(value));
        artistFacts.appendChild(item);
      });
    }
  } else {
    if (artistDisambiguation) {
      artistDisambiguation.textContent = '';
      artistDisambiguation.hidden = true;
    }
    if (artistFacts) {
      artistFacts.replaceChildren();
      artistFacts.hidden = true;
    }
    playlistHeroDesc.textContent = 'Sin información disponible en MusicBrainz.';
    playlistHeroDesc.style.removeProperty('display');
  }
  if (typeof override?.description === 'string' && override.description.trim()) {
    playlistHeroDesc.textContent = override.description.trim();
    playlistHeroDesc.style.removeProperty('display');
  }
  // Bio larga: clamp + botón mostrar más / mostrar menos
  playlistHeroDesc.classList.remove('artist-bio-clamped', 'is-expanded');
  const descText = (playlistHeroDesc.textContent || '').trim();
  const isPlaceholder = !descText || descText.startsWith('Sin información');
  const shouldClamp = !isPlaceholder && (
    descText.length > 220 ||
    descText.split(/\s+/).length > 40 ||
    (playlistHeroDesc.scrollHeight > 0 && playlistHeroDesc.scrollHeight > 72)
  );
  if (artistBioToggle) {
    if (shouldClamp) {
      playlistHeroDesc.classList.add('artist-bio-clamped');
      artistBioToggle.hidden = false;
      artistBioToggle.textContent = 'Mostrar más';
      artistBioToggle.setAttribute('aria-expanded', 'false');
      // Medir tras layout: si no desborda 3 líneas, ocultar el botón
      requestAnimationFrame(() => {
        if (!playlistHeroDesc.isConnected || !artistBioToggle) return;
        const overflows = playlistHeroDesc.scrollHeight > playlistHeroDesc.clientHeight + 2;
        if (!overflows) {
          playlistHeroDesc.classList.remove('artist-bio-clamped');
          artistBioToggle.hidden = true;
        }
      });
    } else {
      artistBioToggle.hidden = true;
    }
  }
  if (artistTagsContainer) {
    artistTagsContainer.replaceChildren();
    artistTagsContainer.hidden = !genres.length;
    genres.forEach(genre => {
      const badge = document.createElement('span');
      badge.className = 'artist-tag-badge';
      badge.textContent = genre;
      artistTagsContainer.appendChild(badge);
    });
  }
}
