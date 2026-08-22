"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const {
  attachDemoStudentSeedOrder,
  isStudentSeedUser,
} = require("./demoSeedStudentOrder");

test("student demo users are deferred during seedReferenceData then restored", async () => {
  const originalAccounts = seedData.userAccounts.slice();
  assert.ok(originalAccounts.some(isStudentSeedUser), "fixture must contain at least one student account");

  let seenRoles = [];
  const repository = {
    async seedReferenceData() {
      seenRoles = seedData.userAccounts.map((user) => user.role);
      return { ok: true };
    },
  };

  attachDemoStudentSeedOrder(repository);
  const result = await repository.seedReferenceData({});

  assert.deepEqual(result, { ok: true });
  assert.equal(seenRoles.some((role) => isStudentSeedUser({ role })), false);
  assert.deepEqual(seedData.userAccounts, originalAccounts);
});

test("student demo users are restored even when reference seed fails", async () => {
  const originalAccounts = seedData.userAccounts.slice();
  const repository = {
    async seedReferenceData() {
      assert.equal(seedData.userAccounts.some(isStudentSeedUser), false);
      throw new Error("reference seed failed");
    },
  };

  attachDemoStudentSeedOrder(repository);
  await assert.rejects(() => repository.seedReferenceData({}), /reference seed failed/);
  assert.deepEqual(seedData.userAccounts, originalAccounts);
});

test("student role detection accepts canonical and accented labels", () => {
  assert.equal(isStudentSeedUser({ role: "STUDENT" }), true);
  assert.equal(isStudentSeedUser({ role: "Élève / Étudiant" }), true);
  assert.equal(isStudentSeedUser({ role: "ELEVE / ETUDIANT" }), true);
  assert.equal(isStudentSeedUser({ role: "Parent" }), false);
});
