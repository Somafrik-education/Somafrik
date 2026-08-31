"use strict";

/**
 * Gate revalidation tenant — Finance + Enrollment + Academic Year + Users.
 * Evidence/test-first : les domaines déjà canoniques doivent rester verts.
 * Enrollment : sonde dual-identity ; ENR-01…ENR-06 sont caractérisés
 * (dette leftover encore présente). Pas de mega-fix runtime dans ce lot.
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
  const server = read("backend/server.js");
  const lookup = read("backend/db/postgresRepository.js");
  const httpAy = read("backend/lib/academicYearTenant.http.pg.test.js");
  const httpUsers = read("backend/lib/usersTenant.http.pg.test.js");
  const httpEnroll = read("backend/lib/enrollmentTenant.http.pg.test.js");
  const financePg = read("backend/lib/financeMembershipScope.pg.test.js");

  assert.match(finance, /principal\.sub → users\.id → users\.school_id/);
  assert.match(ay, /principal\.sub → users\.id → users\.school_id/);
  assert.match(users, /principal\.sub → users\.id → users\.school_id/);

  assert.doesNotMatch(finance, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(ay, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(users, /COALESCE\(login_code,\s*school_code\)/i);

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

  assert.match(httpAy, /CD-LAC-26-001/);
  assert.match(httpAy, /BI-BUJ-26-001/);
  assert.match(httpUsers, /CD-LAC-26-001/);
  assert.match(httpUsers, /BI-BUJ-26-001/);
  assert.match(httpEnroll, /CD-LAC-26-001/);
  assert.match(httpEnroll, /BI-BUJ-26-001/);
  assert.match(financePg, /CD-LAC-26-001/);
  assert.match(financePg, /CD-2026-0001/);

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
  run(
    process.execPath,
    ["--test", "backend/lib/financeSchoolScope.test.js"],
    "revalidation Finance unit a échoué",
  );

  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-tenant-revalidation: SKIP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-tenant-revalidation (source + unit + AY/Users/Finance unit)");
    return;
  }

  run(
    process.execPath,
    ["backend/lib/financeMembershipScope.pg.test.js"],
    "revalidation Finance membership PG a échoué",
  );

  run(
    process.execPath,
    ["backend/lib/enrollmentTenant.http.pg.test.js"],
    "sonde Enrollment dual-identity (caractérisation dette leftover)",
  );
  console.log(
    "FINDING Enrollment: leftover JWT / getSchoolByCode OR COALESCE encore autorité — verrouillé en caractérisation. Correctif étroit dédié requis — pas de mega-fix dans ce lot.",
  );
  console.log("OK verify-tenant-revalidation");
}

main();
