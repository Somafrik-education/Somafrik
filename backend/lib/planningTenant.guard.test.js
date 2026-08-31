"use strict";

/**
 * Garde-fou source GP-014 — le chemin Planning course-schedules ne doit pas
 * réintroduire leftover JWT comme autorité, ni COALESCE/OR login_code/school_code
 * dans le scope établissement.
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

test("GP-014: routes course-schedules attachent le membership UUID", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/course-schedules"', 'app.post("/api/courses"');
  const postBlock = sliceFrom(server, 'app.post("/api/course-schedules"', 'app.patch("/api/course-schedules/:scheduleId"');
  const patchBlock = sliceFrom(server, 'app.patch("/api/course-schedules/:scheduleId"', 'app.delete("/api/course-schedules/:scheduleId"');
  const deleteBlock = sliceFrom(server, 'app.delete("/api/course-schedules/:scheduleId"', "function requireCanonicalPg");

  assert.match(getBlock, /planningHttpPrincipal/);
  assert.match(getBlock, /assertPlanningReadable/);
  assert.match(postBlock, /planningHttpPrincipal/);
  assert.match(postBlock, /assertPlanningReadable/);
  assert.match(patchBlock, /planningHttpPrincipal/);
  assert.match(patchBlock, /assertPlanningReadable/);
  assert.match(deleteBlock, /planningHttpPrincipal/);
  assert.match(deleteBlock, /assertPlanningReadable/);
});

test("GP-014: projection / scope PG sans COALESCE leftover ni OR school_code", () => {
  const store = read("db/pedagogyPgStore.js");
  const weeklySelect = sliceFrom(store, "const WEEKLY_SLOT_SELECT = `", "const REPLACEMENT_SELECT");
  assert.match(weeklySelect, /s\.login_code/);
  assert.doesNotMatch(weeklySelect, /COALESCE\s*\(\s*s\.login_code/i);
  assert.doesNotMatch(weeklySelect, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  const listFn = sliceFrom(store, "async listWeeklyScheduleSlots", "async insertCourse");
  assert.match(listFn, /filters\.schoolId/);
  assert.match(listFn, /filters\.countryCode/);

  const dto = read("lib/planningWeekly.js");
  const mapFn = sliceFrom(dto, "function mapWeeklyScheduleDto", "module.exports");
  assert.match(mapFn, /row\.login_code/);
  assert.match(mapFn, /row\.school_id/);
});

test("GP-014: planningSchoolScope n'autorise pas leftover comme autorité établissement", () => {
  const scopeLib = read("lib/planningSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachPlanningMembershipScope", "function attachPlanningFixtureScope");
  const resolveFn = sliceFrom(scopeLib, "function resolvePlanningSchoolScope", "function sqlPlanningScope");
  const sqlFn = sliceFrom(scopeLib, "function sqlPlanningScope", "function filterPlanningRows");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachPlanningMembershipScope");

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /coalesce\(nullif\(btrim\(s\.login_code\)/i);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);

  assert.match(resolveFn, /planningLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);

  assert.match(sqlFn, /w\.school_id/);
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /login_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);
  assert.doesNotMatch(sqlFn, /\sOR\s/i);

  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);
});
