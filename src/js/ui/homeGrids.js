// UI · Cuadrículas de inicio, álbumes e indicadores de la biblioteca.

import { createLibraryAlbumCard, createLibraryArtistCard, getLibraryAlbums, getLibraryArtists, invalidateLibraryEntityCaches, libraryArtistsCache } from './libraryEntities.js';
import { state } from '../state.js';
import { clearContainerCovers } from './covers.js';
import { albumsGrid, allAlbumsGrid, artistsGrid, exploreGrid, recentGrid } from './dom.js';
import { createSongCard } from './songCards.js';
import { playFromContext, syncPlayingUI } from './playback.js';
import { loadArtistPortraits } from './artists.js';
import { isPlaybackPaused } from '../audioPlayer.js';
import { uiVars } from './sharedState.js';
import { albumsMinTrackCount } from './init.js';
import { getSoundWaveHTML } from './uiUtils.js';

export function renderGrids() {
  if (libraryArtistsCache.source !== state.localMusicFiles) {
    invalidateLibraryEntityCaches();
  }
  clearContainerCovers(recentGrid);
  clearContainerCovers(artistsGrid);
  clearContainerCovers(exploreGrid);
  clearContainerCovers(albumsGrid);

  recentGrid.innerHTML = '';
  artistsGrid?.replaceChildren();
  exploreGrid.innerHTML = '';
  albumsGrid?.replaceChildren();

  if (state.localMusicFiles.length === 0) {
    recentGrid.innerHTML = `
      <div class="empty-state-card">
        <i class="ph ph-folder-open"></i>
        <h3>Tu biblioteca está vacía</h3>
        <p>No se ha escaneado música todavía. Haz clic en "Escanear música" para elegir tu carpeta local.</p>
        <button class="btn-primary" onclick="document.getElementById('native-folder-input').click()">
          <i class="ph ph-file-audio"></i> Seleccionar carpeta
        </button>
      </div>
    `;
    exploreGrid.innerHTML = `
      <div class="empty-state-card" style="padding: 2rem;">
        <p style="color:var(--text-muted); font-size:0.9rem;">Tus canciones y artistas aparecerán aquí una vez escaneada tu música.</p>
      </div>
    `;
    if (artistsGrid) {
      artistsGrid.innerHTML = '<div class="empty-state-card"><p>Aquí aparecerán los artistas de tu biblioteca.</p></div>';
    }
    if (albumsGrid) {
      albumsGrid.innerHTML = '<div class="empty-state-card"><p>Aquí aparecerán los álbumes de tu biblioteca.</p></div>';
    }
    if (state.currentView === 'albums') renderAllAlbumsUI();
    return;
  }

  const recentSongs = [...state.localMusicFiles]
    .sort((a, b) => (b.file?.lastModified || 0) - (a.file?.lastModified || 0))
    .slice(0, 25);

  recentSongs.forEach((song, idx) => {
    recentGrid.appendChild(createSongCard(song, () => {
      playFromContext(recentSongs, idx, "Recién agregadas", true, "recent");
    }, "recent"));
  });

  const topArtists = getLibraryArtists().slice(0, 25);
  topArtists.forEach(artist => artistsGrid?.appendChild(createLibraryArtistCard(artist)));
  loadArtistPortraits(artistsGrid);

  const mostPlayedSongs = [...state.localMusicFiles]
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 25);

  mostPlayedSongs.forEach((song, idx) => {
    exploreGrid.appendChild(createSongCard(song, () => {
      playFromContext(mostPlayedSongs, idx, "Más escuchadas", true, "mostPlayed");
    }, "mostPlayed"));
  });

  getLibraryAlbums().slice(0, 25).forEach(album => {
    albumsGrid?.appendChild(createLibraryAlbumCard(album));
  });
  if (state.currentView === 'albums') {
    renderAllAlbumsUI();
  }
  syncPlayingUI(!isPlaybackPaused());
}

export function renderAllAlbumsUI({ append = false, previousVisibleCount = 0 } = {}) {
  if (!allAlbumsGrid) return;
  if (!append) {
    clearContainerCovers(allAlbumsGrid);
    allAlbumsGrid.replaceChildren();
    uiVars.albumGridVisibleCount = 50;
  }
  const albums = getLibraryAlbums().filter(album => album.songs.length > albumsMinTrackCount);
  if (albums.length === 0) {
    allAlbumsGrid.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1;">
        <i class="ph ph-disc"></i>
        <h3>No hay álbumes que coincidan</h3>
        <p>Prueba otro filtro de cantidad de pistas o revisa los metadatos de tu biblioteca.</p>
      </div>
    `;
    return;
  }
  const firstIndex = append ? Math.min(previousVisibleCount, albums.length) : 0;
  albums.slice(firstIndex, uiVars.albumGridVisibleCount)
    .forEach(album => allAlbumsGrid.appendChild(createLibraryAlbumCard(album, true)));
  const currentSong = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  syncLibraryAlbumIndicators(currentSong, !isPlaybackPaused());
}

export function syncLibraryAlbumIndicators(currentSong, isPlaying) {
  document.querySelectorAll('.library-album-card').forEach(card => {
    const indicator = card.querySelector('.library-album-playing-indicator');
    const isCurrentAlbum = Boolean(currentSong) &&
      String(currentSong.album || '').trim().toLocaleLowerCase() === card.dataset.albumTitle.toLocaleLowerCase() &&
      String(currentSong.artist || '').trim().toLocaleLowerCase() === card.dataset.albumArtist.toLocaleLowerCase();
    card.classList.toggle('is-playing-origin', isCurrentAlbum && state.activeContextId === card.dataset.albumContext);
    card.classList.toggle('is-playing-elsewhere', isCurrentAlbum && state.activeContextId !== card.dataset.albumContext);
    if (indicator) {
      indicator.hidden = !isCurrentAlbum;
      indicator.innerHTML = isCurrentAlbum ? getSoundWaveHTML(!isPlaying) : '';
    }
  });
}
