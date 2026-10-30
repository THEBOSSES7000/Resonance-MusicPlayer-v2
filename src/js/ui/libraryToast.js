// UI · Toast inferior derecha (canciones no encontradas, etc.)

let toastEl = null;
let hideTimer = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div');
  toastEl.id = 'library-toast';
  toastEl.className = 'library-toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showLibraryToast(message, opts = {}) {
  const type = opts.type || 'error';
  const durationMs = opts.durationMs ?? 4500;
  const el = ensureToast();
  el.className = `library-toast library-toast--${type}`;
  el.innerHTML = `<i class="ph ${type === 'error' ? 'ph-warning-circle' : type === 'success' ? 'ph-check-circle' : 'ph-info'}" aria-hidden="true"></i><span></span>`;
  el.querySelector('span').textContent = message;
  el.hidden = false;
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => { el.hidden = true; }, durationMs);
}

export function showMissingSongToast(song) {
  const title = song?.title || song?.file?.name || 'Canción';
  showLibraryToast(`No se encontró el archivo: ${title}`, { type: 'error', durationMs: 5000 });
}
