"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { previewClassCardBatch } = require("../lib/studentCardBatchPreflight");

test("précontrôle : refuse le mode plateforme avant toute requête", async () => {
  let queried = false;
  const repo = { query: async () => { queried = true; throw new Error("unexpected query"); } };
  await assert.rejects(previewClassCardBatch(repo, { schoolId: "school-a", mode: "platform" }, "P1"), (e) =>
    e.code === "STUDENT_CARD_TENANT_DENIED" && e.statusCode === 403);
  assert.equal(queried, false);
});

test("précontrôle : refuse classe absente ou code trop long avant requête", async () => {
  let calls = 0;
  const repo = { query: async () => { calls++; } };
  const scope = { schoolId: "school-a", mode: "school" };
  for (const code of ["", " ".repeat(3), "X".repeat(129)]) {
    await assert.rejects(previewClassCardBatch(repo, scope, code), (e) => e.code === "STUDENT_CARD_CLASS_INVALID");
  }
  assert.equal(calls, 0);
});

test("précontrôle : refuse une connexion PostgreSQL absente", async () => {
  await assert.rejects(previewClassCardBatch({}, { schoolId: "school-a", mode: "school" }, "P1"), /PostgreSQL requis/);
});

test("SQL du précontrôle : séparation de classe/établissement, sans écriture", async () => {
  // Test de contrat SQL isolé ; ne remplace pas le smoke PostgreSQL réel.
  const pgCalls = [];
  const repo = {
    query: async (sql, params) => {
      pgCalls.push({ sql, params });
      if (/FROM classes\s/i.test(sql)) return { rows: [{ id: "class-1", name: "Primaire 1", class_code: "P1" }] };
      if (/FROM enrollments e/i.test(sql)) return { rows: [] };
      throw new Error("Requête inattendue");
    },
  };
  const management = require("../lib/studentAccessCardsManagement");
  const original = management.assertStudentCardMasterEnabled;
  management.assertStudentCardMasterEnabled = async () => undefined;
  const modulePath = require.resolve("../lib/studentCardBatchPreflight");
  const cached = require.cache[modulePath];
  try {
    delete require.cache[modulePath];
    const { previewClassCardBatch: fresh } = require("../lib/studentCardBatchPreflight");
    const result = await fresh(repo, { mode: "school", schoolId: "school-a" }, "P1");
    assert.deepEqual(result.counts, { issueCandidates: 0, alreadyActive: 0, ineligible: 0 });
    assert.equal(pgCalls.length, 2);
    assert.deepEqual(pgCalls[0].params, ["school-a", "P1"]);
    assert.deepEqual(pgCalls[1].params, ["school-a", "class-1"]);
    assert.match(pgCalls[0].sql, /school_id = \$1/);
    assert.match(pgCalls[1].sql, /y\.is_current IS TRUE/);
    assert.match(pgCalls[1].sql, /e\.school_id = \$1/);
    assert.ok(pgCalls.every((x) => /^\s*SELECT\b/i.test(x.sql)));
  } finally {
    management.assertStudentCardMasterEnabled = original;
    delete require.cache[modulePath];
    if (cached) require.cache[modulePath] = cached;
  }
});
