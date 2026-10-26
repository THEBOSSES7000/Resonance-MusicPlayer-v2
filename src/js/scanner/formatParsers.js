// Biblioteca · Lectores de formatos: M4A, OGG, WAV y duración MP3.

import { extractImageBuffer, parseReplayGainDb, parseTrackNumber } from './tagUtils.js';
import { parseLyricsText } from './lyricsParsing.js';

export async function parseM4A(file) {
  const result = {
    title: null,
    artist: null,
    album: null,
    trackNumber: null,
    coverUrl: null,
    lyrics: null,
    replayGainDb: null,
    duration: null,
    codec: "M4A (AAC / MPEG-4 Audio)",
    sampleRate: 44100,
    channels: 2,
    bitDepth: 16
  };

  try {
    let moovBuffer = null;
    let offset = 0;
    const fileSize = file.size;

    while (offset + 8 <= fileSize) {
      const headerBlob = file.slice(offset, offset + 16);
      const headerBuf = await headerBlob.arrayBuffer();
      if (headerBuf.byteLength < 8) break;
      const view = new DataView(headerBuf);
      let size = view.getUint32(0, false);
      let headerSize = 8;
      const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));

      if (size === 1 && headerBuf.byteLength >= 16) {
        const high = view.getUint32(8, false);
        const low = view.getUint32(12, false);
        size = (high * 0x100000000) + low;
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }

      if (type === 'moov') {
        const moovBlob = file.slice(offset, offset + Math.min(size, 32 * 1024 * 1024));
        moovBuffer = await moovBlob.arrayBuffer();
        break;
      }

      if (size < headerSize || offset + size > fileSize) break;
      offset += size;
    }

    if (moovBuffer) {
      parseM4ABuffer(moovBuffer, result);
    } else if (fileSize > 0) {
      const tailBuffer = await file.slice(Math.max(0, fileSize - 8 * 1024 * 1024)).arrayBuffer();
      parseM4ABuffer(tailBuffer, result);
    }
  } catch (e) {
    console.warn("Error leyendo M4A:", e);
  }

  return result;
}

function parseM4ABuffer(buf, result) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const containers = new Set(['moov', 'udta', 'meta', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'ilst']);

  const readAtomSize = (start, end) => {
    if (start + 8 > end) return null;
    let size = view.getUint32(start, false);
    const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
    let headerSize = 8;
    if (size === 1) {
      if (start + 16 > end) return null;
      size = view.getUint32(start + 8, false) * 0x100000000 + view.getUint32(start + 12, false);
      headerSize = 16;
    } else if (size === 0) {
      size = end - start;
    }
    if (size < headerSize || start + size > end) return null;
    return { type, headerSize, contentStart: start + headerSize, end: start + size };
  };

  const parseItem = (tag, contentStart, end) => {
    if (tag === '----') {
      let childOffset = contentStart;
      let name = '';
      let value = '';
      while (childOffset + 8 <= end) {
        const child = readAtomSize(childOffset, end);
        if (!child) break;
        if ((child.type === 'name' || child.type === 'mean') && child.contentStart + 4 <= child.end) {
          const text = new TextDecoder('utf-8').decode(bytes.subarray(child.contentStart + 4, child.end)).trim();
          if (child.type === 'name') name = text;
          else name = `${text}:${name}`;
        } else if (child.type === 'data' && child.contentStart + 8 <= child.end) {
          value = new TextDecoder('utf-8').decode(bytes.subarray(child.contentStart + 8, child.end)).replace(/\0+$/g, '').trim();
        }
        childOffset = child.end;
      }
      if (/replaygain_track_gain/i.test(name)) result.replayGainDb = parseReplayGainDb(value);
      return;
    }
    let childOffset = contentStart;
    while (childOffset + 8 <= end) {
      const child = readAtomSize(childOffset, end);
      if (!child) break;
      if (child.type === 'data' && child.contentStart + 8 <= child.end) {
        const dataType = view.getUint32(child.contentStart, false);
        const valueStart = child.contentStart + 8;
        const value = bytes.subarray(valueStart, child.end);
        if (tag === 'trkn' && value.length >= 4) {
          result.trackNumber = view.getUint16(valueStart + 2, false) || null;
        } else if (tag === 'covr' && !result.coverUrl) {
          result.coverUrl = extractImageBuffer(value);
        } else if (value.length) {
          let text;
          try {
            text = dataType === 2
              ? new TextDecoder('utf-16be').decode(value)
              : new TextDecoder('utf-8').decode(value);
          } catch {
            text = new TextDecoder('utf-8').decode(value);
          }
          text = text.replace(/\0+$/g, '').trim();
          if (tag === '\u00a9nam' && !result.title) result.title = text;
          else if ((tag === '\u00a9ART' || tag === 'aART') && !result.artist) result.artist = text;
          else if (tag === '\u00a9alb' && !result.album) result.album = text;
          else if (tag === '\u00a9lyr' && !result.lyrics) result.lyrics = parseLyricsText(text);
        }
      }
      childOffset = child.end;
    }
  };

  const parseAtoms = (start, end, parent = '') => {
    let offset = start;
    while (offset + 8 <= end) {
      const atom = readAtomSize(offset, end);
      if (!atom) break;
      if (parent === 'ilst') {
        parseItem(atom.type, atom.contentStart, atom.end);
      } else if (atom.type === 'mvhd' && atom.contentStart + 20 <= atom.end) {
        const version = view.getUint8(atom.contentStart);
        const timescaleOffset = atom.contentStart + (version === 1 ? 20 : 12);
        const durationOffset = timescaleOffset + 4;
        const durationBytes = version === 1 ? 8 : 4;
        if (durationOffset + durationBytes <= atom.end) {
          const timescale = view.getUint32(timescaleOffset, false);
          const high = version === 1 ? view.getUint32(durationOffset, false) : 0;
          const low = view.getUint32(durationOffset + (version === 1 ? 4 : 0), false);
          const isUnknownDuration = version === 1
            ? high === 0xFFFFFFFF && low === 0xFFFFFFFF
            : low === 0xFFFFFFFF;
          const duration = version === 1 ? high * 0x100000000 + low : low;
          if (timescale > 0 && !isUnknownDuration && Number.isFinite(duration)) {
            result.duration = duration / timescale;
          }
        }
      } else if (containers.has(atom.type)) {
        const childStart = atom.type === 'meta' ? atom.contentStart + 4 : atom.contentStart;
        parseAtoms(childStart, atom.end, atom.type);
      }
      offset = atom.end;
    }
  };

  parseAtoms(0, bytes.length);
}

export async function parseOgg(file) {
  const result = {
    title: null, artist: null, album: null, trackNumber: null, coverUrl: null, lyrics: null, replayGainDb: null,
    sampleRate: null, channels: null, bitDepth: null, codec: 'OGG audio'
  };
  const buffer = await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  let packetParts = [];
  let packetLength = 0;

  const parseComments = packet => {
    let pos;
    if (packet.length >= 7 && packet[0] === 3 && String.fromCharCode(...packet.subarray(1, 7)) === 'vorbis') {
      pos = 7;
      result.codec = 'OGG Vorbis';
    } else if (packet.length >= 8 && String.fromCharCode(...packet.subarray(0, 8)) === 'OpusTags') {
      pos = 8;
      result.codec = 'Opus';
    } else {
      return;
    }

    if (pos + 4 > packet.length) return;
    const vendorLength = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(pos, true);
    pos += 4 + vendorLength;
    if (pos + 4 > packet.length) return;
    const commentCount = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(pos, true);
    pos += 4;
    const decoder = new TextDecoder('utf-8');
    for (let i = 0; i < commentCount && pos + 4 <= packet.length; i++) {
      const commentLength = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(pos, true);
      pos += 4;
      if (pos + commentLength > packet.length) break;
      const comment = decoder.decode(packet.subarray(pos, pos + commentLength));
      pos += commentLength;
      const separator = comment.indexOf('=');
      if (separator < 0) continue;
      const key = comment.slice(0, separator).toUpperCase();
      const value = comment.slice(separator + 1).trim();
      if (key === 'TITLE' && !result.title) result.title = value;
      else if ((key === 'ARTIST' || key === 'ALBUMARTIST') && !result.artist) result.artist = value;
      else if (key === 'ALBUM' && !result.album) result.album = value;
      else if (key === 'TRACKNUMBER' && !result.trackNumber) result.trackNumber = parseTrackNumber(value);
      else if (key === 'LYRICS' && !result.lyrics) result.lyrics = parseLyricsText(value);
      else if (key === 'REPLAYGAIN_TRACK_GAIN' && result.replayGainDb === null) result.replayGainDb = parseReplayGainDb(value);
      else if ((key === 'METADATA_BLOCK_PICTURE' || key === 'COVERART') && !result.coverUrl) {
        try {
          const base64 = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
          const raw = atob(base64);
          const imageBytes = new Uint8Array(raw.length);
          for (let j = 0; j < raw.length; j++) imageBytes[j] = raw.charCodeAt(j);
          result.coverUrl = extractImageBuffer(imageBytes);
        } catch (error) {
          console.warn('No se pudo leer la carátula del archivo OGG:', error);
        }
      }
    }
  };

  while (offset + 27 <= bytes.length) {
    if (String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== 'OggS') {
      offset++;
      continue;
    }
    const segmentCount = bytes[offset + 26];
    const segmentTableStart = offset + 27;
    const pageDataStart = segmentTableStart + segmentCount;
    if (pageDataStart > bytes.length) break;
    let pageDataOffset = pageDataStart;
    for (let i = 0; i < segmentCount; i++) {
      const segmentLength = bytes[segmentTableStart + i];
      if (pageDataOffset + segmentLength > bytes.length) return result;
      packetParts.push(bytes.subarray(pageDataOffset, pageDataOffset + segmentLength));
      packetLength += segmentLength;
      pageDataOffset += segmentLength;
      if (segmentLength < 255) {
        const packet = new Uint8Array(packetLength);
        let packetOffset = 0;
        packetParts.forEach(part => {
          packet.set(part, packetOffset);
          packetOffset += part.length;
        });
        parseComments(packet);
        packetParts = [];
        packetLength = 0;
        if (result.title && result.artist && result.album) return result;
      }
    }
    offset = pageDataOffset;
  }
  return result;
}

export async function parseWav(file) {
  const result = {
    title: null, artist: null, album: null, trackNumber: null, coverUrl: null, lyrics: null,
    sampleRate: null, channels: null, bitDepth: null, codec: 'WAV (PCM audio)', duration: null
  };
  const buffer = await file.slice(0, Math.min(file.size, 16 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WAVE') return result;

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(bytes.length, chunkStart + chunkSize);
    if (chunkEnd < chunkStart) break;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkStart + 16 <= chunkEnd) {
      result.channels = view.getUint16(chunkStart + 2, true) || null;
      result.sampleRate = view.getUint32(chunkStart + 4, true) || null;
      byteRate = view.getUint32(chunkStart + 8, true) || 0;
      result.bitDepth = view.getUint16(chunkStart + 14, true) || null;
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
    } else if (chunkId === 'LIST' && chunkSize >= 4 &&
               String.fromCharCode(...bytes.subarray(chunkStart, chunkStart + 4)) === 'INFO') {
      let infoOffset = chunkStart + 4;
      while (infoOffset + 8 <= chunkEnd) {
        const tag = String.fromCharCode(...bytes.subarray(infoOffset, infoOffset + 4));
        const tagSize = view.getUint32(infoOffset + 4, true);
        const valueStart = infoOffset + 8;
        const valueEnd = Math.min(chunkEnd, valueStart + tagSize);
        const value = new TextDecoder('utf-8').decode(bytes.subarray(valueStart, valueEnd)).replace(/\0+$/g, '').trim();
        if (tag === 'INAM' && value) result.title = value;
        else if (tag === 'IART' && value) result.artist = value;
        else if (tag === 'IPRD' && value) result.album = value;
        else if (tag === 'ITRK' && value) result.trackNumber = parseTrackNumber(value);
        infoOffset = valueStart + tagSize + (tagSize % 2);
      }
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (byteRate > 0 && dataSize > 0) result.duration = dataSize / byteRate;
  return result;
}

export async function estimateMp3Duration(file, audioStart) {
  const buffer = await file.slice(audioStart, Math.min(file.size, audioStart + 256 * 1024)).arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const tailBuffer = file.size >= 128
    ? await file.slice(file.size - 128).arrayBuffer()
    : new ArrayBuffer(0);
  const hasId3v1Tag = tailBuffer.byteLength >= 3 &&
    String.fromCharCode(...new Uint8Array(tailBuffer, 0, 3)) === 'TAG';
  const mpeg1Layer1Bitrates = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448];
  const mpeg1Layer2Bitrates = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384];
  const mpeg1Layer3Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Layer1Bitrates = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256];
  const mpeg2Layer23Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRates = [44100, 48000, 32000];

  for (let offset = 0; offset + 4 <= bytes.length; offset++) {
    const header = view.getUint32(offset, false);
    if (((header >>> 21) & 0x7FF) !== 0x7FF) continue;
    const version = (header >>> 19) & 0x03;
    const layer = (header >>> 17) & 0x03;
    const bitrateIndex = (header >>> 12) & 0x0F;
    const sampleRateIndex = (header >>> 10) & 0x03;
    if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;

    const isMpeg1 = version === 3;
    const bitrateTable = isMpeg1
      ? [null, mpeg1Layer3Bitrates, mpeg1Layer2Bitrates, mpeg1Layer1Bitrates][layer]
      : [null, mpeg2Layer23Bitrates, mpeg2Layer23Bitrates, mpeg2Layer1Bitrates][layer];
    const bitrate = bitrateTable[bitrateIndex];
    const sampleRate = sampleRates[sampleRateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (!bitrate || !sampleRate) continue;

    if (layer === 1) {
      const crcBytes = ((header >>> 16) & 1) === 0 ? 2 : 0;
      const mono = ((header >>> 6) & 0x03) === 3;
      const sideInfoBytes = isMpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
      const xingOffset = offset + 4 + crcBytes + sideInfoBytes;
      if (xingOffset + 12 <= bytes.length) {
        const marker = String.fromCharCode(...bytes.subarray(xingOffset, xingOffset + 4));
        if (marker === 'Xing' || marker === 'Info') {
          const flags = view.getUint32(xingOffset + 4, false);
          if ((flags & 1) !== 0 && xingOffset + 12 <= bytes.length) {
            const frameCount = view.getUint32(xingOffset + 8, false);
            const samplesPerFrame = isMpeg1 ? 1152 : 576;
            if (frameCount > 0) return frameCount * samplesPerFrame / sampleRate;
          }
        }
      }
    }

    const samplesPerFrame = layer === 3
      ? 384
      : layer === 1 && !isMpeg1 ? 576
        : 1152;
    const frameCountInHeader = samplesPerFrame / sampleRate;
    const streamBytes = Math.max(0, file.size - audioStart - (hasId3v1Tag ? 128 : 0));
    return streamBytes / (bitrate * 125) || frameCountInHeader;
  }
  return null;
}
