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

  // P0 KILOMBO : GET /assignments est déjà filtré par le principal live côté API.
  // Le client ne doit pas éliminer les 4 lignes autorisées à cause d'une autre
  // représentation de teacherId/teacherCode que celle de session.user.id.
  const networkState = {
    teachers: [] as Teacher[],
    classes,
    assignmentsSource: "network" as const,
    assignments: [
      {
        id: "net-2a-math",
        teacherId: "server-teacher-ref-a",
        teacherCode: "server-teacher-code-a",
        classId: "cls-2a",
        classCode: "CLS-2A",
        className: "2ème A",
        course: "Mathématiques",
        status: "active",
      },
      {
        id: "net-2a-phys",
        teacherId: "server-teacher-ref-a",
        teacherCode: "server-teacher-code-a",
        classId: "cls-2a",
        classCode: "CLS-2A",
        className: "2ème A",
        course: "Physique",
        status: "active",
      },
      {
        id: "net-2c-fr",
        teacherId: "server-teacher-ref-a",
        teacherCode: "server-teacher-code-a",
        classId: "cls-2c",
        classCode: "CLS-2C",
        className: "2ème C",
        course: "Français",
        status: "active",
      },
      {
        id: "net-2c-hist",
        teacherId: "server-teacher-ref-a",
        teacherCode: "server-teacher-code-a",
        classId: "cls-2c",
        classCode: "CLS-2C",
        className: "2ème C",
        course: "Histoire",
        status: "active",
      },
      {
        id: "net-archived",
        teacherId: "server-teacher-ref-a",
        teacherCode: "server-teacher-code-a",
        classId: "cls-1a",
        classCode: "CLS-1A",
        className: "1ère A",
        course: "SVT",
        status: "archived",
      },
    ] as TeacherAssignment[],
  };
  const networkAssignments = listCanonicalTeacherAssignments(session, networkState);
  assert.equal(networkAssignments.length, 4);
  assert.deepEqual(
    networkAssignments.map((row) => row.id).sort(),
    ["net-2a-math", "net-2a-phys", "net-2c-fr", "net-2c-hist"],
  );
  assert.deepEqual(teacherScopedClassLabels(session, students, networkState), ["2ème A", "2ème C"]);
  assert.equal(scopedStudentsForSession(session, students, networkState).length, 5);
  assert.deepEqual(classNamesOf(scopedClassesForSession(session, classes, students, networkState)), ["2ème A", "2ème C"]);

  // L1 reste strict : teacherCode/teacherId ne suffisent jamais. Seul
  // teacherUserId === session.user.id ouvre la ligne hors connexion.
  const l1State = {
    teachers: state.teachers,
    classes,
    assignmentsSource: "l1-cache" as const,
    assignments: [
      {
        id: "l1-valid",
        teacherId: TEACHER_CODE,
        teacherCode: TEACHER_CODE,
        teacherUserId: USER_ID,
        classId: "cls-2a",
        classCode: "CLS-2A",
        className: "2ème A",
        course: "Mathématiques",
        status: "active",
      },
      {
        id: "l1-mismatch",
        teacherId: TEACHER_CODE,
        teacherCode: TEACHER_CODE,
        teacherUserId: "other-user",
        classId: "cls-2c",
        classCode: "CLS-2C",
        className: "2ème C",
        course: "Français",
        status: "active",
      },
      {
        id: "l1-missing-user",
        teacherId: TEACHER_CODE,
        teacherCode: TEACHER_CODE,
        classId: "cls-1a",
        classCode: "CLS-1A",
        className: "1ère A",
        course: "Histoire",
        status: "active",
      },
    ] as TeacherAssignment[],
  };
  assert.deepEqual(listCanonicalTeacherAssignments(session, l1State).map((row) => row.id), ["l1-valid"]);
  assert.deepEqual(teacherScopedClassLabels(session, students, l1State), ["2ème A"]);

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
  assert.deepEqual(
    listScopedAttendanceClasses(students, classes, session, poisonOnly),
    [],
    "enseignant sans affectation canonique : Présences ne reconstruit pas les classes depuis les élèves",
  );

  const schoolA = "CD-NURU-001";
  const schoolB = "CD-OTHER-002";
  const homonymCatalog: SchoolClass[] = [
    { id: "cls-nuru-6a", publicId: "CLS-NURU-6A", classCode: "CLS-NURU-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "", schoolCode: schoolA },
    { id: "cls-other-6a", publicId: "CLS-OTHER-6A", classCode: "CLS-OTHER-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "", schoolCode: schoolB },
    { id: "cls-legacy-6a", publicId: "CLS-LEGACY-6A", classCode: "CLS-LEGACY-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "" },
  ];
  const localSixieme = [
    student({ id: "stu-nuru-1", className: "6ème A", classId: "cls-nuru-6a", classCode: "CLS-NURU-6A", schoolCode: schoolA }),
  ];
  const adminNuru = {
    role: "school_admin",
    user: { role: "Admin School", schoolCode: schoolA },
    school: { code: schoolA },
  };
  const teacherNuru = {
    role: "teacher",
    user: { id: "user-nuru", role: "Enseignant", teacherCode: "ENS-NURU", schoolCode: schoolA },
    school: { code: schoolA },
  };
  const teacherNuruState = {
    assignments: [
      {
        id: "asg-nuru-6a",
        teacherId: "ENS-NURU",
        teacherCode: "ENS-NURU",
        classId: "cls-nuru-6a",
        classCode: "CLS-NURU-6A",
        className: "6ème A",
        course: "Mathématiques",
        status: "active",
      },
    ] as TeacherAssignment[],
    classes: homonymCatalog.filter((row) => row.schoolCode),
  };

  const adminHomonyms = scopedClassesForSession(
    adminNuru,
    homonymCatalog.filter((row) => row.schoolCode),
    localSixieme,
    { classes: homonymCatalog.filter((row) => row.schoolCode) },
  );
  assert.deepEqual(
    adminHomonyms.map((row) => row.id),
    ["cls-nuru-6a"],
    "school_admin : homonyme inter-tenant 6ème A exclu (seul Nuru)",
  );

  const teacherHomonyms = scopedClassesForSession(
    teacherNuru,
    homonymCatalog.filter((row) => row.schoolCode),
    localSixieme,
    teacherNuruState,
  );
  assert.deepEqual(
    teacherHomonyms.map((row) => row.id),
    ["cls-nuru-6a"],
    "teacher : homonyme inter-tenant 6ème A exclu (seul Nuru)",
  );
  assert.deepEqual(
    scopedClassesForSession(
      teacherNuru,
      homonymCatalog.filter((row) => row.schoolCode),
      [],
      teacherNuruState,
    ).map((row) => row.id),
    ["cls-nuru-6a"],
    "teacher sans élèves : la 6ème A affectée locale reste, l'homonyme étranger non",
  );

  const adminLegacyOnly = scopedClassesForSession(
    adminNuru,
    [homonymCatalog[1], homonymCatalog[2]],
    localSixieme,
    { classes: [homonymCatalog[1], homonymCatalog[2]] },
  );
  assert.deepEqual(
    adminLegacyOnly.map((row) => row.id),
    ["cls-legacy-6a"],
    "fallback legacy : classe sans schoolCode gardée, schoolCode étranger refusé",
  );

  assert.deepEqual(
    listScopedAttendanceClasses(
      localSixieme,
      homonymCatalog.filter((row) => row.schoolCode),
      adminNuru,
      { classes: homonymCatalog.filter((row) => row.schoolCode) },
    ).map((row) => row.classId),
    ["cls-nuru-6a"],
    "Présences school_admin : une seule 6ème A (établissement courant)",
  );
  assert.deepEqual(
    listScopedAttendanceClasses(
      localSixieme,
      homonymCatalog.filter((row) => row.schoolCode),
      teacherNuru,
      teacherNuruState,
    ).map((row) => row.classId),
    ["cls-nuru-6a"],
    "Présences teacher : une seule 6ème A (classe affectée locale)",
  );

  const here = path.dirname(fileURLToPath(import.meta.url));
  const establishmentSrc = fs.readFileSync(path.join(here, "establishment.ts"), "utf8");
  assert.match(establishmentSrc, /teacherUserId/);
  assert.match(establishmentSrc, /teacher_user_id/);
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
  assert.match(establishmentSrc, /classCompatibleWithSessionSchool/);
  assert.doesNotMatch(
    establishmentSrc,
    /normalize\(row\.schoolCode\) === normalize\(schoolCode\) \|\| classNames\.has/,
    "scopedClassesForSession ne doit plus laisser passer un homonyme via le nom seul",
  );

  console.log("establishment.teacherScope.test.ts OK");
}

run();