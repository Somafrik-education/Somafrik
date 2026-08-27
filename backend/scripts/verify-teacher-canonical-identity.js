"use strict";

const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function run(file, extraArgs = []) {
  const result = spawnSync(process.execPath, extraArgs.concat(file), {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const identity = fs.readFileSync(
    path.join(ROOT, "backend/db/teacherAssignmentsRepository.js"),
    "utf8",
  );
  const fnStart = identity.indexOf("async getLiveTeacherIdentityForSchool");
  const fn = identity.slice(fnStart, identity.indexOf("async listLiveTeacherAssignmentIdsForSync"));
  assert.match(fn, /t\.user_id::text = \$1/);
  assert.match(fn, /async resolveCanonicalUserIdForSchool/);
  assert.match(fn, /t\.id::text = \$1/);
  assert.doesNotMatch(fn, /first_name/);
  assert.doesNotMatch(fn, /teacher_code = \$1/);
  assert.doesNotMatch(fn, /JOIN users u ON u\.id = t\.user_id\s+AND u\.school_id = t\.school_id/);
  assert.match(identity, /t\.user_id AS teacher_user_id/);
  const l1Start = identity.indexOf("async listForMobileSync");
  const l1 = identity.slice(l1Start, identity.indexOf("async create(body, schoolCode"));
  assert.doesNotMatch(l1, /u\.id AS teacher_user_id/);
  assert.doesNotMatch(l1, /LEFT JOIN users u ON u\.id = t\.user_id/);

  const assignments = fs.readFileSync(path.join(ROOT, "backend/lib/mobileSyncAssignments.js"), "utf8");
  assert.match(assignments, /queryOptions\.teacherIds = scope\.teacherId \? \[scope\.teacherId\] : \[\]/);

  const rest = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const getBlock = rest.slice(
    rest.indexOf('app.get("/api/assignments"'),
    rest.indexOf('app.post("/api/assignments"'),
  );
  assert.match(getBlock, /teacherId: snapshot\.scope\.teacherId/);
  assert.match(getBlock, /logAssignmentsPrincipalIdentity/);
  assert.doesNotMatch(getBlock, /Teachers:READ/);

  const scopeSrc = fs.readFileSync(path.join(ROOT, "backend/lib/mobileSyncScope.js"), "utf8");
  assert.match(scopeSrc, /TEACHER_ASSIGNMENTS_PRINCIPAL_IDENTITY/);

  const auth = fs.readFileSync(path.join(ROOT, "backend/services/authService.js"), "utf8");
  assert.match(auth, /id:\s*base\.id/);

  const rbac = fs.readFileSync(path.join(ROOT, "backend/services/rbacService.js"), "utf8");
  assert.match(rbac, /"GET \/api\/assignments"/);

  const mobile = fs.readFileSync(path.join(ROOT, "Mobile/src/lib/establishment.ts"), "utf8");
  assert.match(mobile, /l1AssignmentBelongsToTeacherSession/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(ROOT, "backend/lib/teacherCanonicalIdentityAudit.js"), "utf8"),
    /Teachers:READ/,
  );

  console.log("OK: identité live par teachers.user_id, pas de fallback nom, pas de Teachers:READ");

  run(path.join(ROOT, "backend/lib/teacherCanonicalIdentityAudit.test.js"), ["--test"]);
  run(path.join(ROOT, "backend/lib/teacherCanonicalIdentityAudit.pg.test.js"));
  run(path.join(ROOT, "backend/lib/principalIdentity.test.js"));
  run(path.join(ROOT, "backend/lib/mobileSyncScope.test.js"), ["--test"]);
  console.log("OK: verify:teacher-canonical-identity");
}

main();
