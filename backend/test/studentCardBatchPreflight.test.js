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
