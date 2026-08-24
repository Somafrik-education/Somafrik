/**
 * P1 — périmètre enseignant = affectations pédagogiques canoniques actives.
 * Capture KILOMBO SEKE : 2ème A + 2ème C attribuées, 1ère A non attribuée et vide.
 *
 *   npx tsx src/lib/establishment.teacherScope.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SchoolClass, Student, Teacher, TeacherAssignment } from "../data/catalog";
import { listScopedAttendanceClasses } from "./attendanceClassIdentity";
import {
  listCanonicalTeacherAssignments,
  resolveTeacherAssignmentsForSession,
  scopedClassesForSession,
  scopedStudentsForSession,
  teacherScopedClassLabels,
  teacherScopedClassNames,
} from "./establishment";

const SCHOOL = "CD-IN-26-001";
const TEACHER_CODE = "CD-IN-26-001-ENS-0007";
const USER_ID = "user-kilombo-seke";

function student(partial: Partial<Student> & { id: string; className: string }): Student {
  return {
    publicId: partial.id,
    name: partial.name ?? `Élève ${partial.id}`,
    firstName: partial.firstName ?? "Élève",
    lastName: partial.lastName ?? partial.id,
    matricule: partial.matricule ?? partial.id,
    gender: "Féminin",
    birthDate: "",
    schoolCode: SCHOOL,
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    ...partial,
  };
}

function captureFixture() {
  const session = {
    role: "teacher",
    user: {
      id: USER_ID,
      publicId: "USR-KILOMBO",
      identifier: TEACHER_CODE,
      teacherCode: TEACHER_CODE,
      name: "KILOMBO SEKE",
      firstName: "KILOMBO",
      lastName: "SEKE",
      role: "Enseignant",
      schoolCode: SCHOOL,
      assignedClasses: ["2ème A", "2ème C", "1ère A"],
      assignments: [
        { className: "1ère A", course: "Histoire", teacherId: TEACHER_CODE, status: "active" },
      ],
    },
  };

  const teacher: Teacher & { teacherCode: string } = {
    id: "uuid-teacher-kilombo",
    publicId: TEACHER_CODE,
    teacherCode: TEACHER_CODE,
    userId: USER_ID,
    identifier: TEACHER_CODE,
    name: "KILOMBO SEKE",
    firstName: "KILOMBO",
    lastName: "SEKE",
    gender: "Masculin",
    phone: "",
    email: "",
    mainSubject: "Mathématiques",
    schoolCode: SCHOOL,
    assignedClasses: ["2ème A", "2ème C", "1ère A"],
    assignments: [
      { className: "1ère A", course: "Histoire", teacherId: TEACHER_CODE, status: "active" },
    ],
  };

  const classes: SchoolClass[] = [
    { id: "cls-2a", publicId: "CLS-2A", classCode: "CLS-2A", name: "2ème A", level: "2ème", track: "A", teacherId: TEACHER_CODE },
    { id: "cls-2c", publicId: "CLS-2C", classCode: "CLS-2C", name: "2ème C", level: "2ème", track: "C", teacherId: "ENS-OTHER" },
    { id: "cls-1a", publicId: "CLS-1A", classCode: "CLS-1A", name: "1ère A", level: "1ère", track: "A", teacherId: TEACHER_CODE },
  ];

  const assignments: TeacherAssignment[] = [
    {
      id: "asg-2a",
      teacherId: TEACHER_CODE,
      teacherCode: TEACHER_CODE,
      classId: "cls-2a",
      classCode: "CLS-2A",
      className: "2ème A",
      course: "Mathématiques",
      status: "active",
    },
    {
      id: "asg-2c",
      teacherId: TEACHER_CODE,
      teacherCode: TEACHER_CODE,
      classId: "cls-2c",
      classCode: "CLS-2C",
      className: "2ème C",
      course: "Français",
      status: "active",
    },
    {
      id: "asg-1a-archived",
      teacherId: TEACHER_CODE,
      teacherCode: TEACHER_CODE,
      classId: "cls-1a",
      classCode: "CLS-1A",
      className: "1ère A",
      course: "Histoire",
      status: "archived",
    },
    {
      id: "asg-1a-other",
      teacherId: "ENS-OTHER",
      teacherCode: "ENS-OTHER",
      teacherName: "KILOMBO SEKE",
      classId: "cls-1a",
      classCode: "CLS-1A",
      className: "1ère A",
      course: "SVT",
      status: "active",
    },
  ];

  const students: Student[] = [
    student({ id: "stu-1", className: "2ème A", classId: "cls-2a", classCode: "CLS-2A" }),
    student({ id: "stu-2", className: "2ème A", classId: "cls-2a", classCode: "CLS-2A" }),
    student({ id: "stu-3", className: "2ème A", classId: "cls-2a", classCode: "CLS-2A" }),
    student({ id: "stu-4", className: "2ème C", classId: "cls-2c", classCode: "CLS-2C" }),
    student({ id: "stu-5", className: "2ème C", classId: "cls-2c", classCode: "CLS-2C" }),
  ];

  const state = { teachers: [teacher], assignments, classes };
  return { session, teacher, classes, assignments, students, state };
}

function classNamesOf(rows: Array<{ name?: string; className?: string }>) {
  return rows.map((row) => String(row.name ?? row.className ?? "").trim()).sort((a, b) => a.localeCompare(b, "fr"));
}

function run() {
  const { session, state, students, classes } = captureFixture();

  const scopedNames = teacherScopedClassNames(session, state);
  assert.ok(scopedNames);
  assert.deepEqual([...scopedNames].sort(), ["2eme a", "2eme c"]);

  const homeLabels = teacherScopedClassLabels(session, students, state);
  assert.deepEqual(homeLabels, ["2ème A", "2ème C"]);

  const visibleStudents = scopedStudentsForSession(session, students, state);
  assert.equal(visibleStudents.length, 5);
  assert.equal(visibleStudents.some((row) => row.className === "1ère A"), false);

  const visibleClasses = scopedClassesForSession(session, classes, students, state);
  assert.deepEqual(classNamesOf(visibleClasses), ["2ème A", "2ème C"]);

  const attendanceClasses = listScopedAttendanceClasses(visibleStudents, classes, session, state);
  assert.deepEqual(
    attendanceClasses.map((row) => row.className).sort((a, b) => a.localeCompare(b, "fr")),
    ["2ème A", "2ème C"],
  );

  const sessionAssignments = resolveTeacherAssignmentsForSession(session, state);
  assert.deepEqual(
    sessionAssignments.map((row) => row.className).sort((a, b) => a.localeCompare(b, "fr")),
    ["2ème A", "2ème C"],
  );
  assert.equal(
    listCanonicalTeacherAssignments(session, state).some((row) => row.className === "1ère A"),
    false,
  );

  const emptyAssigned = {
    ...state,
    assignments: [
      ...state.assignments,
      {
        id: "asg-3b-empty",
        teacherId: TEACHER_CODE,
        teacherCode: TEACHER_CODE,
        classId: "cls-3b",
        classCode: "CLS-3B",
        className: "3ème B",
        course: "Physique",
        status: "active",
      },
    ],
    classes: [
      ...classes,
      { id: "cls-3b", publicId: "CLS-3B", classCode: "CLS-3B", name: "3ème B", level: "3ème", track: "B", teacherId: "" },
    ],
  };
  const labelsWithEmpty = teacherScopedClassLabels(session, students, emptyAssigned);
  assert.deepEqual(labelsWithEmpty, ["2ème A", "2ème C", "3ème B"]);
  assert.equal(scopedStudentsForSession(session, students, emptyAssigned).length, 5);
  assert.deepEqual(
    classNamesOf(scopedClassesForSession(session, emptyAssigned.classes, students, emptyAssigned)),
    ["2ème A", "2ème C", "3ème B"],
  );
  assert.deepEqual(
    listScopedAttendanceClasses(
      scopedStudentsForSession(session, students, emptyAssigned),
      emptyAssigned.classes,
      session,
      emptyAssigned,
    )
      .map((row) => row.className)
      .sort((a, b) => a.localeCompare(b, "fr")),
    ["2ème A", "2ème C", "3ème B"],
  );

  const poisonOnly = {
    teachers: state.teachers,
    assignments: [] as TeacherAssignment[],
    classes: state.classes,
  };
  const closedNames = teacherScopedClassNames(session, poisonOnly);
  assert.ok(closedNames);
  assert.equal(closedNames.size, 0);
  assert.deepEqual(teacherScopedClassLabels(session, students, poisonOnly), []);
  assert.deepEqual(scopedStudentsForSession(session, students, poisonOnly), []);
  assert.deepEqual(scopedClassesForSession(session, classes, students, poisonOnly), []);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const establishmentSrc = fs.readFileSync(path.join(here, "establishment.ts"), "utf8");
  const scopedFn = establishmentSrc.match(
    /export function teacherScopedClassNames\([\s\S]*?\nexport function teacherScopedClassLabels/,
  );
  assert.ok(scopedFn, "teacherScopedClassNames introuvable");
  assert.doesNotMatch(scopedFn[0], /assignedClasses/);
  assert.doesNotMatch(scopedFn[0], /teacherNameKeys/);
  assert.doesNotMatch(scopedFn[0], /schoolClass\.teacherId/);
  const canonicalFn = establishmentSrc.match(
    /export function listCanonicalTeacherAssignments\([\s\S]*?\nexport function teacherScopedClassNames/,
  );
  assert.ok(canonicalFn, "listCanonicalTeacherAssignments introuvable");
  assert.doesNotMatch(canonicalFn[0], /assignedClasses/);
  assert.doesNotMatch(canonicalFn[0], /teacherNameKeys/);
  assert.doesNotMatch(canonicalFn[0], /schoolClass\.teacherId/);

  console.log("establishment.teacherScope.test.ts OK");
}

run();
