// UI · Letras: dibujo, sincronización palabra a palabra y animaciones.

import { formatTime, state } from '../state.js';
import { ensureSongLyrics, parseInlineLyricWords, resolveCoverUrl } from '../scanner.js';
import { clearContainerCovers } from './covers.js';
import { syncNpFsVinylLabelArt } from './playback.js';
import { initLiquidGradientBackground, syncLiquidBackgroundFromCover } from '../../visual_plus/blurred_background.js';
import { initLiquidImmersiveBackground, syncImmersiveBackgroundFromCover } from '../../visual_plus/liquid_background.js';
import { lyricsLinesBox, lyricsSongArtist, lyricsSongTitle } from './dom.js';
import { getPlaybackDuration, getPlaybackPosition, isPlaybackPaused, seekPlayback } from '../audioPlayer.js';
import { fitLyricLineToViewport, lyricsProgressSeeking, refitActiveLyricLine, removeStylePropCached, setStylePropIfChanged } from './lyricsDock.js';

export let lyricsAutoScrollEnabled = true;

export let activeLyricElement = null;

let lyricsSyncSongKey = null;

let lyricFillAnimationFrame = null;

const LYRIC_VOICE_COLORS = [
  '#38a8ff', '#ff941f', '#ff3b8d', '#35c98a',
  '#ffd21f', '#19c9d2', '#a16bff', '#ff4b45'
];

export function updateLyricsUI() {
  voiceLineResizeObserver?.disconnect();
  const currentTrack = state.currentTrackIndex >= 0 ? state.activeQueue[state.currentTrackIndex] : null;
  if (currentTrack && !currentTrack.lyricsLoaded) {
    void ensureSongLyrics(currentTrack).then(() => {
      if (state.activeQueue[state.currentTrackIndex] === currentTrack) updateLyricsUI();
    });
  }
  const miniPlayerCover = document.getElementById('lyrics-focus-mini-cover');
  const miniPlayerTitle = document.getElementById('lyrics-focus-mini-title');
  const miniPlayerArtist = document.getElementById('lyrics-focus-mini-artist');
  const miniPlayerAlbum = document.getElementById('lyrics-focus-mini-album');
  const updateMiniPlayer = current => {
    if (!miniPlayerCover || !miniPlayerTitle || !miniPlayerArtist || !miniPlayerAlbum) return;
    miniPlayerTitle.textContent = current?.title || '';
    miniPlayerArtist.textContent = current?.artist || 'Desconocido';
    miniPlayerAlbum.textContent = current?.album || '';
    clearContainerCovers(miniPlayerCover);
    miniPlayerCover.replaceChildren();
    const coverSrc = current ? resolveCoverUrl(current) : null;
    try { syncNpFsVinylLabelArt(coverSrc); } catch (_) {}
    try { syncLiquidBackgroundFromCover(coverSrc || null); } catch (_) {}
    try { syncImmersiveBackgroundFromCover(coverSrc || null); } catch (_) {}
    try {
      document.dispatchEvent(new CustomEvent('pn-track-cover-changed', { detail: { coverSrc: coverSrc || null, track: current || null } }));
    } catch (_) {}
    if (coverSrc) {
      const image = document.createElement('img');
      image.src = coverSrc;
      image.alt = `Carátula de ${current.title || 'la canción actual'}`;
      miniPlayerCover.appendChild(image);
    } else {
      const placeholder = document.createElement('i');
      placeholder.className = 'ph ph-music-note';
      placeholder.setAttribute('aria-hidden', 'true');
      miniPlayerCover.appendChild(placeholder);
    }
  };

  if (state.currentTrackIndex === -1 || !state.activeQueue[state.currentTrackIndex]) {
    lyricsSongTitle.textContent = 'Letras';
    lyricsSongArtist.textContent = '';
    updateMiniPlayer(null);
    lyricsLinesBox.replaceChildren();
    activeLyricElement = null;
    lyricsSyncSongKey = null;
    document.dispatchEvent(new CustomEvent('pn-lyrics-view-updated', { detail: { isSynced: false, songId: null } }));
    return;
  }
  const current = state.activeQueue[state.currentTrackIndex];

  lyricsSongTitle.textContent = current.title;
  lyricsSongArtist.textContent = current.artist || "Desconocido";
  updateMiniPlayer(current);
  lyricsLinesBox.innerHTML = '';
  activeLyricElement = null;
  document.documentElement.dataset.lyricsHasMultipleVoices = String(
    Boolean(current.lyrics?.hasMultipleVoices) ||
    new Set((current.lyrics?.lines || [])
      .map(line => line?.voice != null && String(line.voice).trim()
        ? line.voice
        : line?.voiceIndex)
      .filter(value => value != null && value !== '')).size > 1
  );
  lyricsSyncSongKey = String(current.file?.path || current.path || current.id || '');
  // Limpiar clases residuales de la canción anterior
  lyricsLinesBox.querySelectorAll('.lyric-line-sync.active').forEach(el => {
    el.classList.remove('active', 'has-active-row-fill', 'has-sophisticated-lyrics');
  });

  if (!current.lyrics || !current.lyrics.lines || current.lyrics.lines.length === 0) {
    lyricsLinesBox.innerHTML = `<div class="lyrics-empty-notice">No hay letras disponibles para este tema.</div>`;
    document.dispatchEvent(new CustomEvent('pn-lyrics-view-updated', { detail: { isSynced: false, songId: current.id } }));
    return;
  }

  if (current.lyrics.isSynced) {
    const voiceIndexes = new Map();
    const assignedVoiceIndexes = new Set();
    const getVoiceIdentity = line => line.voice != null && String(line.voice).trim()
      ? String(line.voice)
      : line.voiceIndex != null
        ? `voice-${line.voiceIndex}`
        : null;
    const explicitVoices = new Set(
      current.lyrics.lines.map(getVoiceIdentity).filter(Boolean)
    );
    const inferUnlabelledVoice = document.documentElement.dataset.lyricsMultiVoiceEnabled === 'true' &&
      (explicitVoices.size > 1 ||
        (current.lyrics.hasMultipleVoices === true && explicitVoices.size > 0)) &&
      current.lyrics.lines.some(line => !getVoiceIdentity(line));
    const unlabelledVoiceIdentity = inferUnlabelledVoice ? '__unlabelled_voice__' : null;
    const assignVoiceIndex = (identity, preferredIndex) => {
      if (voiceIndexes.has(identity)) return voiceIndexes.get(identity);
      let index = Number.isSafeInteger(preferredIndex) && preferredIndex > 0 &&
        !assignedVoiceIndexes.has(preferredIndex)
        ? preferredIndex
        : voiceIndexes.size + 1;
      while (assignedVoiceIndexes.has(index)) index++;
      voiceIndexes.set(identity, index);
      assignedVoiceIndexes.add(index);
      return index;
    };

    current.lyrics.lines.forEach(line => {
      const identity = getVoiceIdentity(line);
      if (identity) assignVoiceIndex(identity, Number(line.voiceIndex));
    });
    if (unlabelledVoiceIdentity) {
      assignVoiceIndex(unlabelledVoiceIdentity, null);
    }

    current.lyrics.lines.forEach(line => {
      const enhancedLyrics = parseInlineLyricWords(line.text);
      const text = enhancedLyrics?.text || line.text || '';
      const wordTimings = Array.isArray(line.words) && line.words.length > 0
        ? line.words
        : enhancedLyrics?.words;
      const p = document.createElement('p');
      p.className = 'lyric-line-sync';
      p.dataset.originalText = text;
      p.dataset.time = (line.time !== null && !isNaN(line.time)) ? line.time : "";
      const voiceIdentity = getVoiceIdentity(line) || unlabelledVoiceIdentity;
      if (voiceIdentity != null) {
        p.dataset.voice = String(voiceIdentity);
        p.dataset.voiceIndex = String(voiceIndexes.get(p.dataset.voice));
        const voiceBar = document.createElement('span');
        voiceBar.className = 'lyric-voice-bar';
        voiceBar.setAttribute('aria-hidden', 'true');
        p.appendChild(voiceBar);
      }
      if (Array.isArray(wordTimings) && wordTimings.length > 0) {
        const validTimings = wordTimings.filter(word =>
          Number.isFinite(Number(word?.time)) && typeof word?.text === 'string' && word.text.length > 0
        );
        p._parsedWordTimings = validTimings;
        p.dataset.wordTimings = JSON.stringify(validTimings);
      } else {
        p._parsedWordTimings = [];
      }
      const original = document.createElement('span');
      original.className = 'lyric-line-original';
      original.textContent = text || '•••';
      p.appendChild(original);

      p.addEventListener('click', () => {
        if (line.time !== null && !isNaN(line.time)) {
          void seekPlayback(line.time);
        }
      });
      lyricsLinesBox.appendChild(p);
    });
    applyVoiceLayout();
  } else {
    current.lyrics.lines.forEach(text => {
      const p = document.createElement('p');
      p.className = 'lyric-line-plain';
      p.textContent = text;
      lyricsLinesBox.appendChild(p);
    });
  }
  refitActiveLyricLine();
  document.dispatchEvent(new CustomEvent('pn-lyrics-view-updated', {
    detail: { isSynced: Boolean(current.lyrics.isSynced), songId: current.id }
  }));
  // Tras cargar letra (p. ej. post-crossfade), forzar sincronía con el tiempo actual del motor
  try {
    const t = getPlaybackPosition();
    updateSyncedLyricsProgress(Number.isFinite(t) ? t : 0);
  } catch (_) {
    updateSyncedLyricsProgress(0);
  }
}

export function scrollLyricsLineIntoView(line, options = {}) {
  const container = line?.closest('.lyrics-scroll-container');
  if (!container || !line.isConnected) return;

  const instant = Boolean(options.instant) || document.body.classList.contains('now-playing-fs');
  const containerRect = container.getBoundingClientRect();
  const lineRect = line.getBoundingClientRect();
  // En pantalla completa centrar un poco más arriba (estilo Spotify)
  const isFs = document.body.classList.contains('now-playing-fs');
  const topInset = isFs
    ? Math.min(160, Math.max(48, container.clientHeight * 0.28))
    : Math.min(96, Math.max(32, container.clientHeight * 0.14));
  const bottomInset = isFs
    ? Math.min(120, Math.max(40, container.clientHeight * 0.22))
    : Math.min(72, Math.max(24, container.clientHeight * 0.1));
  const availableHeight = Math.max(1, container.clientHeight - topInset - bottomInset);
  let delta;
  if (lineRect.height > availableHeight) {
    delta = lineRect.top - containerRect.top - topInset;
  } else {
    delta = (lineRect.top + lineRect.bottom - containerRect.top - containerRect.bottom) / 2;
  }
  if (Math.abs(delta) > 1) {
    container.scrollTo({
      top: Math.max(0, container.scrollTop + delta),
      behavior: instant && options.instant !== false ? (options.instant ? 'auto' : 'smooth') : 'smooth'
    });
  }
}

export function resyncLyricsScrollForFullscreen() {
  if (!document.body.classList.contains('now-playing-fs')) return;
  const container = document.querySelector('.lyrics-scroll-container');
  if (!container) return;
  // Primero ir al inicio para no quedar “atascado” a mitad del bloque
  container.scrollTop = 0;
  const active = document.querySelector('.lyrics-lines-box .lyric-line-sync.active')
    || document.querySelector('.lyrics-lines-box .lyric-line-sync');
  if (active) {
    requestAnimationFrame(() => {
      scrollLyricsLineIntoView(active, { instant: true });
      requestAnimationFrame(() => scrollLyricsLineIntoView(active, { instant: true }));
    });
  }
}

function createActiveRowFillOverlay(line, direction, wordTimings = [], sophisticated = false) {
  const original = line.querySelector('.lyric-line-original');
  if (!original) return null;

  line.querySelector('.lyric-active-overlay')?.remove();
  const overlay = document.createElement('span');
  overlay.className = 'lyric-active-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.dataset.direction = direction;
  overlay.dataset.sourceText = original.textContent || '';

  const clone = original.cloneNode(false);
  const text = original.textContent || '';
  const cachedUnits = [];
  let unitCount = 0;
  if (direction === 'timed-words') {
    wordTimings.forEach((word, index) => {
      const wordText = String(word.text);
      const visibleWord = wordText.trimEnd();
      const trailingSpace = wordText.slice(visibleWord.length);
      if (!visibleWord) {
        clone.appendChild(document.createTextNode(wordText));
        return;
      }
      const wordStart = Number(word.time);
      const nextWordStart = wordTimings.slice(index + 1)
        .map(candidate => Number(candidate.time))
        .find(candidateStart => Number.isFinite(candidateStart) && candidateStart > wordStart);
      const previousWordStart = wordTimings.slice(0, index)
        .map(candidate => Number(candidate.time))
        .reverse()
        .find(candidateStart => Number.isFinite(candidateStart) && candidateStart < wordStart);
      const estimatedDuration = Number.isFinite(previousWordStart)
        ? Math.min(1.5, Math.max(0.25, wordStart - previousWordStart))
        : 0.65;
      const unit = document.createElement('span');
      unit.className = 'lyric-fill-unit';
      unit.dataset.wordStart = String(wordStart);
      unit._wordStart = wordStart;
      unit._wordEnd = Number.isFinite(nextWordStart)
        ? nextWordStart
        : wordStart + estimatedDuration;
      unit.textContent = visibleWord;
      unit.style.opacity = '0.34';
      clone.appendChild(unit);
      cachedUnits.push(unit);
      if (trailingSpace) clone.appendChild(document.createTextNode(trailingSpace));
      unitCount++;
    });
  } else if (direction === 'horizontal' && sophisticated) {
    text.split(/(\s+)/u).forEach(part => {
      if (!part || /^\s+$/u.test(part)) {
        clone.appendChild(document.createTextNode(part));
        return;
      }
      const unit = document.createElement('span');
      unit.className = 'lyric-fill-unit lyric-fill-word';
      unit.textContent = part;
      setStylePropIfChanged(unit, '--lyric-unit-fill', '0%');
      clone.appendChild(unit);
      cachedUnits.push(unit);
      unitCount++;
    });
  } else if (direction === 'letters' || direction === 'words') {
    const parts = text.split(/(\s+)/u);
    parts.forEach(part => {
      if (/^\s+$/u.test(part)) {
        clone.appendChild(document.createTextNode(part));
        return;
      }
      if (direction === 'letters' && sophisticated) {
        const word = document.createElement('span');
        word.className = 'lyric-fill-letter-word';
        const letters = typeof Intl.Segmenter === 'function'
          ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(part), segment => segment.segment)
          : Array.from(part);
        letters.forEach(letter => {
          const unit = document.createElement('span');
          unit.className = 'lyric-fill-unit';
          unit.textContent = letter;
          unit.style.opacity = '0.34';
          word.appendChild(unit);
          cachedUnits.push(unit);
          unitCount++;
        });
        clone.appendChild(word);
        return;
      }
      const unit = document.createElement('span');
      unit.className = 'lyric-fill-unit';
      unit.textContent = part;
      unit.style.opacity = '0.34';
      clone.appendChild(unit);
      cachedUnits.push(unit);
      unitCount++;
    });
  } else {
    clone.textContent = text;
  }
  overlay.dataset.unitCount = String(unitCount);
  overlay._cachedUnits = cachedUnits;
  overlay._directionalText = clone;
  overlay.appendChild(clone);
  line.appendChild(overlay);
  if (direction === 'horizontal' && sophisticated) {
    updateHorizontalWrappedLineLayout(overlay);
  }
  return overlay;
}

function updateHorizontalWrappedLineLayout(overlay) {
  const units = overlay._cachedUnits || Array.from(overlay.querySelectorAll('.lyric-fill-word'));
  if (units.length === 0) return;

  const fragments = units.map(unit => {
    const rect = unit.getBoundingClientRect();
    return { unit, rect, rowTop: Math.round(rect.top) };
  }).filter(fragment => fragment.rect.width > 0 && fragment.rect.height > 0);
  const rows = new Map();
  fragments.forEach(fragment => {
    const row = rows.get(fragment.rowTop) || { left: Infinity, right: -Infinity };
    row.left = Math.min(row.left, fragment.rect.left);
    row.right = Math.max(row.right, fragment.rect.right);
    rows.set(fragment.rowTop, row);
  });

  const orderedRows = [...rows.entries()].sort((first, second) => first[0] - second[0]);
  const rowIndexes = new Map(orderedRows.map(([rowTop], index) => [rowTop, index]));
  fragments.forEach(({ unit, rect, rowTop }) => {
    const row = rows.get(rowTop);
    const vRow = rowIndexes.get(rowTop);
    const vRowLeft = row.left;
    const vRowWidth = Math.max(1, row.right - row.left);
    const vUnitLeft = rect.left;
    const vUnitWidth = Math.max(1, rect.width);

    unit._vRow = vRow;
    unit._vRowLeft = vRowLeft;
    unit._vRowWidth = vRowWidth;
    unit._vUnitLeft = vUnitLeft;
    unit._vUnitWidth = vUnitWidth;

    unit.dataset.visualRow = String(vRow);
    unit.dataset.visualRowLeft = String(vRowLeft);
    unit.dataset.visualRowWidth = String(vRowWidth);
    unit.dataset.visualUnitLeft = String(vUnitLeft);
    unit.dataset.visualUnitWidth = String(vUnitWidth);
  });
  overlay._visualRowCount = Math.max(1, orderedRows.length);
  overlay.dataset.visualRowCount = String(overlay._visualRowCount);
  overlay.dataset.visualLayoutWidth = String(overlay.clientWidth);
  overlay.dataset.visualLayoutHeight = String(overlay.clientHeight);
}

function springResponse(progress, frequency, damping) {
  const phase = Math.max(0, Math.min(1, progress));
  const time = phase * Math.PI * 1.76;
  const decay = Math.exp(-damping * time);
  const ratio = damping / frequency;
  return 1 - decay * (Math.cos(frequency * time) + ratio * Math.sin(frequency * time));
}

function applySophisticatedMotion(element, progress, isEnabled, isLetter = false) {
  if (!element) return;
  if (!isEnabled) {
    if (element._hasSpicyMotion) {
      removeStylePropCached(element, '--lyrics-spicy-scale');
      removeStylePropCached(element, '--lyrics-spicy-y');
      removeStylePropCached(element, '--lyrics-spicy-glow');
      removeStylePropCached(element, '--lyrics-spicy-glow-blur');
      element._hasSpicyMotion = false;
    }
    return;
  }

  element._hasSpicyMotion = true;
  const phase = Math.max(0, Math.min(1, progress));
  const quantizedPhase = Math.round(phase * 250) / 250;
  if (element._lastSpicyPhase === quantizedPhase && element._lastSpicyIsLetter === isLetter) return;
  element._lastSpicyPhase = quantizedPhase;
  element._lastSpicyIsLetter = isLetter;

  const scaleSpring = springResponse(phase, 0.88, 0.64);
  const ySpring = springResponse(phase, 1.45, 0.4);
  const glowSpring = springResponse(phase, 1.18, 0.56);
  const scale = isLetter
    ? Math.max(0.95, Math.min(1.175, 0.95 + scaleSpring * 0.225))
    : Math.max(0.95, Math.min(1.0505, 0.95 + phase * 0.05 + (scaleSpring - phase) * 0.14));
  const offset = Math.max(-0.0167, Math.min(0.01, 0.01 * (1 - phase) - 0.04 * (ySpring - phase)));
  const glowEnvelope = phase < 0.35
    ? phase / 0.35
    : phase < 0.75
      ? 1
      : (1 - phase) / 0.25;
  const glow = Math.max(0, Math.min(1, glowEnvelope * glowSpring));
  setStylePropIfChanged(element, '--lyrics-spicy-scale', scale.toFixed(4));
  setStylePropIfChanged(element, '--lyrics-spicy-y', `${offset.toFixed(4)}em`);
  setStylePropIfChanged(element, '--lyrics-spicy-glow', glow.toFixed(3));
  setStylePropIfChanged(element, '--lyrics-spicy-glow-blur', `${(glow * 12).toFixed(2)}px`);
}

function getParsedLineWordTimings(lineElement) {
  if (!lineElement) return [];
  if (Array.isArray(lineElement._parsedWordTimings)) {
    return lineElement._parsedWordTimings;
  }
  const serialized = lineElement.dataset.wordTimings;
  if (!serialized) {
    lineElement._parsedWordTimings = [];
    return [];
  }
  try {
    const parsed = JSON.parse(serialized);
    lineElement._parsedWordTimings = Array.isArray(parsed)
      ? parsed.filter(word =>
          Number.isFinite(Number(word?.time)) && typeof word?.text === 'string' && word.text.length > 0
        )
      : [];
  } catch {
    lineElement._parsedWordTimings = [];
  }
  return lineElement._parsedWordTimings;
}

function computeLineStartEndTimes(lineElement) {
  if (!lineElement) return { start: 0, end: 4 };
  const start = Number.parseFloat(lineElement.dataset.time) || 0;
  const trackDuration = getPlaybackDuration();
  if (lineElement._cachedLineBounds && lineElement._cachedTrackDuration === trackDuration) {
    return lineElement._cachedLineBounds;
  }

  const lines = Array.from(lyricsLinesBox.querySelectorAll('.lyric-line-sync'));
  const voiceKey = lineElement.dataset.voice || '__default';
  const lineTimes = lines
    .filter(line => line !== lineElement)
    .map(line => Number.parseFloat(line.dataset.time))
    .filter(Number.isFinite);
  const nextVoiceTime = lines
    .filter(line => line !== lineElement && (line.dataset.voice || '__default') === voiceKey)
    .map(line => Number.parseFloat(line.dataset.time))
    .filter(lineTime => Number.isFinite(lineTime) && lineTime > start)
    .sort((a, b) => a - b)[0];
  const nextAnyVoiceTime = lineTimes
    .filter(lineTime => lineTime > start)
    .sort((a, b) => a - b)[0];
  const previousVoiceTime = lines
    .filter(line => line !== lineElement && (line.dataset.voice || '__default') === voiceKey)
    .map(line => Number.parseFloat(line.dataset.time))
    .filter(lineTime => Number.isFinite(lineTime) && lineTime < start)
    .sort((a, b) => b - a)[0];
  const previousAnyVoiceTime = lineTimes
    .filter(lineTime => lineTime < start)
    .sort((a, b) => b - a)[0];

  const timedWords = getParsedLineWordTimings(lineElement);
  const lastWordStart = timedWords.length
    ? Number(timedWords[timedWords.length - 1].time)
    : NaN;
  const previousWordStart = timedWords.slice(0, -1)
    .map(word => Number(word.time))
    .filter(wordTime => Number.isFinite(wordTime) && wordTime < lastWordStart)
    .sort((a, b) => b - a)[0];
  const finalWordDuration = Number.isFinite(previousWordStart)
    ? Math.min(1.5, Math.max(0.25, lastWordStart - previousWordStart))
    : 0.65;
  const timedLyricsEnd = Number.isFinite(lastWordStart)
    ? lastWordStart + finalWordDuration
    : NaN;

  let end = Number.isFinite(nextVoiceTime) ? nextVoiceTime : nextAnyVoiceTime;
  if (!Number.isFinite(end) || end <= start) {
    if (Number.isFinite(timedLyricsEnd) && timedLyricsEnd > start) {
      end = timedLyricsEnd;
    } else {
      const previousTime = Number.isFinite(previousVoiceTime)
        ? previousVoiceTime
        : previousAnyVoiceTime;
      const estimatedDuration = Number.isFinite(previousTime)
        ? Math.min(6, Math.max(1.5, start - previousTime))
        : 4;
      end = start + estimatedDuration;
    }
  }
  if (Number.isFinite(timedLyricsEnd) && end > timedLyricsEnd) end = timedLyricsEnd;
  if (Number.isFinite(trackDuration) && trackDuration > start) {
    end = Math.min(end, trackDuration);
  }

  lineElement._cachedTrackDuration = trackDuration;
  lineElement._cachedLineBounds = { start, end };
  return lineElement._cachedLineBounds;
}

function updateActiveRowFillForLine(currentTime, activeLine) {
  const root = document.documentElement;
  const enabled = root.dataset.lyricsActiveRowAnimation === 'true';
  const sophisticated = root.dataset.lyricsSophisticatedLyrics === 'true';
  const selectedDirection = root.dataset.lyricsActiveRowFillDirection || 'horizontal';
  if (!activeLine) return;

  const previousOverlay = activeLine.querySelector('.lyric-active-overlay');
  if (!enabled) {
    activeLine.classList.remove('has-active-row-fill');
    activeLine.classList.remove('has-sophisticated-lyrics');
    activeLine.removeAttribute('data-fill-direction');
    previousOverlay?.remove();
    applySophisticatedMotion(activeLine, 0, false);
    return;
  }

  const wordTimings = root.dataset.lyricsWordTimingAnimation === 'true'
    ? getParsedLineWordTimings(activeLine)
    : [];

  const direction = wordTimings.length > 0
    ? 'timed-words'
    : selectedDirection;
  activeLine.classList.add('has-active-row-fill');
  activeLine.classList.toggle('has-sophisticated-lyrics', sophisticated);
  activeLine.dataset.fillDirection = direction;
  let overlay = previousOverlay;
  const originalText = activeLine.querySelector('.lyric-line-original')?.textContent || '';
  const overlayTimingsRef = overlay?._wordTimingsRef || null;
  const nextTimingsRef = direction === 'timed-words' ? wordTimings : null;
  if (!overlay || overlay.dataset.direction !== direction || overlay.dataset.sourceText !== originalText ||
      overlayTimingsRef !== nextTimingsRef || overlay._wasSophisticated !== sophisticated) {
    overlay = createActiveRowFillOverlay(activeLine, direction, wordTimings, sophisticated);
    if (overlay) {
      overlay._wordTimingsRef = nextTimingsRef;
      overlay._wasSophisticated = sophisticated;
    }
  } else if (direction === 'horizontal' && sophisticated &&
      (overlay.dataset.visualLayoutWidth !== String(overlay.clientWidth) ||
       overlay.dataset.visualLayoutHeight !== String(overlay.clientHeight))) {
    updateHorizontalWrappedLineLayout(overlay);
  }
  if (!overlay) return;

  const { start, end } = computeLineStartEndTimes(activeLine);
  const progress = Math.max(0, Math.min(1, (currentTime - start) / (end - start)));
  setStylePropIfChanged(overlay, '--lyric-fill-progress', `${(progress * 100).toFixed(2)}%`);

  const isUnitDirection = direction === 'timed-words' || direction === 'letters' || direction === 'words';
  const sophisticatedDirectional = sophisticated &&
    (direction === 'horizontal' || direction === 'vertical');
  applySophisticatedMotion(
    activeLine,
    progress,
    sophisticated && !isUnitDirection && !sophisticatedDirectional
  );
  const directionalText = overlay._directionalText || overlay.querySelector('.lyric-line-original');
  if (sophisticatedDirectional) {
    const gradientPosition = (-20 + progress * 120).toFixed(2);
    const glowProgress = Math.max(0, Math.min(1, progress / 0.35, (1 - progress) / 0.25));
    const glowOpacityStr = (glowProgress * 0.8).toFixed(3);
    const glowBlurStr = `${(4 + glowProgress * 8).toFixed(2)}px`;
    setStylePropIfChanged(overlay, '--lyric-gradient-position', `${gradientPosition}%`);
    setStylePropIfChanged(overlay, '--lyric-text-glow-opacity', glowOpacityStr);
    setStylePropIfChanged(overlay, '--lyric-text-glow-blur', glowBlurStr);
    applySophisticatedMotion(activeLine, 0, false);
    if (directionalText) {
      setStylePropIfChanged(directionalText, '--lyric-gradient-position', `${gradientPosition}%`);
      setStylePropIfChanged(directionalText, '--lyric-text-glow-opacity', glowOpacityStr);
      setStylePropIfChanged(directionalText, '--lyric-text-glow-blur', glowBlurStr);
    }
    overlay._hasDirectionalGlow = true;
  } else if (overlay._hasDirectionalGlow) {
    removeStylePropCached(overlay, '--lyric-gradient-position');
    removeStylePropCached(overlay, '--lyric-text-glow-opacity');
    removeStylePropCached(overlay, '--lyric-text-glow-blur');
    removeStylePropCached(directionalText, '--lyric-gradient-position');
    removeStylePropCached(directionalText, '--lyric-text-glow-opacity');
    removeStylePropCached(directionalText, '--lyric-text-glow-blur');
    overlay._hasDirectionalGlow = false;
  }

  const setUnitProgress = (unit, unitProgress) => {
    const normalizedProgress = Math.max(0, Math.min(1, unitProgress));
    const quantized = Math.round(normalizedProgress * 200) / 200;
    if (unit._lastQuantizedProgress === quantized && unit._lastSophisticatedState === sophisticated) {
      return;
    }
    unit._lastQuantizedProgress = quantized;
    unit._lastSophisticatedState = sophisticated;

    setStylePropIfChanged(unit, '--lyric-unit-fill', `${(quantized * 100).toFixed(1)}%`);
    const fillEdge = quantized * 120 - 20;
    setStylePropIfChanged(unit, '--lyric-unit-fill-start', `${fillEdge.toFixed(1)}%`);
    setStylePropIfChanged(unit, '--lyric-unit-fill-end', `${(fillEdge + 20).toFixed(1)}%`);
    const opacityVal = (0.34 + quantized * 0.66).toFixed(3);
    if (unit._lastOpacity !== opacityVal) {
      unit._lastOpacity = opacityVal;
      unit.style.opacity = opacityVal;
    }
    applySophisticatedMotion(
      unit,
      quantized,
      sophisticated && direction !== 'horizontal',
      direction === 'letters'
    );
  };

  const units = overlay._cachedUnits || Array.from(overlay.querySelectorAll('.lyric-fill-unit'));
  if (direction === 'timed-words') {
    for (const unit of units) {
      const wordStart = unit._wordStart !== undefined ? unit._wordStart : Number.parseFloat(unit.dataset.wordStart);
      const unitWordEnd = unit._wordEnd !== undefined
        ? unit._wordEnd
        : wordStart + 0.65;
      const wordEnd = Math.min(end, unitWordEnd);
      const wordProgress = wordEnd > wordStart
        ? Math.max(0, Math.min(1, (currentTime - wordStart) / (wordEnd - wordStart)))
        : 0;
      setUnitProgress(unit, currentTime < wordEnd ? wordProgress : 0);
    }
  } else if (direction === 'letters' || direction === 'words') {
    const count = units.length;
    const filledUnits = progress * count;
    for (let index = 0; index < count; index++) {
      const unitProgress = Math.max(0, Math.min(1, filledUnits - index));
      setUnitProgress(units[index], unitProgress);
    }
  } else if (direction === 'horizontal' && sophisticated) {
    const rowCount = overlay._visualRowCount || Number.parseInt(overlay.dataset.visualRowCount || '1', 10);
    const totalRowProgress = progress * rowCount;
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const rowIndex = unit._vRow !== undefined ? unit._vRow : Number.parseInt(unit.dataset.visualRow || '0', 10);
      const rowProgress = Math.max(0, Math.min(1, totalRowProgress - rowIndex));
      const rowLeft = unit._vRowLeft !== undefined ? unit._vRowLeft : (Number.parseFloat(unit.dataset.visualRowLeft) || 0);
      const rowWidth = unit._vRowWidth !== undefined ? unit._vRowWidth : (Number.parseFloat(unit.dataset.visualRowWidth) || 1);
      const unitLeft = unit._vUnitLeft !== undefined ? unit._vUnitLeft : (Number.parseFloat(unit.dataset.visualUnitLeft) || rowLeft);
      const unitWidth = unit._vUnitWidth !== undefined ? unit._vUnitWidth : (Number.parseFloat(unit.dataset.visualUnitWidth) || 1);
      const progressAcrossRow = rowProgress * rowWidth;
      const unitProgress = (progressAcrossRow - (unitLeft - rowLeft)) / unitWidth;
      setUnitProgress(unit, unitProgress);
      const glowProgress = Math.min(1, Math.max(0, unitProgress) / 0.35);
      setStylePropIfChanged(unit, '--lyrics-spicy-glow', (glowProgress * 0.8).toFixed(3));
      setStylePropIfChanged(unit, '--lyrics-spicy-glow-blur', `${(4 + glowProgress * 8).toFixed(2)}px`);
    }
  }
}

export function updateActiveRowFill(currentTime) {
  const multiVoiceEnabled = hasMultipleRenderedVoicesEnabled();
  const activeLines = multiVoiceEnabled
    ? Array.from(lyricsLinesBox.querySelectorAll('.lyric-line-sync.active'))
    : [activeLyricElement].filter(Boolean);
  activeLines.forEach(line => updateActiveRowFillForLine(currentTime, line));
}

export function stopLyricsActiveRowAnimation() {
  if (lyricFillAnimationFrame === null) return;
  cancelAnimationFrame(lyricFillAnimationFrame);
  lyricFillAnimationFrame = null;
}

function animateLyricsActiveRow() {
  lyricFillAnimationFrame = null;
  if (!state.isLyricsOpen || isPlaybackPaused() ||
      document.documentElement.dataset.lyricsActiveRowAnimation !== 'true' ||
      !lyricsLinesBox.querySelector('.lyric-line-sync.active')) return;
  updateActiveRowFill(getPlaybackPosition());
  lyricFillAnimationFrame = requestAnimationFrame(animateLyricsActiveRow);
}

function syncLyricsActiveRowAnimation() {
  if (state.isLyricsOpen && !isPlaybackPaused() &&
      document.documentElement.dataset.lyricsActiveRowAnimation === 'true' &&
      lyricsLinesBox.querySelector('.lyric-line-sync.active') && lyricFillAnimationFrame === null) {
    lyricFillAnimationFrame = requestAnimationFrame(animateLyricsActiveRow);
  } else if (document.documentElement.dataset.lyricsActiveRowAnimation !== 'true' || isPlaybackPaused()) {
    stopLyricsActiveRowAnimation();
  }
}

export function updateSyncedLyricsProgress(currentTime) {
  if (!lyricsLinesBox) return;

  const time = Number.isFinite(currentTime) ? currentTime : getPlaybackPosition();

  const miniProgress = document.getElementById('lyrics-focus-mini-progress');
  const miniProgressFill = document.getElementById('lyrics-focus-mini-progress-fill');
  if (miniProgress && miniProgressFill && !lyricsProgressSeeking) {
    const duration = getPlaybackDuration();
    const progress = duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
    miniProgressFill.style.width = `${progress}%`;
    miniProgress.setAttribute('aria-valuenow', String(Math.round(progress)));
    const curEl = document.getElementById('lyrics-focus-mini-time-current');
    const remEl = document.getElementById('lyrics-focus-mini-time-remaining');
    if (curEl && remEl) {
      const safeTime = Math.max(0, Number(time) || 0);
      const safeDur = Math.max(0, Number(duration) || 0);
      curEl.textContent = formatTime(safeTime);
      if (safeDur > 0) {
        const remaining = Math.max(0, safeDur - safeTime);
        remEl.textContent = `-${formatTime(remaining)}`;
      } else {
        remEl.textContent = '-0:00';
      }
    }
  }

  const lines = lyricsLinesBox.querySelectorAll('.lyric-line-sync');
  if (lines.length === 0) return;

  let currentLineEl = null;

  for (let i = 0; i < lines.length; i++) {
    const timeAttr = lines[i].dataset.time;
    if (!timeAttr || timeAttr === "null") continue;
    const t = parseFloat(timeAttr);
    const activeTime = currentLineEl ? Number.parseFloat(currentLineEl.dataset.time) : -Infinity;
    if (!isNaN(t) && time >= t && t >= activeTime) {
      currentLineEl = lines[i];
    }
  }

  const multiVoiceEnabled = hasMultipleRenderedVoicesEnabled();
  let activeLines = [];
  if (multiVoiceEnabled) {
    const latestByVoice = new Map();
    lines.forEach(line => {
      if (!line.dataset.time) return;
      const lineTime = Number.parseFloat(line.dataset.time);
      if (!Number.isFinite(lineTime) || lineTime > time) return;
      const voiceKey = line.dataset.voice || '__default';
      const previous = latestByVoice.get(voiceKey);
      if (!previous || Number.parseFloat(previous.dataset.time) <= lineTime) {
        latestByVoice.set(voiceKey, line);
      }
    });

    activeLines = [];
    latestByVoice.forEach(line => {
      const { end } = computeLineStartEndTimes(line);
      if (time < end) activeLines.push(line);
    });
  } else if (currentLineEl) {
    const { end } = computeLineStartEndTimes(currentLineEl);
    if (time < end) activeLines.push(currentLineEl);
  }

  activeLines.forEach(line => {
    const { start, end } = computeLineStartEndTimes(line);
    const interval = Math.max(0.5, end - start);
    const motionDuration = Math.min(12, Math.max(2, (interval || 4) * 1.5));
    line.style.setProperty('--lyric-motion-duration', `${motionDuration}s`);
  });

  const activeLineSet = new Set(activeLines);
  lines.forEach(line => {
    if (line.classList.contains('active') && !activeLineSet.has(line)) {
      line.classList.remove('active', 'has-active-row-fill', 'has-sophisticated-lyrics');
      line.querySelector('.lyric-active-overlay')?.remove();
      line.style.removeProperty('--lyric-line-fit-scale');
      line.style.removeProperty('--lyric-motion-duration');
      applySophisticatedMotion(line, 0, false);
    }
  });
  activeLines.forEach(line => line.classList.add('active'));
  activeLines.forEach(updateVoiceBarLength);
  const visibleCurrentLine = activeLines.includes(currentLineEl) ? currentLineEl : null;
  if (visibleCurrentLine && visibleCurrentLine !== activeLyricElement) {
    activeLyricElement = visibleCurrentLine;

    fitLyricLineToViewport(visibleCurrentLine);
    if (lyricsAutoScrollEnabled) scrollLyricsLineIntoView(visibleCurrentLine);
  }
  if (!visibleCurrentLine) {
    activeLyricElement = null;
  }
  activeLines.forEach(line => updateActiveRowFillForLine(time, line));
  syncLyricsActiveRowAnimation();
}

export function suspendLyricsAutoScroll() {
  lyricsAutoScrollEnabled = false;
  document.dispatchEvent(new CustomEvent('pn-lyrics-auto-scroll-changed', {
    detail: { enabled: false }
  }));
}

export function resumeLyricsAutoScrollAtActiveLine() {
  lyricsAutoScrollEnabled = true;
  document.dispatchEvent(new CustomEvent('pn-lyrics-auto-scroll-changed', {
    detail: { enabled: true }
  }));
  if (!activeLyricElement?.isConnected) updateSyncedLyricsProgress(getPlaybackPosition());
  if (activeLyricElement) refitActiveLyricLine();
}

function getVoiceSide(voiceIndex) {
  const voiceOneOnLeft =
    document.documentElement.dataset.lyricsMultiVoiceLayout !== 'voice-one-right';
  return Number(voiceIndex) === 1
    ? (voiceOneOnLeft ? 'left' : 'right')
    : (voiceOneOnLeft ? 'right' : 'left');
}

function hasMultipleRenderedVoicesEnabled() {
  if (document.documentElement.dataset.lyricsMultiVoiceEnabled !== 'true') return false;
  return new Set(
    Array.from(lyricsLinesBox.querySelectorAll('.lyric-line-sync[data-voice]'))
      .map(line => line.dataset.voice)
      .filter(Boolean)
  ).size > 1;
}

function updateVoiceBarLength(line) {
  const bar = line.querySelector('.lyric-voice-bar');
  const text = line.querySelector('.lyric-line-original');
  if (!bar || !text) return;

  const height = Math.max(text.scrollHeight, text.getBoundingClientRect().height);
  if (height > 0) bar.style.height = `${height}px`;
}

const voiceLineResizeObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver(entries => {
    entries.forEach(entry => {
      const line = entry.target.closest('.lyric-line-sync');
      if (line) updateVoiceBarLength(line);
    });
  });

function applyVoiceLayout() {
  voiceLineResizeObserver?.disconnect();
  const enabled = hasMultipleRenderedVoicesEnabled();
  const showColors = enabled &&
    document.documentElement.dataset.lyricsVoiceColors !== 'false';
  lyricsLinesBox.querySelectorAll('.lyric-line-sync[data-voice-index]').forEach(line => {
    const side = getVoiceSide(line.dataset.voiceIndex);
    const bar = line.querySelector('.lyric-voice-bar');
    line.dataset.voiceSide = enabled ? side : '';
    line.style.setProperty('position', 'relative', 'important');
    if (enabled) {
      line.style.setProperty('width', '72%', 'important');
      line.style.setProperty('max-width', '560px', 'important');
      line.style.setProperty('margin-left', side === 'right' ? 'auto' : '0', 'important');
      line.style.setProperty('margin-right', side === 'left' ? 'auto' : '0', 'important');
      line.style.setProperty('text-align', side, 'important');
      line.style.setProperty('padding-left', side === 'left' ? '1.1em' : '0.75em', 'important');
      line.style.setProperty('padding-right', side === 'right' ? '1.1em' : '0.75em', 'important');
      line.style.setProperty('transform-origin', `${side} center`, 'important');
      line.style.setProperty('--lyrics-sync-transform-origin', `${side} center`);
      const text = line.querySelector('.lyric-line-original');
      if (text) voiceLineResizeObserver?.observe(text);
      updateVoiceBarLength(line);
    } else {
      [
        'width', 'max-width', 'margin-left', 'margin-right', 'text-align',
        'padding-left', 'padding-right', 'transform-origin'
      ]
        .forEach(property => line.style.removeProperty(property));
      line.style.removeProperty('--lyrics-sync-transform-origin');
    }
    if (bar) {
      const voiceIndex = Number(line.dataset.voiceIndex);
      const colorIndex = Number.isSafeInteger(voiceIndex) && voiceIndex > 0
        ? (voiceIndex - 1) % LYRIC_VOICE_COLORS.length
        : 0;
      bar.style.setProperty('background-color', LYRIC_VOICE_COLORS[colorIndex]);
      bar.style.setProperty('display', showColors ? 'block' : 'none', 'important');
      bar.style.setProperty('left', side === 'left' ? '0.12em' : 'auto', 'important');
      bar.style.setProperty('right', side === 'right' ? '0.12em' : 'auto', 'important');
    }
  });
}

document.addEventListener('pn-lyrics-visual-settings-changed', () => {
  applyVoiceLayout();
  requestAnimationFrame(refitActiveLyricLine);
});

document.addEventListener('pn-lyrics-active-row-animation-changed', () => {
  updateActiveRowFill(getPlaybackPosition());
  syncLyricsActiveRowAnimation();
});

document.addEventListener('pn-lyrics-multi-voice-settings-changed', () => {
  applyVoiceLayout();
  updateSyncedLyricsProgress(getPlaybackPosition());
});

try { initLiquidGradientBackground(); } catch (_) {}
try { initLiquidImmersiveBackground(); } catch (_) {}

document.addEventListener('pn-visual-plus-settings-changed', event => {
  if (typeof event.detail?.sophisticatedLyrics !== 'boolean') return;
  document.documentElement.dataset.lyricsSophisticatedLyrics = String(event.detail.sophisticatedLyrics);
  updateActiveRowFill(getPlaybackPosition());
});

document.addEventListener('pn-lyrics-layers-changed', () => {
  activeLyricElement?.querySelector('.lyric-active-overlay')?.remove();
  applyVoiceLayout();
  updateActiveRowFill(getPlaybackPosition());
});
