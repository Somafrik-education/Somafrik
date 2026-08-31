"use strict";

/**
 * Gate revalidation Planning / Présences / Sync E2E (#427).
 * Evidence/test-first. Échoue sur fuite cross-tenant, mutation étrangère,
 * autorité client/JWT, absence de fail-closed, ou succès masquant une erreur.
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
  return result.status ?? 1;
}

function sourceGuards() {
  const http = read("backend/lib/planningPresenceSyncRevalidation.http.pg.test.js");
  const findings = read("backend/lib/planningPresenceSyncRevalidation.findings.md");
  const pedagogy = read("backend/lib/pedagogyService.js");
  const server = read("backend/server.js");
  const pgStore = read("backend/db/pedagogyPgStore.js");

  assert.match(http, /CD-LAC-26-001/);
  assert.match(http, /BI-BUJ-26-001/);
  assert.match(http, /CD-LAC-26-002/);
  assert.match(http, /PL-02 JWT leftover B/);
  assert.match(http, /PR-05 JWT leftover B/);
  assert.match(http, /SY-06/);
  assert.match(http, /0 write B/);

  assert.match(findings, /GP-014/);
  assert.match(findings, /GP-015/);
  assert.match(findings, /GP-020/);
  assert.doesNotMatch(findings, /dette encore présente masquée en GO/);

  assert.doesNotMatch(pedagogy, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(pgStore, /COALESCE\(login_code,\s*school_code\)/i);

  const getSchedules = server.slice(
    server.indexOf('app.get("/api/course-schedules"'),
    server.indexOf('app.post("/api/courses"'),
  );
  const postSchedules = server.slice(
    server.indexOf('app.post("/api/course-schedules"'),
    server.indexOf('app.patch("/api/course-schedules/:scheduleId"'),
  );
  const getPresences = server.slice(
    server.indexOf('app.get("/api/presences"'),
    server.indexOf('app.post("/api/notes"'),
  );
  const postPresences = server.slice(
    server.indexOf('app.post("/api/presences"'),
    server.indexOf('app.get("/api/students/:id/report"'),
  );
  const syncClasses = server.slice(
    server.indexOf('"/api/mobile-sync/l1/classes"'),
    server.indexOf('"/api/mobile-sync/l1/students"'),
  );

  for (const block of [getSchedules, postSchedules, getPresences, postPresences, syncClasses]) {
    assert.doesNotMatch(block, /COALESCE\(login_code,\s*school_code\)/i);
    assert.doesNotMatch(block, /login_code\s*=\s*.*\sOR\s+.*school_code/i);
  }
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/planningPresenceSyncRevalidation.guard.test.js"],
    "garde-fou revalidation Planning/Présences/Sync a échoué",
  );

  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-planning-presence-sync-revalidation: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-planning-presence-sync-revalidation (source + unit)");
    return;
  }

  run(
    process.execPath,
    ["backend/lib/planningPresenceSyncRevalidation.http.pg.test.js"],
    "parcours HTTP PostgreSQL Planning/Présences/Sync a échoué — fuite, mutation étrangère, autorité JWT/client ou fail-closed manquant",
  );
  console.log("OK verify-planning-presence-sync-revalidation — Planning / Présences / Sync E2E");
}

main();
