"use strict";

/**
 * Gate P0 AUTH/SCOPE TEACHER — login/refresh JWT conserve classId/classCode.
 */
const { spawnSync } = require("node:child_process");
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

run("backend/lib/teacherLoginScope.diagnostic.test.js");
run("backend/lib/teacherSessionAssignments.test.js");
run("backend/lib/classStudentsAuthz.test.js");
run("backend/lib/teacherLoginScope.pg.test.js");
console.log("verify-teacher-login-scope: OK");
