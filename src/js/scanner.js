// Escáner de biblioteca. Este archivo solo reexporta la API pública; el código vive en js/scanner/*.js.

export { trackLoadedLyricsInRam } from './scanner/lyricsCache.js';
export { parseLyricsText, parseInlineLyricWords } from './scanner/lyricsParsing.js';
export { extractMetadata } from './scanner/extractMetadata.js';
export { processAudioFiles, rescanConfiguredMusic } from './scanner/processFiles.js';
export { saveNativeLibraryCache } from './scanner/libraryCache.js';
export { ensureSongLyrics, ensureSongCover, ensureSongTechDetails } from './scanner/songAssets.js';
export { initializeMusicLibrary } from './scanner/libraryLoad.js';
export { refreshLibraryMetadata } from './scanner/libraryRefresh.js';
export { initScanner } from './scanner/init.js';

export { resolveCoverUrl, resolveAudioUrl } from './state.js';
