// UI · Estado mutable compartido entre módulos de la interfaz (se usa como uiVars.nombre).

export const SEARCH_PAGE_SIZE = 50;

// Variables que se reasignan desde más de un módulo. Se leen y escriben como uiVars.nombre.
export const uiVars = {
  profileEditorPhotoData: null,
  activeTrackFilter: { field: 'all', value: '' },
  listSearchQuery: '',
  draggedTrackIndex: null,
  isDragging: false,
  tempModalCoverUrl: null,
  tempCoverFile: null,
  tempImportedSongs: [],
  tempImportedPlaylistHasM3U: false,
  songDetailsTarget: null,
  detailVisibleCount: 50,
  searchVisibleCount: SEARCH_PAGE_SIZE,
  renderedSearchSongsList: [],
  renderedSearchQueueList: [],
  detailVisibleContextKey: '',
  albumGridVisibleCount: 50,
  isLoadingMoreTrackRows: false,
  renderedTrackList: [],
  playlistTracksBodyListenersBound: false,
  renderedTrackContextId: null,
  renderedTrackContextTitle: '',
  lastMusicBrainzRequestAt: 0,
  musicBrainzRequestQueue: Promise.resolve()
};
