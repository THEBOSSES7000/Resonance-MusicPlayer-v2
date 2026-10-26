// UI · Arrastrar y soltar: reordenar cola, canciones y playlists.

import { btnToggleTrackReorder, playlistTracksBody } from './dom.js';
import { persistPlaylists, state } from '../state.js';
import { sidebarPlaylistDragReorderEnabled } from './init.js';
import { uiVars } from './sharedState.js';
import { renderHistoryUI, renderQueue } from './queueHistory.js';
import { renderPlaylistDetailView } from './playlistDetail.js';
import { favoriteStorageKey } from './favorites.js';
import { renderPlaylistsUI } from './collections.js';

export let draggedQueueIndex = null;

export let draggedPlaylistId = null;

export function updateTrackReorderToggle() {
  if (!btnToggleTrackReorder) return;
  const isCustomPlaylist = state.currentView === 'playlist' && state.trackSortMode === 'custom';
  const isQueue = state.currentView === 'queue-detail';
  let queueHistoryPrefixLen = 0;
  const enabled = isQueue
    ? (state.queueTrackDragReorderEnabled !== false)
    : state.playlistTrackDragReorderEnabled;
  btnToggleTrackReorder.hidden = !(isCustomPlaylist || isQueue);
  btnToggleTrackReorder.setAttribute('aria-pressed', String(Boolean(enabled)));
  btnToggleTrackReorder.title = enabled
    ? 'Desactivar reordenamiento por arrastre'
    : 'Activar reordenamiento por arrastre';
  btnToggleTrackReorder.setAttribute('aria-label', btnToggleTrackReorder.title);
  const icon = btnToggleTrackReorder.querySelector('i');
  if (icon) icon.className = enabled ? 'ph ph-hand-grabbing' : 'ph ph-hand';
}

export function updateSidebarPlaylistReorderToggle() {
  const btn = document.getElementById('btn-toggle-sidebar-playlist-reorder');
  if (!btn) return;
  const isCustom = state.playlistSortMode === 'custom';
  btn.hidden = !isCustom;
  btn.setAttribute('aria-pressed', String(sidebarPlaylistDragReorderEnabled));
  btn.title = sidebarPlaylistDragReorderEnabled
    ? 'Desactivar reordenamiento por arrastre'
    : 'Activar reordenamiento por arrastre';
  btn.setAttribute('aria-label', btn.title);
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = sidebarPlaylistDragReorderEnabled ? 'ph ph-hand-grabbing' : 'ph ph-hand';
  }
}

function clearDragClasses() {
  document.querySelectorAll('.dragging, .table-dragging, .queue-dragging').forEach(el => {
    el.classList.remove('dragging', 'table-dragging', 'queue-dragging');
  });
  document.querySelectorAll('.drag-over, .table-drag-over, .queue-drag-over').forEach(el => {
    el.classList.remove('drag-over', 'table-drag-over', 'queue-drag-over');
  });
}

export function cleanupDragState() {
  clearDragClasses();
  uiVars.draggedTrackIndex = null;
  draggedQueueIndex = null;
  draggedPlaylistId = null;
  setTimeout(() => {
    uiVars.isDragging = false;
  }, 100);
}

/** Reordenado interno por pointer (evita fallos de HTML5 DnD en WebView2). */
const PN_POINTER_DRAG = {
  active: false,
  moved: false,
  type: null, // 'queue' | 'track' | 'playlist'
  fromIndex: -1,
  fromId: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  ghost: null,
  overEl: null,
};

function pnClearPointerDragOver() {
  document.querySelectorAll('.queue-drag-over, .table-drag-over, .drag-over').forEach(el => {
    el.classList.remove('queue-drag-over', 'table-drag-over', 'drag-over');
  });
  PN_POINTER_DRAG.overEl = null;
}

function pnRemovePointerGhost() {
  if (PN_POINTER_DRAG.ghost) {
    PN_POINTER_DRAG.ghost.remove();
    PN_POINTER_DRAG.ghost = null;
  }
}

function pnEndPointerDrag() {
  pnClearPointerDragOver();
  pnRemovePointerGhost();
  document.body.classList.remove('pn-pointer-dragging');
  if (PN_POINTER_DRAG.pointerId != null) {
    try {
      document.body.releasePointerCapture?.(PN_POINTER_DRAG.pointerId);
    } catch (_) {}
  }
  PN_POINTER_DRAG.active = false;
  PN_POINTER_DRAG.moved = false;
  PN_POINTER_DRAG.type = null;
  PN_POINTER_DRAG.fromIndex = -1;
  PN_POINTER_DRAG.fromId = null;
  PN_POINTER_DRAG.pointerId = null;
  cleanupDragState();
}

function pnCreateGhost(fromEl, clientX, clientY) {
  pnRemovePointerGhost();
  const ghost = fromEl.cloneNode(true);
  ghost.classList.add('pn-drag-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = `${clientX + 12}px`;
  ghost.style.top = `${clientY + 12}px`;
  ghost.style.width = `${Math.min(fromEl.getBoundingClientRect().width, 320)}px`;
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '20000';
  ghost.style.opacity = '0.92';
  ghost.style.margin = '0';
  document.body.appendChild(ghost);
  PN_POINTER_DRAG.ghost = ghost;
}

function pnUpdateGhost(clientX, clientY) {
  if (!PN_POINTER_DRAG.ghost) return;
  PN_POINTER_DRAG.ghost.style.left = `${clientX + 12}px`;
  PN_POINTER_DRAG.ghost.style.top = `${clientY + 12}px`;
}

function pnHighlightOver(el, className) {
  if (PN_POINTER_DRAG.overEl === el) return;
  pnClearPointerDragOver();
  if (el) {
    el.classList.add(className);
    PN_POINTER_DRAG.overEl = el;
  }
}

function pnApplyQueueReorder(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return;
  if (from < 0 || from >= state.activeQueue.length) return;
  to = Math.max(0, Math.min(state.activeQueue.length - 1, to));
  if (from === to) return;
  const item = state.activeQueue[from];
  state.activeQueue.splice(from, 1);
  state.activeQueue.splice(to, 0, item);
  if (state.currentTrackIndex === from) state.currentTrackIndex = to;
  else if (from < state.currentTrackIndex && to >= state.currentTrackIndex) state.currentTrackIndex -= 1;
  else if (from > state.currentTrackIndex && to <= state.currentTrackIndex) state.currentTrackIndex += 1;
  renderQueue();
}

function pnApplyTrackReorder(from, insertAt) {
  uiVars.draggedTrackIndex = from;
  const fakeEvent = { clientY: 0 };
  // Reuse existing reorder with synthetic target
  const rows = [...(playlistTracksBody?.querySelectorAll('.playlist-table-row') || [])];
  let targetRow = null;
  if (insertAt >= rows.length) {
    targetRow = rows[rows.length - 1] || null;
    if (targetRow) {
      const rect = targetRow.getBoundingClientRect();
      fakeEvent.clientY = rect.bottom;
    }
  } else {
    targetRow = rows.find(r => Number(r.dataset.sourceTrackIdx) === insertAt) || rows[insertAt] || null;
    if (targetRow) {
      const rect = targetRow.getBoundingClientRect();
      fakeEvent.clientY = rect.top + 1;
    }
  }
  reorderTrackRows(targetRow, fakeEvent);
  uiVars.draggedTrackIndex = null;
}

function pnOnPointerMove(e) {
  if (!PN_POINTER_DRAG.active || e.pointerId !== PN_POINTER_DRAG.pointerId) return;
  const dx = e.clientX - PN_POINTER_DRAG.startX;
  const dy = e.clientY - PN_POINTER_DRAG.startY;
  if (!PN_POINTER_DRAG.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
    PN_POINTER_DRAG.moved = true;
    document.body.classList.add('pn-pointer-dragging');
    uiVars.isDragging = true;
    try { PN_POINTER_DRAG.sourceEl?.setPointerCapture?.(e.pointerId); } catch (_) {}
    const fromEl =
      PN_POINTER_DRAG.type === 'queue'
        ? document.querySelector(`.queue-item[data-queue-idx="${PN_POINTER_DRAG.fromIndex}"]`)
        : (PN_POINTER_DRAG.type === 'track' || PN_POINTER_DRAG.type === 'queue-detail')
          ? document.querySelector(`.playlist-table-row[data-source-track-idx="${PN_POINTER_DRAG.fromIndex}"]`)
          : document.querySelector(`.playlist-card-left[data-playlist-id="${PN_POINTER_DRAG.fromId}"]`);
    if (fromEl) {
      fromEl.classList.add(PN_POINTER_DRAG.type === 'queue' ? 'queue-dragging' : (PN_POINTER_DRAG.type === 'track' || PN_POINTER_DRAG.type === 'queue-detail') ? 'table-dragging' : 'dragging');
      pnCreateGhost(fromEl, e.clientX, e.clientY);
    }
  }
  if (!PN_POINTER_DRAG.moved) return;
  e.preventDefault();
  pnUpdateGhost(e.clientX, e.clientY);

  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (PN_POINTER_DRAG.type === 'queue') {
    const over = under?.closest?.('.queue-item');
    pnHighlightOver(over && Number(over.dataset.queueIdx) !== PN_POINTER_DRAG.fromIndex ? over : null, 'queue-drag-over');
  } else if (PN_POINTER_DRAG.type === 'track' || PN_POINTER_DRAG.type === 'queue-detail') {
    const over = under?.closest?.('.playlist-table-row');
    pnHighlightOver(over && Number(over.dataset.sourceTrackIdx) !== PN_POINTER_DRAG.fromIndex ? over : null, 'table-drag-over');
  } else if (PN_POINTER_DRAG.type === 'playlist') {
    const over = under?.closest?.('.playlist-card-left');
    pnHighlightOver(over && String(over.dataset.playlistId) !== String(PN_POINTER_DRAG.fromId) ? over : null, 'drag-over');
  }
}

function pnOnPointerUp(e) {
  if (!PN_POINTER_DRAG.active || e.pointerId !== PN_POINTER_DRAG.pointerId) return;
  const moved = PN_POINTER_DRAG.moved;
  const type = PN_POINTER_DRAG.type;
  const from = PN_POINTER_DRAG.fromIndex;
  const fromId = PN_POINTER_DRAG.fromId;
  const overEl = PN_POINTER_DRAG.overEl;
  const clientY = e.clientY;

  document.removeEventListener('pointermove', pnOnPointerMove, true);
  document.removeEventListener('pointerup', pnOnPointerUp, true);
  document.removeEventListener('pointercancel', pnOnPointerUp, true);

  if (moved) {
    if (type === 'queue' && overEl) {
      let to = Number(overEl.dataset.queueIdx);
      const rect = overEl.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) to += 1;
      if (from < to) to -= 1;
      pnApplyQueueReorder(from, to);
    } else if (type === 'queue-detail' && overEl) {
      const isHistTarget = overEl.dataset.queueHistory === '1';
      let rowIndex = Number(overEl.dataset.sourceTrackIdx);
      const rect = overEl.getBoundingClientRect();
      const dropAfter = clientY > rect.top + rect.height / 2;
      let insertAt;
      const cur = state.currentTrackIndex;
      if (isHistTarget || !Number.isInteger(rowIndex) || rowIndex < 0) {
        insertAt = -1; // zona de reproducidas
      } else if (rowIndex === cur && !dropAfter && from > cur) {
        // Mitad superior de la canción actual → contar como reproducida
        insertAt = -1;
      } else {
        insertAt = dropAfter ? rowIndex + 1 : rowIndex;
        if (from < insertAt) insertAt -= 1;
      }
      if (from >= 0 && from < state.activeQueue.length) {
        const moveToHistory = from !== cur && (
          insertAt < 0 ||
          (Number.isInteger(insertAt) && insertAt < cur)
        );
        if (moveToHistory) {
          const item = state.activeQueue.splice(from, 1)[0];
          if (item) {
            if (from < cur) {
              state.currentTrackIndex = Math.max(0, cur - 1);
            }
            // Siempre registrar como reproducida
            if (state.playbackHistory.length === 0 || state.playbackHistory[0] !== item) {
              state.playbackHistory.unshift(item);
              if (state.playbackHistory.length > 100) state.playbackHistory.length = 100;
            }
            try { renderHistoryUI(); } catch (_) {}
          }
          renderQueue();
          void renderPlaylistDetailView();
        } else if (from !== insertAt) {
          insertAt = Math.max(0, Math.min(state.activeQueue.length - 1, insertAt));
          const item = state.activeQueue[from];
          state.activeQueue.splice(from, 1);
          state.activeQueue.splice(insertAt, 0, item);
          if (state.currentTrackIndex === from) state.currentTrackIndex = insertAt;
          else if (from < state.currentTrackIndex && insertAt >= state.currentTrackIndex) state.currentTrackIndex -= 1;
          else if (from > state.currentTrackIndex && insertAt <= state.currentTrackIndex) state.currentTrackIndex += 1;
          renderQueue();
          void renderPlaylistDetailView();
        }
      }
    } else if (type === 'track' && overEl) {
      let rowIndex = Number(overEl.dataset.sourceTrackIdx);
      const rect = overEl.getBoundingClientRect();
      let insertAt = clientY > rect.top + rect.height / 2 ? rowIndex + 1 : rowIndex;
      if (from < insertAt) insertAt -= 1;
      uiVars.draggedTrackIndex = from;
      // Direct splice path
      const isFavorites = state.currentView === 'favorites';
      const playlist = isFavorites ? null : state.playlists.find(p => p.id === state.currentPlaylistId);
      const orderedTracks = isFavorites
        ? state.localMusicFiles.filter(s => s.isFavorite)
        : playlist?.songs;
      if (orderedTracks && from >= 0 && from < orderedTracks.length) {
        insertAt = Math.max(0, Math.min(orderedTracks.length - 1, insertAt));
        if (from !== insertAt) {
          const [song] = orderedTracks.splice(from, 1);
          orderedTracks.splice(insertAt, 0, song);
          if (isFavorites) {
            const nonFavorites = state.localMusicFiles.filter(t => !t.isFavorite);
            state.localMusicFiles = [...orderedTracks, ...nonFavorites];
            localStorage.setItem(
              'pn_favorites_keys',
              JSON.stringify(orderedTracks.map(favoriteStorageKey).filter(Boolean))
            );
          } else {
            persistPlaylists();
          }
          void renderPlaylistDetailView();
        }
      }
      uiVars.draggedTrackIndex = null;
    } else if (type === 'playlist' && overEl && fromId != null) {
      const insertAfter = clientY > overEl.getBoundingClientRect().top + overEl.offsetHeight / 2;
      try {
        reorderPinnedPlaylists(fromId, overEl.dataset.playlistId, insertAfter);
      } catch (_) {}
    }
  }
  pnEndPointerDrag();
}

export function pnStartPointerDrag(e, { type, fromIndex, fromId, el }) {
  if (e.button !== 0) return;
  if (e.target.closest('button, a, input, select, textarea, .btn-icon')) return;
  PN_POINTER_DRAG.active = true;
  PN_POINTER_DRAG.moved = false;
  PN_POINTER_DRAG.type = type;
  PN_POINTER_DRAG.fromIndex = fromIndex;
  PN_POINTER_DRAG.fromId = fromId != null ? String(fromId) : null;
  PN_POINTER_DRAG.pointerId = e.pointerId;
  PN_POINTER_DRAG.startX = e.clientX;
  PN_POINTER_DRAG.startY = e.clientY;
  uiVars.isDragging = true;
  if (type === 'queue') draggedQueueIndex = fromIndex;
  if (type === 'track') uiVars.draggedTrackIndex = fromIndex;
  if (type === 'playlist') draggedPlaylistId = PN_POINTER_DRAG.fromId;
  PN_POINTER_DRAG.sourceEl = el || null;
  document.addEventListener('pointermove', pnOnPointerMove, true);
  document.addEventListener('pointerup', pnOnPointerUp, true);
  document.addEventListener('pointercancel', pnOnPointerUp, true);
}

function canReorderTrackRows() {
  return state.trackSortMode === 'custom' &&
    (state.currentView === 'favorites' ||
      (state.currentView === 'playlist' && state.playlistTrackDragReorderEnabled)) &&
    uiVars.draggedTrackIndex !== null;
}

export function reorderTrackRows(targetRow, event) {
  if (uiVars.draggedTrackIndex === null || state.trackSortMode !== 'custom') return;
  if (state.currentView === 'playlist' && !state.playlistTrackDragReorderEnabled) return;
  const isFavorites = state.currentView === 'favorites';
  if (!isFavorites && state.currentView !== 'playlist') return;

  const playlist = isFavorites
    ? null
    : state.playlists.find(item => item.id === state.currentPlaylistId);
  const orderedTracks = isFavorites
    ? state.localMusicFiles.filter(song => song.isFavorite)
    : playlist?.songs;
  if (!orderedTracks || uiVars.draggedTrackIndex < 0 || uiVars.draggedTrackIndex >= orderedTracks.length) return;

  const sourceIndex = uiVars.draggedTrackIndex;
  let insertAt;
  if (targetRow) {
    let rowIndex = Number(targetRow.dataset.sourceTrackIdx);
    if (!Number.isInteger(rowIndex) || rowIndex < 0) {
      const rows = [...(playlistTracksBody?.querySelectorAll('.playlist-table-row') || [])];
      rowIndex = rows.indexOf(targetRow);
    }
    if (!Number.isInteger(rowIndex) || rowIndex < 0) return;
    const rect = targetRow.getBoundingClientRect();
    const placeAfter = !!(event && event.clientY > rect.top + rect.height / 2);
    insertAt = placeAfter ? rowIndex + 1 : rowIndex;
  } else {
    insertAt = orderedTracks.length;
  }

  // Ajuste al quitar el origen (como Array splice)
  if (sourceIndex < insertAt) insertAt -= 1;
  insertAt = Math.max(0, Math.min(orderedTracks.length - 1, insertAt));
  if (sourceIndex === insertAt) return;

  const [song] = orderedTracks.splice(sourceIndex, 1);
  orderedTracks.splice(insertAt, 0, song);
  if (isFavorites) {
    const nonFavorites = state.localMusicFiles.filter(track => !track.isFavorite);
    state.localMusicFiles = [...orderedTracks, ...nonFavorites];
    localStorage.setItem(
      'pn_favorites_keys',
      JSON.stringify(orderedTracks.map(favoriteStorageKey).filter(Boolean))
    );
  } else {
    persistPlaylists();
  }
  void renderPlaylistDetailView();
}

export function reorderPinnedPlaylists(sourceId, targetId = null, insertAfter = false) {
  const pinnedPlaylists = state.playlists.filter(playlist => playlist.isPinned !== false);
  const sourceIndex = pinnedPlaylists.findIndex(playlist => String(playlist.id) === String(sourceId));
  if (sourceIndex < 0) return;

  const [playlist] = pinnedPlaylists.splice(sourceIndex, 1);
  let targetIndex = targetId === null
    ? pinnedPlaylists.length
    : pinnedPlaylists.findIndex(item => String(item.id) === String(targetId));
  if (targetIndex < 0) return;
  if (insertAfter && targetId !== null) targetIndex++;
  pinnedPlaylists.splice(targetIndex, 0, playlist);

  let pinnedIndex = 0;
  state.playlists = state.playlists.map(item =>
    item.isPinned !== false ? pinnedPlaylists[pinnedIndex++] : item
  );
  persistPlaylists();
  renderPlaylistsUI();
}
