"use strict";

/**
 * Gate GP-014 — Planning canonical tenant.
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
  const scopeLib = read("backend/lib/planningSchoolScope.js");
  const store = read("backend/db/pedagogyPgStore.js");
  const dto = read("backend/lib/planningWeekly.js");
  const httpTest = read("backend/lib/planningTenant.http.pg.test.js");

  const getBlock = server.slice(
    server.indexOf('app.get("/api/course-schedules"'),
    server.indexOf('app.post("/api/courses"'),
  );
  const postBlock = server.slice(
    server.indexOf('app.post("/api/course-schedules"'),
    server.indexOf('app.patch("/api/course-schedules/:scheduleId"'),
  );

  assert.match(getBlock, /planningHttpPrincipal/);
  assert.match(getBlock, /assertPlanningReadable/);
  assert.match(postBlock, /planningHttpPrincipal/);
  assert.match(postBlock, /assertPlanningReadable/);

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  const sqlFn = scopeLib.slice(scopeLib.indexOf("function sqlPlanningScope"), scopeLib.indexOf("function filterPlanningRows"));
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);

  assert.match(store, /s\.login_code/);
  assert.match(dto, /row\.login_code/);

  assert.match(httpTest, /CD-LAC-26-001/);
  assert.match(httpTest, /BI-BUJ-26-001/);
  assert.match(httpTest, /PL-02/);
  assert.match(httpTest, /PL-06/);
  assert.match(httpTest, /PL-08/);
  assert.match(httpTest, /PL-11/);
  assert.match(httpTest, /PL-14/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/planningSchoolScope.test.js", "backend/lib/planningTenant.guard.test.js"],
    "tests unitaires / garde-fou GP-014 ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-planning-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-planning-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/planningTenant.http.pg.test.js"], "parcours HTTP PostgreSQL GP-014 a échoué");
  console.log("OK verify-planning-tenant");
}

main();
