// UI · Playlists dinámicas: filtros y su formulario.

import { state } from '../state.js';
import { smartPlaylistFilterTemplate, smartPlaylistFilters, smartPlaylistLogic } from './dom.js';

function populateSmartPlaylistFolderSelect(select, selectedValue = '') {
  if (!select) return;
  const folders = [...(state.configuredFolders || [])]
    .filter(folder => folder && folder.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { sensitivity: 'base' }));
  const current = String(selectedValue || '');
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = folders.length ? 'Elegir carpeta...' : 'No hay carpetas en la biblioteca';
  select.appendChild(placeholder);
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder.name;
    option.textContent = folder.name;
    select.appendChild(option);
  });
  if (current && [...select.options].some(option => option.value === current)) {
    select.value = current;
  } else {
    select.value = '';
  }
}

export function syncSmartPlaylistFilterRowInputs(row, fieldValue, value = '') {
  if (!row) return;
  const artist = row.querySelector('.smart-playlist-filter-artist');
  const folder = row.querySelector('.smart-playlist-filter-folder');
  if (artist) {
    const showText = fieldValue === 'artist' || fieldValue === 'genre';
    artist.hidden = !showText;
    if (fieldValue === 'artist') {
      artist.placeholder = 'Nombre del artista...';
      artist.setAttribute('aria-label', 'Filtrar por artista');
      artist.value = String(value || '');
    } else if (fieldValue === 'genre') {
      artist.placeholder = 'Género (ej. Rock, Electronic)...';
      artist.setAttribute('aria-label', 'Filtrar por género');
      artist.value = String(value || '');
    } else {
      artist.value = '';
    }
  }
  if (folder) {
    folder.hidden = fieldValue !== 'folder';
    if (fieldValue === 'folder') populateSmartPlaylistFolderSelect(folder, value);
    else folder.value = '';
  }
}

export function addSmartPlaylistFilterRow(filter = { field: 'date', value: '' }) {
  if (!smartPlaylistFilters || !smartPlaylistFilterTemplate) return;
  if (!filter || typeof filter !== 'object') filter = { field: 'date', value: '' };
  const fragment = smartPlaylistFilterTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.smart-playlist-filter-row');
  const field = row.querySelector('.smart-playlist-filter-field');
  const isValidField = [...field.options].some(option => option.value === filter.field);
  field.value = isValidField ? filter.field : 'date';
  syncSmartPlaylistFilterRowInputs(row, field.value, filter.value || '');
  smartPlaylistFilters.appendChild(fragment);
  updateSmartPlaylistFilterRemoveButtons();
}

export function updateSmartPlaylistFilterRemoveButtons() {
  if (!smartPlaylistFilters) return;
  const rows = smartPlaylistFilters.querySelectorAll('.smart-playlist-filter-row');
  rows.forEach(row => {
    row.querySelector('.smart-playlist-remove-filter').disabled = rows.length <= 1;
  });
}

export function setSmartPlaylistFilters(filters, operator = 'and') {
  if (!smartPlaylistFilters) return;
  smartPlaylistFilters.replaceChildren();
  const normalizedFilters = Array.isArray(filters) && filters.length
    ? filters.filter(filter => filter && typeof filter === 'object')
    : [{ field: 'date', value: '' }];
  if (!normalizedFilters.length) normalizedFilters.push({ field: 'date', value: '' });
  normalizedFilters.forEach(filter => addSmartPlaylistFilterRow(filter));
  setSmartPlaylistFilterOperator(operator);
}

export function setSmartPlaylistFilterOperator(operator) {
  if (!smartPlaylistLogic) return;
  const normalizedOperator = operator === 'or' ? 'or' : 'and';
  smartPlaylistLogic.dataset.operator = normalizedOperator;
  smartPlaylistLogic.textContent = normalizedOperator === 'or'
    ? 'Coincidir cualquiera (O)'
    : 'Coincidir todos (Y)';
  smartPlaylistLogic.setAttribute('aria-label', normalizedOperator === 'or'
    ? 'Los filtros se combinan con O: coincide cualquiera'
    : 'Los filtros se combinan con Y: deben coincidir todos');
}

export function readSmartPlaylistFilters() {
  return [...(smartPlaylistFilters?.querySelectorAll('.smart-playlist-filter-row') || [])].map(row => {
    const field = row.querySelector('.smart-playlist-filter-field').value;
    const artist = row.querySelector('.smart-playlist-filter-artist');
    const folder = row.querySelector('.smart-playlist-filter-folder');
    let value = '';
    if (field === 'artist' || field === 'genre') value = artist?.value?.trim() || '';
    else if (field === 'folder') value = folder?.value?.trim() || '';
    return { field, value };
  });
}
