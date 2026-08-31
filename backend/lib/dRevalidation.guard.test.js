"use strict";

/**
 * Garde-fou lot D finale — Planning / Présences / Sync L1.
 * Échoue si leftover JWT / COALESCE login_code,school_code revient comme autorité,
 * si l'audit présence retombe sur principal.schoolCode, ou si GET Présences
 * élargit un scope élève vide à toute l'école.
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

test("D-reval: Planning n'utilise pas leftover / COALESCE comme autorité établissement", () => {
  const scope = read("lib/planningSchoolScope.js");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  const sql = sliceFrom(scope, "function sqlPlanningScope", "function filterPlanningRows");
  assert.doesNotMatch(sql, /school_code/);
  assert.doesNotMatch(sql, /COALESCE/i);
  assert.doesNotMatch(scope, /COALESCE\(login_code,\s*school_code\)/i);
});

test("D-reval: Présences n'utilisent pas leftover / COALESCE comme autorité établissement", () => {
  const scope = read("lib/presenceSchoolScope.js");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  const sql = sliceFrom(scope, "function sqlPresenceScope", "function filterPresenceRows");
  assert.doesNotMatch(sql, /school_code/);
  assert.doesNotMatch(sql, /COALESCE/i);
  assert.doesNotMatch(scope, /COALESCE\(login_code,\s*school_code\)/i);
});

test("D-reval: Sync L1 n'a pas de fallback COALESCE login_code,school_code", () => {
  const helper = read("lib/mobileSyncSchoolScope.js");
  assert.doesNotMatch(helper, /COALESCE\(login_code,\s*school_code\)/i);
  for (const file of [
    "lib/mobileSyncClasses.js",
    "lib/mobileSyncStudents.js",
    "lib/mobileSyncAssignments.js",
    "lib/mobileSyncSchoolCourses.js",
    "lib/mobileSyncCourseSchedules.js",
  ]) {
    assert.match(read(file), /assertMobileSyncCanonicalLoginCode/, `${file} sans SY-08`);
  }
});

test("D-reval: dual-identity A/B exigée dans les preuves HTTP", () => {
  for (const file of [
    "lib/planningTenant.http.pg.test.js",
    "lib/presenceTenant.http.pg.test.js",
    "lib/mobileSyncTenant.http.pg.test.js",
    "lib/dRevalidation.http.pg.test.js",
  ]) {
    const src = read(file);
    assert.match(src, /CD-LAC-26-001/, `${file} sans login A`);
    assert.match(src, /BI-BUJ-26-001/, `${file} sans login B`);
    assert.match(src, /CD-2026-0001/, `${file} sans leftover A`);
  }
});

test("D-reval: sonde HTTP couvre PR-audit, PR-scope et SY-09 sans assouplir", () => {
  const http = read("lib/dRevalidation.http.pg.test.js");
  assert.match(http, /PR-audit/);
  assert.match(http, /upsert_attendance_batch/);
  assert.match(http, /PR-scope-teacher/);
  assert.match(http, /PR-scope-parent/);
  assert.match(http, /check\(\s*"SY-09"/);
  assert.doesNotMatch(http, /allowFail|t\.skip\(/);
});

test("D-reval: audit présence n'utilise pas leftover JWT schoolCode", () => {
  const pedagogy = read("lib/pedagogyService.js");
  const auditFn = pedagogy.slice(
    pedagogy.indexOf("async function upsertAttendanceBatch"),
    pedagogy.indexOf("module.exports"),
  );
  assert.match(auditFn, /presenceSchoolId/);
  assert.match(auditFn, /presenceLoginCode/);
  assert.doesNotMatch(auditFn, /schoolCode:\s*principal\?\.schoolCode/);
});

test("D-reval: GET Présences ne retombe pas sur fallback school-wide si scope élève calculé", () => {
  const server = read("server.js");
  const getBlock = server.slice(server.indexOf('app.get("/api/presences"'), server.indexOf('app.post("/api/notes"'));
  assert.match(getBlock, /presenceListStaysStudentScoped/);
  assert.doesNotMatch(getBlock, /studentIds\.size \? byStudents : scopedPresences/);
});
