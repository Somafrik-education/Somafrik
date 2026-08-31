"use strict";

/**
 * Gate Enrollment tenant — membership UUID → login_code.
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
  const scopeLib = read("backend/lib/enrollmentSchoolScope.js");
  const httpTest = read("backend/lib/enrollmentTenant.http.pg.test.js");
  const repo = read("backend/db/classStudentsRepository.js");

  const getBlock = server.slice(
    server.indexOf('app.get("/api/students"'),
    server.indexOf('app.get("/api/students/:id"'),
  );
  const postBlock = server.slice(
    server.indexOf('app.post("/api/classes/:classCode/students"'),
    server.indexOf('app.get("/api/courses"'),
  );

  assert.match(getBlock, /enrollmentHttpPrincipal/);
  assert.match(getBlock, /requireEnrollmentLoginCode/);
  assert.doesNotMatch(getBlock, /req\.principal\?\.schoolCode/);
  assert.match(postBlock, /enrollmentHttpPrincipal/);
  assert.match(postBlock, /resolveEnrollmentWriteSchool/);

  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(scopeLib, /projectEnrollmentApiStudent/);
  assert.match(repo, /school_login_code/);

  assert.match(httpTest, /CD-LAC-26-001/);
  assert.match(httpTest, /BI-BUJ-26-001/);
  assert.match(httpTest, /ENR-01/);
  assert.match(httpTest, /ENR-02/);
  assert.match(httpTest, /ENR-03 0 write B/);
  assert.match(httpTest, /ENR-06/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/enrollmentSchoolScope.test.js", "backend/lib/enrollmentTenant.guard.test.js"],
    "tests unitaires / garde-fou Enrollment tenant ont échoué",
  );
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-enrollment-tenant: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-enrollment-tenant (source + unit)");
    return;
  }
  run(process.execPath, ["backend/lib/enrollmentTenant.http.pg.test.js"], "parcours HTTP PostgreSQL Enrollment a échoué");
  console.log("OK verify-enrollment-tenant");
}

main();
