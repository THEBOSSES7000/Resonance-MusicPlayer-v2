// UI · Artistas y álbumes de la biblioteca: cachés, coincidencias y tarjetas.

import { state } from '../state.js';
import { albumsMinTrackCount, blockAlbumsBelowTrackFilter } from './init.js';
import { currentAlbumLink, currentAlbumSeparator } from './dom.js';
import { getProfileOverride } from './profileEditor.js';
import { bindLazyCover } from './covers.js';
import { navigateToView } from './navigation.js';

const LIBRARY_ENTITY_MAX_ENTRIES = 200;

/** Caché de artistas/álbumes acotada para evitar retención masiva en bibliotecas enormes. */
export let libraryArtistsCache = { source: null, data: null, timestamp: 0 };

let libraryAlbumsCache = { source: null, data: null, timestamp: 0 };

export function invalidateLibraryEntityCaches() {
  libraryArtistsCache = { source: null, data: null, timestamp: 0 };
  libraryAlbumsCache = { source: null, data: null, timestamp: 0 };
}

export function artistContextId(artistName) {
  return `artist_${String(artistName || '').trim().toLocaleLowerCase()}`;
}

export function albumContextId(artistName, albumTitle) {
  return `album_${String(artistName || '').trim().toLocaleLowerCase()}_${String(albumTitle || '').trim().toLocaleLowerCase()}`;
}

export function artistsFromCredit(credit) {
  return String(credit || '')
    .split(/\s*(?:,|&|\bfeat(?:uring)?\.?|\bft\.?|\bwith\b)\s*/i)
    .map(name => name.trim())
    .filter(Boolean);
}

export function matchingArtistSongs(artistName) {
  const normalizedArtist = String(artistName || '').trim().toLocaleLowerCase();
  return state.localMusicFiles.filter(song =>
    artistsFromCredit(song.artist).some(name => name.toLocaleLowerCase() === normalizedArtist)
  );
}

export function matchingAlbumSongs(artistName, albumTitle) {
  const normalizedArtist = String(artistName || '').trim().toLocaleLowerCase();
  const normalizedAlbum = String(albumTitle || '').trim().toLocaleLowerCase();
  return state.localMusicFiles.filter(song => {
    if (String(song.album || '').trim().toLocaleLowerCase() !== normalizedAlbum) return false;
    const credit = String(song.artist || '').trim().toLocaleLowerCase();
    if (credit === normalizedArtist) return true;
    return artistsFromCredit(song.artist).some(name => name.toLocaleLowerCase() === normalizedArtist);
  });
}

export function isAlbumNavigationBlocked(artistName, albumTitle) {
  if (!blockAlbumsBelowTrackFilter || albumsMinTrackCount === 0) return false;
  return matchingAlbumSongs(artistName, albumTitle).length <= albumsMinTrackCount;
}

export function syncPlayerAlbumLinkState() {
  if (!currentAlbumLink) return;
  const currentSong = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  const albumTitle = String(currentSong?.album || '').trim();
  const artistName = artistsFromCredit(currentSong?.artist)[0] || '';
  const blocked = Boolean(albumTitle && isAlbumNavigationBlocked(artistName, albumTitle));
  currentAlbumLink.textContent = albumTitle;
  currentAlbumLink.hidden = !albumTitle;
  if (currentAlbumSeparator) currentAlbumSeparator.hidden = !albumTitle;
  currentAlbumLink.disabled = blocked;
  currentAlbumLink.classList.toggle('is-active', Boolean(albumTitle && !blocked));
  currentAlbumLink.title = blocked
    ? 'Este álbum no cumple el filtro de cantidad de pistas'
    : albumTitle ? `Abrir álbum ${albumTitle}` : '';
  if (albumTitle) {
    currentAlbumLink.setAttribute('aria-label', blocked
      ? `${albumTitle}: no cumple el filtro de cantidad de pistas`
      : `Abrir álbum ${albumTitle}`);
  } else {
    currentAlbumLink.removeAttribute('aria-label');
  }
}

export function getLibraryArtists() {
  const now = Date.now();
  if (libraryArtistsCache.source === state.localMusicFiles &&
      libraryArtistsCache.data &&
      now - libraryArtistsCache.timestamp < 120000) {
    return libraryArtistsCache.data;
  }
  const artists = new Map();
  state.localMusicFiles.forEach(song => {
    artistsFromCredit(song.artist).forEach(name => {
      const key = name.toLocaleLowerCase();
      const artist = artists.get(key) || { name, songs: [] };
      artist.songs.push(song);
      artists.set(key, artist);
    });
  });
  const data = [...artists.values()]
    .sort((a, b) => b.songs.length - a.songs.length || a.name.localeCompare(b.name))
    .slice(0, LIBRARY_ENTITY_MAX_ENTRIES);
  libraryArtistsCache = { source: state.localMusicFiles, data, timestamp: now };
  return data;
}

export function getLibraryAlbums() {
  const now = Date.now();
  if (libraryAlbumsCache.source === state.localMusicFiles &&
      libraryAlbumsCache.data &&
      now - libraryAlbumsCache.timestamp < 120000) {
    return libraryAlbumsCache.data;
  }
  const albums = new Map();
  state.localMusicFiles.forEach(song => {
    const title = String(song.album || '').trim();
    if (!title) return;
    const artist = String(song.artist || 'Desconocido').trim() || 'Desconocido';
    const key = `${title.toLocaleLowerCase()}:::${artist.toLocaleLowerCase()}`;
    const album = albums.get(key) || { title, artist, songs: [], coverSong: null };
    album.songs.push(song);
    if (!album.coverSong) album.coverSong = song;
    albums.set(key, album);
  });
  const data = [...albums.values()]
    .map(album => ({
      ...album,
      coverUrl: getProfileOverride('album', album.artist, album.title)?.photo || ''
    }))
    .sort((a, b) =>
      b.songs.length - a.songs.length ||
      a.title.localeCompare(b.title) ||
      a.artist.localeCompare(b.artist)
    )
    .slice(0, LIBRARY_ENTITY_MAX_ENTRIES);
  libraryAlbumsCache = { source: state.localMusicFiles, data, timestamp: now };
  return data;
}

export function createLibraryAlbumCard(album, isGrid = false) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `library-album-card${isGrid ? ' is-grid' : ''}`;
  const navigationBlocked = isAlbumNavigationBlocked(album.artist, album.title);
  card.disabled = navigationBlocked;
  if (navigationBlocked) {
    card.title = 'Este álbum no cumple el filtro de cantidad de pistas';
    card.setAttribute('aria-label', `${album.title}, ${album.artist}: no cumple el filtro de cantidad de pistas`);
  }
  card.dataset.albumTitle = album.title;
  card.dataset.albumArtist = album.artist;
  card.dataset.albumContext = albumContextId(album.artist, album.title);
  const cover = document.createElement('span');
  cover.className = 'library-album-cover';
  const image = document.createElement('img');
  image.alt = '';
  const icon = document.createElement('i');
  icon.className = 'ph ph-disc';
  cover.appendChild(icon);
  cover.appendChild(image);
  const overrideOrUrl = album.coverUrl || '';
  if (overrideOrUrl) {
    bindLazyCover(image, overrideOrUrl, album.title || '');
    icon.hidden = true;
  } else if (album.coverSong || album.songs?.[0]) {
    bindLazyCover(image, album.coverSong || album.songs[0], album.title || '');
    image.addEventListener('load', () => { icon.hidden = true; }, { once: true });
  }
  const title = document.createElement('strong');
  title.textContent = album.title;
  const artist = document.createElement('span');
  artist.textContent = album.artist;
  const count = document.createElement('span');
  count.className = 'library-entity-count';
  count.textContent = `${album.songs.length} ${album.songs.length === 1 ? 'pista' : 'pistas'}`;
  const soundwave = document.createElement('span');
  soundwave.className = 'library-album-playing-indicator';
  soundwave.hidden = true;
  cover.appendChild(soundwave);
  card.append(cover, title, artist, count);
  card.addEventListener('click', () => navigateToView('album-detail', {
    artistName: album.artist,
    albumTitle: album.title
  }));
  return card;
}

export function createLibraryArtistCard(artist) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'library-artist-card';
  const avatar = document.createElement('span');
  avatar.className = 'library-artist-avatar';
  const icon = document.createElement('i');
  icon.className = 'ph ph-user';
  avatar.appendChild(icon);
  const image = document.createElement('img');
  image.alt = '';
  image.className = 'library-artist-portrait';
  image.dataset.artistName = artist.name;
  avatar.appendChild(image);
  const name = document.createElement('strong');
  name.textContent = artist.name;
  const count = document.createElement('span');
  count.className = 'library-entity-count';
  count.textContent = `${artist.songs.length} ${artist.songs.length === 1 ? 'canción' : 'canciones'}`;
  card.dataset.artistName = artist.name;
  card.append(avatar, name, count);
  card.addEventListener('click', () => navigateToView('artist', { artistName: artist.name }));
  return card;
}
