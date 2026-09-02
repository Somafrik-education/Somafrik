"use strict";

/**
 * Garde-fou revalidation tenant — Finance + Academic Year + Users + Enrollment.
 * Échoue si un chemin canonique réintroduit leftover JWT ou
 * COALESCE/OR login_code/school_code comme autorité établissement.
 * Enrollment : invariants après #432 (plus de finding leftover).
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

test("revalidation: Finance n'utilise pas leftover comme autorité établissement", () => {
  const scope = read("lib/financeSchoolScope.js");
  const attach = sliceFrom(scope, "async function attachFinanceMembershipScope", "function attachFinanceFixtureScope");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  assert.doesNotMatch(attach, /principal\.schoolCode/);
  assert.doesNotMatch(attach, /COALESCE\(login_code,\s*school_code\)/i);
  const pred = sliceFrom(scope, "function sqlSchoolPredicate", "function schoolCodeInScope");
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /COALESCE/i);
  assert.doesNotMatch(pred, /login_code\s*=\s*.*\sOR\s+.*school_code/i);
});

test("revalidation: Academic Year n'utilise pas leftover comme autorité établissement", () => {
  const scope = read("lib/academicYearSchoolScope.js");
  const attach = sliceFrom(scope, "async function attachAcademicYearMembershipScope", "function attachAcademicYearFixtureScope");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  assert.doesNotMatch(attach, /principal\.schoolCode/);
  assert.doesNotMatch(attach, /COALESCE\(login_code,\s*school_code\)/i);
  const sql = sliceFrom(scope, "function sqlAcademicYearScope", "function filterAcademicYearRows");
  assert.doesNotMatch(sql, /school_code/);
  assert.doesNotMatch(sql, /COALESCE/i);
});

test("revalidation: Users n'utilise pas leftover comme autorité établissement", () => {
  const scope = read("lib/usersSchoolScope.js");
  const attach = sliceFrom(scope, "async function attachUsersMembershipScope", "function attachUsersFixtureScope");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  assert.doesNotMatch(attach, /principal\.schoolCode/);
  assert.doesNotMatch(attach, /COALESCE\(login_code,\s*school_code\)/i);
  const sql = sliceFrom(scope, "function sqlUsersScope", "function filterUsersRows");
  assert.doesNotMatch(sql, /school_code/);
  assert.doesNotMatch(sql, /COALESCE/i);
  assert.doesNotMatch(sql, /login_code\s*=\s*.*\sOR\s+.*school_code/i);
});

test("revalidation: GET/POST/PATCH Users/AY n'utilisent plus leftover JWT comme autorité", () => {
  const server = read("server.js");
  const ayGet = sliceFrom(server, 'app.get("/api/v2/academic-years"', 'app.post("/api/v2/academic-years"');
  const ayPost = sliceFrom(server, 'app.post("/api/v2/academic-years"', 'app.patch("/api/v2/academic-years/:id"');
  const usersGet = sliceFrom(server, 'app.get("/api/backoffice/users"', 'app.get("/api/backoffice/users/assignable-roles"');
  const usersPost = sliceFrom(server, 'app.post("/api/backoffice/users"', 'app.post("/api/backoffice/users/provision"');
  assert.match(ayGet, /academicYearHttpPrincipal/);
  assert.doesNotMatch(ayPost, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);
  assert.match(usersGet, /usersHttpPrincipal/);
  assert.doesNotMatch(usersPost, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);
});

test("revalidation: dual-identity A/B est exigée dans les preuves HTTP canoniques", () => {
  const finance = read("lib/financeMembershipScope.pg.test.js");
  const ay = read("lib/academicYearTenant.http.pg.test.js");
  const users = read("lib/usersTenant.http.pg.test.js");
  const enroll = read("lib/enrollmentTenant.http.pg.test.js");
  for (const src of [finance, ay, users, enroll]) {
    assert.match(src, /CD-LAC-26-001/);
    assert.match(src, /CD-2026-0001/);
  }
  assert.match(ay, /BI-BUJ-26-001/);
  assert.match(users, /BI-BUJ-26-001/);
  assert.match(enroll, /BI-BUJ-26-001/);
  assert.match(enroll, /ENR-07/);
});

test("revalidation: Enrollment n'utilise plus leftover JWT comme autorité établissement", () => {
  const server = read("server.js");
  const getStudents = sliceFrom(server, 'app.get("/api/students"', 'app.get("/api/students/:id"');
  const postEnroll = sliceFrom(server, 'app.post("/api/classes/:classCode/students"', 'app.get("/api/courses"');
  const getById = sliceFrom(server, 'app.get("/api/students/:id"', 'app.patch("/api/students/:id"');
  const patch = sliceFrom(server, 'app.patch("/api/students/:id"', 'app.delete("/api/students/:id"');
  assert.match(getStudents, /enrollmentHttpPrincipal/);
  assert.match(getStudents, /requireEnrollmentLoginCode/);
  assert.doesNotMatch(getStudents, /req\.principal\?\.schoolCode/);
  assert.match(postEnroll, /enrollmentHttpPrincipal/);
  assert.match(postEnroll, /resolveEnrollmentWriteSchool/);
  assert.doesNotMatch(postEnroll, /req\.principal\?\.schoolCode/);
  assert.match(getById, /enrollmentHttpPrincipal/);
  assert.doesNotMatch(getById, /req\.principal\?\.schoolCode/);
  assert.match(patch, /enrollmentHttpPrincipal/);
  assert.match(patch, /\{\s*schoolCode\s*,?\s*\}/);

  const scope = read("lib/enrollmentSchoolScope.js");
  assert.match(scope, /principal\.sub → users\.id → users\.school_id/);
  assert.doesNotMatch(scope, /COALESCE\(login_code,\s*school_code\)/i);

  const lookup = read("db/postgresRepository.js");
  const getSchool = sliceFrom(lookup, "getSchoolByCode(code)", "getSchoolsRepository()");
  assert.match(getSchool, /OR upper\(coalesce\(login_code/);
});
