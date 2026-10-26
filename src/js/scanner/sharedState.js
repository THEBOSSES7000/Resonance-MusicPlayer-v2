// Biblioteca · Estado mutable compartido entre módulos (se usa como scannerVars.nombre).

// Variables que se reasignan desde más de un módulo. Se leen y escriben como scannerVars.nombre.
export const scannerVars = {
  hasInitializedPlaybackSession: false,
  hideScanProgressTimer: null
};
