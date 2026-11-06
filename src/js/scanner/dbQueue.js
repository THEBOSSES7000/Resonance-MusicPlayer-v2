// Biblioteca · Cola única de escrituras en la base de datos (SQLite).
//
// Los comandos de Rust de la base de datos se ejecutan fuera del hilo principal y, por tanto, podrían
// terminar en distinto orden al pedido. Esta cola los lanza de uno en uno, en el mismo orden en que se
// pidieron, para que un dato antiguo nunca pise a uno más nuevo.

let tail = Promise.resolve();

/**
 * Encola un trabajo que escribe en la base de datos y devuelve su resultado.
 * Si un trabajo falla, el error llega a quien lo pidió pero la cola sigue funcionando.
 */
export function enqueueDbWrite(job) {
  const run = tail.then(() => job());
  tail = run.catch(() => {});
  return run;
}
