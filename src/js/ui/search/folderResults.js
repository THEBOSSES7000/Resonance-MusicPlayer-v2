// UI · Resultados de búsqueda: pestaña «Carpetas».

import { state } from '../../state.js';
import { searchResultsContent } from '../dom.js';
import { escapeHtml, getSoundWaveHTML } from '../uiUtils.js';
import { isPlaybackPaused } from '../../audioPlayer.js';
import { navigateToView } from '../navigation.js';

/** Resultados de búsqueda de la pestaña «Carpetas». */
export function renderFolderSearchResults(q, displayQuery) {
    const matches = state.configuredFolders.filter(f =>
      (f.name && f.name.toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q))
    );

    if (matches.length === 0) {
      searchResultsContent.innerHTML = `
        <div class="empty-state-card" style="margin-top: 1rem;">
          <i class="ph ph-folder"></i>
          <h3>No se encontraron carpetas</h3>
          <p>No hay carpetas vinculadas que coincidan con "${displayQuery}".</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'folders-grid';

    matches.forEach(folder => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.dataset.id = folder.id;

      const isThisFolderPlaying = state.activeContextId === ('folder_' + folder.id);
      if (isThisFolderPlaying) card.classList.add('is-playing-origin');

      card.innerHTML = `
        <div class="folder-card-icon"><i class="ph-fill ph-folder"></i></div>
        <div class="folder-card-info">
          <div class="folder-card-title-row">
            <span class="folder-card-title">${escapeHtml(folder.name)}</span>
            <div class="folder-soundwave-wrap">
              ${isThisFolderPlaying ? getSoundWaveHTML(isPlaybackPaused()) : ''}
            </div>
          </div>
          <span class="folder-card-desc">${escapeHtml(folder.description || "Carpeta local de música")}</span>
          <span class="folder-card-count">${folder.count} canciones</span>
        </div>
      `;

      card.addEventListener('click', () => {
        navigateToView('folder-detail', { folderId: folder.id });
      });

      grid.appendChild(card);
    });

    searchResultsContent.appendChild(grid);
}
