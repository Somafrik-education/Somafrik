"use strict";

/**
 * Adaptateur PostgreSQL scopé à un client transactionnel.
 * Aucun état mutable partagé entre requêtes concurrentes.
 * @param {import("pg").PoolClient} client
 */
function createTxAdapter(client) {
  return {
    client,
    async query(sql, params = []) {
      return client.query(sql, params);
    },
    async one(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params = []) {
      const result = await client.query(sql, params);
      return result.rows;
    },
  };
}

module.exports = { createTxAdapter };
