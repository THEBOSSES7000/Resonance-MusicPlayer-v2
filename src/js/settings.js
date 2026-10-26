// Ajustes. Este archivo solo reexporta la API pública; el código vive en js/settings/*.js.

export { renderDirectories, removeDirectory, clearFolders } from './settings/directories.js';
export { isNpFsVinylEnabled, applyNpFsVinylEnabled, updateNpFsVinylVolumeConflicts } from './settings/nowPlayingFsSettings.js';
export { initSettings } from './settings/init.js';
