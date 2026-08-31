"use strict";

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

test("GP-015: routes présences attachent le membership UUID", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/presences"', 'app.post("/api/notes"');
  const postBlock = sliceFrom(server, 'app.post("/api/presences"', 'app.get("/api/students/:id/report"');
  const studentBlock = sliceFrom(server, 'app.get("/api/students/:id/presences"', 'app.get("/api/students/:id/payments"');

  assert.match(getBlock, /presenceHttpPrincipal/);
  assert.match(getBlock, /assertPresenceReadable/);
  assert.match(postBlock, /presenceHttpPrincipal/);
  assert.match(postBlock, /assertPresenceReadable/);
  assert.match(studentBlock, /presenceHttpPrincipal/);
  assert.match(studentBlock, /assertPresenceReadable/);
});

test("GP-015: mapAttendance projette login_code, jamais leftover", () => {
  const repo = read("db/postgresRepository.js");
  const mapFn = sliceFrom(repo, "mapAttendance(attendance) {", "mapPayment(payment)");
  assert.match(mapFn, /login_code/);
  assert.doesNotMatch(mapFn, /attendance\.school_code/);
  assert.doesNotMatch(mapFn, /login_code\s*\|\|/);
  assert.doesNotMatch(mapFn, /login_code[\s\S]{0,80}\|\|[\s\S]{0,80}school_code/);
});

test("GP-015: resolveStudentForAttendance privilégie presenceSchoolId, pas login_code comme school_code", () => {
  const repo = read("db/postgresRepository.js");
  const resolveFn = sliceFrom(repo, "async resolveStudentForAttendance", "async teacherCanAccessClassFromBackOffice");
  const queryFn = sliceFrom(repo, "async queryStudentWithClass", "async findOpenAcademicYear");

  assert.match(resolveFn, /presenceSchoolId/);
  assert.match(resolveFn, /queryStudentWithClass/);
  assert.doesNotMatch(resolveFn, /presenceLoginCode \?\? payload\.schoolCode/);
  assert.doesNotMatch(resolveFn, /presenceLoginCode \?\? principal\.schoolCode/);
  assert.match(queryFn, /options\.schoolId/);
  assert.match(queryFn, /st\.school_id = \$2::uuid/);
});

test("GP-015: presenceSchoolScope n'autorise pas leftover comme autorité établissement", () => {
  const scopeLib = read("lib/presenceSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachPresenceMembershipScope", "function attachPresenceFixtureScope");
  const resolveFn = sliceFrom(scopeLib, "function resolvePresenceSchoolScope", "function sqlPresenceScope");
  const sqlFn = sliceFrom(scopeLib, "function sqlPresenceScope", "function filterPresenceRows");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachPresenceMembershipScope");

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);
  assert.match(resolveFn, /presenceLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);
  assert.match(sqlFn, /a\.school_id/);
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);
  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);
});
