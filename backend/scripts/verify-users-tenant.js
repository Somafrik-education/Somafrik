"use strict";

/**
 * Gate GP-003 — Users tenant authority.
 * Garde source + tests unitaires + parcours HTTP PostgreSQL dual-identity.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const server = read("backend/server.js");
  const scopeLib = read("backend/lib/usersSchoolScope.js");
  const service = read("backend/lib/clientsService.js");
  const httpTest = read("backend/lib/usersTenant.http.pg.test.js");

  const getBlock = server.slice(
    server.indexOf('app.get("/api/backoffice/users"'),
    server.indexOf('app.get("/api/backoffice/users/assignable-roles"'),
  );
  const postBlock = server.slice(
    server.indexOf('app.post("/api/backoffice/users"'),
    server.indexOf('app.post("/api/backoffice/users/provision"'),
  );

  assert.match(getBlock, /usersHttpPrincipal/);
  assert.match(getBlock, /listClientsUsers\(scope\)/);
  assert.doesNotMatch(getBlock, /tenantScopeService\.filterRows\(clients\.users/);
  assert.match(postBlock, /usersHttpPrincipal/);

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(service, /resolveUsersWriteSchool/);
  assert.doesNotMatch(service, /resolveCreateUserSchoolCode/);

  assert.match(httpTest, /CD-LAC-26-001/);
  assert.match(httpTest, /BI-BUJ-26-001/);
  assert.match(httpTest, /P0-1 GET A/);
  assert.match(httpTest, /P0-11 jamais A/);
  assert.match(httpTest, /schoolId: fixture.schoolAId/);
  assert.match(httpTest, /USER_PAYS_BI/);
  assert.match(scopeLib, /profile_payload->>'countryCode'/);
  assert.match(scopeLib, /sameId\(requestedRaw, membership\.schoolId\)/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/usersSchoolScope.test.js", "backend/lib/usersTenant.guard.test.js"],
    "tests unitaires / garde-fou GP-003 ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-users-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-users-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/usersTenant.http.pg.test.js"], "parcours HTTP PostgreSQL GP-003 a échoué");
  console.log("OK verify-users-tenant");
}

main();
