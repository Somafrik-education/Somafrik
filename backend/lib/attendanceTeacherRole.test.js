"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isAttendanceTeacherPrincipal } = require("./attendanceTeacherRole");

test("R2 : teacher remains teacher when préfet is primary role", () => {
  assert.equal(isAttendanceTeacherPrincipal({
    role: "Préfet des études",
    roles: ["Préfet des études", "Enseignant"],
    roleKeys: ["PREFET", "TEACHER"],
  }), true);
});
test("R2 : no teacher grant means no teacher identity", () => {
  assert.equal(isAttendanceTeacherPrincipal({ role: "Préfet des études", roleKeys: ["PREFET"] }), false);
  assert.equal(isAttendanceTeacherPrincipal({ role: "Sans affectation", roleKeys: [] }), false);
});
