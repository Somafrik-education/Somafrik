"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recordResidualReplace } = require("./residualStateManagement");

test("recordResidualReplace interdit toute écriture exam/bulletin/document", async () => {
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
    () => recordResidualReplace(repository, "exam", "CD-2026-0001", [], { schoolCode: "CD-2026-0001" }, {}),
    (error) => error.code === "LEGACY_EXAMS_WRITE_FORBIDDEN" && error.statusCode === 400,
  );
  await assert.rejects(
    () => recordResidualReplace(repository, "bulletin", "CD-2026-0001", [], { schoolCode: "CD-2026-0001" }, {}),
    (error) => error.code === "LEGACY_REPORT_CARDS_WRITE_FORBIDDEN",
  );
  await assert.rejects(
    () => recordResidualReplace(repository, "document", "CD-2026-0001", [], { schoolCode: "CD-2026-0001" }, {}),
    (error) => error.code === "LEGACY_DOCUMENTS_WRITE_FORBIDDEN",
  );
  assert.equal(mutated, false);
});

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
    (error) => error.code === "LEGACY_EXAMS_WRITE_FORBIDDEN" && error.statusCode === 400,
  );
  assert.equal(committed, false);
});
