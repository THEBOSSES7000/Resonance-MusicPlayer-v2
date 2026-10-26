import { initializeSettingsPersistence } from './settingsPersistence.js';

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    })
  ]);
}

let persistenceError = null;
try {
  // No bloquear la app indefinidamente si el IPC de ajustes cuelga
  await withTimeout(initializeSettingsPersistence(), 4000, 'load_app_settings');
} catch (error) {
  persistenceError = error;
  console.error('No se pudo cargar la configuración persistida en disco:', error);
}

// Siempre cargar la app: sin esto no hay handlers de UI ni de la barra de título
await import('./main.js');

if (persistenceError) {
  window.dispatchEvent(new CustomEvent('pn-settings-persistence-error', {
    detail: {
      message: persistenceError instanceof Error
        ? persistenceError.message
        : String(persistenceError)
    }
  }));
}
