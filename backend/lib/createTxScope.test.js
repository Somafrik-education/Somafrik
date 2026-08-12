"use strict";

/**
 * Prouve que createTxScope lie les méthodes au Proxy : this.query / this.one
 * passent par l'adaptateur tx, pas par le pool.
 */
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");

async function main() {
  let poolCalls = 0;
  let txCalls = 0;

  const repo = Object.create(PostgresRepository.prototype);
  repo.pool = {
    async query() {
      poolCalls += 1;
      return { rows: [{ via: "pool" }] };
    },
  };
  repo.query = PostgresRepository.prototype.query;
  repo.one = PostgresRepository.prototype.one;
  repo.all = PostgresRepository.prototype.all;
  repo.createTxScope = PostgresRepository.prototype.createTxScope;

  /** Méthode métier typique : appelle this.one → this.query en interne. */
  repo.syncStudentsDomainFromBackOffice = async function syncStudentsDomainFromBackOffice() {
    const row = await this.one("SELECT 1 AS marker");
    await this.query("INSERT INTO students DEFAULT VALUES");
    const rows = await this.all("SELECT 1");
    return { row, rows };
  };

  const tx = {
    async query() {
      txCalls += 1;
      return { rows: [{ via: "tx" }] };
    },
    async one() {
      txCalls += 1;
      return { via: "tx" };
    },
    async all() {
      txCalls += 1;
      return [{ via: "tx" }];
    },
  };

  const transactional = repo.createTxScope(tx);
  const result = await transactional.syncStudentsDomainFromBackOffice({});

  assert.equal(result.row.via, "tx");
  assert.equal(result.rows[0].via, "tx");
  assert.equal(poolCalls, 0, "aucune requête ne doit toucher le pool hors transaction");
  assert.ok(txCalls >= 3, "les appels doivent passer par tx");

  // Contrôle négatif : bind(target) historique aurait utilisé le pool.
  const broken = new Proxy(repo, {
    get(target, prop) {
      if (prop === "query") return (sql, params) => tx.query(sql, params);
      if (prop === "one") return (sql, params) => tx.one(sql, params);
      if (prop === "all") return (sql, params) => tx.all(sql, params);
      const value = target[prop];
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
  poolCalls = 0;
  txCalls = 0;
  await broken.syncStudentsDomainFromBackOffice({});
  assert.ok(poolCalls > 0, "le bind(target) historique doit utiliser le pool (régression documentée)");

  console.log("createTxScope.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
