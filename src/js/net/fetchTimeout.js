// Red · fetch con tiempo límite y caché corta en memoria.

const DEFAULT_TIMEOUT_MS = 12000;
const responseCache = new Map();
const MAX_CACHE = 80;

export function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const cacheKey = `${options.method || 'GET'} ${url}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.data;

  let res;
  try {
    res = await fetchWithTimeout(url, options, timeoutMs);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Tiempo de espera agotado');
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (responseCache.size >= MAX_CACHE) {
    responseCache.delete(responseCache.keys().next().value);
  }
  responseCache.set(cacheKey, { data, expires: Date.now() + 5 * 60 * 1000 });
  return data;
}

export function clearNetworkCache() {
  responseCache.clear();
}
