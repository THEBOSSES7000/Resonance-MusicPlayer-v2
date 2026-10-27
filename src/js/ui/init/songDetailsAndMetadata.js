// UI · Detalles de canción y modales de metadatos.

import { btnCloseDetailsBtn, btnCloseSongDetails, btnDetailsEditTrack, btnDetailsSearchLyrics, btnFetchTrackMetadata, detailsCoverBox, metadataMatchClose, metadataMatchList, metadataMatchModal, metadataSearchAlbum, metadataSearchArtist, metadataSearchSubmit, metadataSearchTitle, metadataTextSearchClose, metadataTextSearchModal, songDetailsModal, trackMetadataSearchMenu } from '../dom.js';
import { clearContainerCovers } from '../covers.js';
import { uiVars } from '../sharedState.js';
import { openLyricsSearch, openTrackEditor } from '../../lyrics.js';
import { applyMetadataMatch, closeMetadataMatchModal, closeMetadataTextSearch, loadMetadataMatchCover, renderMetadataMatchDetails, searchMetadataByText, searchTrackMetadata, trackMetadataMatches } from '../songDetails.js';

/** Detalles de canción y modales de metadatos. */
export function bindSongDetailsAndMetadata() {

  btnCloseSongDetails.addEventListener('click', () => {
    songDetailsModal.classList.remove('open');
    clearContainerCovers(detailsCoverBox);
    uiVars.songDetailsTarget = null;
  });
  btnCloseDetailsBtn.addEventListener('click', () => {
    songDetailsModal.classList.remove('open');
    clearContainerCovers(detailsCoverBox);
    uiVars.songDetailsTarget = null;
  });
  btnDetailsSearchLyrics.addEventListener('click', () => {
    if (uiVars.songDetailsTarget) openLyricsSearch(uiVars.songDetailsTarget);
  });
  btnDetailsEditTrack.addEventListener('click', () => {
    if (uiVars.songDetailsTarget) openTrackEditor(uiVars.songDetailsTarget);
  });
  btnFetchTrackMetadata?.addEventListener('click', event => {
    event.stopPropagation();
    const isOpen = !trackMetadataSearchMenu.hidden;
    trackMetadataSearchMenu.hidden = isOpen;
    btnFetchTrackMetadata.setAttribute('aria-expanded', String(!isOpen));
  });
  trackMetadataSearchMenu?.addEventListener('click', event => {
    const option = event.target.closest('[data-metadata-search]');
    if (option) void searchTrackMetadata(option.dataset.metadataSearch);
  });
  metadataMatchList?.addEventListener('click', event => {
    const card = event.target.closest('[data-match-index]');
    if (!card) return;
    const index = Number(card.dataset.matchIndex);
    const match = trackMetadataMatches[index];
    if (!match) return;

    if (event.target.closest('[data-metadata-expand]')) {
      const button = event.target.closest('[data-metadata-expand]');
      const details = card.querySelector('[data-metadata-details]');
      const isExpanded = !details.hidden;
      details.hidden = isExpanded;
      button.setAttribute('aria-expanded', String(!isExpanded));
      if (!isExpanded) {
        renderMetadataMatchDetails(card, match);
        void loadMetadataMatchCover(card, match);
      }
      return;
    }
    if (event.target.closest('[data-metadata-copy-all]')) {
      void applyMetadataMatch(index);
      return;
    }
    const singleFieldButton = event.target.closest('[data-metadata-copy-field]');
    if (singleFieldButton) {
      void applyMetadataMatch(index, [singleFieldButton.dataset.metadataCopyField]);
      return;
    }
    if (event.target.closest('[data-metadata-copy-selected]')) {
      const fields = [...card.querySelectorAll('[data-metadata-field]:checked')]
        .map(input => input.dataset.metadataField);
      if (fields.length) void applyMetadataMatch(index, fields);
    }
  });
  metadataMatchClose?.addEventListener('click', closeMetadataMatchModal);
  metadataMatchModal?.addEventListener('click', event => {
    if (event.target === metadataMatchModal) event.stopPropagation();
  });
  metadataTextSearchClose?.addEventListener('click', closeMetadataTextSearch);
  metadataTextSearchModal?.addEventListener('click', event => {
    if (event.target === metadataTextSearchModal) event.stopPropagation();
  });
  metadataSearchSubmit?.addEventListener('click', () => {
    void searchMetadataByText(
      metadataSearchTitle.value,
      metadataSearchArtist.value,
      metadataSearchAlbum.value
    );
  });
  [metadataSearchTitle, metadataSearchArtist, metadataSearchAlbum].forEach(input => {
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        metadataSearchSubmit?.click();
      }
    });
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.metadata-search-wrap')) return;
    if (trackMetadataSearchMenu) trackMetadataSearchMenu.hidden = true;
    btnFetchTrackMetadata?.setAttribute('aria-expanded', 'false');
  });
  songDetailsModal.addEventListener('click', (e) => {
    if (e.target === songDetailsModal) e.stopPropagation();
  });
}
