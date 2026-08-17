"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const countryYear = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260825_school_login_code_country_year.sql"),
  "utf8",
);
const backfill = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260825_school_login_code_seq_backfill.sql"),
  "utf8",
);
const boot = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
const webSchoolModule = fs.readFileSync(
  path.join(__dirname, "../../web/src/lib/schoolModule.ts"),
  "utf8",
);
const mobileAdmin = fs.readFileSync(
  path.join(__dirname, "../../Mobile/src/screens/AdminCrudScreen.tsx"),
  "utf8",
);

assert.match(countryYear, /ON CONFLICT \(country_id, creation_year\)/);
assert.match(countryYear, /somafrik_prepare_school_login_code/);
assert.doesNotMatch(
  countryYear,
  /INSERT INTO school_login_code_counters \(\s*country_id,\s*school_initials/s,
);
assert.doesNotMatch(countryYear, /SET login_code\s*=/);
assert.match(countryYear, /school_login_code_sequence_audit/);

assert.match(backfill, /APPLY_CTO_APPROVED/);
assert.match(backfill, /SCHOOL_LOGIN_SEQ_BACKFILL_DRY_RUN/);
assert.match(backfill, /DISABLE TRIGGER USER/);

assert.match(boot, /20260825_school_login_code_country_year\.sql/);
assert.doesNotMatch(boot, /readFileSync\([^)]*20260825_school_login_code_seq_backfill/);

assert.match(webSchoolModule, /return "";/);
assert.match(mobileAdmin, /\$\{countryCode\}-\$\{year\}-\$\{String\(next\)\.padStart\(4, "0"\)\}/);
assert.doesNotMatch(mobileAdmin, /login_code_counters/);

console.log("schoolLoginCodeSchema.guard.test.js: OK");
