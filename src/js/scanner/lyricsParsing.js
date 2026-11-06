// Biblioteca · Lectura de letras (LRC y sincronización palabra a palabra).

export function parseLyricsText(raw) {
  if (!raw || !raw.trim()) return null;
  const rawLines = raw.split(/\r?\n/);
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const tagRegex = /^\[(ti|ar|al|by|offset|length|re|ve|au|x-translation):.*\]$/i;
  const voiceRegex = /(?:\[(?:voice|voz|v)\s*[:= ]?\s*([A-Za-z0-9_-]+)(?:\s*:[^\]]*)?\]|<(?:voice|voz|v)\s*[:= ]?\s*([A-Za-z0-9_-]+)>|\{(?:voice|voz|v)\s*[:= ]?\s*([A-Za-z0-9_-]+)\}|\((?:voice|voz|v)\s*[:= ]?\s*([A-Za-z0-9_-]+)\))/gi;
  const voicePrefixRegex = /^((?:\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*)*)(?:voice|voz|v)\s*[:= ]?\s*([A-Za-z0-9_-]+)\s*:\s*/i;
  const backgroundVoicePrefixRegex = /^\[(bg|background|backing)\s*:/i;

  const syncedLines = [];
  const plainLines = [];
  let hasTimestamp = false;
  const voiceIndexes = new Map();
  const parseTimestamp = match => {
    const minutes = Number.parseInt(match[1], 10);
    const seconds = Number.parseInt(match[2], 10);
    const fraction = match[3] || '0';
    return minutes * 60 + seconds + Number.parseInt(fraction.padEnd(3, '0'), 10) / 1000;
  };
  const stripLyricBrackets = text => text.replace(/[\[\]]/g, '');

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (tagRegex.test(trimmed)) continue;

    const voiceMatches = [...trimmed.matchAll(voiceRegex)];
    const voicePrefix = trimmed.match(voicePrefixRegex);
    const backgroundVoicePrefix = trimmed.match(backgroundVoicePrefixRegex);
    const voice = voicePrefix?.[2] || backgroundVoicePrefix?.[1] || (voiceMatches.length
      ? voiceMatches[voiceMatches.length - 1].slice(1).find(Boolean)
      : null);
    let lyricText = trimmed
      .replace(voiceRegex, '')
      .replace(voicePrefixRegex, '$1')
      .replace(backgroundVoicePrefixRegex, '');
    if (backgroundVoicePrefix) lyricText = lyricText.replace(/\]\s*$/, '');
    lyricText = lyricText.trim();
    if (!lyricText) continue;

    const lineTimes = [...lyricText.matchAll(timeRegex)].map(parseTimestamp);
    const timedWords = parseInlineLyricWords(lyricText);
    if (lineTimes.length > 0 || timedWords) {
      hasTimestamp = true;
      const text = stripLyricBrackets(timedWords?.text || lyricText.replace(timeRegex, '').trim()).trim();
      const words = timedWords?.words?.map(word => ({
        ...word,
        text: stripLyricBrackets(word.text)
      }));
      const times = lineTimes.length > 0 ? lineTimes : [words[0].time];
      for (const time of times) {
        syncedLines.push({
          time,
          text: text || '•••',
          ...(voice ? { voice } : {}),
          ...(words ? { words } : {})
        });
      }
    } else {
      const text = stripLyricBrackets(lyricText).trim();
      if (!text) continue;
      plainLines.push(text);
      syncedLines.push({ time: null, text, ...(voice ? { voice } : {}) });
    }
  }

  syncedLines.forEach(line => {
    if (line.voice && !voiceIndexes.has(line.voice)) {
      voiceIndexes.set(line.voice, voiceIndexes.size + 1);
    }
    if (line.voice) line.voiceIndex = voiceIndexes.get(line.voice);
  });

  if (hasTimestamp) {
    syncedLines.sort((a, b) => {
      const timeA = a.time === null ? 0 : a.time;
      const timeB = b.time === null ? 0 : b.time;
      return timeA - timeB;
    });

    return {
      isSynced: true,
      hasMultipleVoices: voiceIndexes.size > 1,
      lines: syncedLines.filter(l => l.text.length > 0)
    };
  } else {
    return {
      isSynced: false,
      hasMultipleVoices: voiceIndexes.size > 1,
      lines: plainLines
    };
  }
}

export function parseInlineLyricWords(text) {
  const value = String(text || '');
  const wordTimeRegex = /<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g;
  const matches = [...value.matchAll(wordTimeRegex)];
  if (matches.length === 0) return null;

  const words = [];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : value.length;
    const wordText = value.slice(start, end).replace(/\[(\d{1,2}):(\d{2})(?:[.:]\d{1,3})?\]/g, '');
    const fraction = match[3] || '0';
    const time = Number.parseInt(match[1], 10) * 60 +
        Number.parseInt(match[2], 10) +
        Number.parseInt(fraction.padEnd(3, '0'), 10) / 1000;
    const nextMatch = matches[index + 1];
    const nextFraction = nextMatch?.[3] || '0';
    const nextTime = nextMatch
      ? Number.parseInt(nextMatch[1], 10) * 60 +
        Number.parseInt(nextMatch[2], 10) +
        Number.parseInt(nextFraction.padEnd(3, '0'), 10) / 1000
      : NaN;
    const endTime = Number.isFinite(nextTime) && nextTime > time ? nextTime : undefined;
    const parts = wordText.match(/\s+|[^\s]+/g) || [];
    parts.forEach(part => {
      if (/^\s+$/.test(part)) {
        const previous = words[words.length - 1];
        if (previous) previous.text += part;
      } else if (part.trim()) {
        words.push({ time, ...(endTime !== undefined ? { endTime } : {}), text: part });
      }
    });
  }

  if (words.length === 0) return null;
  return {
    text: words.map(word => word.text).join('').trim(),
    words
  };
}
