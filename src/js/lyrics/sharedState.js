// Letras · Estado mutable compartido entre módulos (se usa como lyricsVars.nombre).

// Variables que se reasignan desde más de un módulo. Se leen y escriben como lyricsVars.nombre.
export const lyricsVars = {
  editCoverDataUrl: null,
  editCoverRemove: false,
  lyricsAutoScrollEnabled: true,
  lyricsAreSynced: false,
  lyricsPointerRecentlyMoved: false,
  lyricsPointerIdleTimer: null
};
