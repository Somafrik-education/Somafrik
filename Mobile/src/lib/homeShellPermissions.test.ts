import assert from "node:assert/strict";
import { canReadRoute } from "../domain/security/permissions";
import {
  canOpenHomeStudentDetail,
  canShowHomeCoursesKpi,
  canShowHomeNotesKpi,
  canShowHomePresenceKpi,
  canShowHomeStudentAction,
} from "./homeShellPermissions";

const student = { role: "student", user: { id: "eleve-1" } };
const parent = { role: "parent_student", user: { id: "parent-1" } };
const teacher = { role: "teacher", user: { id: "ens-1" } };

assert.equal(canReadRoute(student, "Timetable"), false, "élève : pas de Planning de cours");
assert.equal(canReadRoute(student, "StudentPayments"), false, "élève : pas de Paiements:READ");
assert.equal(canReadRoute(student, "StudentDetail"), false, "élève : pas d’Élèves:READ");
assert.equal(canReadRoute(student, "StudentNotes"), true);
assert.equal(canReadRoute(student, "StudentPresences"), true);

assert.equal(canShowHomeCoursesKpi(student, false), false);
assert.equal(canShowHomeStudentAction(student, "studentPayments", "stu-1"), false);
assert.equal(canShowHomeStudentAction(student, "profile", "stu-1"), false);
assert.equal(canOpenHomeStudentDetail(student, "stu-1"), false);
assert.equal(canShowHomeStudentAction(student, "notes", "stu-1"), true);
assert.equal(canShowHomeStudentAction(student, "presences", "stu-1"), true);
assert.equal(canShowHomeNotesKpi(student), true);
assert.equal(canShowHomePresenceKpi(student), true);
assert.equal(canShowHomeStudentAction(student, "notes", undefined), false);

assert.equal(canShowHomeStudentAction(parent, "studentPayments", "stu-1"), true);
assert.equal(canShowHomeStudentAction(parent, "profile", "stu-1"), true);
assert.equal(canShowHomeCoursesKpi(parent, false), false);

assert.equal(canShowHomeCoursesKpi(teacher, true), true);
assert.equal(canShowHomeCoursesKpi(teacher, false), false);

console.log("homeShellPermissions.test.ts OK");
