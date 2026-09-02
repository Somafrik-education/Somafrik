"use strict";

/**
 * Gate revalidation tenant — Finance + Enrollment + Academic Year + Users.
 * Après merge #432, les quatre domaines sont canoniques (invariants).
 * Enrollment : ENR-01…ENR-07, plus de caractérisation de dette leftover.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label, { allowFail = false } = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!allowFail) {
    assert.equal(result.status, 0, label);
  }
  return result.status ?? 1;
}

function sourceGuards() {
  const finance = read("backend/lib/financeSchoolScope.js");
  const ay = read("backend/lib/academicYearSchoolScope.js");
  const users = read("backend/lib/usersSchoolScope.js");
  const enrollment = read("backend/lib/enrollmentSchoolScope.js");
  const server = read("backend/server.js");
  const lookup = read("backend/db/postgresRepository.js");
  const httpAy = read("backend/lib/academicYearTenant.http.pg.test.js");
  const httpUsers = read("backend/lib/usersTenant.http.pg.test.js");
  const httpEnroll = read("backend/lib/enrollmentTenant.http.pg.test.js");
  const financePg = read("backend/lib/financeMembershipScope.pg.test.js");
  const findings = read("backend/lib/tenantRevalidation.findings.md");

  assert.match(finance, /principal\.sub → users\.id → users\.school_id/);
  assert.match(ay, /principal\.sub → users\.id → users\.school_id/);
  assert.match(users, /principal\.sub → users\.id → users\.school_id/);
  assert.match(enrollment, /principal\.sub → users\.id → users\.school_id/);

  assert.doesNotMatch(finance, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(ay, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(users, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(enrollment, /COALESCE\(login_code,\s*school_code\)/i);

  const usersGet = server.slice(
    server.indexOf('app.get("/api/backoffice/users"'),
    server.indexOf('app.get("/api/backoffice/users/assignable-roles"'),
  );
  assert.match(usersGet, /usersHttpPrincipal/);
  assert.doesNotMatch(usersGet, /req\.principal\.schoolCode/);

  const ayGet = server.slice(
    server.indexOf('app.get("/api/v2/academic-years"'),
    server.indexOf('app.post("/api/v2/academic-years"'),
  );
  assert.match(ayGet, /academicYearHttpPrincipal/);

  const getStudents = server.slice(
    server.indexOf('app.get("/api/students"'),
    server.indexOf('app.get("/api/students/:id"'),
  );
  assert.match(getStudents, /enrollmentHttpPrincipal/);
  assert.doesNotMatch(getStudents, /req\.principal\?\.schoolCode/);

  assert.match(httpAy, /CD-LAC-26-001/);
  assert.match(httpAy, /BI-BUJ-26-001/);
  assert.match(httpUsers, /CD-LAC-26-001/);
  assert.match(httpUsers, /BI-BUJ-26-001/);
  assert.match(httpEnroll, /CD-LAC-26-001/);
  assert.match(httpEnroll, /BI-BUJ-26-001/);
  assert.match(httpEnroll, /ENR-07/);
  assert.match(httpEnroll, /sont des invariants/);
  assert.match(financePg, /CD-LAC-26-001/);
  assert.match(financePg, /CD-2026-0001/);

  assert.match(findings, /fermé par #432/);
  assert.match(findings, /ENR-07/);
  assert.doesNotMatch(findings, /dette encore présente/);

  const getSchool = lookup.slice(lookup.indexOf("getSchoolByCode(code)"), lookup.indexOf("getSchoolsRepository()"));
  assert.match(getSchool, /OR upper\(coalesce\(login_code/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/tenantRevalidation.guard.test.js"],
    "garde-fou revalidation tenant a échoué",
  );

  run(process.execPath, ["backend/scripts/verify-academic-year-tenant.js"], "revalidation Academic Year a échoué");
  run(process.execPath, ["backend/scripts/verify-users-tenant.js"], "revalidation Users a échoué");
  run(process.execPath, ["backend/scripts/verify-enrollment-tenant.js"], "revalidation Enrollment a échoué");
  run(
    process.execPath,
    ["--test", "backend/lib/financeSchoolScope.test.js"],
    "revalidation Finance unit a échoué",
  );

  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-tenant-revalidation: SKIP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-tenant-revalidation (source + unit + AY/Users/Enrollment/Finance unit)");
    return;
  }

  run(
    process.execPath,
    ["backend/lib/financeMembershipScope.pg.test.js"],
    "revalidation Finance membership PG a échoué",
  );

  console.log("OK verify-tenant-revalidation — Finance / Enrollment / AY / Users canoniques");
}

main();
