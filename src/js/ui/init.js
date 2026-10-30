// UI · Inicialización de la interfaz: llama a cada grupo de eventos (ui/init/*.js).

import { bindGlobalEvents } from './init/globalBindings.js';
import { bindFilterAndWindowEvents } from './init/filterAndWindowBindings.js';
import { bindMenusShortcutsAndListSearch } from './init/menusShortcutsAndListSearch.js';
import { bindSearchAndContent } from './init/searchAndContentBindings.js';
import { bindListInteractions, bindMetaLinkNavigation } from './init/listInteractions.js';
import { bindNavigationAndFavorites } from './init/navigationAndFavorites.js';
import { bindPlaylistModals } from './init/playlistModals.js';
import { bindSortMenus } from './init/sortMenus.js';
import { bindSongDetailsAndMetadata } from './init/songDetailsAndMetadata.js';

export let sidebarPlaylistDragReorderEnabled = localStorage.getItem('pn_sidebar_playlist_drag_reorder') !== 'false';

export let queueDetailShowHistory = localStorage.getItem('pn_queue_detail_show_history') === 'true';

export let albumsMinTrackCount = ['0', '3', '4', '5', '6'].includes(localStorage.getItem('pn_albums_min_tracks') || '0')
  ? Number(localStorage.getItem('pn_albums_min_tracks') || 0)
  : 0;

export let blockAlbumsBelowTrackFilter = localStorage.getItem('pn_albums_block_below_filter') !== 'false';

/* Setters: otros módulos importan estas variables (enlace vivo), pero solo este archivo puede reasignarlas. */
export function setSidebarPlaylistDragReorderEnabled(value) {
  sidebarPlaylistDragReorderEnabled = value;
}

export function setQueueDetailShowHistory(value) {
  queueDetailShowHistory = value;
}

export function setAlbumsMinTrackCount(value) {
  albumsMinTrackCount = value;
}

export function setBlockAlbumsBelowTrackFilter(value) {
  blockAlbumsBelowTrackFilter = value;
}

export function initUI() {
  bindGlobalEvents();
  bindFilterAndWindowEvents();
  bindMenusShortcutsAndListSearch();
  bindSearchAndContent();
  bindListInteractions();
  try { bindMetaLinkNavigation(); } catch (_) {}
  bindNavigationAndFavorites();
  bindPlaylistModals();
  bindSortMenus();
  bindSongDetailsAndMetadata();
}
