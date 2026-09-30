"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { BusinessError } = require("../services/authService");
const {
  principalHasClassAccess,
  scopeClassStudentsForPrincipal,
  scopeSchoolStudentsForPrincipal,
  scopeSchoolClassesForPrincipal,
} = require("./classStudentsAuthz");

const rows = [{ id: "STU-1", classCode: "CLS-1" }];
const superadmin = { role: "Super Administrateur Somafrik", roleKey: "SUPER_ADMIN" };
const unknown = { role: "Role Inconnu" };

function expect403(fn) {
  assert.throws(fn, (error) => error instanceof BusinessError && error.statusCode === 403);
}

test("P0-03 principal absent est fail-closed", () => {
  assert.equal(principalHasClassAccess(null, "Classe A"), false);
  expect403(() => scopeClassStudentsForPrincipal(null, { classCode: "CLS-1" }, rows, () => undefined));
  expect403(() => scopeSchoolStudentsForPrincipal(null, rows, () => undefined));
  expect403(() => scopeSchoolClassesForPrincipal(null, rows));
});

test("P0-03 SUPER_ADMIN n'obtient aucun accès scolaire global", () => {
  assert.equal(principalHasClassAccess(superadmin, "Classe A"), false);
  expect403(() => scopeClassStudentsForPrincipal(superadmin, { classCode: "CLS-1" }, rows, () => undefined));
  expect403(() => scopeSchoolStudentsForPrincipal(superadmin, rows, () => undefined));
  expect403(() => scopeSchoolClassesForPrincipal(superadmin, rows));
});

test("P0-03 rôle inconnu est fail-closed", () => {
  assert.equal(principalHasClassAccess(unknown, "Classe A"), false);
  expect403(() => scopeClassStudentsForPrincipal(unknown, { classCode: "CLS-1" }, rows, () => undefined));
  expect403(() => scopeSchoolStudentsForPrincipal(unknown, rows, () => undefined));
  expect403(() => scopeSchoolClassesForPrincipal(unknown, rows));
});

test("P0-03 rôle scolaire explicitement autorisé reste ouvert dans son tenant", () => {
  const admin = { role: "Admin School" };
  assert.equal(principalHasClassAccess(admin, "Classe A"), true);
  assert.deepEqual(scopeClassStudentsForPrincipal(admin, { classCode: "CLS-1" }, rows, () => undefined), rows);
  assert.deepEqual(scopeSchoolStudentsForPrincipal(admin, rows, () => undefined), rows);
  assert.deepEqual(scopeSchoolClassesForPrincipal(admin, rows), rows);
});
