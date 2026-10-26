// UI · Utilidades de interfaz: diálogo de confirmación, color dominante, animación de ondas.

import { btnConfirmAlternate, btnConfirmNo, btnConfirmYes, confirmModalMessage, confirmModalOverlay, confirmModalTitle } from './dom.js';

export function getSoundWaveHTML(isPaused = false) {
  return `
    <div class="sound-wave ${isPaused ? 'paused' : ''}">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;
}

export function showConfirmDialog({ title = "¿Estás seguro?", message = "", confirmText = "Aceptar", cancelText = "Cancelar", showCancel = true, alternateText = null }) {
  return new Promise((resolve) => {
    if (!confirmModalOverlay || !btnConfirmYes) {
      console.warn('showConfirmDialog: modal no disponible', title, message);
      resolve(true);
      return;
    }
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    btnConfirmYes.textContent = confirmText;
    if (btnConfirmNo) {
      btnConfirmNo.textContent = cancelText;
      btnConfirmNo.style.display = showCancel ? 'inline-flex' : 'none';
    }
    if (btnConfirmAlternate) {
      btnConfirmAlternate.textContent = alternateText || '';
      btnConfirmAlternate.style.display = alternateText ? 'inline-flex' : 'none';
    }

    confirmModalOverlay.classList.add('open');

    const btnConfirmClose = document.getElementById('btn-confirm-close');

    const cleanup = (result) => {
      confirmModalOverlay.classList.remove('open');
      btnConfirmYes.removeEventListener('click', onYes);
      btnConfirmNo?.removeEventListener('click', onNo);
      btnConfirmAlternate?.removeEventListener('click', onAlternate);
      btnConfirmClose?.removeEventListener('click', onClose);
      confirmModalOverlay.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKeyDown, true);
      resolve(result);
    };

    const onYes = () => cleanup(true);
    const onNo = () => cleanup(false);
    const onAlternate = () => cleanup('alternate');
    const onClose = () => cleanup(showCancel ? false : true);
    // No cerrar al hacer clic fuera: solo X, Cancelar o ESC
    const onBackdropClick = (event) => {
      if (event.target === confirmModalOverlay) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup(showCancel ? false : true);
    };

    btnConfirmYes.addEventListener('click', onYes);
    btnConfirmNo?.addEventListener('click', onNo);
    if (alternateText) btnConfirmAlternate?.addEventListener('click', onAlternate);
    btnConfirmClose?.addEventListener('click', onClose);
    confirmModalOverlay.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

export function extractDominantColor(imgSrc) {
  return new Promise((resolve) => {
    if (!imgSrc) return resolve({ r: 61, g: 28, b: 104 });
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 70) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count > 0) {
          resolve({
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
          });
        } else {
          resolve({ r: 61, g: 28, b: 104 });
        }
      } catch (e) {
        resolve({ r: 61, g: 28, b: 104 });
      }
    };
    img.onerror = () => resolve({ r: 61, g: 28, b: 104 });
    img.src = imgSrc;
  });
}


/** Escapa texto que viene de archivos (etiquetas ID3, nombres de carpeta) o del usuario
 *  antes de insertarlo dentro de plantillas HTML que se asignan a innerHTML.
 *  Evita que un título como <img onerror=...> se ejecute como código. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
