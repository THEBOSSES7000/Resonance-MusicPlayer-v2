// Letras y editor de pista. Este archivo solo reexporta la API pública; el código vive en js/lyrics/*.js.

export { toggleLyricsTranslation } from './lyrics/translation.js';
export { getLyricsTarget, openLyricsSearch, closeLyricsSearch, applyLyricsToSong } from './lyrics/lyricsSearch.js';
export { openTrackEditor, closeTrackEditor } from './lyrics/trackEditor.js';
export { saveTrackEdits } from './lyrics/saveTrackEdits.js';
export { initLyricsFeatures } from './lyrics/init.js';
