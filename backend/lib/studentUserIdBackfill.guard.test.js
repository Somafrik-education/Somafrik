"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const migration07 = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260907_student_user_id.sql"),
  "utf8",
);
const migration23 = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
  "utf8",
);
const userRolesSchemaSource = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
const { STUDENT_GENERAL_IDENTITY_SQL } = require("../db/studentGeneralIdentityPg");

test("20260823 ne remplace plus une CHECK existante par le format EL-only", () => {
  assert.doesNotMatch(migration23, /DROP CONSTRAINT students_canonical_identifier_format_check/);
  assert.match(migration23, /IF NOT EXISTS/);
  assert.match(migration23, /students_canonical_identifier_format_check/);
});

test("20260907 ne touche pas la CHECK et n'écrit pas l'identité", () => {
  assert.doesNotMatch(migration07, /DROP CONSTRAINT/i);
  assert.doesNotMatch(migration07, /VALIDATE CONSTRAINT/i);
  assert.doesNotMatch(migration07, /DISABLE TRIGGER/i);
  assert.doesNotMatch(migration07, /SET student_code/i);
  assert.doesNotMatch(migration07, /SET identity_code/i);
  assert.doesNotMatch(migration07, /SET login_code/i);
});

test("20260907 dérive le fail-safe de la CHECK réelle (check_violation), sans regex dupliquée", () => {
  assert.match(migration07, /check_violation/);
  assert.match(migration07, /EXCEPTION/);
  assert.doesNotMatch(migration07, /student_code ~ '\^\[A-Z\]/);
});

test("userRolesSchema charge 20260823 avant 20260907", () => {
  const idx23 = userRolesSchemaSource.indexOf("20260823_student_canonical_identifier.sql");
  const idx07 = userRolesSchemaSource.indexOf("20260907_student_user_id.sql");
  assert.ok(idx23 >= 0 && idx07 > idx23, "ordre migrations 20260823 puis 20260907 requis");
});

test("la CHECK runtime exacte (SEQ5 | EL) est celle de studentGeneralIdentityPg", () => {
  assert.match(
    STUDENT_GENERAL_IDENTITY_SQL,
    /student_code ~ '\^\[A-Z\]\{2\}-\[A-Z0-9\]\{2,5\}-\[A-Z0-9\]\{1,5\}-\[0-9\]\{2\}-\[0-9\]\{5\}\$'/,
  );
  assert.match(
    STUDENT_GENERAL_IDENTITY_SQL,
    /student_code ~ '\^\[A-Z\]\{2\}-\[A-Z0-9\]\{2,5\}-EL-\[0-9\]\{2\}-\[0-9\]\{3\}\$'/,
  );
  assert.match(STUDENT_GENERAL_IDENTITY_SQL, /login_code IS NOT DISTINCT FROM student_code/);
  assert.match(STUDENT_GENERAL_IDENTITY_SQL, /identity_code IS NOT DISTINCT FROM student_code/);
});
