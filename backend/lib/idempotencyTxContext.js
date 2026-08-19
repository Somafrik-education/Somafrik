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

module.exports = {
  getIdempotencyTx,
  runWithIdempotencyTx,
};
