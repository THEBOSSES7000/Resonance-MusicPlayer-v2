// Ajustes · Directorios de música: lista, subcarpetas, quitar y limpiar.

import { state } from '../state.js';
import { directoriesListContainer } from './dom.js';
import { renderFoldersUI, renderGrids, renderHistoryUI, renderQueue, showConfirmDialog, syncPlayerAlbumLinkState, updateFavIcon } from '../ui.js';
import { resetProgressVisual, stopPlaybackForDeletedFile } from '../audioPlayer.js';

function normalizeDirPathKey(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

async function toggleDirectorySubfolders(dir, block, expandButton) {
  const existing = block.querySelector('.directory-subfolders');
  if (existing) {
    existing.remove();
    expandButton.classList.remove('is-open');
    expandButton.setAttribute('aria-expanded', 'false');
    expandButton.innerHTML = '<i class="ph ph-caret-right"></i>';
    return;
  }
  if (!window.__TAURI__?.core?.invoke) return;
  expandButton.disabled = true;
  try {
    const children = await window.__TAURI__.core.invoke('list_music_subfolders', { path: dir.path });
    const list = document.createElement('div');
    list.className = 'directory-subfolders';
    if (!children?.length) {
      list.innerHTML = '<p class="directory-subfolders-empty">No hay subcarpetas en este nivel.</p>';
    } else {
      children.forEach(child => {
        const row = document.createElement('div');
        row.className = 'directory-subfolder-row' + (child.excluded ? ' is-excluded' : '');
        const label = document.createElement('div');
        label.className = 'directory-subfolder-label';
        label.innerHTML = `<i class="ph ph-folder-simple"></i><span></span>`;
        label.querySelector('span').textContent = child.name;
        if (child.excluded) {
          const badge = document.createElement('em');
          badge.textContent = 'Excluida';
          label.appendChild(badge);
        }
        const action = document.createElement('button');
        action.type = 'button';
        action.className = child.excluded ? 'btn-restore-subdir' : 'btn-exclude-subdir';
        action.title = child.excluded ? 'Volver a incluir en el escaneo' : 'Excluir del escaneo';
        action.innerHTML = child.excluded
          ? '<i class="ph ph-arrow-counter-clockwise"></i>'
          : '<i class="ph ph-trash"></i>';
        action.addEventListener('click', async (event) => {
          event.stopPropagation();
          action.disabled = true;
          try {
            const updated = await window.__TAURI__.core.invoke('set_music_subfolder_excluded', {
              rootPath: dir.path,
              subfolderPath: child.path,
              excluded: !child.excluded
            });
            const idx = state.nativeMusicDirectories.findIndex(item => item.path === dir.path);
            if (idx >= 0) {
              state.nativeMusicDirectories[idx] = {
                ...state.nativeMusicDirectories[idx],
                ...updated
              };
            }
            // Refrescar solo la lista expandida
            list.remove();
            expandButton.classList.remove('is-open');
            await toggleDirectorySubfolders(dir, block, expandButton);
          } catch (error) {
            console.error(error);
            action.disabled = false;
          }
        });
        row.append(label, action);
        list.appendChild(row);
      });
    }
    block.appendChild(list);
    expandButton.classList.add('is-open');
    expandButton.setAttribute('aria-expanded', 'true');
    expandButton.innerHTML = '<i class="ph ph-caret-down"></i>';
  } catch (error) {
    console.error(error);
  } finally {
    expandButton.disabled = false;
  }
}

/** Escapa texto antes de insertarlo en plantillas HTML (innerHTML). */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function renderDirectories() {
  directoriesListContainer.innerHTML = '';
  if (state.nativeMusicDirectories.length > 0) {
    state.nativeMusicDirectories.forEach(dir => {
      const block = document.createElement('div');
      block.className = 'directory-block';

      const row = document.createElement('div');
      row.className = 'directory-row';
      const info = document.createElement('div');
      info.className = 'dir-info';
      info.innerHTML = '<i class="ph ph-folder"></i>';
      const labels = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = dir.name;
      const count = document.createElement('span');
      const excludedCount = Array.isArray(dir.excludedSubfolders) ? dir.excludedSubfolders.length : 0;
      count.textContent = excludedCount > 0
        ? `${dir.count} canciones indexadas · ${excludedCount} subcarpeta${excludedCount === 1 ? '' : 's'} excluida${excludedCount === 1 ? '' : 's'}`
        : `${dir.count} canciones indexadas`;
      labels.append(name, count);
      info.appendChild(labels);

      const actions = document.createElement('div');
      actions.className = 'directory-row-actions';

      const expandButton = document.createElement('button');
      expandButton.type = 'button';
      expandButton.className = 'btn-expand-dir';
      expandButton.title = 'Mostrar subcarpetas';
      expandButton.setAttribute('aria-expanded', 'false');
      expandButton.innerHTML = '<i class="ph ph-caret-right"></i>';
      expandButton.addEventListener('click', () => {
        void toggleDirectorySubfolders(dir, block, expandButton);
      });

      const removeButton = document.createElement('button');
      removeButton.className = 'btn-remove-dir';
      removeButton.title = 'Quitar carpeta';
      removeButton.innerHTML = '<i class="ph ph-trash"></i>';
      removeButton.addEventListener('click', () => removeDirectory(dir.path));

      actions.append(expandButton, removeButton);
      row.append(info, actions);
      block.appendChild(row);
      directoriesListContainer.appendChild(block);
    });
    return;
  }

  if (state.configuredFolders.length === 0) {
    directoriesListContainer.innerHTML = `
      <p style="color:var(--text-muted); font-size:0.85rem; padding: 1rem 0;">No has seleccionado ninguna carpeta de música aún.</p>
    `;
    return;
  }

  state.configuredFolders.forEach(dir => {
    const row = document.createElement('div');
    row.className = 'directory-row';
    row.innerHTML = `
      <div class="dir-info">
        <i class="ph ph-folder"></i>
        <div>
          <strong>${escapeHtml(dir.name)}</strong>
          <span>${dir.count} canciones indexadas</span>
        </div>
      </div>
      <button class="btn-remove-dir" title="Quitar">
        <i class="ph ph-trash"></i>
      </button>
    `;
    row.querySelector('.btn-remove-dir').addEventListener('click', () => removeDirectory(dir.name));
    directoriesListContainer.appendChild(row);
  });
}

export function removeDirectory(folderName) {
  const nativeDirectory = state.nativeMusicDirectories.find(dir => dir.path === folderName);
  if (nativeDirectory && window.__TAURI__?.core?.invoke) {
    window.__TAURI__.core.invoke('remove_music_directory', { path: nativeDirectory.path }).then(() => {
      state.nativeMusicDirectories = state.nativeMusicDirectories.filter(dir => dir.path !== nativeDirectory.path);
      renderDirectories();
      window.dispatchEvent(new Event('pn-native-library-changed'));
    }).catch(async error => {
      console.error('No se pudo quitar la carpeta de música:', error);
      await showConfirmDialog({
        title: "No se pudo quitar la carpeta",
        message: "No se pudo quitar la carpeta guardada. Revisa la consola para ver más detalles.",
        confirmText: "Entendido",
        showCancel: false
      });
    });
    return;
  }

  state.localMusicFiles = state.localMusicFiles.filter(s => s.folderName !== folderName);
  state.configuredFolders = state.configuredFolders.filter(f => f.name !== folderName);
  state.localMusicFiles.forEach((s, idx) => s.id = idx);

  const descs = JSON.parse(localStorage.getItem('pn_folder_descs') || '{}');
  delete descs[folderName];
  localStorage.setItem('pn_folder_descs', JSON.stringify(descs));
  localStorage.setItem('pn_folders_info', JSON.stringify(state.configuredFolders));

  if (state.configuredFolders.length === 0) {
    clearFolders();
  } else {
    renderDirectories();
    renderGrids();
    renderQueue();
    renderHistoryUI();
    renderFoldersUI();
    updateFavIcon();
  }
}

export function clearFolders() {
  state.configuredFolders = [];
  state.localMusicFiles = [];
  state.activeQueue = [];
  state.playbackHistory = [];
  state.currentTrackIndex = -1;
  stopPlaybackForDeletedFile();

  document.getElementById('current-title-text').textContent = "Sin reproducción activa";
  document.getElementById('current-artist').textContent = "Selecciona una canción";
  syncPlayerAlbumLinkState();
  document.getElementById('player-audio-quality').textContent = '';
  /* no destruir #player-cover-box: stopPlaybackForDeletedFile ya resetea la carátula */
  document.getElementById('time-current').textContent = "0:00";
  document.getElementById('time-total').textContent = "0:00";
  resetProgressVisual();
  document.getElementById('play-icon').className = "ph-fill ph-play";

  localStorage.removeItem('pn_folders_info');
  localStorage.removeItem('pn_folder_descs');
  renderDirectories();
  renderGrids();
  renderQueue();
  renderHistoryUI();
  renderFoldersUI();
  updateFavIcon();
}
