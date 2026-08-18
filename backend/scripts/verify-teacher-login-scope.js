"use strict";

/**
 * Gate P0 AUTH/SCOPE TEACHER — login/refresh JWT conserve classId/classCode.
 */
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function run(file) {
  const result = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function assertPresenceWebUsesSessionAssignments() {
  const roster = fs.readFileSync(path.join(ROOT, "web/src/lib/presenceRoster.ts"), "utf8");
  assert.match(roster, /currentUser\?\.assignments|currentUser\.assignments/);
  assert.match(roster, /assignedClassIds/);
  assert.match(roster, /isExplicitlyActiveAssignmentStatus/);
  assert.doesNotMatch(roster, /if \(!normalized\) return true/);
}

assertPresenceWebUsesSessionAssignments();
run("backend/lib/teacherLoginScope.diagnostic.test.js");
run("backend/lib/teacherSessionAssignments.test.js");
run("backend/lib/classStudentsAuthz.test.js");
run("backend/lib/teacherLoginScope.pg.test.js");

const web = spawnSync("npm", ["--prefix", "web", "run", "test", "--", "src/lib/presenceRoster.test.ts"], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
if (web.status !== 0) {
  process.exit(web.status || 1);
}
console.log("verify-teacher-login-scope: OK");
