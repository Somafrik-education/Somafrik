/**
 * P1 Mobile — leftover JWT vs login_code V2.
 *   npx tsx src/lib/studentsScope.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Student } from "../data/catalog";
import { scopedStudentsForSession } from "./establishment";
import {
  attachStudentTenantIdentity,
  legacyScopedStudentsBySchoolCode,
  projectScopedStudentsForSession,
} from "./studentsScope";
import { projectL1Student } from "../offline/l1/uiProjection";
import { metricLabelFromSnapshot, type ResourceSnapshot } from "./dataTruth";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

function student(index: number, overrides: Partial<Student> = {}): Student {
  const seq = String(index + 1).padStart(5, "0");
  return {
    id: `CD-IN-EL-26-${seq}`,
    publicId: `CD-IN-EL-26-${seq}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    matricule: `CD-IN-EL-26-${seq}`,
    gender: "Masculin",
    birthDate: "",
    className: "6ème A",
    schoolId: SCHOOL_ID_A,
    schoolPublicCode: LOGIN_A,
    schoolCode: LOGIN_A,
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    status: "active",
    ...overrides,
  };
}

function schoolAdmin(overrides: Record<string, unknown> = {}) {
  return {
    role: "school_admin",
    user: {
      id: "admin-nuru",
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
      ...((overrides.user as Record<string, unknown> | undefined) ?? {}),
    },
    school: { id: SCHOOL_ID_A, code: LEFTOVER_A },
    ...overrides,
  };
}

function snapshot(rows: Student[]): ResourceSnapshot<Student> {
  return { status: rows.length ? "success" : "empty", data: rows, source: "network" };
}

function homeStudentsKpi(session: ReturnType<typeof schoolAdmin>, rows: Student[]): string {
  const visible = scopedStudentsForSession(session, rows);
  return metricLabelFromSnapshot(snapshot(rows), () => String(visible.length));
}

function studentsScreenCounts(session: ReturnType<typeof schoolAdmin>, rows: Student[]) {
  const visible = scopedStudentsForSession(session, rows);
  const projection = projectScopedStudentsForSession(session, rows);
  return {
    subtitle: `${visible.length} élèves inscrits`,
    kpi: String(visible.length),
    list: visible.length,
    error: projection.error,
  };
}

const thirteen = Array.from({ length: 13 }, (_, index) => student(index));

{
  const session = schoolAdmin();
  assert.equal(thirteen.length, 13);
  assert.equal(legacyScopedStudentsBySchoolCode(session, thirteen).length, 0, "AVANT leftover → 0");
  const projection = projectScopedStudentsForSession(session, thirteen);
  assert.equal(projection.received, 13);
  assert.equal(projection.kept, 13);
  assert.equal(projection.error, null);
  assert.equal(projection.trace.session.hasSchoolId, true);
  assert.equal(projection.trace.session.leftoverPresent, true);
  assert.equal(JSON.stringify(projection.trace).includes("Prenom"), false, "trace sans PII");
  assert.equal(homeStudentsKpi(session, thirteen), "13");
  const screen = studentsScreenCounts(session, thirteen);
  assert.equal(screen.subtitle, "13 élèves inscrits");
  assert.equal(screen.kpi, "13");
  assert.equal(screen.list, 13);
}

{
  const mixed = [...thirteen.slice(0, 12), student(12, { schoolId: SCHOOL_ID_B, schoolCode: "BI-EC-26-001" })];
  const projection = projectScopedStudentsForSession(schoolAdmin(), mixed);
  assert.equal(projection.kept, 12);
  assert.equal(projection.error?.code, "SCOPE_LEAK");
  assert.equal(projection.students.some((row) => row.schoolId === SCHOOL_ID_B), false);
  assert.equal(homeStudentsKpi(schoolAdmin(), mixed), "12");
}

{
  const session = schoolAdmin({ user: { schoolId: "", schoolCode: LEFTOVER_A }, school: { id: "", code: LEFTOVER_A } });
  const projection = projectScopedStudentsForSession(session, thirteen);
  assert.equal(projection.students.length, 0);
  assert.equal(projection.error?.code, "MISSING_CANONICAL_IDENTITY");
  assert.match(projection.error?.message ?? "", /schoolId/i);
}

{
  const mixed = [...thirteen.slice(0, 12), student(12, { schoolId: "" })];
  const projection = projectScopedStudentsForSession(schoolAdmin(), mixed);
  assert.equal(projection.received, 13);
  assert.equal(projection.kept, 12);
  assert.equal(projection.error?.code, "INCOMPLETE_ROW_IDENTITY");
  assert.equal(homeStudentsKpi(schoolAdmin(), mixed), "12");
}

{
  const session = schoolAdmin();
  const home = homeStudentsKpi(session, thirteen);
  const screen = studentsScreenCounts(session, thirteen);
  assert.equal(home, "13");
  assert.equal(screen.list, 13);
  const homeAgain = homeStudentsKpi(session, thirteen);
  assert.equal(homeAgain, "13", "navigation / retour Accueil");
}

{
  const refreshed = thirteen.slice();
  const first = projectScopedStudentsForSession(schoolAdmin(), thirteen);
  const second = projectScopedStudentsForSession(schoolAdmin(), refreshed);
  assert.equal(first.kept, second.kept);
  assert.equal(homeStudentsKpi(schoolAdmin(), refreshed), "13");
}

{
  const l1Student = projectL1Student(
    {
      id: "stu-1",
      student_code: "STU-001",
      first_name: "Esther",
      last_name: "Okito",
      class_id: "cls-6a",
      class_code: "CLS-6A",
      status: "active",
    },
    { userId: "user-a", schoolId: SCHOOL_ID_A, schoolCode: LEFTOVER_A },
    { byId: new Map(), byCode: new Map() },
  );
  assert.equal(l1Student.schoolId, SCHOOL_ID_A);
  assert.equal(l1Student.schoolCode, LEFTOVER_A);
  const l1Rows = Array.from({ length: 13 }, (_, index) => ({
    ...l1Student,
    id: `stu-${index + 1}`,
  }));
  const projection = projectScopedStudentsForSession(schoolAdmin(), l1Rows);
  assert.equal(projection.kept, 13, "L1 partition schoolId → même autorité UUID");
  assert.equal(legacyScopedStudentsBySchoolCode(schoolAdmin(), l1Rows).length, 13);
}

{
  const teacher = {
    role: "teacher",
    user: { id: "user-a", schoolCode: LOGIN_A, schoolId: SCHOOL_ID_A },
    school: { id: SCHOOL_ID_A, code: LOGIN_A },
  };
  const rows = [
    student(0, { className: "2ème A" }),
    student(1, { className: "1ère A" }),
  ];
  const state = {
    assignments: [
      { className: "2ème A", course: "Maths", teacherUserId: "user-a", status: "active" },
    ],
    classes: [],
  };
  const visible = scopedStudentsForSession(teacher, rows, state);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].className, "2ème A");
}

{
  const parent = {
    role: "parent_student",
    user: { id: "parent-1", schoolCode: LEFTOVER_A, children: [{ id: thirteen[0].id }] },
    school: { code: LEFTOVER_A },
  };
  const projection = projectScopedStudentsForSession(parent, [thirteen[0]]);
  assert.equal(projection.kept, 1, "parent sans schoolId : pas de leftover, enfant conservé");
  assert.equal(legacyScopedStudentsBySchoolCode(parent, [thirteen[0]]).length, 0);
}

{
  const attached = attachStudentTenantIdentity({
    id: "CD-IN-EL-26-00001",
    school_id: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    school_public_code: LOGIN_A,
  });
  assert.equal(attached.schoolId, SCHOOL_ID_A);
  assert.equal(attached.schoolPublicCode, LOGIN_A);
  assert.equal(attached.schoolCode, LOGIN_A);
}

{
  const homeSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/HomeScreen.tsx"), "utf8");
  const studentsSrc = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/StudentsScreen.tsx"),
    "utf8",
  );
  assert.match(homeSrc, /scopedStudentsForSession/);
  assert.doesNotMatch(
    homeSrc,
    /metricLabelFromSnapshot\(studentsSnapshot, \(rows\) => String\(rows\.length\)\)/,
  );
  assert.match(studentsSrc, /projectScopedStudentsForSession/);
  assert.match(studentsSrc, /students-scope-error/);
}

console.log("OK: studentsScope leftover vs schoolId — Accueil/Élèves/L1/teacher/parent");
