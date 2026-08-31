"use strict";

/**
 * Garde-fou revalidation Planning / Présences / Sync E2E.
 * Exige la matrice dual-identity et refuse un verdissement qui masquerait
 * leftover JWT / COALESCE comme autorité établissement.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function read(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 4000);
}

test("revalidation PPS: matrice HTTP dual-identity A/B leftover ≠ login_code", () => {
  const http = read("lib/planningPresenceSyncRevalidation.http.pg.test.js");
  assert.match(http, /CD-LAC-26-001/);
  assert.match(http, /CD-2026-0001/);
  assert.match(http, /BI-BUJ-26-001/);
  assert.match(http, /BI-2026-0001/);
  assert.match(http, /CD-LAC-26-002/);
  assert.match(http, /CD-2026-0002/);
  for (const id of [
    "PL-01",
    "PL-02",
    "PL-03",
    "PL-04",
    "PL-05",
    "PL-06",
    "PL-07",
    "PL-08",
    "PL-09",
    "PL-10",
    "PL-11",
    "PL-12",
    "PL-13",
    "PL-14",
    "PR-01",
    "PR-02",
    "PR-03",
    "PR-04",
    "PR-05",
    "PR-06",
    "PR-07",
    "PR-08",
    "PR-09",
    "PR-10",
    "PR-11",
    "SY-01",
    "SY-02",
    "SY-03",
    "SY-04",
    "SY-05",
    "SY-06",
    "SY-07",
    "SY-08",
    "SY-09",
    "SY-10",
  ]) {
    assert.match(http, new RegExp(id));
  }
  assert.match(http, /0 write B/);
  assert.match(http, /JWT leftover B depuis user A ne doit jamais lister B/);
  assert.doesNotMatch(http, /try\s*\{\s*assert\./);
});

test("revalidation PPS: findings classent les HOLD historiques sans masquer une fuite", () => {
  const findings = read("lib/planningPresenceSyncRevalidation.findings.md");
  assert.match(findings, /GP-014/);
  assert.match(findings, /GP-015/);
  assert.match(findings, /GP-020/);
  assert.match(findings, /\b(FERMÉ|HOLD|MANUAL BLOCKER|HORS_RELEASE)\b/);
  assert.doesNotMatch(findings, /statut succès masquant/);
  assert.doesNotMatch(findings, /dette encore présente masquée en GO/);
});

test("revalidation PPS: chemins testés n'utilisent pas COALESCE login_code/school_code comme autorité établissement", () => {
  const pedagogy = read("lib/pedagogyService.js");
  const resolve = sliceFrom(pedagogy, "async function resolveSchoolContext", "async function createCourse");
  const list = sliceFrom(pedagogy, "async function listCourseSchedules", "async function createEvaluation");
  assert.doesNotMatch(resolve, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(list, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(resolve, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  const pgStore = read("db/pedagogyPgStore.js");
  const getSchool = sliceFrom(pgStore, "async getSchoolByCode(code)", "async resolveActorUserId");
  assert.doesNotMatch(getSchool, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(getSchool, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  const server = read("server.js");
  const getPresences = sliceFrom(server, 'app.get("/api/presences"', 'app.post("/api/notes"');
  const postPresences = sliceFrom(server, 'app.post("/api/presences"', 'app.get("/api/students/:id/report"');
  assert.doesNotMatch(getPresences, /COALESCE\(login_code,\s*school_code\)/i);
  assert.doesNotMatch(postPresences, /COALESCE\(login_code,\s*school_code\)/i);

  const syncClasses = read("lib/mobileSyncClasses.js");
  const handle = sliceFrom(syncClasses, "async function handleMobileSyncL1Classes", "module.exports");
  assert.doesNotMatch(handle, /COALESCE\(login_code,\s*school_code\)/i);
});

test("revalidation PPS: verify ne traite pas un skip HTTP comme succès si DATABASE_URL est posé", () => {
  const verify = read("scripts/verify-planning-presence-sync-revalidation.js");
  assert.match(verify, /DATABASE_URL/);
  assert.match(verify, /planningPresenceSyncRevalidation\.http\.pg\.test\.js/);
  assert.doesNotMatch(verify, /allowFail:\s*true/);
});
