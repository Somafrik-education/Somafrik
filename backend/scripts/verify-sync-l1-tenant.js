"use strict";

/**
 * Gate GP-020 / SY-08 — Sync L1 fail-closed login_code vide.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  for (const file of [
    "backend/lib/mobileSyncClasses.js",
    "backend/lib/mobileSyncStudents.js",
    "backend/lib/mobileSyncAssignments.js",
    "backend/lib/mobileSyncSchoolCourses.js",
    "backend/lib/mobileSyncCourseSchedules.js",
  ]) {
    assert.match(read(file), /assertMobileSyncCanonicalLoginCode/, `${file} sans SY-08`);
  }
  const helper = read("backend/lib/mobileSyncSchoolScope.js");
  assert.doesNotMatch(helper, /COALESCE\(login_code,\s*school_code\)/i);
  const httpTest = read("backend/lib/mobileSyncTenant.http.pg.test.js");
  assert.match(httpTest, /SY-08/);
  assert.match(httpTest, /SY-06/);
  assert.match(httpTest, /ALTER COLUMN login_code DROP NOT NULL/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    [
      "--test",
      "backend/lib/mobileSyncSchoolScope.test.js",
      "backend/lib/mobileSyncTenant.guard.test.js",
      "backend/lib/mobileSyncClasses.test.js",
    ],
    "tests unitaires / garde-fou GP-020 SY-08 ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-sync-l1-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-sync-l1-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/mobileSyncTenant.http.pg.test.js"], "parcours HTTP PostgreSQL SY-08 a échoué");
  console.log("OK verify-sync-l1-tenant");
}

main();
