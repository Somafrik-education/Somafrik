"use strict";

/**
 * Gate GP-015 — Présences canonical tenant.
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
  const scopeLib = read("backend/lib/presenceSchoolScope.js");
  const repo = read("backend/db/postgresRepository.js");
  const store = read("backend/db/pedagogyPgStore.js");
  const httpTest = read("backend/lib/presenceTenant.http.pg.test.js");

  const getBlock = server.slice(server.indexOf('app.get("/api/presences"'), server.indexOf('app.post("/api/notes"'));
  const postBlock = server.slice(
    server.indexOf('app.post("/api/presences"'),
    server.indexOf('app.get("/api/students/:id/report"'),
  );

  assert.match(getBlock, /presenceHttpPrincipal/);
  assert.match(getBlock, /assertPresenceReadable/);
  assert.match(getBlock, /presenceListStaysStudentScoped/);
  assert.doesNotMatch(getBlock, /studentIds\.size \? byStudents : scopedPresences/);

  const pedagogy = read("backend/lib/pedagogyService.js");
  const auditFn = pedagogy.slice(
    pedagogy.indexOf("async function upsertAttendanceBatch"),
    pedagogy.indexOf("module.exports"),
  );
  assert.match(auditFn, /presenceSchoolId/);
  assert.match(auditFn, /presenceLoginCode/);
  assert.doesNotMatch(auditFn, /schoolCode:\s*principal\?\.schoolCode/);
  assert.match(postBlock, /presenceHttpPrincipal/);
  assert.match(postBlock, /assertPresenceReadable/);

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  const sqlFn = scopeLib.slice(scopeLib.indexOf("function sqlPresenceScope"), scopeLib.indexOf("function filterPresenceRows"));
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);

  const mapStart = repo.indexOf("mapAttendance(attendance) {");
  const mapFn = repo.slice(mapStart, repo.indexOf("mapPayment(payment)", mapStart));
  assert.match(mapFn, /login_code/);
  assert.doesNotMatch(mapFn, /attendance\.school_code/);
  assert.doesNotMatch(mapFn, /login_code\s*\|\|/);
  assert.match(store, /s\.login_code/);

  assert.match(httpTest, /CD-LAC-26-001/);
  assert.match(httpTest, /BI-BUJ-26-001/);
  assert.match(httpTest, /PR-01/);
  assert.match(httpTest, /PR-02/);
  assert.match(httpTest, /PR-06/);
  assert.match(httpTest, /PR-07/);
  assert.match(httpTest, /PR-08/);
  assert.match(httpTest, /PR-04/);
  assert.match(httpTest, /PR-05/);
  assert.match(httpTest, /PR-audit/);
  assert.match(httpTest, /PR-scope-teacher/);
  assert.match(httpTest, /PR-scope-parent/);
  assert.match(httpTest, /ALTER COLUMN login_code DROP NOT NULL/);

  const resolveStart = repo.indexOf("async resolveStudentForAttendance");
  const resolveFn = repo.slice(resolveStart, repo.indexOf("async teacherCanAccessClassFromBackOffice", resolveStart));
  assert.match(resolveFn, /presenceSchoolId/);
  assert.doesNotMatch(resolveFn, /presenceLoginCode \?\? payload\.schoolCode/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/presenceSchoolScope.test.js", "backend/lib/presenceTenant.guard.test.js"],
    "tests unitaires / garde-fou GP-015 ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-presence-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-presence-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/presenceTenant.http.pg.test.js"], "parcours HTTP PostgreSQL GP-015 a échoué");
  console.log("OK verify-presence-tenant");
}

main();
