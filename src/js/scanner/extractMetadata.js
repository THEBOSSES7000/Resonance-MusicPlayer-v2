// Biblioteca · Extracción de metadatos de un archivo de audio.

import { extractImageBuffer, finalizeExtractedMetadata, parseReplayGainDb, parseTrackNumber } from './tagUtils.js';
import { estimateMp3Duration, parseM4A, parseOgg, parseWav } from './formatParsers.js';
import { decodeId3Lyrics, decodeId3Text, parseFlac } from './id3Flac.js';

export async function extractMetadata(file) {
  const result = {
    title: null,
    artist: null,
    album: null,
    trackNumber: null,
    coverUrl: null,
    lyrics: null,
    sampleRate: null,
    channels: null,
    bitDepth: null,
    codec: null,
    replayGainDb: null,
    duration: null,
  };

  if (!file || typeof file.slice !== 'function') return result;

  try {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (ext === '.m4a' || ext === '.mp4') {
      return await finalizeExtractedMetadata(await parseM4A(file));
    }

    if (ext === '.ogg' || ext === '.opus') {
      return await finalizeExtractedMetadata(await parseOgg(file));
    }

    if (ext === '.wav') {
      return await finalizeExtractedMetadata(await parseWav(file));
    }

    if (ext === '.flac') {
      const flacBlob = file.slice(0, 4);
      const flacBuf = await flacBlob.arrayBuffer();
      const flacView = new DataView(flacBuf);
      if (flacView.byteLength >= 4 && flacView.getUint32(0, false) === 0x664C6143) {
        return await finalizeExtractedMetadata(await parseFlac(file));
      }
    }

    let audioStart = 0;
    const id3HeaderBlob = file.slice(0, 10);
    const id3HeaderBuf = await id3HeaderBlob.arrayBuffer();
    const id3View = new DataView(id3HeaderBuf);

    if (
      id3View.byteLength >= 10 &&
      id3View.getUint8(0) === 0x49 &&
      id3View.getUint8(1) === 0x44 &&
      id3View.getUint8(2) === 0x33
    ) {
      const version = id3View.getUint8(3);
      const b0 = id3View.getUint8(6);
      const b1 = id3View.getUint8(7);
      const b2 = id3View.getUint8(8);
      const b3 = id3View.getUint8(9);
      const tagSize = ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
      audioStart = Math.min(file.size, tagSize + 10);

      const readLimit = Math.min(file.size, Math.max(tagSize + 20, 1024 * 1024));
      const fullBlob = file.slice(0, Math.min(readLimit, 12 * 1024 * 1024));
      const fullBuf = await fullBlob.arrayBuffer();
      const view = new DataView(fullBuf);
      const bytes = new Uint8Array(fullBuf);

      let offset = 10;
      const end = Math.min(fullBuf.byteLength, tagSize + 10);

      if (version === 2) {
        while (offset < end - 6) {
          if (view.getUint8(offset) === 0) break;
          const frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2));
          const frameSize = (view.getUint8(offset + 3) << 16) | (view.getUint8(offset + 4) << 8) | view.getUint8(offset + 5);
          if (frameSize <= 0 || offset + 6 + frameSize > fullBuf.byteLength) break;

          const frameData = bytes.subarray(offset + 6, offset + 6 + frameSize);
          if (frameId === "TT2") result.title = decodeId3Text(frameData);
          else if (frameId === "TP1") result.artist = decodeId3Text(frameData);
          else if (frameId === "TAL") result.album = decodeId3Text(frameData);
          else if (frameId === "TRK") result.trackNumber = parseTrackNumber(decodeId3Text(frameData));
          else if (frameId === "TXX") {
            const [description, value] = decodeId3Text(frameData).split('\0', 2);
            if (/^replaygain_track_gain$/i.test(description || '')) result.replayGainDb = parseReplayGainDb(value);
          }
          else if (frameId === "PIC" && !result.coverUrl) result.coverUrl = extractImageBuffer(frameData);
          else if (frameId === "ULT" && !result.lyrics) result.lyrics = decodeId3Lyrics(frameData);

          offset += 6 + frameSize;
        }
      } else {
        while (offset < end - 10) {
          if (view.getUint8(offset) === 0) break;
          let frameId = "";
          for (let i = 0; i < 4; i++) {
            frameId += String.fromCharCode(view.getUint8(offset + i));
          }

          let frameSize = 0;
          if (version === 4) {
            const fb0 = view.getUint8(offset + 4);
            const fb1 = view.getUint8(offset + 5);
            const fb2 = view.getUint8(offset + 6);
            const fb3 = view.getUint8(offset + 7);
            frameSize = ((fb0 & 0x7f) << 21) | ((fb1 & 0x7f) << 14) | ((fb2 & 0x7f) << 7) | (fb3 & 0x7f);
          } else {
            frameSize = view.getUint32(offset + 4, false);
          }

          if (frameSize <= 0 || offset + 10 + frameSize > fullBuf.byteLength) break;

          const frameData = bytes.subarray(offset + 10, offset + 10 + frameSize);

          if (frameId === "TIT2") result.title = decodeId3Text(frameData);
          else if (frameId === "TPE1") result.artist = decodeId3Text(frameData);
          else if (frameId === "TALB") result.album = decodeId3Text(frameData);
          else if (frameId === "TRCK") result.trackNumber = parseTrackNumber(decodeId3Text(frameData));
          else if (frameId === "TXXX") {
            const [description, value] = decodeId3Text(frameData).split('\0', 2);
            if (/^replaygain_track_gain$/i.test(description || '')) result.replayGainDb = parseReplayGainDb(value);
          }
          else if (frameId === "APIC" && !result.coverUrl) {
            result.coverUrl = extractImageBuffer(frameData);
          }
          else if ((frameId === "USLT" || frameId === "SYLT") && !result.lyrics) {
            result.lyrics = decodeId3Lyrics(frameData);
          }

          offset += 10 + frameSize;
        }
      }

      if (!result.coverUrl) {
        result.coverUrl = extractImageBuffer(bytes.subarray(10, end));
      }

      result.codec = ext === '.aac' ? "AAC (Advanced Audio Coding)" : "MP3 (MPEG Layer-3 Audio)";
      result.channels = 2;
      result.sampleRate = 44100;
      result.bitDepth = 16;
    }
    if (ext === '.mp3') result.duration = await estimateMp3Duration(file, audioStart);
  } catch (err) {
    console.warn("Fallo lectura metadatos:", err);
  }

  return await finalizeExtractedMetadata(result);
}
