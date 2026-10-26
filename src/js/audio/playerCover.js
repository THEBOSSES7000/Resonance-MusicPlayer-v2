// Audio · Carátula del reproductor inferior.

import { expandedCoverImg, expandedCoverPlaceholder, playerCoverArt } from './dom.js';
import { ensureSongCover } from '../scanner.js';
import { state } from '../state.js';

function getPlayerCoverArtEl() {
  return document.getElementById('player-cover-art') || playerCoverArt;
}

function ensurePlayerCoverStructure() {
  const box = document.getElementById('player-cover-box');
  if (!box) return null;
  let art = document.getElementById('player-cover-art');
  if (!art) {
    art = document.createElement('div');
    art.className = 'track-cover-art';
    art.id = 'player-cover-art';
    art.innerHTML = '<i class="ph ph-music-note"></i>';
    box.insertBefore(art, box.firstChild);
  }
  if (!document.getElementById('btn-expand-cover')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cover-expand-btn';
    btn.id = 'btn-expand-cover';
    btn.title = 'Expandir carátula';
    btn.innerHTML = '<i class="ph ph-caret-up"></i>';
    box.appendChild(btn);
  }
  return art;
}

export function resetPlayerCoverToPlaceholder() {
  const art = ensurePlayerCoverStructure();
  if (art) art.innerHTML = '<i class="ph ph-music-note"></i>';
  if (typeof expandedCoverImg !== 'undefined' && expandedCoverImg && expandedCoverPlaceholder) {
    expandedCoverImg.removeAttribute('src');
    expandedCoverImg.style.display = 'none';
    expandedCoverPlaceholder.style.display = 'flex';
  }
}

export function paintPlayerCover(cover, track = null) {
  const art = ensurePlayerCoverStructure();
  if (!art) return;
  if (cover) {
    let img = art.querySelector('img.track-cover-img');
    if (!img) {
      art.innerHTML = '';
      img = document.createElement('img');
      img.className = 'track-cover-img';
      img.alt = 'Cover';
      img.loading = 'eager';
      img.decoding = 'async';
      // Permite muestrear color en Visual+ sin taint del canvas (asset.localhost / http)
      img.crossOrigin = 'anonymous';
      art.appendChild(img);
    }
    if (!img.crossOrigin) img.crossOrigin = 'anonymous';
    if (img.getAttribute('src') !== cover) img.setAttribute('src', cover);
    img.onerror = () => {
      img.onerror = null;
      if (!track) {
        art.innerHTML = '<i class="ph ph-music-note"></i>';
        return;
      }
      track.coverUrl = null;
      void ensureSongCover(track).then(recovered => {
        if (recovered && state.activeQueue[state.currentTrackIndex] === track) {
          paintPlayerCover(recovered, track);
        } else if (state.activeQueue[state.currentTrackIndex] === track) {
          const el = ensurePlayerCoverStructure();
          if (el) el.innerHTML = '<i class="ph ph-music-note"></i>';
        }
      });
    };
  } else {
    art.innerHTML = '<i class="ph ph-music-note"></i>';
  }

  // Expanded cover panel: evitar src="" que fuerza a Blink a intentar decodificar index.html
  if (typeof expandedCoverImg !== 'undefined' && expandedCoverImg && expandedCoverPlaceholder) {
    if (cover) {
      if (expandedCoverImg.getAttribute('src') !== cover) {
        expandedCoverImg.setAttribute('src', cover);
      }
      expandedCoverImg.style.display = 'block';
      expandedCoverPlaceholder.style.display = 'none';
    } else {
      expandedCoverImg.removeAttribute('src');
      expandedCoverImg.style.display = 'none';
      expandedCoverPlaceholder.style.display = 'flex';
    }
  }

  // Avisa a Visual+ (fondo líquido) para actualizar la paleta de la canción actual
  try {
    document.dispatchEvent(new CustomEvent('pn-track-cover-changed', {
      detail: { coverSrc: cover || null, track: track || null }
    }));
  } catch (_) {}
}
