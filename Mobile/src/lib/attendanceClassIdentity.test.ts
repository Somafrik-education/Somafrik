/**
 *   npx tsx Mobile/src/lib/attendanceClassIdentity.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTENDANCE_AUTHOR_COPY,
  ATTENDANCE_EMPTY_CLASSES_COPY,
  assertAttendanceClassIdentity,
  assignmentsForClassIdentity,
  attachAttendanceAuthorToPayload,
  authorTeacherIdFromOutboxPayload,
  filterStudentsByClassIdentity,
  listActiveClassAuthorOptions,
  listScopedAttendanceClasses,
  persistAttendanceAuthorSelection,
  presenceIntentionId,
  resolveAttendanceAuthor,
  resolveExplicitAttendanceTeacherKey,
  resolveStudentClassIdentity,
  uniqueActiveAssignmentTeacherKey,
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

  const school = "CD-2026-0001";
  const foreignSchool = "CD-OTHER-0002";
  const establishmentCatalog: SchoolClass[] = [
    { id: "cls-6a", publicId: "CLS-6A", classCode: "CLS-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "", schoolCode: school },
    { id: "cls-5b", publicId: "CLS-5B", classCode: "CLS-5B", name: "5ème B", level: "5ème", track: "B", teacherId: "", schoolCode: school },
    { id: "cls-empty", publicId: "CLS-4C", classCode: "CLS-4C", name: "4ème C", level: "4ème", track: "C", teacherId: "", schoolCode: school },
    { id: "cls-foreign", publicId: "CLS-X", classCode: "CLS-X", name: "Terminale", level: "Tle", track: "", teacherId: "", schoolCode: foreignSchool },
  ];
  const studentsWithoutClassRef = [student({ id: "s-orphan" })];
  for (const role of ["school_admin", "secretary", "principal"] as const) {
    const establishmentSession = {
      role,
      user: {
        role: role === "school_admin" ? "Admin School" : role === "secretary" ? "Secrétaire" : "Directeur",
        schoolCode: school,
      },
      school: { code: school },
    };
    const fromCatalog = listScopedAttendanceClasses(
      studentsWithoutClassRef,
      establishmentCatalog,
      establishmentSession,
      { classes: establishmentCatalog },
    );
    assert.deepEqual(
      fromCatalog.map((row) => row.className),
      ["4ème C", "5ème B", "6ème A"],
      `${role} part du catalogue établissement, pas des élèves`,
    );
    assert.equal(
      fromCatalog.some((row) => row.classId === "cls-foreign"),
      false,
      `${role} n'importe pas une classe d'un autre établissement`,
    );
    assert.deepEqual(
      listScopedAttendanceClasses([], [], establishmentSession, { classes: [] }),
      [],
      `${role} sans classe accessible → liste vide`,
    );
  }

  const teacherEmptyClassSession = {
    role: "teacher" as const,
    user: { id: "user-t", role: "Enseignant", teacherCode: "ENS-T", schoolCode: school },
    school: { code: school },
  };
  const teacherEmptyAssignments = [
    {
      id: "asg-empty",
      teacherId: "ENS-T",
      teacherCode: "ENS-T",
      classId: "cls-empty",
      classCode: "CLS-4C",
      className: "4ème C",
      course: "Mathématiques",
      status: "active" as const,
    },
  ];
  const teacherEmptyListed = listScopedAttendanceClasses(
    [],
    establishmentCatalog,
    teacherEmptyClassSession,
    { assignments: teacherEmptyAssignments, classes: establishmentCatalog },
  );
  assert.deepEqual(
    teacherEmptyListed.map((row) => ({ classId: row.classId, className: row.className })),
    [{ classId: "cls-empty", className: "4ème C" }],
    "enseignant : classe affectée vide (0 élève) reste listée",
  );
  assert.deepEqual(
    listScopedAttendanceClasses(
      studentsWithoutClassRef,
      establishmentCatalog,
      teacherEmptyClassSession,
      { assignments: [], classes: establishmentCatalog },
    ),
    [],
    "enseignant sans affectation : fail-closed, le catalogue ne s'ouvre pas",
  );

  const nuru = "CD-NURU-001";
  const otherSchool = "CD-OTHER-002";
  const homonymCatalog: SchoolClass[] = [
    { id: "cls-nuru-6a", publicId: "CLS-NURU-6A", classCode: "CLS-NURU-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "", schoolCode: nuru },
    { id: "cls-other-6a", publicId: "CLS-OTHER-6A", classCode: "CLS-OTHER-6A", name: "6ème A", level: "6ème", track: "A", teacherId: "", schoolCode: otherSchool },
  ];
  const nuruStudent = [student({ id: "s-nuru", className: "6ème A", classId: "cls-nuru-6a", classCode: "CLS-NURU-6A", schoolCode: nuru })];
  const adminNuruSession = {
    role: "school_admin" as const,
    user: { role: "Admin School", schoolCode: nuru },
    school: { code: nuru },
  };
  const teacherNuruSession = {
    role: "teacher" as const,
    user: { id: "user-nuru", role: "Enseignant", teacherCode: "ENS-NURU", schoolCode: nuru },
    school: { code: nuru },
  };
  const teacherNuruState = {
    classes: homonymCatalog,
    assignments: [
      {
        id: "asg-nuru-6a",
        teacherId: "ENS-NURU",
        teacherCode: "ENS-NURU",
        classId: "cls-nuru-6a",
        classCode: "CLS-NURU-6A",
        className: "6ème A",
        course: "Mathématiques",
        status: "active" as const,
      },
    ],
  };
  assert.deepEqual(
    listScopedAttendanceClasses(nuruStudent, homonymCatalog, adminNuruSession, { classes: homonymCatalog }).map(
      (row) => row.classId,
    ),
    ["cls-nuru-6a"],
    "school_admin : homonyme 6ème A d'un autre établissement exclu",
  );
  assert.deepEqual(
    listScopedAttendanceClasses(nuruStudent, homonymCatalog, teacherNuruSession, teacherNuruState).map(
      (row) => row.classId,
    ),
    ["cls-nuru-6a"],
    "teacher : homonyme 6ème A d'un autre établissement exclu",
  );
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

  const teacherSession = { role: "teacher" as const, user: { role: "Enseignant" } };
  const adminSession = { role: "school_admin" as const, user: { role: "Admin School" } };
  const twoTeachers = [
    { teacherId: "T1", teacherName: "Amina Math", status: "active" },
    { teacherId: "T2", teacherName: "Jean Français", status: "active" },
  ];

  const classA = { classId: "UUID-A", classCode: "CLS-A", className: "6ème A" };
  const homonymAssignments = [
    { teacherId: "T-A", teacherName: "Prof A", classId: "UUID-A", classCode: "CLS-A", className: "6ème A", status: "active" },
    { teacherId: "T-B", teacherName: "Prof B", classId: "UUID-B", classCode: "CLS-B", className: "6ème A", status: "active" },
    { teacherId: "T-NAME", teacherName: "Prof nom seul", className: "6ème A", status: "active" },
  ];
  const authorsForA = assignmentsForClassIdentity(homonymAssignments, classA);
  assert.deepEqual(
    authorsForA.map((row) => row.teacherId),
    ["T-A"],
    "homonymes : className ne fait pas entrer l'enseignant de B (ni une affectation sans id/code)",
  );
  assert.deepEqual(
    listActiveClassAuthorOptions(authorsForA).map((row) => row.teacherId),
    ["T-A"],
    "sélecteur UI : uniquement l'enseignant actif de la classe A",
  );
  assert.deepEqual(
    resolveAttendanceAuthor({ session: adminSession, assignmentsForClass: authorsForA }),
    { status: "auto", teacherId: "T-A" },
    "homonymes : 1 enseignant réel de A → auto, pas T-B",
  );
  assert.deepEqual(
    resolveExplicitAttendanceTeacherKey({ session: adminSession, assignmentsForClass: authorsForA }),
    { teacherId: "T-A" },
    "handler d'enregistrement : teacherId de A seulement",
  );
  assert.deepEqual(
    assignmentsForClassIdentity(
      [
        { teacherId: "T-CODE", classCode: "CLS-A", className: "6ème A", status: "active" },
        { teacherId: "T-B-CODE", classCode: "CLS-B", className: "6ème A", status: "active" },
      ],
      classA,
    ).map((row) => row.teacherId),
    ["T-CODE"],
    "sans classId : le classCode canonique départage les homonymes",
  );

  assert.deepEqual(uniqueActiveAssignmentTeacherKey([]), { ok: false, reason: "none" });
  assert.deepEqual(
    uniqueActiveAssignmentTeacherKey([{ teacherId: "T1", status: "active" }]),
    { ok: true, teacherId: "T1" },
  );
  assert.deepEqual(uniqueActiveAssignmentTeacherKey(twoTeachers), { ok: false, reason: "ambiguous" });
  assert.deepEqual(
    listActiveClassAuthorOptions(twoTeachers).map((row) => row.teacherId),
    ["T1", "T2"],
    "2+ enseignants : options listées, aucun défaut",
  );
  assert.deepEqual(
    listActiveClassAuthorOptions([
      ...twoTeachers,
      { teacherId: "T-INACTIF", teacherName: "Archivé", status: "inactive" },
    ]).map((row) => row.teacherId),
    ["T1", "T2"],
    "sélecteur : uniquement les affectations actives de la classe",
  );

  assert.deepEqual(
    resolveAttendanceAuthor({ session: adminSession, assignmentsForClass: [] }),
    { status: "blocked", reason: "none", message: ATTENDANCE_AUTHOR_COPY.none },
    "0 enseignant → blocage",
  );
  assert.deepEqual(
    resolveAttendanceAuthor({
      session: adminSession,
      assignmentsForClass: [{ teacherId: "T9", status: "active" }],
    }),
    { status: "auto", teacherId: "T9" },
    "1 enseignant → auto teacherId",
  );
  const needTwo = resolveAttendanceAuthor({
    session: adminSession,
    assignmentsForClass: twoTeachers,
  });
  assert.equal(needTwo.status, "need_selection");
  if (needTwo.status === "need_selection") {
    assert.deepEqual(
      needTwo.options.map((row) => row.teacherId),
      ["T1", "T2"],
    );
    assert.notEqual(needTwo.options[0]?.teacherId, undefined);
    assert.notEqual(
      resolveAttendanceAuthor({
        session: adminSession,
        assignmentsForClass: twoTeachers,
      }).status,
      "auto",
      "2+ enseignants : jamais auto-sélection du premier",
    );
  }

  assert.deepEqual(
    resolveAttendanceAuthor({
      session: adminSession,
      assignmentsForClass: twoTeachers,
      selectedTeacherId: "T2",
    }),
    { status: "selected", teacherId: "T2" },
    "enseignant sélectionné valide",
  );

  const fourItems: Array<{ studentId: string; teacherId?: string }> = [
    { studentId: "s1" },
    { studentId: "s2" },
    { studentId: "s3" },
    { studentId: "s4" },
  ];
  type PresenceBatch = { classId: string; teacherId?: string; items: typeof fourItems };
  const payload = attachAttendanceAuthorToPayload(
    { classId: "uuid-a", items: fourItems } satisfies PresenceBatch,
    "T2",
  );
  assert.equal(payload.teacherId, "T2");
  assert.equal(payload.items.length, 4);
  assert.ok(
    payload.items.every((item) => item.teacherId === "T2"),
    "refresh après POST : 4 items portent le teacherId canonique",
  );

  assert.deepEqual(
    resolveAttendanceAuthor({
      session: adminSession,
      assignmentsForClass: twoTeachers,
      selectedTeacherId: "T-HORS-CLASSE",
    }),
    { status: "blocked", reason: "outside_class", message: ATTENDANCE_AUTHOR_COPY.outsideClass },
    "enseignant hors classe → refus",
  );

  assert.deepEqual(
    resolveAttendanceAuthor({
      session: adminSession,
      assignmentsForClass: twoTeachers,
      selectedTeacherId: "T-AUTRE-ECOLE",
      sessionSchoolCode: "SCH-A",
      teachers: [{ id: "T-AUTRE-ECOLE", name: "Autre", schoolCode: "SCH-B" }],
    }),
    { status: "blocked", reason: "outside_tenant", message: ATTENDANCE_AUTHOR_COPY.outsideTenant },
    "enseignant autre tenant → refus",
  );

  assert.deepEqual(
    resolveAttendanceAuthor({
      session: teacherSession,
      assignmentsForClass: twoTeachers,
      selectedTeacherId: "T1",
    }),
    { status: "teacher_session" },
    "session teacher → principal.sub, aucun teacherId forgé",
  );
  assert.deepEqual(
    resolveExplicitAttendanceTeacherKey({
      session: teacherSession,
      assignmentsForClass: twoTeachers,
      selectedTeacherId: "T1",
    }),
    {},
  );
  const teacherKey = resolveExplicitAttendanceTeacherKey({
    session: teacherSession,
    assignmentsForClass: twoTeachers,
  });
  const teacherPayload = attachAttendanceAuthorToPayload(
    { classId: "uuid-a", items: fourItems } satisfies PresenceBatch,
    "teacherId" in teacherKey ? teacherKey.teacherId : undefined,
  );
  assert.equal("teacherId" in teacherPayload, false, "session teacher : aucun teacherId forgé dans le POST");

  const intentionId = presenceIntentionId("uuid-a", "25-08-2026");
  const stored = persistAttendanceAuthorSelection({}, intentionId, "T2");
  assert.equal(stored[intentionId], "T2");
  assert.equal(
    persistAttendanceAuthorSelection(stored, intentionId, "T2")[intentionId],
    "T2",
    "retry / outbox : le choix d'auteur est conservé",
  );
  assert.equal(authorTeacherIdFromOutboxPayload({ teacherId: "T2", items: fourItems }), "T2");
  assert.equal(
    authorTeacherIdFromOutboxPayload({ items: [{ teacherId: "T2" }, { teacherId: "T2" }] }),
    "T2",
  );

  const screen = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../screens/TeacherAttendanceScreen.tsx"),
    "utf8",
  );
  assert.match(screen, /resolveAttendanceAuthor/);
  assert.match(screen, /attendanceAuthorPicker/);
  assert.match(screen, /persistAttendanceAuthorSelection/);
  assert.match(screen, /assignmentsForClassIdentity/);
  assert.match(screen, /ATTENDANCE_EMPTY_CLASSES_COPY/);
  assert.match(screen, /attendanceEmptyClasses/);
  assert.match(screen, /listScopedAttendanceClasses\(studentsData/);
  assert.equal(ATTENDANCE_EMPTY_CLASSES_COPY, "Aucune classe disponible");
  const identitySrc = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "attendanceClassIdentity.ts"),
    "utf8",
  );
  assert.match(identitySrc, /scopedClassesForSession/);
  assert.match(
    identitySrc,
    /Liste Appel \/ Présences : même source canonique que Classes/,
  );
  assert.ok(
    (screen.match(/assignmentsForClassIdentity/g) ?? []).length >= 2,
    "sélecteur UI et handler d'enregistrement partagent assignmentsForClassIdentity",
  );
  assert.doesNotMatch(
    screen,
    /classNameMatches\(assignment\.className/,
    "aucun fallback className pour filtrer les affectations de la classe",
  );
  assert.doesNotMatch(
    screen,
    /options\[0\]\.teacherId/,
    "l'écran ne prend pas le premier enseignant par défaut",
  );

  console.log("attendanceClassIdentity.test.ts OK");
}

run();
