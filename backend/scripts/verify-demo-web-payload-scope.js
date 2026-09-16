"use strict";

/**
 * Gate DEMO-DATA — payload réel seed PostgreSQL + API + scopers Web.
 * RED : classes raw≥30 et scoped=0, ou students raw≥300 et kept=0.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function sourceGuards() {
  const studentsScope = read("web/src/lib/studentsScope.ts");
  const usersScope = read("web/src/lib/schoolCanonicalIdentity.ts");
  const classesScope = read("web/src/lib/establishment.ts");
  const apply = read("web/src/lib/demoPayloadScope.apply.ts");
  const httpTest = read("backend/lib/demoWebPayloadScope.http.pg.test.js");

  assert.match(studentsScope, /resolveSessionSchoolIdentity/);
  assert.match(studentsScope, /studentMatchesSchoolIdentity/);
  assert.match(studentsScope, /sameSchoolId/);
  assert.match(usersScope, /accountMatchesSchoolIdentity/);
  assert.match(classesScope, /normalize\(item\.schoolCode\) === normalize\(schoolCode\)/);
  assert.match(apply, /projectScopedStudents/);
  assert.match(apply, /scopedClasses/);
  assert.doesNotMatch(apply, /schoolId \|\| schoolCode/);
  assert.match(httpTest, /seed-platform-bulk\.js/);
  assert.match(httpTest, /\/backoffice\/login/);
  assert.match(httpTest, /\/login/);
  assert.match(httpTest, /CD-IN-26-001/);
  assert.match(httpTest, /SCH-BULK-CD-0001/);
  assert.match(httpTest, /discoverSchoolAdminIdentities/);
  assert.match(httpTest, /classRow\.raw >= 30/);
  assert.match(httpTest, /studentRow\.raw >= 300/);
}

function main() {
  sourceGuards();
  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-demo-web-payload-scope: SKIP HTTP PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-demo-web-payload-scope (source)");
    return;
  }
  const result = spawnSync(process.execPath, ["backend/lib/demoWebPayloadScope.http.pg.test.js"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "gate HTTP PostgreSQL demo payload scope a échoué");
  console.log("OK verify-demo-web-payload-scope");
}

main();
