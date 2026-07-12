/**
 * E2E 0028 : Intégration compte enseignant — planning, notes & évaluations
 *
 * Parcours :
 *   1. Admin provisionne enseignant + affectation + planning (créneaux).
 *   2. L'enseignant se connecte.
 *   3. Il consulte son planning (uniquement son périmètre).
 *   4. Il crée une évaluation, saisit des notes et consulte l'historique.
 *   5. Les créneaux / notes hors périmètre restent inaccessibles.
 *
 *   npm run verify:e2e-0028
 */
const assert = require("assert");
const path = require("path");
const {
  request,
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  E2E_TEACHER_PIN,
  mobileLoginFull,
  resolveSchoolContext,
  extractApiList,
} = require("./e2e-api-helpers");
const { prepareContactForSave, assertContactRequiredFields, validateContactDuplicate } = require("./e2e-contacts-rules");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));
const {
  teacherCanAccessEvaluation,
  buildGradeEntrySession,
  gradesToLegacyNotes,
  createEvaluation,
} = require("./e2e-grades-rules");
const {
  resolveTeacherAssignedClasses,
} = require(path.join(__dirname, "..", "backend", "services", "authService"));
const { rolePermissions } = require(path.join(__dirname, "..", "backend", "data.js"));

const TEACHER_PIN = E2E_TEACHER_PIN;
const CLASS_ASSIGNED = "6ème A";
const CLASS_OTHER = "5ème B";
const PERIOD = "Trimestre 1";
const SUBJECT = "Mathématiques";
const OTHER_SUBJECT = "Physique";

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

function getWeekMonday(reference = new Date()) {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function buildCourseSlot({
  id,
  schoolCode,
  className,
  subject,
  teacherId,
  teacherName,
  dayOffset = 0,
  hour = 8,
}) {
  const monday = getWeekMonday();
  const start = new Date(monday);
  start.setDate(start.getDate() + dayOffset);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 1, 0, 0, 0);
  return {
    id,
    schoolCode,
    className,
    subject,
    teacherId,
    teacherName,
    start: start.toISOString(),
    end: end.toISOString(),
    kind: "course",
    periodName: PERIOD,
    periodStart: "01-09-2025",
    periodEnd: "31-12-2025",
  };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const teacherPassword = TEACHER_PIN;
  const attendanceDate = todayPeriodDate();

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  const classAssigned = {
    id: newId("CLASS"),
    name: CLASS_ASSIGNED,
    className: CLASS_ASSIGNED,
    level: "6ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  const classOther = {
    id: newId("CLASS"),
    name: CLASS_OTHER,
    className: CLASS_OTHER,
    level: "5ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  const course = {
    id: newId("COURSE"),
    name: SUBJECT,
    className: CLASS_ASSIGNED,
    schoolCode,
    coefficient: 2,
    status: "Actif",
  };

  state = await putStatePatch(adminToken, {
    classes: [classAssigned, classOther, ...(state.classes ?? [])],
    academicConfigs: {
      ...(state.academicConfigs ?? {}),
      [schoolCode]: {
        periods: [{ name: PERIOD, startDate: "01-09-2025", endDate: "31-12-2025" }],
        evaluationTypes: ["Devoir", "Interrogation", "Composition"],
      },
    },
  });

  const studentRows = [];
  for (const [index, spec] of [
    { className: CLASS_ASSIGNED, lastName: "Mukendi", firstName: `Ada${stamp}` },
    { className: CLASS_ASSIGNED, lastName: "Kabila", firstName: `Bob${stamp}` },
    { className: CLASS_OTHER, lastName: "Tshisekedi", firstName: `Cid${stamp}` },
  ].entries()) {
    const contactFlow = saveContactOnly(
      state,
      {
        id: newId("CONTACT"),
        lastName: spec.lastName,
        firstName: spec.firstName,
        contactType: "Élève",
        phone: `+243 810 ${String(stamp + index).slice(-6)}`,
        email: `eleve-${stamp}-${index}@somafrik.app`,
        status: "Actif",
      },
      schoolCode,
    );
    assert.ok(contactFlow.ok, contactFlow.error);
    const link = linkContactToOperationalRecord(contactFlow.contact, state, schoolCode);
    assert.strictEqual(link.linkedType, "student");
    state = await putStatePatch(adminToken, {
      contacts: [link.contact, ...(state.contacts ?? [])],
      students: link.students,
    });
    const student = (state.students ?? []).find(
      (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
    );
    assert.ok(student, "Fiche élève absente");
    const enrolled = {
      ...student,
      className: spec.className,
      schoolCode,
      matricule: `ELE-${index}-${stamp}`,
    };
    state = await putStatePatch(adminToken, {
      students: (state.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
    });
    studentRows.push(enrolled);
  }

  const assignedStudents = studentRows.filter((row) => row.className === CLASS_ASSIGNED);
  const otherStudent = studentRows.find((row) => row.className === CLASS_OTHER);

  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "Kabongo",
    firstName: `Prof${stamp}`,
    contactType: "Enseignant",
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };
  const teacherFlow = saveContactWithOptionalUserAccount(
    { ...teacherContactDraft, password: teacherPassword, temporaryPassword: teacherPassword },
    state,
    schoolCode,
    { identifier: schoolAdminIdentifier, role: "Admin School", schoolCode },
  );
  assert.ok(teacherFlow.ok, teacherFlow.error);
  const teacherUser = {
    ...teacherFlow.user,
    password: teacherPassword,
    temporaryPassword: teacherPassword,
    pin: teacherPassword,
    mustChangePassword: false,
    permissions: [
      ...(rolePermissions.Enseignant ?? []),
      "Notes:CREATE",
      "Notes:UPDATE",
      "Présences:CREATE",
      "Présences:UPDATE",
    ],
  };
  state = await putStatePatch(adminToken, {
    ...teacherFlow.patch,
    users: teacherFlow.patch.users.map((row) => (row.id === teacherUser.id ? teacherUser : row)),
  });

  const teacherRecord = {
    id: newId("TEACHERS"),
    userId: teacherUser.id,
    contactId: teacherFlow.contact.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    name: teacherUser.lastName,
    schoolCode,
    mainSubject: SUBJECT,
    assignments: [],
  };
  const teacherDisplayName = `${teacherRecord.firstName} ${teacherRecord.lastName}`.trim();
  const assignment = {
    id: newId("ASSIGN"),
    teacherId: teacherRecord.id,
    teacherName: teacherDisplayName,
    className: CLASS_ASSIGNED,
    course: SUBJECT,
    subject: SUBJECT,
    schoolCode,
  };
  teacherRecord.assignments = [assignment];

  const otherTeacher = {
    id: newId("TEACHERS"),
    userId: newId("USR"),
    identifier: `ENS-OTHER-${stamp}`,
    firstName: "Autre",
    lastName: "Professeur",
    name: "Professeur",
    schoolCode,
    mainSubject: OTHER_SUBJECT,
    assignments: [],
  };

  const ownSchedule = buildCourseSlot({
    id: newId("CS"),
    schoolCode,
    className: CLASS_ASSIGNED,
    subject: SUBJECT,
    teacherId: teacherUser.id,
    teacherName: teacherDisplayName,
    dayOffset: 0,
    hour: 9,
  });
  const foreignSchedule = buildCourseSlot({
    id: newId("CS"),
    schoolCode,
    className: CLASS_OTHER,
    subject: OTHER_SUBJECT,
    teacherId: otherTeacher.id,
    teacherName: "Autre Professeur",
    dayOffset: 1,
    hour: 10,
  });

  await putStatePatch(adminToken, {
    teachers: [teacherRecord, otherTeacher, ...(state.teachers ?? [])],
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [
      { ...course, teacherId: teacherRecord.id, teacherName: teacherDisplayName },
      ...(state.courses ?? []),
    ],
    courseSchedules: [ownSchedule, foreignSchedule, ...(state.courseSchedules ?? [])],
  });
  state = await getState(adminToken);

  const expectedAssignedClasses = resolveTeacherAssignedClasses(teacherRecord, teacherUser, state.assignments ?? []);
  pushResult(
    results,
    "2. Données test (planning + affectation)",
    CLASS_ASSIGNED,
    `${ownSchedule.id} / ${foreignSchedule.id}`,
    expectedAssignedClasses.includes(CLASS_ASSIGNED),
  );

  const loginData = await mobileLoginFull("teacher", teacherUser.identifier, teacherPassword, schoolCode);
  const teacherToken = loginData.accessToken;
  pushResult(
    results,
    "3. Enseignant connecté",
    "Enseignant",
    loginData.user?.role ?? "—",
    Boolean(teacherToken) && loginData.user?.role === "Enseignant",
  );

  const schedulesRes = await request("/course-schedules", { token: teacherToken });
  const teacherSchedules = extractApiList(schedulesRes);
  const seesOwnSlot = teacherSchedules.some((row) => String(row.id) === String(ownSchedule.id));
  const seesForeignSlot = teacherSchedules.some((row) => String(row.id) === String(foreignSchedule.id));
  pushResult(
    results,
    "4. Planning : créneau affecté visible",
    ownSchedule.id,
    teacherSchedules.map((row) => row.id).join(", ") || "—",
    schedulesRes.status === 200 && seesOwnSlot,
  );
  pushResult(
    results,
    "5. Planning : créneau hors classe invisible",
    "absent",
    seesForeignSlot ? foreignSchedule.id : "absent",
    schedulesRes.status === 200 && !seesForeignSlot,
  );

  const coursesRes = await request("/courses", { token: teacherToken });
  const teacherCourses = extractApiList(coursesRes);
  pushResult(
    results,
    "6. Matières affectées visibles (cours)",
    SUBJECT,
    teacherCourses.map((row) => row.name ?? row.subject).join(", ") || sessionClasses.join(", ") || "—",
    coursesRes.status === 200 &&
      teacherCourses.some(
        (row) =>
          normalize(row.className ?? row.name) === normalize(CLASS_ASSIGNED) ||
          normalize(row.name ?? row.subject) === normalize(SUBJECT),
      ),
  );

  const teacherSessionUser = {
    id: teacherUser.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    role: "Enseignant",
    schoolCode,
  };
  const gradeRulesState = {
    ...state,
    teachers: [
      teacherRecord,
      otherTeacher,
      ...((state.teachers ?? []).filter((row) => String(row.id) !== String(teacherRecord.id) && String(row.id) !== String(otherTeacher.id))),
    ],
    assignments: [
      assignment,
      ...((state.assignments ?? []).filter((row) => String(row.id) !== String(assignment.id))),
    ],
    students: studentRows,
  };
  const evalSession = buildGradeEntrySession({
    state: gradeRulesState,
    author: teacherSessionUser,
    evaluationInput: {
      schoolCode,
      className: CLASS_ASSIGNED,
      subject: SUBJECT,
      period: PERIOD,
      evaluationType: "Devoir",
      title: `Devoir intégration ${stamp}`,
      date: attendanceDate,
      scale: 20,
      coefficient: 1,
      status: "Ouverte",
      teacherId: teacherRecord.id,
      teacherName: teacherDisplayName,
    },
    studentGrades: assignedStudents.map((student, index) => ({
      studentId: student.id,
      value: index === 0 ? 15 : 13,
    })),
  });
  assert.ok(evalSession.ok, evalSession.error);

  const foreignEval = createEvaluation(
    {
      schoolCode,
      className: CLASS_OTHER,
      subject: OTHER_SUBJECT,
      period: PERIOD,
      evaluationType: "Devoir",
      title: "Devoir hors périmètre",
      date: attendanceDate,
      scale: 20,
      coefficient: 1,
    },
    teacherSessionUser,
  );
  const foreignDenied = teacherCanAccessEvaluation(teacherSessionUser, foreignEval, gradeRulesState) === false;
  pushResult(
    results,
    "7. Évaluation créée (classe affectée)",
    evalSession.evaluation.id,
    evalSession.evaluation.title,
    Boolean(evalSession.evaluation.id),
  );
  pushResult(results, "8. Évaluation hors périmètre refusée", "false", String(!foreignDenied), foreignDenied);

  state = await putStatePatch(adminToken, {
    evaluations: [evalSession.evaluation, ...(state.evaluations ?? [])],
    notes: [...gradesToLegacyNotes(evalSession.grades), ...(state.notes ?? [])],
  });

  const notePostRes = await request("/notes", {
    method: "POST",
    token: teacherToken,
    body: {
      studentId: assignedStudents[0].matricule ?? assignedStudents[0].id,
      subject: SUBJECT,
      value: 15,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: evalSession.evaluation.id,
      evaluationTitle: evalSession.evaluation.title,
      period: PERIOD,
      date: attendanceDate,
      className: CLASS_ASSIGNED,
    },
  });
  pushResult(
    results,
    "9. Note saisie via API",
    "201",
    String(notePostRes.status),
    notePostRes.status === 201 || notePostRes.status === 200,
  );

  const notesRes = await request("/notes", { token: teacherToken });
  const teacherNotes = extractApiList(notesRes);
  const notesForAssignedStudents = teacherNotes.filter((row) =>
    assignedStudents.some((student) => String(student.id) === String(row.studentId)),
  );
  pushResult(
    results,
    "10. Notes consultables (élèves affectés)",
    ">=1",
    String(notesForAssignedStudents.length),
    notesRes.status === 200 && notesForAssignedStudents.length >= 1,
  );

  const foreignStudentNotesRes = await request(
    `/students/${encodeURIComponent(otherStudent.id)}/notes`,
    { token: teacherToken },
  );
  const foreignStudentNotes = extractApiList(foreignStudentNotesRes);
  pushResult(
    results,
    "11. Notes élève hors périmètre inaccessibles",
    "0",
    String(foreignStudentNotes.length),
    foreignStudentNotes.length === 0,
  );

  const persistedState = await getState(adminToken);
  const persistedEvaluation = (persistedState.evaluations ?? []).find(
    (row) => String(row.id) === String(evalSession.evaluation.id),
  );
  pushResult(
    results,
    "12. Évaluation persistée en base",
    evalSession.evaluation.id,
    persistedEvaluation?.title ?? "—",
    Boolean(persistedEvaluation),
  );

  console.log("\n=== E2E 0028 : Enseignant — planning, notes & évaluations ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Enseignant    : ${teacherUser.identifier}`);
  console.log(`Planning      : ${ownSchedule.className} ${ownSchedule.subject} (${ownSchedule.start})`);
  console.log(`Évaluation    : ${evalSession.evaluation.title}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0028 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
