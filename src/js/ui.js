// Interfaz principal. Este archivo solo reexporta la API pública; el código vive en js/ui/*.js.

export { shouldShowListTrackNumbers, applyListTrackNumbersVisibility, getListCoverMode, applyListCoverMode } from './ui/covers.js';
export { isAlbumNavigationBlocked, syncPlayerAlbumLinkState } from './ui/libraryEntities.js';
export { getSoundWaveHTML, showConfirmDialog, extractDominantColor } from './ui/uiUtils.js';
export { parseM3UContent } from './ui/m3uImport.js';
export { playFromContext, ensureSongMetadata, averageCoverColor, syncPlayingUI } from './ui/playback.js';
export { addCurrentSongToPlaylist, addSongToPlaylist } from './ui/playlistPicker.js';
export { toggleCurrentSongFavorite, updateFavoritesCount, applyFavoritesDisplayName, updateFavIcon } from './ui/favorites.js';
export { renderGrids } from './ui/homeGrids.js';
export { renderHistoryUI, renderQueue } from './ui/queueHistory.js';
export { persistPlaybackSession, initializePlaybackSession } from './ui/playbackSession.js';
export { navigateToView } from './ui/navigation.js';
export { renderSearchResultsContent } from './ui/search.js';
export { renderFoldersUI, renderPlaylistsHubUI } from './ui/folderPlaylistViews.js';
export { renderPlaylistDetailView } from './ui/playlistDetail.js';
export { openPlaylistExportPicker, renderPlaylistsUI } from './ui/collections.js';
export { updateLyricsUI, updateSyncedLyricsProgress, suspendLyricsAutoScroll, resumeLyricsAutoScrollAtActiveLine } from './ui/lyricsRender.js';
export { showSongDetails, refreshSongDetailsIfOpen } from './ui/songDetails.js';
export { toggleExpandedCover, showLyricsCompactPlayerImmediately, toggleNowPlayingFullscreenFromShortcut, cycleNowPlayingFsLayout, closeLyricsView, updateNowPlayingFsAvailability, updateNpFsVinylAccent, updatePlayerState } from './ui/nowPlayingFs.js';
export { openEditPlaylistModal, openFolderDescModal } from './ui/modals.js';
export { initUI } from './ui/init.js';
