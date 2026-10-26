// Biblioteca · Lectura de letras (LRC y sincronización palabra a palabra).

export function parseLyricsText(raw) {
  if (!raw || !raw.trim()) return null;
  const rawLines = raw.split(/\r?\n/);
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const tagRegex = /^\[(ti|ar|al|by|offset|length|re|ve|au):.*\]$/i;

  const syncedLines = [];
  const plainLines = [];
  let hasTimestamp = false;
  const parseTimestamp = match => {
    const minutes = Number.parseInt(match[1], 10);
    const seconds = Number.parseInt(match[2], 10);
    const fraction = match[3] || '0';
    return minutes * 60 + seconds + Number.parseInt(fraction.padEnd(3, '0'), 10) / 1000;
  };

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (tagRegex.test(trimmed)) continue;

    const lineTimes = [...trimmed.matchAll(timeRegex)].map(parseTimestamp);
    const timedWords = parseInlineLyricWords(trimmed);
    if (lineTimes.length > 0 || timedWords) {
      hasTimestamp = true;
      const text = timedWords?.text || trimmed.replace(timeRegex, '').trim();
      const words = timedWords?.words;
      const times = lineTimes.length > 0 ? lineTimes : [words[0].time];
      for (const time of times) {
        syncedLines.push({ time, text: text || '•••', ...(words ? { words } : {}) });
      }
    } else {
      plainLines.push(trimmed);
      syncedLines.push({ time: null, text: trimmed });
    }
  }

  if (hasTimestamp) {
    syncedLines.sort((a, b) => {
      const timeA = a.time === null ? 0 : a.time;
      const timeB = b.time === null ? 0 : b.time;
      return timeA - timeB;
    });

    return {
      isSynced: true,
      lines: syncedLines.filter(l => l.text.length > 0)
    };
  } else {
    return {
      isSynced: false,
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
    if (!wordText.trim()) continue;
    const fraction = match[3] || '0';
    const time = Number.parseInt(match[1], 10) * 60 +
        Number.parseInt(match[2], 10) +
        Number.parseInt(fraction.padEnd(3, '0'), 10) / 1000;
    const parts = wordText.match(/\s+|[^\s]+/g) || [];
    parts.forEach(part => {
      if (/^\s+$/.test(part)) {
        const previous = words[words.length - 1];
        if (previous) previous.text += part;
      } else {
        words.push({ time, text: part });
      }
    });
  }

  if (words.length === 0) return null;
  return {
    text: words.map(word => word.text).join('').trim(),
    words
  };
}
