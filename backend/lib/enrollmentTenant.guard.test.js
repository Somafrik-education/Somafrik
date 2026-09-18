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

test("ENR: audit POST/PATCH/DELETE propage le login_code résolu, pas leftover JWT", () => {
  const server = read("server.js");
  const postEnroll = sliceFrom(server, 'app.post("/api/classes/:classCode/students"', 'app.get("/api/courses"');
  const patch = sliceFrom(server, 'app.patch("/api/students/:id"', 'app.delete("/api/students/:id"');
  const del = sliceFrom(server, 'app.delete("/api/students/:id"', 'app.get("/api/students/:id/notes"');

  for (const block of [postEnroll, patch, del]) {
    assert.match(block, /auditService\.record\(/);
    assert.match(block, /\{\s*schoolCode\s*,?\s*\}/);
  }

  const audit = read("services/auditService.js");
  assert.match(audit, /function resolveAuditSchoolCode/);
  assert.match(audit, /enrollmentLoginCode/);
  assert.match(audit, /options\.schoolCode/);
});

test("ENR: HTTP projette login_code, pas leftover", () => {
  const server = read("server.js");
  const helper = sliceFrom(server, "function enrollmentApiStudent", "function enrollmentApiStudents");
  assert.match(helper, /projectEnrollmentApiStudent/);
  const getList = sliceFrom(server, 'app.get("/api/students"', 'app.get("/api/students/:id"');
  assert.match(getList, /enrollmentApiStudents/);
  assert.doesNotMatch(getList, /sanitizeUsersForResponse\(scoped\)/);
});

test("ENR: C18 enrollments utilise membership, pas leftover JWT", () => {
  const server = read("server.js");
  const helper = sliceFrom(
    server,
    "async function authorizeEnrollmentStudentOr404",
    'app.get("/api/students/:studentId/enrollments"',
  );
  const c18 = sliceFrom(
    server,
    'app.get("/api/students/:studentId/enrollments"',
    'app.patch("/api/students/:id"',
  );
  assert.match(helper, /enrollmentHttpPrincipal/);
  assert.match(helper, /requireEnrollmentLoginCode/);
  assert.match(c18, /authorizeEnrollmentStudentOr404/);
  assert.match(c18, /refuseC18MutationForParentStudent/);
  assert.match(c18, /scoped\.schoolCode/);
  assert.doesNotMatch(c18, /req\.principal\?\.schoolCode/);
  assert.doesNotMatch(c18, /assertSchoolAccess\(req\.principal/);
});

test("ENR: findStudent C18/fiche matche studentCode + UUID", () => {
  const server = read("server.js");
  const identity = read("lib/studentIdentityMatch.js");
  const findFn = sliceFrom(server, "function findStudent(students, studentId)", "function principalLinkedStudentIds");
  assert.match(findFn, /findStudentByIdentity/);
  assert.match(identity, /item\.studentCode/);
  assert.match(identity, /item\.studentUuid/);
  assert.match(identity, /item\.matricule/);
});
