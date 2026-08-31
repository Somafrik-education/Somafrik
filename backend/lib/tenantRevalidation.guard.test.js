"use strict";

/**
 * Revalidation tenant P0 — Finance + Enrollment + Academic Year + Users.
 * Evidence/test-first : les 3 domaines canoniques ne doivent pas réintroduire
 * leftover JWT comme autorité, ni COALESCE/OR login_code/school_code.
 * Enrollment : leftover encore autorité HTTP — finding verrouillé, pas un runtime fix.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { TenantScopeService } = require("../services/tenantScopeService");
const { filterUsersRows } = require("./usersSchoolScope");
const { schoolCodeInScope, resolveFinanceSchoolScope } = require("./financeSchoolScope");

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LOGIN_A2 = "CD-KIN-26-002";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_A2 = "33333333-3333-4333-8333-333333333333";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

function read(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 4000);
}

function assertNoLeftoverAuthoritySql(fnSrc, label) {
  assert.doesNotMatch(fnSrc, /COALESCE\s*\(\s*login_code/i, `${label}: pas de COALESCE(login_code`);
  assert.doesNotMatch(fnSrc, /COALESCE\s*\(\s*nullif\(btrim\(s\.login_code\)/i, `${label}: pas de COALESCE leftover`);
  assert.doesNotMatch(fnSrc, /login_code\s*=\s*.*\sOR\s+.*school_code/i, `${label}: pas de OR school_code`);
}

test("revalidation: Users HTTP n'utilise plus leftover comme autorité", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/backoffice/users"', 'app.get("/api/backoffice/users/assignable-roles"');
  const postBlock = sliceFrom(server, 'app.post("/api/backoffice/users"', 'app.post("/api/backoffice/users/provision"');
  assert.match(getBlock, /usersHttpPrincipal/);
  assert.match(getBlock, /listClientsUsers\(scope\)/);
  assert.doesNotMatch(getBlock, /tenantScopeService\.filterRows\(clients\.users/);
  assert.match(postBlock, /usersHttpPrincipal/);
  assert.doesNotMatch(postBlock, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);
});

test("revalidation: Academic Year HTTP n'utilise plus leftover comme autorité", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/v2/academic-years"', 'app.post("/api/v2/academic-years"');
  const postBlock = sliceFrom(server, 'app.post("/api/v2/academic-years"', 'app.patch("/api/v2/academic-years/:id"');
  assert.match(getBlock, /academicYearHttpPrincipal/);
  assert.match(getBlock, /getAcademicYearsV2\(scope\)/);
  assert.doesNotMatch(postBlock, /req\.principal\.schoolCode/);
  assert.match(postBlock, /resolveAcademicYearWriteSchool/);
});

test("revalidation: Finance HTTP attache membership avant lecture", () => {
  const server = read("server.js");
  const getPayments = sliceFrom(server, 'app.get("/api/payments"', 'app.post("/api/payments"');
  const getGrids = sliceFrom(server, 'app.get("/api/finance/fee-grids"', 'app.post("/api/finance/fee-grids"');
  assert.match(getPayments, /financeHttpPrincipal/);
  assert.match(getGrids, /financeHttpPrincipal/);
  const httpFn = sliceFrom(server, "async function financeHttpPrincipal", 'app.get("/api/finance/fee-grids"');
  assert.match(httpFn, /attachFinanceMembershipScope/);
});

test("revalidation: SQL scope canonique sans COALESCE/OR leftover", () => {
  const usersSql = sliceFrom(read("lib/usersSchoolScope.js"), "function sqlUsersScope", "function filterUsersRows");
  const aySql = sliceFrom(read("lib/academicYearSchoolScope.js"), "function sqlAcademicYearScope", "function filterAcademicYearRows");
  const finSql = sliceFrom(read("lib/financeSchoolScope.js"), "function sqlSchoolPredicate", "function countryIsoFromRecord");
  assertNoLeftoverAuthoritySql(usersSql, "sqlUsersScope");
  assertNoLeftoverAuthoritySql(aySql, "sqlAcademicYearScope");
  assertNoLeftoverAuthoritySql(finSql, "sqlSchoolPredicate");
  assert.doesNotMatch(finSql, /school_code/);
  assert.match(usersSql, /u\.school_id/);
  assert.match(aySql, /school_id/);
  assert.match(finSql, /login_code/);
});

test("revalidation: attach membership lit users.school_id, pas JWT leftover", () => {
  const usersAttach = sliceFrom(
    read("lib/usersSchoolScope.js"),
    "async function attachUsersMembershipScope",
    "function attachUsersFixtureScope",
  );
  const ayAttach = sliceFrom(
    read("lib/academicYearSchoolScope.js"),
    "async function attachAcademicYearMembershipScope",
    "function attachAcademicYearFixtureScope",
  );
  const finAttach = sliceFrom(
    read("lib/financeSchoolScope.js"),
    "async function attachFinanceMembershipScope",
    "function attachFinanceFixtureScope",
  );
  for (const [label, src] of [
    ["Users", usersAttach],
    ["Academic Year", ayAttach],
    ["Finance", finAttach],
  ]) {
    assert.match(src, /u\.school_id/, `${label} attach joint users.school_id`);
    assert.doesNotMatch(src, /principal\.schoolCode/, `${label} attach n'utilise pas leftover JWT`);
    assert.doesNotMatch(src, /COALESCE/i, `${label} attach sans COALESCE leftover`);
  }
});

test("revalidation: même pays A/A2 — le scope établissement ne se réduit pas au pays", () => {
  const rows = [
    { id: "staff-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A, schoolPublicCode: LOGIN_A, countryCode: "CD" },
    { id: "staff-a2", schoolId: SCHOOL_ID_A2, schoolCode: LOGIN_A2, schoolPublicCode: LOGIN_A2, countryCode: "CD" },
    { id: "staff-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B, schoolPublicCode: LOGIN_B, countryCode: "BI" },
  ];
  assert.deepEqual(
    filterUsersRows(rows, { mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A }).map((row) => row.id),
    ["staff-a"],
  );
  assert.deepEqual(
    filterUsersRows(rows, { mode: "school", schoolId: SCHOOL_ID_A2, loginCode: LOGIN_A2 }).map((row) => row.id),
    ["staff-a2"],
  );
  const financeA = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "CD-2026-0001",
    financeLoginCode: LOGIN_A,
  });
  assert.equal(schoolCodeInScope(LOGIN_A, financeA), true);
  assert.equal(schoolCodeInScope(LOGIN_A2, financeA), false);
  assert.equal(schoolCodeInScope(LOGIN_B, financeA), false);
});

test("revalidation: leftover A vs leftover B isolés (contrat JWT actuel Enrollment)", () => {
  const tenantScope = new TenantScopeService();
  const rows = [
    { id: "enr-a", schoolCode: "CD-2026-0001", studentCode: "STU-A" },
    { id: "enr-b", schoolCode: "BI-2026-0001", studentCode: "STU-B" },
  ];
  const scopedA = tenantScope.filterRows(rows, { role: "Admin School", schoolCode: "CD-2026-0001" });
  const scopedB = tenantScope.filterRows(rows, { role: "Admin School", schoolCode: "BI-2026-0001" });
  assert.deepEqual(scopedA.map((row) => row.id), ["enr-a"]);
  assert.deepEqual(scopedB.map((row) => row.id), ["enr-b"]);
});

test("FINDING Enrollment: GET/POST class students utilisent encore leftover JWT", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/classes/:classCode/students"', 'app.post("/api/classes/:classCode/students"');
  const postBlock = sliceFrom(server, 'app.post("/api/classes/:classCode/students"', 'app.get("/api/courses"');
  assert.match(getBlock, /req\.principal\?\.schoolCode/, "FINDING: GET enrollment leftover JWT");
  assert.match(postBlock, /req\.principal\?\.schoolCode/, "FINDING: POST enrollment leftover JWT");
  assert.doesNotMatch(getBlock, /usersHttpPrincipal|financeHttpPrincipal|academicYearHttpPrincipal/);
  assert.doesNotMatch(postBlock, /usersHttpPrincipal|financeHttpPrincipal|academicYearHttpPrincipal/);
  console.log(
    "FINDING Enrollment: leftover JWT (req.principal.schoolCode) est encore l'autorité HTTP class-students. Correctif étroit dédié requis — hors de ce lot de preuves.",
  );
});
