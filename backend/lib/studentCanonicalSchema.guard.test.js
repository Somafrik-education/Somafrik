"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const legacySchema = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
  "utf8",
);
const generalBoot = fs.readFileSync(
  path.join(__dirname, "../db/studentGeneralIdentityPg.js"),
  "utf8",
);
const generalBackfill = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260827_student_general_identity_backfill.sql"),
  "utf8",
);
const repositoryFactory = fs.readFileSync(path.join(__dirname, "../db/repositoryFactory.js"), "utf8");
const allocation = fs.readFileSync(path.join(__dirname, "./studentCodeAllocation.js"), "utf8");
const fallbackRepository = fs.readFileSync(path.join(__dirname, "../db/fallbackRepository.js"), "utf8");

// Historique conservé, jamais réécrit : la nouvelle règle vient après.
assert.match(legacySchema, /somafrik_assign_permanent_student_identity/);
assert.match(generalBoot, /student_general_code_counters/);
assert.match(generalBoot, /somafrik_student_person_initials/);
assert.match(generalBoot, /99999/);
assert.match(generalBoot, /\[A-Z0-9\]\{1,5\}.*\[0-9\]\{5\}/);
assert.doesNotMatch(generalBoot, /DELETE FROM students/i);

assert.match(generalBackfill, /student_general_identity_remap/);
assert.match(generalBackfill, /VALIDATE CONSTRAINT students_canonical_identifier_format_check/);
assert.match(generalBackfill, /UPDATE students/);
assert.match(generalBackfill, /UPDATE users/);
assert.doesNotMatch(generalBackfill, /DELETE FROM students/i);
assert.match(generalBackfill, /STUDENT_GENERAL_IDENTITY_SEQ_COLLISION/);

assert.match(repositoryFactory, /ensureStudentGeneralIdentityPg/);
assert.match(repositoryFactory, /ensureStudentLifecyclePgSchema/);

assert.doesNotMatch(allocation, /MEMORY_STUDENT_INITIALS/);
assert.doesNotMatch(allocation, /fallbackInitials/);
assert.doesNotMatch(allocation, /["']EL["']/);
assert.match(fallbackRepository, /firstName:\s*params\[2\]/);
assert.match(fallbackRepository, /lastName:\s*params\[3\]/);

console.log("studentCanonicalSchema.guard.test.js: OK");
