// Letras · Traducción de letras: caché, solicitud, render y controles.

import { state } from '../state.js';
import { lyricsVars } from './sharedState.js';
import { updateLyricsResyncVisibility } from './scrollResync.js';

const TRANSLATION_CACHE_INDEX_KEY = 'pn_lyrics_trans_keys';

const MAX_CACHED_TRANSLATIONS = 40;

let lyricsTranslationShown = false;

let lyricsTranslationLoading = false;

let lyricsTranslationRequestId = 0;

let activeTranslationSongId = null;

let activeTranslationLanguage = null;

let activeTranslationLines = null;

let lyricsToastTimer = null;

const LYRIC_TRANSLATION_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it'];

function isLyricsTranslationEnabled() {
  return localStorage.getItem('pn_lyrics_translation_enabled') === 'true';
}

function getLyricsTranslationLanguage() {
  const language = localStorage.getItem('pn_lyrics_translation_language') || 'es';
  return LYRIC_TRANSLATION_LANGUAGES.includes(language) ? language : 'es';
}

function getTranslationCacheKey(song, targetLang) {
  const path = song.file?.path || song.path;
  const trackKey = path
    ? encodeURIComponent(String(path).replace(/\\/g, '/').toLowerCase())
    : (song.id || encodeURIComponent(`${song.artist || ''}_${song.title || ''}`));
  return `lyrics_trans_${trackKey}_${targetLang}`;
}

function saveTranslationToBoundedStorage(cacheKey, translatedLines) {
  try {
    let keys = [];
    try {
      keys = JSON.parse(localStorage.getItem(TRANSLATION_CACHE_INDEX_KEY) || '[]');
      if (!Array.isArray(keys)) keys = [];
    } catch {
      keys = [];
    }
    keys = keys.filter(k => k !== cacheKey);
    while (keys.length >= MAX_CACHED_TRANSLATIONS) {
      const oldest = keys.shift();
      if (oldest) localStorage.removeItem(oldest);
    }
    localStorage.setItem(cacheKey, JSON.stringify(translatedLines));
    keys.push(cacheKey);
    localStorage.setItem(TRANSLATION_CACHE_INDEX_KEY, JSON.stringify(keys));
  } catch (error) {
    console.warn('No se pudo guardar la traducción de letras en caché:', error);
    showLyricsToast('Traducción cargada, pero no se pudo guardar en caché.');
  }
}

export function invalidateLyricsTranslationCache(song) {
  let keys = [];
  try {
    keys = JSON.parse(localStorage.getItem(TRANSLATION_CACHE_INDEX_KEY) || '[]');
    if (!Array.isArray(keys)) keys = [];
  } catch {
    keys = [];
  }
  LYRIC_TRANSLATION_LANGUAGES.forEach(language => {
    try {
      const key = getTranslationCacheKey(song, language);
      localStorage.removeItem(key);
      keys = keys.filter(k => k !== key);
      // Limpiar también clave legacy por ID si existía
      if (song.id) {
        const legacyKey = `lyrics_trans_${song.id}_${language}`;
        localStorage.removeItem(legacyKey);
        keys = keys.filter(k => k !== legacyKey);
      }
    } catch (error) {
      console.warn('No se pudo invalidar la caché de traducción de letras:', error);
    }
  });
  try {
    localStorage.setItem(TRANSLATION_CACHE_INDEX_KEY, JSON.stringify(keys));
  } catch { /* ignore */ }
}

function showLyricsToast(message) {
  let toast = document.getElementById('lyrics-translation-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lyrics-translation-toast';
    toast.className = 'lyrics-translation-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(lyricsToastTimer);
  lyricsToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

function getCurrentPlaybackSong() {
  return state.currentTrackIndex === -1 ? null : state.activeQueue[state.currentTrackIndex] || null;
}

function cloneOriginalLyrics(line) {
  const existing = line.querySelector('.lyric-line-original');
  if (existing) return existing.cloneNode(true);
  const original = document.createElement('span');
  original.className = 'lyric-line-original';
  original.textContent = line.dataset.originalText || '';
  return original;
}

function replaceLyricsLineLayers(line, baseLayers) {
  line.replaceChildren(...baseLayers);
}

function restoreOriginalLyrics() {
  document.querySelectorAll('#lyrics-lines-box .lyric-line-sync').forEach(line => {
    replaceLyricsLineLayers(line, [cloneOriginalLyrics(line)]);
  });
  document.dispatchEvent(new CustomEvent('pn-lyrics-layers-changed'));
}

function renderTranslatedLyrics(lines) {
  const lyricElements = document.querySelectorAll('#lyrics-lines-box .lyric-line-sync');
  lyricElements.forEach((line, index) => {
    const original = cloneOriginalLyrics(line);
    const translated = document.createElement('span');
    translated.className = 'lyric-line-translation';
    translated.textContent = lines[index]?.text || '';
    replaceLyricsLineLayers(line, [original, translated]);
  });
  document.dispatchEvent(new CustomEvent('pn-lyrics-layers-changed'));
}

export function updateLyricsTranslationControls(isSynced = false) {
  lyricsVars.lyricsAreSynced = isSynced;
  const container = document.getElementById('lyrics-floating-actions');
  const toggle = document.getElementById('lyrics-translation-toggle');
  if (container) {
    container.hidden = !document.getElementById('lyrics-overlay')?.classList.contains('open') ||
      !isSynced;
  }
  if (toggle) {
    toggle.hidden = !isSynced || !isLyricsTranslationEnabled();
    toggle.classList.toggle('is-active', lyricsTranslationShown);
    toggle.setAttribute('aria-pressed', String(lyricsTranslationShown));
    toggle.classList.toggle('is-loading', lyricsTranslationLoading);
    toggle.disabled = lyricsTranslationLoading;
    toggle.title = lyricsTranslationShown ? 'Mostrar letra original' : 'Traducir letra';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.querySelector('i').className = lyricsTranslationLoading
      ? 'ph ph-spinner-gap'
      : 'ph ph-translate';
  }
  updateLyricsResyncVisibility();
}

function getCachedTranslation(song, targetLang) {
  try {
    const key = getTranslationCacheKey(song, targetLang);
    let stored = localStorage.getItem(key);
    if (!stored && song.id) {
      stored = localStorage.getItem(`lyrics_trans_${song.id}_${targetLang}`);
    }
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length !== song.lyrics.lines.length ||
        parsed.some(line => !line || typeof line.text !== 'string')) {
      console.warn(`La caché de traducción para "${song.title}" no es válida; se volverá a traducir.`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('No se pudo leer la caché de traducción de letras:', error);
    return null;
  }
}

async function requestLyricsTranslation(song, targetLang) {
  const sourceLines = song.lyrics.lines;
  const nonEmptyLines = sourceLines
    .map((line, index) => ({ index, text: String(line.text || '').trim() }))
    .filter(line => line.text);
  if (!nonEmptyLines.length) throw new Error('La letra no contiene líneas de texto para traducir.');

  const query = nonEmptyLines.map(line => line.text).join('\n');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`El servicio respondió ${response.status}.`);
    const payload = await response.json();
    const segments = payload?.[0];
    if (!Array.isArray(segments)) throw new Error('El servicio devolvió una respuesta inesperada.');
    const segmentTexts = segments
      .map(segment => Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '');
    let translatedTexts;
    if (segmentTexts.length === nonEmptyLines.length && segmentTexts.every(text => !text.includes('\n'))) {
      translatedTexts = segmentTexts;
    } else {
      translatedTexts = segmentTexts.join('').split(/\r?\n/);
      while (translatedTexts.length > nonEmptyLines.length &&
             translatedTexts[translatedTexts.length - 1] === '') translatedTexts.pop();
    }
    if (translatedTexts.length !== nonEmptyLines.length) {
      throw new Error('No se pudo vincular cada traducción con su línea original.');
    }

    const translatedByIndex = new Map(nonEmptyLines.map((line, index) => [line.index, translatedTexts[index]]));
    return sourceLines.map((line, index) => ({
      time: line.time ?? null,
      text: translatedByIndex.get(index) || ''
    }));
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadAndShowLyricsTranslation(song, targetLang = getLyricsTranslationLanguage()) {
  if (!song?.lyrics?.isSynced || !isLyricsTranslationEnabled()) return;
  const requestId = ++lyricsTranslationRequestId;
  lyricsTranslationLoading = true;
  updateLyricsTranslationControls(true);
  try {
    let translatedLines = getCachedTranslation(song, targetLang);
    if (!translatedLines) {
      translatedLines = await requestLyricsTranslation(song, targetLang);
      saveTranslationToBoundedStorage(getTranslationCacheKey(song, targetLang), translatedLines);
    }
    if (requestId !== lyricsTranslationRequestId || getCurrentPlaybackSong()?.id !== song.id) return;
    activeTranslationSongId = song.id;
    activeTranslationLanguage = targetLang;
    activeTranslationLines = translatedLines;
    lyricsTranslationShown = true;
    renderTranslatedLyrics(translatedLines);
  } catch (error) {
    if (requestId !== lyricsTranslationRequestId) return;
    console.warn('No se pudo traducir la letra:', error);
    lyricsTranslationShown = false;
    restoreOriginalLyrics();
    showLyricsToast('No se pudo traducir la letra. Se mantiene la versión original.');
  } finally {
    if (requestId === lyricsTranslationRequestId) {
      lyricsTranslationLoading = false;
      updateLyricsTranslationControls(true);
    }
  }
}

export function handleLyricsViewUpdated(event) {
  const { isSynced, songId } = event.detail || {};
  const currentSong = getCurrentPlaybackSong();
  const changedSong = activeTranslationSongId !== songId;
  if (changedSong) {
    activeTranslationLines = null;
    activeTranslationSongId = songId;
    activeTranslationLanguage = null;
    restoreOriginalLyrics();
  }
  updateLyricsTranslationControls(Boolean(isSynced));
  const translationIsRendered = Boolean(document.querySelector('#lyrics-lines-box .lyric-line-translation'));
  if (lyricsTranslationShown && isLyricsTranslationEnabled() && currentSong?.lyrics?.isSynced &&
      document.getElementById('lyrics-overlay')?.classList.contains('open') &&
      (changedSong || !translationIsRendered)) {
    const language = getLyricsTranslationLanguage();
    if (activeTranslationSongId === currentSong.id &&
        activeTranslationLanguage === language && activeTranslationLines) {
      renderTranslatedLyrics(activeTranslationLines);
    } else {
      void loadAndShowLyricsTranslation(currentSong, language);
    }
  }
}

export function handleLyricsTranslationSettingsChanged(event) {
  const detail = event.detail || {};
  if (!isLyricsTranslationEnabled()) {
    lyricsTranslationRequestId++;
    lyricsTranslationLoading = false;
    lyricsTranslationShown = false;
    activeTranslationLines = null;
    activeTranslationLanguage = null;
    restoreOriginalLyrics();
    updateLyricsTranslationControls(Boolean(getCurrentPlaybackSong()?.lyrics?.isSynced));
    return;
  }
  if (detail.languageChanged) {
    const currentSong = getCurrentPlaybackSong();
    const wasShowingTranslation = lyricsTranslationShown;
    lyricsTranslationRequestId++;
    lyricsTranslationLoading = false;
    lyricsTranslationShown = false;
    activeTranslationLines = null;
    activeTranslationLanguage = null;
    restoreOriginalLyrics();
    updateLyricsTranslationControls(Boolean(currentSong?.lyrics?.isSynced));
    if (wasShowingTranslation && currentSong?.lyrics?.isSynced &&
        document.getElementById('lyrics-overlay')?.classList.contains('open')) {
      lyricsTranslationShown = true;
      void loadAndShowLyricsTranslation(currentSong, getLyricsTranslationLanguage());
    }
  } else {
    updateLyricsTranslationControls(Boolean(getCurrentPlaybackSong()?.lyrics?.isSynced));
  }
}

export function toggleLyricsTranslation() {
  if (lyricsTranslationShown) {
    lyricsTranslationRequestId++;
    lyricsTranslationLoading = false;
    lyricsTranslationShown = false;
    restoreOriginalLyrics();
    updateLyricsTranslationControls(true);
    return;
  }
  const song = getCurrentPlaybackSong();
  if (!song?.lyrics?.isSynced) return;
  const language = getLyricsTranslationLanguage();
  if (activeTranslationSongId === song.id && activeTranslationLanguage === language && activeTranslationLines) {
    lyricsTranslationShown = true;
    renderTranslatedLyrics(activeTranslationLines);
    updateLyricsTranslationControls(true);
    return;
  }
  void loadAndShowLyricsTranslation(song, language);
}
