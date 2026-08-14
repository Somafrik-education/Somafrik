"use strict";

const assert = require("node:assert/strict");
const {
  FORBIDDEN_PATCH_KEYS,
  validateTeacherUpdateInput,
} = require("../db/teacherLifecycleRepository");
const { routePermissions } = require("../services/rbacService");

function expectStatus(fn, statusCode, code) {
  try {
    fn();
    assert.fail("expected error");
  } catch (error) {
    assert.equal(error.statusCode, statusCode, error.message);
    if (code) assert.equal(error.code, code);
  }
}

function main() {
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("schoolCode"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("school_id"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("role"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("teacherCode"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("userId"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("password"));
  assert.ok(FORBIDDEN_PATCH_KEYS.includes("assignments"));

  expectStatus(() => validateTeacherUpdateInput({ schoolCode: "CD-2026-0001", firstName: "Awa" }), 400);
  expectStatus(() => validateTeacherUpdateInput({ role: "TEACHER", lastName: "Diop" }), 400);
  expectStatus(() => validateTeacherUpdateInput({ teacherCode: "HACK" }), 400);
  expectStatus(() => validateTeacherUpdateInput({ userId: "x" }), 400);
  expectStatus(() => validateTeacherUpdateInput({ password: "secret" }), 400);
  expectStatus(() => validateTeacherUpdateInput({ assignments: [] }), 400);
  expectStatus(() => validateTeacherUpdateInput({}), 400);
  expectStatus(() => validateTeacherUpdateInput(null), 400);

  const patch = validateTeacherUpdateInput({
    firstName: "Awa",
    lastName: "Diop",
    email: "awa@example.com",
    speciality: "Maths",
    hireDate: "2015-09-01",
  });
  assert.equal(patch.firstName, "Awa");
  assert.equal(patch.entryDate, "2015-09-01");
  assert.equal(patch.speciality, "Maths");

  assert.deepEqual(routePermissions["PATCH /api/teachers/:teacherCode"], [
    "Enseignants:UPDATE",
    "Gérer enseignants",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["DELETE /api/teachers/:teacherCode"], [
    "Enseignants:DELETE",
    "Gérer enseignants",
    "ALL_PRIVILEGES",
  ]);
  assert.equal(routePermissions["PATCH /api/teachers/:teacherCode"].includes("COUNTRY_PRIVILEGES"), false);
  assert.equal(routePermissions["DELETE /api/teachers/:teacherCode"].includes("COUNTRY_PRIVILEGES"), false);
  assert.ok(routePermissions["GET /api/teachers"].includes("COUNTRY_PRIVILEGES"));

  console.log("teacherLifecycleRepository.test.js: OK");
}

main();
