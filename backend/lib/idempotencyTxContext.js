"use strict";

/**
 * Contexte transactionnel d'idempotence.
 * Pendant withIdempotencyTransaction, query/withTransaction du dépôt
 * doivent réutiliser le même client PostgreSQL (pas un second COMMIT).
 */
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();

function getIdempotencyTx() {
  return storage.getStore() ?? null;
}

function runWithIdempotencyTx(store, fn) {
  return storage.run(store, fn);
}

/**
 * NFC-PRES-LOCAL-PR1c : exécute `fn` HORS du contexte transactionnel (requêtes sur une autre
 * connexion du pool). Réservé aux lectures en direct qui ne doivent ni partager le client de la
 * transaction (requêtes parallèles), ni voir ses écritures non validées.
 */
function runOutsideIdempotencyTx(fn) {
  return storage.exit(fn);
}

module.exports = {
  getIdempotencyTx,
  runWithIdempotencyTx,
  runOutsideIdempotencyTx,
};
