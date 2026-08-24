/**
 *   npx tsx Mobile/src/lib/attendanceClassIdentity.test.ts
 */
import assert from "node:assert/strict";
import {
  assertAttendanceClassIdentity,
  filterStudentsByClassIdentity,
  listScopedAttendanceClasses,
  presenceIntentionId,
  resolveStudentClassIdentity,
} from "./attendanceClassIdentity";
import type { SchoolClass, Student } from "../data/catalog";

function student(partial: Partial<Student> & { id: string }): Student {
  return {
    publicId: partial.id,
    name: "Élève",
    firstName: "Élève",
    matricule: partial.id,
    gender: "Féminin",
    birthDate: "",
    className: "",
    schoolCode: "CD-2026-0001",
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    ...partial,
  };
}

function run() {
  const classes: SchoolClass[] = [
    { id: "uuid-a", publicId: "CLS-A", classCode: "CLS-A", name: "2ème A", level: "", track: "", teacherId: "" },
    { id: "uuid-b", publicId: "CLS-B", classCode: "CLS-B", name: "2ème A", level: "", track: "", teacherId: "" },
  ];
  const a = student({ id: "s1", classId: "uuid-a", classCode: "CLS-A", className: "2ème A" });
  const b = student({ id: "s2", classId: "uuid-b", classCode: "CLS-B", className: "2ème A" });

  const identity = resolveStudentClassIdentity(a, classes);
  assert.equal(identity?.classId, "uuid-a");
  assert.equal(identity?.classCode, "CLS-A");

  const listed = listScopedAttendanceClasses([a, b], classes);
  assert.equal(listed.length, 2, "homonymes distincts par classId");
  assert.deepEqual(
    filterStudentsByClassIdentity([a, b], listed[0], classes).map((row) => row.id),
    listed[0].classId === "uuid-a" ? ["s1"] : ["s2"],
  );

  assert.equal(assertAttendanceClassIdentity({ className: "2ème A" }), false);
  assert.equal(assertAttendanceClassIdentity({ classId: "uuid-a", classCode: "CLS-A", className: "2ème A" }), true);
  assert.equal(presenceIntentionId("uuid-a", "23-08-2026"), "presence:uuid-a:23-08-2026");

  const namedOnly = student({ id: "s3", className: "6ème A" });
  const catalog: SchoolClass[] = [
    { id: "uuid-6", publicId: "CLS-6A", classCode: "CLS-6A", name: "6ème A", level: "", track: "", teacherId: "" },
  ];
  assert.equal(resolveStudentClassIdentity(namedOnly, catalog)?.classId, "uuid-6");

  console.log("attendanceClassIdentity.test.ts OK");
}

run();
