"use strict";

/**
 * Garde-fou source GP-003 — le chemin Users ne doit pas réintroduire
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

test("GP-003: GET/POST/PATCH users n'utilisent plus leftover JWT comme autorité", () => {
  const server = read("server.js");
  const getBlock = sliceFrom(server, 'app.get("/api/backoffice/users"', 'app.get("/api/backoffice/users/assignable-roles"');
  const postBlock = sliceFrom(server, 'app.post("/api/backoffice/users"', 'app.post("/api/backoffice/users/provision"');
  const patchBlock = sliceFrom(server, 'app.patch("/api/backoffice/users/:userId"', 'app.post("/api/backoffice/users/:userId/reassign-school"');
  const resetBlock = sliceFrom(server, 'app.post("/api/users/:id/reset-password"', 'const { clientsAuditMetaFromRequest }');

  assert.match(getBlock, /usersHttpPrincipal/);
  assert.match(getBlock, /assertUsersReadable/);
  assert.match(getBlock, /listClientsUsers\(scope\)/);
  assert.doesNotMatch(getBlock, /tenantScopeService\.filterRows\(clients\.users/);

  assert.match(postBlock, /usersHttpPrincipal/);
  assert.doesNotMatch(postBlock, /req\.body\?\.schoolCode \?\? req\.principal\.schoolCode/);

  assert.match(patchBlock, /usersHttpPrincipal/);
  assert.doesNotMatch(patchBlock, /assertSchoolAccess\(req\.principal/);

  assert.match(resetBlock, /usersHttpPrincipal/);
  assert.match(resetBlock, /assertUsersTargetAccess/);
  assert.doesNotMatch(resetBlock, /tenantScopeService\.filterRows\(canonicalUsers, req\.principal\)/);
});

test("GP-003: usersSchoolScope n'autorise pas leftover comme autorité établissement", () => {
  const scopeLib = read("lib/usersSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachUsersMembershipScope", "function attachUsersFixtureScope");
  const resolveFn = sliceFrom(scopeLib, "function resolveUsersSchoolScope", "function sqlUsersScope");
  const sqlFn = sliceFrom(scopeLib, "function sqlUsersScope", "function filterUsersRows");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachUsersMembershipScope");
  const writeFn = sliceFrom(scopeLib, "async function resolveUsersWriteSchool", "function projectUsersApiUser");

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /coalesce\(nullif\(btrim\(s\.login_code\)/i);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);

  assert.match(resolveFn, /usersLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);

  assert.match(sqlFn, /u\.school_id/);
  assert.doesNotMatch(sqlFn, /school_code/);
  assert.doesNotMatch(sqlFn, /login_code/);
  assert.doesNotMatch(sqlFn, /COALESCE/i);
  assert.doesNotMatch(sqlFn, /\sOR\s/i);

  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);

  assert.match(writeFn, /typeof one !== "function"/);
  assert.match(writeFn, /countryIsoFromPublicCode/);
});

test("GP-003: createUser ne dérive plus l'école du JWT leftover", () => {
  const service = read("lib/clientsService.js");
  const createFn = sliceFrom(service, "async function createUser", "function rethrowProvisionLoginIdentityConflict");
  assert.match(createFn, /resolveCreateUserSchool/);
  assert.match(service, /resolveUsersWriteSchool/);
  assert.doesNotMatch(createFn, /resolveCreateUserSchoolCode/);
  assert.doesNotMatch(createFn, /principal\?\.schoolCode\)\.toUpperCase/);
});
