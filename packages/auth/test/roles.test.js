import assert from "node:assert/strict";
import test from "node:test";

import { CANONICAL_ROLES, isCanonicalRole } from "../src/index.js";

test("exposes the exact immutable list of ten canonical roles", () => {
  assert.deepEqual(CANONICAL_ROLES, [
    "super_admin",
    "country_admin",
    "school_admin",
    "principal",
    "prefet",
    "secretary",
    "accountant",
    "teacher",
    "parent",
    "student",
  ]);
  assert.equal(Object.isFrozen(CANONICAL_ROLES), true);
  assert.throws(() => {
    CANONICAL_ROLES.push("legacy_admin");
  }, TypeError);
});

test("accepts only exact canonical role identifiers", () => {
  for (const role of CANONICAL_ROLES) {
    assert.equal(isCanonicalRole(role), true);
  }

  assert.equal(isCanonicalRole("Super Administrateur Somafrik"), false);
  assert.equal(isCanonicalRole("Super Administrateur OKAFRIK"), false);
  assert.equal(isCanonicalRole("Admin Pays"), false);
  assert.equal(isCanonicalRole("Admin School"), false);
  assert.equal(isCanonicalRole("Sécretaire"), false);
  assert.equal(isCanonicalRole("Secrétaire"), false);
  assert.equal(isCanonicalRole("Proviseur"), false);
  assert.equal(isCanonicalRole("Directeur"), false);
  assert.equal(isCanonicalRole("Directeur adjoint"), false);
  assert.equal(isCanonicalRole("parent_student"), false);
  assert.equal(isCanonicalRole("SUPER_ADMIN"), false);
  assert.equal(isCanonicalRole(""), false);
  assert.equal(isCanonicalRole(null), false);
  assert.equal(isCanonicalRole(undefined), false);
});
