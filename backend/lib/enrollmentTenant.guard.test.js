"use strict";

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

test("ENR: GET/POST students n'utilisent plus leftover JWT comme autorité", () => {
  const server = read("server.js");
  const getList = sliceFrom(server, 'app.get("/api/students"', 'app.get("/api/students/:id"');
  const postClass = sliceFrom(server, 'app.post("/api/classes/:classCode/students"', 'app.get("/api/courses"');
  const patch = sliceFrom(server, 'app.patch("/api/students/:id"', 'app.delete("/api/students/:id"');
  const getClass = sliceFrom(server, 'app.get("/api/classes/:classCode/students"', 'app.post("/api/classes/:classCode/students"');

  for (const [label, block] of [
    ["GET /students", getList],
    ["GET class students", getClass],
    ["POST class students", postClass],
    ["PATCH /students", patch],
  ]) {
    assert.match(block, /enrollmentHttpPrincipal/, `${label} attache membership`);
    assert.doesNotMatch(block, /req\.principal\?\.schoolCode/, `${label} leftover JWT`);
    assert.doesNotMatch(block, /tenantScopeService\.assertSchoolAccess/, `${label} leftover assert`);
  }
});

test("ENR: enrollmentSchoolScope n'autorise pas leftover comme autorité", () => {
  const scopeLib = read("lib/enrollmentSchoolScope.js");
  const attachFn = sliceFrom(scopeLib, "async function attachEnrollmentMembershipScope", "function attachEnrollmentFixtureScope");
  const findFn = sliceFrom(scopeLib, "async function findSchoolForPlatformScope", "async function attachEnrollmentMembershipScope");
  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  assert.match(attachFn, /SELECT s\.id AS school_id, s\.login_code/);
  assert.doesNotMatch(attachFn, /principal\.schoolCode/);
  assert.doesNotMatch(attachFn, /COALESCE/i);
  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /COALESCE/i);
});
