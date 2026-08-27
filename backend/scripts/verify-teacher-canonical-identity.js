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
  assert.doesNotMatch(fn, /first_name/);
  assert.doesNotMatch(fn, /JOIN users u ON u\.id = t\.user_id\s+AND u\.school_id = t\.school_id/);

  const assignments = fs.readFileSync(path.join(ROOT, "backend/lib/mobileSyncAssignments.js"), "utf8");
  assert.match(assignments, /queryOptions\.teacherIds = scope\.teacherId \? \[scope\.teacherId\] : \[\]/);

  const rest = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const getBlock = rest.slice(
    rest.indexOf('app.get("/api/assignments"'),
    rest.indexOf('app.post("/api/assignments"'),
  );
  assert.match(getBlock, /teacherId: snapshot\.scope\.teacherId/);
  assert.doesNotMatch(getBlock, /Teachers:READ/);

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
  console.log("OK: verify:teacher-canonical-identity");
}

main();
