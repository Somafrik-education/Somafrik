"use strict";

/**
 * Garde-fou source Enrollment — leftover JWT n'est plus l'autorité,
 * ni COALESCE/OR login_code/school_code dans le scope établissement.
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

test("ENR: GET/POST/PATCH students n'utilisent plus leftover JWT comme autorité", () => {
  const server = read("server.js");
  const httpPrincipal = sliceFrom(server, "async function enrollmentHttpPrincipal", "function requireEnrollmentLoginCode");
  assert.match(httpPrincipal, /engine !== "memory"/);
  assert.match(httpPrincipal, /attachEnrollmentMembershipScope/);

  const getList = sliceFrom(server, 'app.get("/api/students"', 'app.get("/api/students/:id"');
  const getById = sliceFrom(server, 'app.get("/api/students/:id"', 'app.patch("/api/students/:id"');
  const patch = sliceFrom(server, 'app.patch("/api/students/:id"', 'app.delete("/api/students/:id"');
  const postEnroll = sliceFrom(server, 'app.post("/api/classes/:classCode/students"', 'app.get("/api/courses"');
  const getClass = sliceFrom(server, 'app.get("/api/classes/:classCode/students"', 'app.post("/api/classes/:classCode/students"');

  for (const block of [getList, getById, patch, getClass]) {
    assert.match(block, /enrollmentHttpPrincipal/);
    assert.match(block, /requireEnrollmentLoginCode/);
    assert.doesNotMatch(block, /req\.principal\?\.schoolCode/);
    assert.doesNotMatch(block, /assertSchoolAccess\(req\.principal/);
  }
  assert.match(postEnroll, /enrollmentHttpPrincipal/);
  assert.match(postEnroll, /resolveEnrollmentWriteSchool/);
  assert.doesNotMatch(postEnroll, /req\.principal\?\.schoolCode/);
  assert.doesNotMatch(postEnroll, /assertSchoolAccess\(req\.principal/);
});

test("ENR: enrollmentSchoolScope n'autorise pas leftover comme autorité établissement", () => {
  const scopeLib = read("lib/enrollmentSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachEnrollmentMembershipScope", "function attachEnrollmentFixtureScope");
  const resolveFn = sliceFrom(scopeLib, "function resolveEnrollmentSchoolScope", "function filterEnrollmentRows");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachEnrollmentMembershipScope");
  const projectFn = sliceFrom(scopeLib, "function publicSchoolCodeFromRow", "function projectEnrollmentApiStudent");

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /coalesce\(nullif\(btrim\(s\.login_code\)/i);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);

  assert.match(resolveFn, /enrollmentLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);

  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);

  assert.match(projectFn, /school_login_code/);
  assert.doesNotMatch(projectFn, /school_code/);
});

test("ENR: mapStudentRow projette login_code, pas leftover", () => {
  const repo = read("db/classStudentsRepository.js");
  const select = sliceFrom(repo, "const STUDENT_SELECT_COLUMNS", "function createClassStudentsDb");
  const mapFn = sliceFrom(repo, "function mapStudentRow(row)", "function mapEnrollmentRow");
  assert.match(select, /s\.login_code AS school_login_code/);
  assert.match(mapFn, /publicSchoolCodeFromRow/);
  assert.doesNotMatch(mapFn, /schoolCode: row\.school_code/);
});
