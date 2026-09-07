"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const { isStudentDemoAccount, shouldSeedDemoData } = require("./demoSeedPolicy");

test("isStudentDemoAccount reconnaît le compte démo Élève avant toute ligne students", () => {
  const student = seedData.userAccounts.find((user) => user.id === "USER-STUDENT-0001");
  assert.ok(student, "le seed démo doit exposer USER-STUDENT-0001");
  assert.equal(student.role, "Élève / Étudiant");
  assert.equal(isStudentDemoAccount(student), true);
  assert.equal(isStudentDemoAccount({ role: "STUDENT" }), true);
  assert.equal(isStudentDemoAccount({ role: "ELEVE / ETUDIANT" }), true);
});

test("isStudentDemoAccount ne classe pas les comptes établissement comme élèves", () => {
  assert.equal(isStudentDemoAccount({ role: "Admin School" }), false);
  assert.equal(isStudentDemoAccount({ role: "Enseignant" }), false);
  assert.equal(isStudentDemoAccount({ role: "Parent" }), false);
  assert.equal(isStudentDemoAccount({}), false);
});

test("shouldSeedDemoData reste coupé quand SOMAFRIK_SKIP_DEMO_SEED=true", () => {
  assert.equal(shouldSeedDemoData({ SOMAFRIK_SKIP_DEMO_SEED: "true", NODE_ENV: "test" }), false);
});
