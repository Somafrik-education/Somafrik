"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schema = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
  "utf8",
);
const backfill = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260824_student_canonical_identifier_backfill.sql"),
  "utf8",
);
const boot = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");

assert.doesNotMatch(schema, /student_code_remap/);
assert.doesNotMatch(schema, /VALIDATE CONSTRAINT/);
assert.match(schema, /NOT VALID/);
assert.match(schema, /somafrik_assign_permanent_student_identity/);

assert.match(backfill, /student_code_remap/);
assert.match(backfill, /VALIDATE CONSTRAINT students_canonical_identifier_format_check/);
assert.match(backfill, /STUDENT_CANONICAL_BACKFILL_INCOMPLETE/);
assert.match(backfill, /STUDENT_SEQUENCE_EXHAUSTED/);

assert.match(boot, /20260823_student_canonical_identifier\.sql/);
assert.doesNotMatch(boot, /readFileSync\([^)]*20260824_student_canonical_identifier_backfill/);

console.log("studentCanonicalSchema.guard.test.js: OK");
