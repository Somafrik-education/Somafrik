"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recordResidualReplace } = require("./residualStateManagement");

test("recordResidualReplace rejette avant mutation si schoolCode imbriqué étranger", async () => {
  let mutated = false;
  const repository = {
    getResidualStore() {
      return {
        async replaceDomainRecords() {
          mutated = true;
          return [];
        },
      };
    },
    async withTransaction(fn) {
      return fn(null);
    },
    async recordAudit() {},
    invalidateCachedDataset() {},
  };

  await assert.rejects(
    () =>
      recordResidualReplace(
        repository,
        "exam",
        "CD-2026-0001",
        [{ id: "EX-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" }],
        { schoolCode: "CD-2026-0001" },
        { userId: "USER-1" },
      ),
    (error) => error.statusCode === 400,
  );
  assert.equal(mutated, false);
});

test("recordResidualReplace propage l'échec d'audit sans valider la mutation", async () => {
  let committed = false;
  const repository = {
    getResidualStore() {
      return {
        async replaceDomainRecords() {
          return [{ id: "EX-1", schoolCode: "CD-2026-0001" }];
        },
      };
    },
    createTxScope() {
      return this;
    },
    async recordAudit() {
      throw new Error("audit failed");
    },
    async withTransaction(fn) {
      try {
        const result = await fn({ query: async () => ({ rows: [] }) });
        committed = true;
        return result;
      } catch (error) {
        committed = false;
        throw error;
      }
    },
    invalidateCachedDataset() {},
  };

  await assert.rejects(
    () =>
      recordResidualReplace(
        repository,
        "exam",
        "CD-2026-0001",
        [{ id: "EX-1", title: "Contrôle" }],
        { schoolCode: "CD-2026-0001" },
        { userId: "USER-1" },
      ),
    /audit failed/,
  );
  assert.equal(committed, false);
});
