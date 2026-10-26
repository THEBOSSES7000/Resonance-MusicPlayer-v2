const SETTING_KEY = 'pn_discord_rpc_enabled';
const ARTWORK_MODE_SETTING_KEY = 'pn_discord_rpc_artwork_mode';
const RPC_UPDATE_INTERVAL_MS = 15_000;
const ITUNES_ARTWORK_CACHE = new Map();
const ITUNES_ARTWORK_REQUESTS = new Map();
const ARTWORK_CACHE_LIMIT = 60;

function getCachedArtwork(key) {
  if (!ITUNES_ARTWORK_CACHE.has(key)) return undefined;
  const value = ITUNES_ARTWORK_CACHE.get(key);
  ITUNES_ARTWORK_CACHE.delete(key);
  ITUNES_ARTWORK_CACHE.set(key, value);
  return value;
}

function cacheArtwork(key, value) {
  ITUNES_ARTWORK_CACHE.delete(key);
  while (ITUNES_ARTWORK_CACHE.size >= ARTWORK_CACHE_LIMIT) {
    ITUNES_ARTWORK_CACHE.delete(ITUNES_ARTWORK_CACHE.keys().next().value);
  }
  ITUNES_ARTWORK_CACHE.set(key, value);
}

const elements = {
  settingsToggle: document.getElementById('toggle-discord-rpc'),
  menuToggle: document.getElementById('toggle-discord-rpc-menu'),
  visualPlusSettingsToggle: document.getElementById('toggle-visual-plus'),
  visualPlusMenuToggle: document.getElementById('toggle-visual-plus-menu'),
  equalizerMenuToggle: document.getElementById('toggle-equalizer-menu'),
  equalizerSettingsToggle: document.getElementById('audio-equalizer-enabled'),
  menu: document.getElementById('discord-rpc-context-menu'),
  settingStatus: document.getElementById('discord-rpc-setting-status'),
  artworkSetting: document.getElementById('discord-rpc-artwork-setting'),
  artworkMode: document.getElementById('discord-rpc-artwork-mode'),
};

let playbackSnapshot = {
  title: '',
  artist: '',
  album: '',
  playing: false,
  positionSeconds: 0,
  durationSeconds: 0,
  largeImage: 'music_default'
};
let lastRpcUpdateAt = 0;
let presenceRevision = 0;

function isEnabled() {
  return localStorage.getItem(SETTING_KEY) === 'true';
}

function artworkMode() {
  const mode = localStorage.getItem(ARTWORK_MODE_SETTING_KEY);
  return ['local', 'default'].includes(mode) ? mode : 'artwork';
}

function updateToggles(enabled) {
  if (elements.settingsToggle) elements.settingsToggle.checked = enabled;
  if (elements.menuToggle) elements.menuToggle.checked = enabled;
  if (elements.artworkSetting) elements.artworkSetting.hidden = !enabled;
}

function setStatus(message, isError = false) {
  if (!elements.settingStatus) return;
  elements.settingStatus.textContent = message;
  elements.settingStatus.classList.toggle('is-error', isError);
}

function getTrackKey(track) {
  return `${track.artist.trim().toLocaleLowerCase()}:::${track.title.trim().toLocaleLowerCase()}`;
}

async function lookupItunesArtwork(track) {
  const artist = track.artist.trim();
  const title = track.title.trim();
  if (!artist || !title) return 'music_default';

  const key = getTrackKey(track);
  const cachedArtwork = getCachedArtwork(key);
  if (cachedArtwork !== undefined) return cachedArtwork;
  if (ITUNES_ARTWORK_REQUESTS.has(key)) return ITUNES_ARTWORK_REQUESTS.get(key);

  const request = (async () => {
    try {
      const query = encodeURIComponent(`${artist} ${title}`);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      let response;
      try {
        response = await fetch(
          `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`,
          { signal: controller.signal }
        );
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`iTunes respondió ${response.status}.`);
      const data = await response.json();
      const artworkUrl = data.results?.[0]?.artworkUrl100;
      if (typeof artworkUrl !== 'string' || !artworkUrl.startsWith('https://')) {
        cacheArtwork(key, 'music_default');
        return 'music_default';
      }
      const highResolutionUrl = artworkUrl.replace(/\/100x100bb(?=\.jpg(?:\?|$))/i, '/512x512bb');
      cacheArtwork(key, highResolutionUrl);
      return highResolutionUrl;
    } catch (error) {
      console.warn('No se pudo buscar la carátula de la pista en iTunes:', error);
      cacheArtwork(key, 'music_default');
      return 'music_default';
    } finally {
      ITUNES_ARTWORK_REQUESTS.delete(key);
    }
  })();
  ITUNES_ARTWORK_REQUESTS.set(key, request);
  return request;
}

async function updateNativePresence(revision = presenceRevision) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke || !isEnabled()) return;
  const snapshot = { ...playbackSnapshot };
  const mode = artworkMode();
  snapshot.artworkMode = mode;
  snapshot.largeImage = mode === 'artwork' && snapshot.title
    ? await lookupItunesArtwork(snapshot)
    : 'music_default';
  if (revision !== presenceRevision || !isEnabled()) return;
  await invoke('update_discord_presence', { update: snapshot });
  lastRpcUpdateAt = Date.now();
}

export async function setDiscordRpcEnabled(enabled) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    throw new Error('Discord Rich Presence solo está disponible en la aplicación de escritorio.');
  }

  updateToggles(enabled);
  try {
    await invoke('set_discord_rpc_enabled', { enabled });
  } catch (error) {
    if (!enabled) {
      localStorage.setItem(SETTING_KEY, 'false');
      updateToggles(false);
    } else {
      updateToggles(isEnabled());
    }
    setStatus(error instanceof Error ? error.message : String(error), true);
    throw error;
  }
  localStorage.setItem(SETTING_KEY, String(enabled));
  setStatus(enabled ? 'Conectado con Discord.' : 'Discord Rich Presence desactivado.');
  if (enabled) {
    try {
      await updateNativePresence();
    } catch (error) {
      console.error('No se pudo actualizar Discord Rich Presence:', error);
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
}

export function openDiscordRpcContextMenu(x, y) {
  if (!elements.menu) return;
  updateToggles(isEnabled());
  if (elements.visualPlusMenuToggle && elements.visualPlusSettingsToggle) {
    elements.visualPlusMenuToggle.checked = elements.visualPlusSettingsToggle.checked;
  }
  if (elements.equalizerMenuToggle) {
    const eqOn = elements.equalizerSettingsToggle
      ? elements.equalizerSettingsToggle.checked
      : localStorage.getItem('pn_audio_eq_enabled') === 'true';
    elements.equalizerMenuToggle.checked = eqOn;
  }
  elements.menu.hidden = false;
  elements.menu.classList.add('open');
  elements.menu.style.left = `${Math.max(10, Math.min(x, window.innerWidth - elements.menu.offsetWidth - 10))}px`;
  elements.menu.style.top = `${Math.max(10, Math.min(y, window.innerHeight - elements.menu.offsetHeight - 10))}px`;
}

export function initDiscordRpc() {
  updateToggles(isEnabled());
  if (elements.artworkMode) elements.artworkMode.value = artworkMode();

  elements.settingsToggle?.addEventListener('change', async () => {
    const enabled = elements.settingsToggle.checked;
    try {
      await setDiscordRpcEnabled(enabled);
    } catch (error) {
      console.error('No se pudo cambiar Discord Rich Presence:', error);
    }
  });
  elements.menuToggle?.addEventListener('change', async () => {
    const enabled = elements.menuToggle.checked;
    try {
      await setDiscordRpcEnabled(enabled);
    } catch (error) {
      console.error('No se pudo cambiar Discord Rich Presence:', error);
    }
  });
  elements.artworkMode?.addEventListener('change', () => {
    const mode = ['local', 'default'].includes(elements.artworkMode.value)
      ? elements.artworkMode.value
      : 'artwork';
    localStorage.setItem(ARTWORK_MODE_SETTING_KEY, mode);
    if (isEnabled()) {
      presenceRevision += 1;
      void updateNativePresence(presenceRevision).catch(error => {
        console.error('No se pudo actualizar la imagen de Discord Rich Presence:', error);
        setStatus(error instanceof Error ? error.message : String(error), true);
      });
    }
  });
  elements.visualPlusMenuToggle?.addEventListener('change', () => {
    if (!elements.visualPlusSettingsToggle) {
      console.error('No se encontró el control principal de Visual+.');
      return;
    }
    elements.visualPlusSettingsToggle.checked = elements.visualPlusMenuToggle.checked;
    elements.visualPlusSettingsToggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  elements.equalizerMenuToggle?.addEventListener('change', () => {
    const next = Boolean(elements.equalizerMenuToggle.checked);
    localStorage.setItem('pn_audio_eq_enabled', String(next));
    if (elements.equalizerSettingsToggle) {
      elements.equalizerSettingsToggle.checked = next;
      elements.equalizerSettingsToggle.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Fallback si ajustes aún no inicializaron el checkbox
      import('./audioPlayer.js').then(({ configureEqualizer }) => {
        const gains = Array.from({ length: 20 }, (_, i) => Number(localStorage.getItem(`pn_audio_eq_${i}`)) || 0);
        return configureEqualizer(next, gains);
      }).catch(error => console.error('No se pudo alternar el EQ:', error));
    }
  });
  document.addEventListener('pn-visual-plus-settings-changed', event => {
    if (elements.visualPlusMenuToggle) {
      elements.visualPlusMenuToggle.checked = event.detail.enabled === true;
    }
  });
  document.getElementById('discord-rpc-open-settings')?.addEventListener('click', () => {
    closeDiscordRpcContextMenu();
    document.getElementById('btn-open-settings')?.click();
    document.querySelector('[data-tab="tab-behavior"]')?.click();
  });
  document.addEventListener('pn-discord-presence-update', event => {
    const prevPlaying = Boolean(playbackSnapshot.playing);
    playbackSnapshot = { ...playbackSnapshot, ...event.detail };
    presenceRevision += 1;
    const force = Boolean(event.detail?.force);
    const playing = Boolean(playbackSnapshot.playing);
    const playStateChanged = prevPlaying !== playing;
    if (!isEnabled()) return;
    // En pausa estable no reenviar actividad: si no, tras clear_activity a los 30s
    // el update periódico volvía a mostrar el Rich Presence en bucle.
    if (!playing && !force && !playStateChanged) {
      return;
    }
    if (force || playStateChanged || Date.now() - lastRpcUpdateAt >= RPC_UPDATE_INTERVAL_MS) {
      void updateNativePresence(presenceRevision).catch(error => {
        console.error('No se pudo actualizar Discord Rich Presence:', error);
        setStatus(error instanceof Error ? error.message : String(error), true);
      });
    }
  });
  document.addEventListener('click', event => {
    if (!elements.menu?.contains(event.target)) closeDiscordRpcContextMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDiscordRpcContextMenu();
  });
  window.addEventListener('resize', closeDiscordRpcContextMenu);

  if (isEnabled()) {
    void setDiscordRpcEnabled(true).catch(error => {
      console.error('No se pudo iniciar Discord Rich Presence:', error);
    });
  }
}

export function closeDiscordRpcContextMenu() {
  if (!elements.menu) return;
  elements.menu.classList.remove('open');
  elements.menu.hidden = true;
}
