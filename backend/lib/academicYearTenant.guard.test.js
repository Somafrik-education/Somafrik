"use strict";

/**
 * Garde-fou source GP-002 — le chemin Academic Year ne doit pas réintroduire
 * leftover JWT comme autorité, ni COALESCE/OR login_code/school_code
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

test("GP-002: routes academic-years n'utilisent plus leftover JWT comme autorité", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/v2/academic-years"', 'app.post("/api/v2/academic-years"');
  const postBlock = sliceFrom(server, 'app.post("/api/v2/academic-years"', 'app.patch("/api/v2/academic-years/:id"');
  const patchBlock = sliceFrom(server, 'app.patch("/api/v2/academic-years/:id"', 'app.get("/api/v2/exams"');

  assert.match(getBlock, /academicYearHttpPrincipal/);
  assert.match(getBlock, /assertAcademicYearReadable/);
  assert.match(getBlock, /getAcademicYearsV2\(scope\)/);
  assert.doesNotMatch(getBlock, /tenantScopeService\.filterRows\(rows, req\.principal\)/);

  assert.match(postBlock, /resolveAcademicYearWriteSchool/);
  assert.doesNotMatch(postBlock, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);
  assert.doesNotMatch(postBlock, /req\.principal\.schoolCode/);
  assert.doesNotMatch(postBlock, /assertSchoolAccess\(req\.principal/);

  assert.match(patchBlock, /assertAcademicYearPatchAccess/);
  assert.doesNotMatch(patchBlock, /assertSchoolAccess\(req\.principal, current\.schoolCode\)/);
  assert.doesNotMatch(patchBlock, /req\.principal\.schoolCode/);
});

test("GP-002: projection / scope PG sans COALESCE leftover ni OR school_code", () => {
  const repo = read("db/postgresRepository.js");
  const getFn = sliceFrom(repo, "async getAcademicYearsV2", "async createAcademicYearV2");
  const createFn = sliceFrom(repo, "async createAcademicYearV2", "async getAcademicYearV2ById");
  const byIdFn = sliceFrom(repo, "async getAcademicYearV2ById", "async updateAcademicYearV2");
  const updateFn = sliceFrom(repo, "async updateAcademicYearV2", "mapAcademicYearV2");
  const mapFn = sliceFrom(repo, "mapAcademicYearV2(row, extras = {})", "async getExamsV2");

  assert.match(getFn, /s\.login_code/);
  assert.match(getFn, /sqlAcademicYearScope/);
  assert.doesNotMatch(getFn, /s\.school_code/);
  assert.doesNotMatch(getFn, /COALESCE/i);
  assert.doesNotMatch(getFn, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  assert.match(createFn, /login_code/);
  assert.doesNotMatch(createFn, /COALESCE/i);
  assert.doesNotMatch(createFn, /login_code\s*=\s*.*\sOR\s+.*school_code/i);

  assert.match(byIdFn, /s\.login_code/);
  assert.doesNotMatch(byIdFn, /s\.school_code/);

  assert.match(updateFn, /s\.login_code/);
  assert.doesNotMatch(updateFn, /s\.school_code/);
  assert.doesNotMatch(updateFn, /COALESCE/i);

  assert.match(mapFn, /row\.login_code/);
  assert.doesNotMatch(mapFn, /row\.school_code/);
  assert.doesNotMatch(mapFn, /COALESCE/i);
});

test("GP-002: academicYearSchoolScope n'autorise pas leftover comme autorité établissement", () => {
  const scopeLib = read("lib/academicYearSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachAcademicYearMembershipScope", "function attachAcademicYearFixtureScope");
  const resolveFn = sliceFrom(scopeLib, "function resolveAcademicYearSchoolScope", "function academicYearCacheKey");
  const sqlFn = sliceFrom(scopeLib, "function sqlAcademicYearScope", "function filterAcademicYearRows");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachAcademicYearMembershipScope");

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /coalesce\(nullif\(btrim\(s\.login_code\)/i);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);

  assert.match(resolveFn, /academicYearLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);

  assert.match(sqlFn, /ay\.school_id/);
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /login_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);
  assert.doesNotMatch(sqlFn, /\sOR\s/i);

  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);
});
