"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");

test("A5-R5 : dépôt mémoire délègue le PATCH uniquement au store financier", async () => {
  const repo = Object.create(FallbackRepository.prototype);
  let called = 0;
  repo.getFinanceStore = () => ({
    updateFinancePaymentStatus: async (code, patch, principal) => {
      called += 1;
      assert.equal(code, "TEST-A5");
      assert.deepEqual(patch, { label: "Réglé" });
      assert.deepEqual(principal, { schoolCode: "CD-2026-0001" });
      return { code, label: patch.label, status: "Inactif", sortOrder: 10 };
    },
  });
  const row = await repo.updateFinancePaymentStatus("TEST-A5", { label: "Réglé" }, { schoolCode: "CD-2026-0001" });
  assert.equal(called, 1);
  assert.deepEqual(row, { code: "TEST-A5", label: "Réglé", status: "Inactif", sortOrder: 10 });
});
