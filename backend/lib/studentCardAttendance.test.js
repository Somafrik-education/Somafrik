"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STUDENT_CARD_ATTENDANCE_ERROR,
  hasAttendanceIntent,
  buildAttendanceItem,
  assertStudentCardAttendanceEnabled,
} = require("./studentCardAttendance");

const resolved = {
  student: { id: "student-a" },
  class: { id: "class-a", classCode: "CL-A" },
};

test("CARTE-PR4 — attendance absent reste resolver-only", () => {
  assert.equal(hasAttendanceIntent({ cardToken: "pub.secret" }), false);
  assert.equal(hasAttendanceIntent(null), false);
  assert.equal(hasAttendanceIntent({ cardToken: "pub.secret", attendance: { date: "2026-10-06", status: "present" } }), true);
});

test("CARTE-PR4 — present et late seulement, identifiants client ignorés", () => {
  const item = buildAttendanceItem(resolved, {
    studentId: "student-b",
    classId: "class-b",
    classCode: "CL-B",
    schoolId: "school-b",
    schoolCode: "XX",
    countryCode: "CD",
    date: "2026-10-06",
    status: "present",
    teacherId: "teacher-1",
  });
  assert.deepEqual(item, {
    studentId: "student-a",
    classId: "class-a",
    classCode: "CL-A",
    date: "2026-10-06",
    status: "present",
    teacherId: "teacher-1",
  });
  assert.equal(buildAttendanceItem(resolved, { date: "2026-10-06", status: "late" }).status, "late");
  for (const status of ["absent", "excused", "Présent", "unknown", ""]) {
    assert.throws(
      () => buildAttendanceItem(resolved, { date: "2026-10-06", status }),
      (error) => error.statusCode === 400 && error.code === STUDENT_CARD_ATTENDANCE_ERROR.STATUS_INVALID,
    );
  }
});

test("CARTE-PR4 — capability présence fail-closed via le helper existant", async () => {
  const repo = {
    getSchoolSettingsStore() {
      return {
        getSettings: async () => ({
          student_card_enabled: true,
          student_card_attendance_enabled: false,
        }),
      };
    },
  };
  await assert.rejects(
    () => assertStudentCardAttendanceEnabled(repo, "school-a"),
    (error) => error.statusCode === 404 && error.code === STUDENT_CARD_ATTENDANCE_ERROR.DISABLED,
  );
  const enabled = {
    getSchoolSettingsStore() {
      return {
        getSettings: async () => ({
          student_card_enabled: true,
          student_card_attendance_enabled: true,
        }),
      };
    },
  };
  await assertStudentCardAttendanceEnabled(enabled, "school-a");
});

test("CARTE-PR4 — l'adaptateur délègue au moteur canonique sans SQL ni finance", () => {
  const source = fs.readFileSync(path.join(__dirname, "studentCardAttendance.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const scanRoute = server.slice(
    server.indexOf('app.post("/api/student-cards/scan"'),
    server.indexOf('app.post("/api/student-cards/:id/replace"'),
  );
  assert.match(source, /scanStudentCard\(/);
  assert.match(source, /upsertSchoolAttendanceBatch/);
  assert.doesNotMatch(source, /INSERT INTO attendance|listFinanceStudentFees|student_card_scanned|last_scan_at/);
  assert.match(scanRoute, /hasAttendanceIntent/);
  assert.match(scanRoute, /write_presence/);
  assert.doesNotMatch(scanRoute, /upsertSchoolAttendanceBatch|INSERT INTO attendance|listFinanceStudentFees/);
  assert.doesNotMatch(scanRoute.slice(0, scanRoute.indexOf("hasAttendanceIntent")), /write_presence/);
});
