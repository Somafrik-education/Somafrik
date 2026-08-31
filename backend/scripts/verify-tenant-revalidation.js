"use strict";

/**
 * Gate de revalidation tenant P0 — Finance + Enrollment + Academic Year + Users.
 * Evidence/test-first. Aucun runtime métier modifié par ce script.
 *
 * Fixture dual-identity attendue dans les parcours HTTP existants :
 *   A: school_code=CD-2026-0001, login_code=CD-LAC-26-001
 *   B: school_code=BI-2026-0001, login_code=BI-BUJ-26-001
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
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: process.env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const users = read("backend/lib/usersSchoolScope.js");
  const ay = read("backend/lib/academicYearSchoolScope.js");
  const finance = read("backend/lib/financeSchoolScope.js");
  const server = read("backend/server.js");
  const usersHttp = read("backend/lib/usersTenant.http.pg.test.js");
  const ayHttp = read("backend/lib/academicYearTenant.http.pg.test.js");
  const financePg = read("backend/lib/financeMembershipScope.pg.test.js");

  for (const [label, src] of [
    ["Users", users],
    ["Academic Year", ay],
    ["Finance", finance],
  ]) {
    assert.match(src, /principal\.sub → users/, `${label}: contrat membership documenté`);
    assert.doesNotMatch(
      src.slice(0, src.indexOf("module.exports")),
      /COALESCE\s*\(\s*nullif\(btrim\(s\.login_code\)/i,
      `${label}: pas de COALESCE leftover dans le module`,
    );
  }

  assert.match(usersHttp, /CD-LAC-26-001/);
  assert.match(usersHttp, /BI-BUJ-26-001/);
  assert.match(usersHttp, /schoolId: fixture.schoolAId/);
  assert.match(usersHttp, /USER_PAYS_BI/);
  assert.match(ayHttp, /CD-LAC-26-001/);
  assert.match(ayHttp, /BI-BUJ-26-001/);
  assert.match(ayHttp, /P0-1 GET A/);
  assert.match(financePg, /CD-LAC-26-001/);
  assert.match(financePg, /CD-2026-0001/);
  assert.match(financePg, /BI-2026-0001/);

  const enrollGet = server.slice(
    server.indexOf('app.get("/api/classes/:classCode/students"'),
    server.indexOf('app.post("/api/classes/:classCode/students"'),
  );
  assert.match(enrollGet, /req\.principal\?\.schoolCode/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/tenantRevalidation.guard.test.js"],
    "garde-fous de revalidation tenant ont échoué",
  );
  run(process.execPath, ["backend/scripts/verify-academic-year-tenant.js"], "verify:academic-year-tenant a échoué");
  run(process.execPath, ["backend/scripts/verify-users-tenant.js"], "verify:users-tenant a échoué");
  run(
    process.execPath,
    ["--test", "backend/lib/financeSchoolScope.test.js"],
    "tests unitaires Finance school scope ont échoué",
  );
  if (String(process.env.DATABASE_URL ?? "").trim()) {
    run(
      process.execPath,
      ["backend/lib/financeMembershipScope.pg.test.js"],
      "preuve Finance leftover ≠ login_code a échoué",
    );
  } else {
    console.log("verify-tenant-revalidation: SKIP Finance PG (DATABASE_URL absent)");
  }
  console.log("FINDING Enrollment: leftover JWT encore autorité HTTP class-students — correctif dédié, pas ce lot.");
  console.log("OK verify-tenant-revalidation");
}

main();
