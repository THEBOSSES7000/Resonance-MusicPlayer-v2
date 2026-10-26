// Biblioteca · Utilidades de etiquetas: ReplayGain, número de pista y carátulas incrustadas.

export function parseReplayGainDb(value) {
  const match = String(value || '').match(/[+-]?\s*\d+(?:[.,]\d+)?\s*(?:dB)?/i);
  if (!match) return null;
  const gain = Number(match[0].replace(/\s|dB/gi, '').replace(',', '.'));
  return Number.isFinite(gain) ? gain : null;
}

export function parseTrackNumber(value) {
  const match = String(value || '').match(/^\s*(\d+)/);
  if (!match) return null;
  const trackNumber = Number(match[1]);
  return Number.isSafeInteger(trackNumber) && trackNumber > 0 ? trackNumber : null;
}

export function extractImageBuffer(bytes) {
  if (!bytes || bytes.length < 16) return null;
  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      const blob = new Blob([bytes.subarray(i)], { type: "image/jpeg" });
      return URL.createObjectURL(blob);
    }
    if (
      bytes[i] === 0x89 && bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47
    ) {
      const blob = new Blob([bytes.subarray(i)], { type: "image/png" });
      return URL.createObjectURL(blob);
    }
  }
  return null;
}

async function resizeLargeEmbeddedArtwork(coverUrl) {
  if (!coverUrl?.startsWith('blob:')) return coverUrl;
  let bitmap = null;
  let canvas = null;
  try {
    const response = await fetch(coverUrl);
    if (!response.ok) throw new Error(`No se pudo leer la carátula: HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size <= 512 * 1024) return coverUrl;
    if (typeof createImageBitmap !== 'function') {
      throw new Error('El entorno no admite la decodificación necesaria para optimizar la carátula.');
    }
    bitmap = await createImageBitmap(blob);
    const largestDimension = Math.max(bitmap.width, bitmap.height);
    if (largestDimension <= 300) return coverUrl;

    const scale = 300 / largestDimension;
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear el lienzo para optimizar la carátula.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const outputType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const resizedBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        result => result
          ? resolve(result)
          : reject(new Error('No se pudo codificar la carátula redimensionada.')),
        outputType,
        0.84
      );
    });
    const resizedUrl = URL.createObjectURL(resizedBlob);
    URL.revokeObjectURL(coverUrl);
    return resizedUrl;
  } catch (error) {
    console.warn('No se pudo optimizar una carátula incrustada; se conservará el archivo original:', error);
    return coverUrl;
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

export async function finalizeExtractedMetadata(metadata) {
  if (metadata?.coverUrl) {
    metadata.coverUrl = await resizeLargeEmbeddedArtwork(metadata.coverUrl);
  }
  return metadata;
}
