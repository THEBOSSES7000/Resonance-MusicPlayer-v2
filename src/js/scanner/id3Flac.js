// Biblioteca · Decodificación ID3 y lector FLAC.

import { parseLyricsText } from './lyricsParsing.js';
import { extractImageBuffer, parseReplayGainDb, parseTrackNumber } from './tagUtils.js';

export function decodeId3Text(frameData) {
  if (frameData.length <= 1) return "";
  const encoding = frameData[0];
  const textBytes = frameData.subarray(1);
  try {
    if (encoding === 0) return new TextDecoder("iso-8859-1").decode(textBytes).trim().replace(/\0+$/, '');
    if (encoding === 1) return new TextDecoder("utf-16").decode(textBytes).trim().replace(/\0+$/, '');
    if (encoding === 2) return new TextDecoder("utf-16be").decode(textBytes).trim().replace(/\0+$/, '');
    if (encoding === 3) return new TextDecoder("utf-8").decode(textBytes).trim().replace(/\0+$/, '');
  } catch (e) {}
  let str = "";
  for (let i = 0; i < textBytes.length; i++) {
    if (textBytes[i] !== 0) str += String.fromCharCode(textBytes[i]);
  }
  return str.trim();
}

export function decodeId3Lyrics(frameData) {
  if (frameData.length <= 4) return null;
  const encoding = frameData[0];
  let offset = 4;

  if (encoding === 1 || encoding === 2) {
    while (offset < frameData.length - 1) {
      if (frameData[offset] === 0 && frameData[offset + 1] === 0) {
        offset += 2;
        break;
      }
      offset += 2;
    }
  } else {
    while (offset < frameData.length && frameData[offset] !== 0) {
      offset++;
    }
    offset++;
  }

  if (offset >= frameData.length) return null;
  const lyricsBytes = frameData.subarray(offset);
  let rawLyrics = "";
  try {
    if (encoding === 0) rawLyrics = new TextDecoder("iso-8859-1").decode(lyricsBytes);
    else if (encoding === 1) rawLyrics = new TextDecoder("utf-16").decode(lyricsBytes);
    else if (encoding === 2) rawLyrics = new TextDecoder("utf-16be").decode(lyricsBytes);
    else if (encoding === 3) rawLyrics = new TextDecoder("utf-8").decode(lyricsBytes);
  } catch (e) {
    rawLyrics = String.fromCharCode(...lyricsBytes);
  }

  return parseLyricsText(rawLyrics);
}

export async function parseFlac(file) {
  const result = {
    title: null,
    artist: null,
    album: null,
    trackNumber: null,
    coverUrl: null,
    lyrics: null,
    replayGainDb: null,
    duration: null,
    sampleRate: 44100,
    channels: 2,
    bitDepth: 16,
    codec: "FLAC (Free Lossless Audio Codec)"
  };

  const maxPictureSize = 5 * 1024 * 1024;
  try {
    let offset = 4;
    let isLast = false;

    while (offset + 4 <= file.size && !isLast) {
      const header = new DataView(await file.slice(offset, offset + 4).arrayBuffer());
      const headerByte = header.getUint8(0);
      isLast = (headerByte & 0x80) !== 0;
      const blockType = headerByte & 0x7F;
      const length = (header.getUint8(1) << 16) | (header.getUint8(2) << 8) | header.getUint8(3);
      const blockOffset = offset + 4;
      const blockEnd = blockOffset + length;
      if (blockEnd > file.size) {
        console.warn(`El bloque FLAC ${blockType} excede el tamaño del archivo.`);
        break;
      }
      offset = blockEnd;

      if (blockType === 0 && length >= 18) {
        const streamInfo = new DataView(await file.slice(blockOffset, blockOffset + 18).arrayBuffer());
        const b10 = streamInfo.getUint8(10);
        const b11 = streamInfo.getUint8(11);
        const b12 = streamInfo.getUint8(12);
        const b13 = streamInfo.getUint8(13);
        result.sampleRate = (b10 << 12) | (b11 << 4) | (b12 >> 4);
        result.channels = ((b12 >> 1) & 0x07) + 1;
        result.bitDepth = (((b12 & 0x01) << 4) | (b13 >> 4)) + 1;
        const totalSamples = (b13 & 0x0F) * 0x100000000 + streamInfo.getUint32(14, false);
        if (result.sampleRate > 0 && totalSamples > 0) {
          result.duration = totalSamples / result.sampleRate;
        }
      } else if (blockType === 4) {
        try {
          const commentBytes = new Uint8Array(await file.slice(blockOffset, blockEnd).arrayBuffer());
          const view = new DataView(commentBytes.buffer);
          let vOffset = 0;
          if (commentBytes.length < 8) throw new Error('Bloque de comentarios demasiado corto.');
          const vendorLen = view.getUint32(vOffset, true);
          vOffset += 4;
          if (vOffset + vendorLen + 4 > commentBytes.length) {
            throw new Error('Longitud del proveedor FLAC no válida.');
          }
          vOffset += vendorLen;
          const listLen = view.getUint32(vOffset, true);
          vOffset += 4;
          const dec = new TextDecoder("utf-8");
          for (let i = 0; i < listLen && vOffset + 4 <= commentBytes.length; i++) {
            const commentLen = view.getUint32(vOffset, true);
            vOffset += 4;
            if (vOffset + commentLen > commentBytes.length) {
              throw new Error('Longitud de comentario FLAC no válida.');
            }
            const text = dec.decode(commentBytes.subarray(vOffset, vOffset + commentLen));
            vOffset += commentLen;
            const eq = text.indexOf("=");
            if (eq === -1) continue;
            const k = text.substring(0, eq).toUpperCase();
            const v = text.substring(eq + 1).trim();
            if (k === "TITLE" && !result.title) result.title = v;
            if (k === "ARTIST" && !result.artist) result.artist = v;
            if (k === "ALBUM" && !result.album) result.album = v;
            if (k === "TRACKNUMBER" && !result.trackNumber) result.trackNumber = parseTrackNumber(v);
            if (k === "REPLAYGAIN_TRACK_GAIN" && result.replayGainDb === null) result.replayGainDb = parseReplayGainDb(v);
            if ((k === "LYRICS" || k === "UNSYNCEDLYRICS") && !result.lyrics) {
              result.lyrics = parseLyricsText(v);
            }
            if ((k === "METADATA_BLOCK_PICTURE" || k === "COVERART") && !result.coverUrl) {
              const estimatedImageSize = Math.floor(v.length * 3 / 4);
              if (estimatedImageSize > maxPictureSize) {
                console.warn(`Se omite la carátula FLAC de comentarios (${estimatedImageSize} bytes).`);
                continue;
              }
              try {
                const rawB64 = atob(v);
                const imageBytes = new Uint8Array(rawB64.length);
                for (let b = 0; b < rawB64.length; b++) imageBytes[b] = rawB64.charCodeAt(b);
                result.coverUrl = extractImageBuffer(imageBytes);
              } catch (error) {
                console.warn('No se pudo extraer la carátula de los comentarios FLAC:', error);
              }
            }
          }
        } catch (error) {
          console.warn('No se pudieron leer los comentarios FLAC:', error);
        }
      } else if (blockType === 6 && !result.coverUrl) {
        if (length > maxPictureSize) {
          console.warn(`Se omite la carátula FLAC de ${length} bytes.`);
          continue;
        }
        try {
          const pictureBytes = new Uint8Array(await file.slice(blockOffset, blockEnd).arrayBuffer());
          result.coverUrl = extractImageBuffer(pictureBytes);
        } catch (error) {
          console.warn('No se pudo extraer la carátula FLAC:', error);
        }
      }
    }
  } catch (error) {
    console.warn(`No se pudieron leer todos los metadatos FLAC de ${file.name}:`, error);
  }

  return result;
}
