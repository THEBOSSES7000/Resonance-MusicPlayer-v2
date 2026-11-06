// UI · Notificaciones toast inferiores derechas.

let toastEl = null;
let hideTimer = null;
let removeTimer = null;

const TOAST_DURATIONS = {
  success: 2600,
  info: 3200,
  warning: 4500,
  error: 6000
};

const TOAST_ICONS = {
  success: 'ph-check-circle',
  info: 'ph-info',
  warning: 'ph-warning',
  error: 'ph-warning-circle'
};

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
  const type = Object.prototype.hasOwnProperty.call(TOAST_DURATIONS, opts.type) ? opts.type : 'info';
  const requestedDuration = Number(opts.durationMs);
  const durationMs = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : TOAST_DURATIONS[type];
  const el = ensureToast();
  el.className = `library-toast library-toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.style.setProperty('--toast-duration', `${durationMs}ms`);
  el.innerHTML = `<i class="ph ${TOAST_ICONS[type]}" aria-hidden="true"></i><span></span><i class="library-toast-progress" aria-hidden="true"></i>`;
  el.querySelector('span').textContent = message;
  el.hidden = false;
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');
  if (hideTimer) window.clearTimeout(hideTimer);
  if (removeTimer) window.clearTimeout(removeTimer);
  hideTimer = window.setTimeout(() => {
    el.classList.remove('is-visible');
    removeTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 180);
  }, durationMs);
}

export function showMissingSongToast(song) {
  const title = song?.title || song?.file?.name || 'Canción';
  showLibraryToast(`No se encontró el archivo: ${title}`, { type: 'error' });
}
