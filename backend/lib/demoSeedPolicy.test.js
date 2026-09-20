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

test("le seed démo réutilise l'email parent sur l'élève Jean Dupont du même établissement", () => {
  const parent = seedData.userAccounts.find((user) => user.id === "USER-PARENT1");
  const student = seedData.students.find((item) => item.matricule === "CD-IN-EL-26-001");
  assert.ok(parent, "USER-PARENT1 doit exister");
  assert.ok(student, "CD-IN-EL-26-001 doit exister");
  assert.equal(parent.schoolCode, student.schoolCode);
  assert.equal(parent.schoolCode, "CD-2026-0001");
  assert.equal(String(parent.email).trim().toLowerCase(), "parent.dupont@example.com");
  assert.equal(String(student.parentEmail).trim().toLowerCase(), "parent.dupont@example.com");
  assert.notEqual(parent.publicId, student.matricule);
});

test("Marie Martin partage le téléphone du parent démo (collision téléphone si recopié sur users)", () => {
  const parent = seedData.userAccounts.find((user) => user.id === "USER-PARENT1");
  const student = seedData.students.find((item) => item.matricule === "CD-IN-EL-26-002");
  assert.equal(parent.phone, student.parentPhone);
  assert.notEqual(String(parent.email).trim().toLowerCase(), String(student.parentEmail).trim().toLowerCase());
});
