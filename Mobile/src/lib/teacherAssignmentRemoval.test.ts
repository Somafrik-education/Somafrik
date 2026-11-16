import assert from "node:assert/strict";
import { removableAssignmentsForTeacher } from "./teacherAssignmentRemoval";

const rows = [
  { id: "a", teacherId: "T-1", className: "5ème A", course: "Mathématiques", status: "active" },
  { id: "b", teacherId: "T-2", className: "5ème A", course: "Français", status: "active", teacherName: "Même Nom" },
  { id: "c", teacherId: "T-1", className: "5ème B", course: "Histoire", status: "deleted" },
  { teacherId: "T-1", className: "5ème B", course: "Physique", status: "active" },
];
assert.deepEqual(removableAssignmentsForTeacher("T-1", rows).map((row) => row.id), ["a"]);
assert.deepEqual(removableAssignmentsForTeacher("", rows), []);
assert.deepEqual(removableAssignmentsForTeacher("T-3", rows), []);
console.log("teacherAssignmentRemoval.test.ts OK");
