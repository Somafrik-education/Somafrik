"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const { isStudentDemoAccount, resolveStudentDemoLoginIdentity, shouldSeedDemoData } = require("./demoSeedPolicy");

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

test("resolveStudentDemoLoginIdentity n'emprunte pas le contact parent", () => {
  const parent = seedData.userAccounts.find((user) => user.id === "USER-PARENT1");
  const jean = seedData.students.find((item) => item.matricule === "CD-IN-EL-26-001");
  const marie = seedData.students.find((item) => item.matricule === "CD-IN-EL-26-002");
  const jeanLogin = resolveStudentDemoLoginIdentity(jean, seedData.userAccounts);
  const marieLogin = resolveStudentDemoLoginIdentity(marie, seedData.userAccounts);
  assert.equal(jeanLogin.email, "jean.dupont@example.com");
  assert.equal(jeanLogin.phone, "");
  assert.notEqual(jeanLogin.email.toLowerCase(), String(parent.email).trim().toLowerCase());
  assert.equal(marieLogin.email, "");
  assert.equal(marieLogin.phone, "");
});

test("les écritures users du seed démo restent uniques par établissement+email", () => {
  const planned = [];
  for (const user of seedData.userAccounts) {
    if (isStudentDemoAccount(user)) continue;
    const email = String(user.email ?? "").trim().toLowerCase();
    if (!email) continue;
    planned.push({
      school: user.schoolCode === "*" ? null : user.schoolCode,
      email,
      source: user.publicId,
    });
  }
  for (const student of seedData.students) {
    const login = resolveStudentDemoLoginIdentity(student, seedData.userAccounts);
    const email = String(login.email ?? "").trim().toLowerCase();
    if (!email) continue;
    planned.push({
      school: student.schoolCode,
      email,
      source: student.matricule,
    });
  }
  const groups = new Map();
  for (const row of planned) {
    const key = `${row.school ?? "platform"}::${row.email}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row.source);
    groups.set(key, bucket);
  }
  const duplicates = [...groups.entries()].filter(([, sources]) => sources.length > 1);
  assert.deepEqual(duplicates, [], "aucune collision school+email dans le seed prévu");
});
