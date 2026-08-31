"use strict";

/**
 * Gate GP-002 — Academic Year tenant canonical.
 * Garde source + tests unitaires + parcours HTTP PostgreSQL dual-identity.
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
  const server = read("backend/server.js");
  const repo = read("backend/db/postgresRepository.js");
  const scopeLib = read("backend/lib/academicYearSchoolScope.js");
  const httpTest = read("backend/lib/academicYearTenant.http.pg.test.js");

  const getBlock = server.slice(
    server.indexOf('app.get("/api/v2/academic-years"'),
    server.indexOf('app.post("/api/v2/academic-years"'),
  );
  const postBlock = server.slice(
    server.indexOf('app.post("/api/v2/academic-years"'),
    server.indexOf('app.patch("/api/v2/academic-years/:id"'),
  );
  const patchBlock = server.slice(
    server.indexOf('app.patch("/api/v2/academic-years/:id"'),
    server.indexOf('app.get("/api/v2/exams"'),
  );

  assert.match(getBlock, /academicYearHttpPrincipal/);
  assert.match(getBlock, /getAcademicYearsV2\(scope\)/);
  assert.doesNotMatch(getBlock, /tenantScopeService\.filterRows\(rows, req\.principal\)/);
  assert.doesNotMatch(postBlock, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);
  assert.doesNotMatch(postBlock, /req\.principal\.schoolCode/);
  assert.match(postBlock, /resolveAcademicYearWriteSchool/);
  assert.match(patchBlock, /assertAcademicYearPatchAccess/);
  assert.doesNotMatch(patchBlock, /assertSchoolAccess\(req\.principal, current\.schoolCode\)/);

  const mapFn = repo.slice(repo.indexOf("mapAcademicYearV2(row, extras = {})"), repo.indexOf("async getExamsV2"));
  assert.match(mapFn, /row\.login_code/);
  assert.doesNotMatch(mapFn, /row\.school_code/);
  assert.doesNotMatch(mapFn, /COALESCE/i);

  const getFn = repo.slice(repo.indexOf("async getAcademicYearsV2"), repo.indexOf("async createAcademicYearV2"));
  assert.match(getFn, /s\.login_code/);
  assert.doesNotMatch(getFn, /COALESCE/i);
  assert.doesNotMatch(getFn, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.doesNotMatch(
    scopeLib.slice(scopeLib.indexOf("function sqlAcademicYearScope"), scopeLib.indexOf("function filterAcademicYearRows")),
    /school_code/,
  );

  assert.match(httpTest, /CD-LAC-26-001/);
  assert.match(httpTest, /BI-BUJ-26-001/);
  assert.match(httpTest, /P0-1 GET A/);
  assert.match(httpTest, /P0-11 cache ne fuit pas A vers B/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/academicYearSchoolScope.test.js", "backend/lib/academicYearTenant.guard.test.js"],
    "tests unitaires / garde-fou GP-002 ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-academic-year-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-academic-year-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/academicYearTenant.http.pg.test.js"], "parcours HTTP PostgreSQL GP-002 a échoué");
  console.log("OK verify-academic-year-tenant");
}

main();
