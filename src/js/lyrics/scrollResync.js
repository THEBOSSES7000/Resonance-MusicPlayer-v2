// Letras · Auto-scroll de letras y botón de resincronizar.

import { lyricsVars } from './sharedState.js';

export function updateLyricsResyncVisibility() {
  const resyncButton = document.getElementById('lyrics-resync');
  const lyricsAreOpen = document.getElementById('lyrics-overlay')?.classList.contains('open');
  if (resyncButton) {
    // Solo mostrar "Volver a la línea activa" cuando la línea NO está fijada
    // (auto-scroll desactivado tras mover el ratón / scroll manual).
    resyncButton.hidden = !lyricsAreOpen || !lyricsVars.lyricsAreSynced || lyricsVars.lyricsAutoScrollEnabled;
  }
}

export function markLyricsPointerMovement() {
  lyricsVars.lyricsPointerRecentlyMoved = true;
  updateLyricsResyncVisibility();
  if (lyricsVars.lyricsPointerIdleTimer !== null) window.clearTimeout(lyricsVars.lyricsPointerIdleTimer);
  lyricsVars.lyricsPointerIdleTimer = window.setTimeout(() => {
    lyricsVars.lyricsPointerRecentlyMoved = false;
    lyricsVars.lyricsPointerIdleTimer = null;
    updateLyricsResyncVisibility();
  }, 3000);
}
