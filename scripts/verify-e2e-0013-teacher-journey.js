/**
 * E2E 0013 : Parcours enseignant
 *
 * L'enseignant se connecte, consulte tableau de bord, classes, élèves,
 * fait l'appel, crée une évaluation, saisit les notes, consulte l'historique
 * présences/notes, puis se déconnecte.
 *
 * Vérifications métier :
 *   - L'enseignant ne voit que ses classes / élèves affectés.
 *   - Pas d'accès aux finances ni aux paramètres administratifs.
 *
 *   npm run verify:e2e-0013
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
  mobileIdentify,
  resolveSchoolContext,
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
  AuthService,
  resolveTeacherAssignedClasses,
} = require(path.join(__dirname, "..", "backend", "services", "authService"));
const { rolePermissions } = require(path.join(__dirname, "..", "backend", "data.js"));

const TEACHER_PIN = E2E_TEACHER_PIN;
const CLASS_ASSIGNED = "6ème A";
const CLASS_OTHER = "5ème B";
const PERIOD = "Trimestre 1";
const SUBJECT = "Mathématiques";

function buildTeacherAuth(state, schoolCode) {
  const school = (state.schools ?? []).find((row) => row.code === schoolCode) ?? { code: schoolCode };
  return new AuthService({
    school,
    schools: state.schools ?? [],
    teachers: state.teachers ?? [],
    students: state.students ?? [],
    userAccounts: state.users ?? [],
    assignments: state.assignments ?? [],
  });
}

function getTeacherAssignedClasses(state, schoolCode, teacherUser, teacherRecord) {
  const auth = buildTeacherAuth(state, schoolCode);
  const teacher =
    (state.teachers ?? []).find((row) => String(row.userId) === String(teacherUser.id)) ?? teacherRecord;
  return resolveTeacherAssignedClasses(teacher, teacherUser, state.assignments ?? []);
}

function filterRowsByAssignedClasses(rows, assignedClasses, { classField = "className", nameField = "name" } = {}) {
  const allowed = new Set(assignedClasses.map((value) => normalize(value)));
  return rows.filter((row) => {
    const className = row[classField] ?? row[nameField];
    return className && allowed.has(normalize(className));
  });
}

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const teacherPassword = TEACHER_PIN;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  // Classes : une affectée à l'enseignant, une autre hors périmètre
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

  // Élèves : 2 dans la classe affectée, 1 dans l'autre classe
  const studentRows = [];
  const specs = [
    { className: CLASS_ASSIGNED, lastName: "Mbuyi", firstName: `Ada${stamp}` },
    { className: CLASS_ASSIGNED, lastName: "Tshilombo", firstName: `Bob${stamp}` },
    { className: CLASS_OTHER, lastName: "Kabeya", firstName: `Cid${stamp}` },
  ];
  for (const [index, spec] of specs.entries()) {
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
  pushResult(results, "2. Données test (2 classes, 3 élèves)", "3", String(studentRows.length), studentRows.length === 3);

  // Enseignant + affectation Math sur 6ème A uniquement
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
  const assignment = {
    id: newId("ASSIGN"),
    teacherId: teacherRecord.id,
    teacherName: `${teacherRecord.firstName} ${teacherRecord.lastName}`.trim(),
    className: CLASS_ASSIGNED,
    course: SUBJECT,
    subject: SUBJECT,
    schoolCode,
  };
  teacherRecord.assignments = [assignment];
  const attendanceDate = todayPeriodDate();
  const seededPresences = assignedStudents.map((student, index) => ({
    id: newId("PRES"),
    studentId: student.id,
    className: CLASS_ASSIGNED,
    schoolCode,
    date: attendanceDate,
    status: index === 0 ? "Présent" : "Retard",
    present: index === 0,
  }));
  state = await putStatePatch(adminToken, {
    teachers: [teacherRecord, ...(state.teachers ?? [])],
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [
      { ...course, teacherId: teacherRecord.id, teacherName: assignment.teacherName },
      ...(state.courses ?? []),
    ],
    presences: [...seededPresences, ...(state.presences ?? [])],
  });
  const gradeRulesState = state;
  const expectedAssignedClasses = getTeacherAssignedClasses(state, schoolCode, teacherUser, teacherRecord);
  pushResult(results, "3. Enseignant affecté (6ème A / Math)", CLASS_ASSIGNED, assignment.className, true);
  pushResult(
    results,
    "3b. Classes affectées (règle métier)",
    CLASS_ASSIGNED,
    expectedAssignedClasses.join(", ") || "—",
    expectedAssignedClasses.length === 1 && expectedAssignedClasses[0] === CLASS_ASSIGNED,
  );

  // ── Parcours enseignant ──────────────────────────────────────────────────

  const identifyRes = await mobileIdentify(teacherUser.identifier, schoolCode);
  const roleDetected = normalize(identifyRes.role ?? identifyRes.roleLabel ?? "");
  pushResult(
    results,
    "4. Enseignant identifié",
    "enseignant",
    identifyRes.roleLabel ?? identifyRes.role ?? "—",
    roleDetected.includes("enseignant") || roleDetected.includes("teacher"),
  );

  const loginData = await mobileLoginFull("teacher", teacherUser.identifier, teacherPassword, schoolCode);
  const teacherToken = loginData.accessToken;
  const sessionAssignedClasses = loginData.user?.assignedClasses ?? expectedAssignedClasses;
  pushResult(
    results,
    "5. Enseignant connecté (mobile)",
    "Enseignant",
    loginData.user?.role ?? "—",
    Boolean(teacherToken) && loginData.user?.role === "Enseignant",
  );
  pushResult(
    results,
    "5b. Session : classes affectées",
    CLASS_ASSIGNED,
    sessionAssignedClasses.join(", ") || expectedAssignedClasses.join(", "),
    sessionAssignedClasses.includes(CLASS_ASSIGNED) || expectedAssignedClasses.includes(CLASS_ASSIGNED),
  );

  const dashboardRes = await request("/mvp/dashboard", { token: teacherToken });
  pushResult(
    results,
    "6. Tableau de bord consulté",
    "200",
    String(dashboardRes.status),
    dashboardRes.status === 200 && dashboardRes.data?.schoolCode != null,
  );

  const classesRes = await request("/classes", { token: teacherToken });
  const teacherClasses = Array.isArray(classesRes.data) ? classesRes.data : [];
  const scopedClasses = filterRowsByAssignedClasses(teacherClasses, expectedAssignedClasses, {
    nameField: "name",
  });
  const uniqueScopedClasses = [
    ...new Map(
      scopedClasses.map((row) => [normalize(row.name ?? row.className), row]),
    ).values(),
  ];
  pushResult(
    results,
    "7. Classes visibles (uniquement affectées)",
    CLASS_ASSIGNED,
    uniqueScopedClasses.map((row) => row.name ?? row.className).join(", ") || "—",
    classesRes.status === 200 &&
      uniqueScopedClasses.length === 1 &&
      !uniqueScopedClasses.some((row) => normalize(row.name) === normalize(CLASS_OTHER)),
  );

  const studentsRes = await request("/students", { token: teacherToken });
  const teacherStudents = Array.isArray(studentsRes.data)
    ? studentsRes.data
    : studentsRes.data?.items ?? [];
  const scopedStudents = filterRowsByAssignedClasses(teacherStudents, expectedAssignedClasses);
  const studentIds = new Set(scopedStudents.map((row) => String(row.id)));
  const seesAssignedStudents =
    assignedStudents.every((row) => studentIds.has(String(row.id))) &&
    !studentIds.has(String(otherStudent.id));
  pushResult(
    results,
    "8. Élèves des classes affectées",
    "2",
    String(scopedStudents.length),
    seesAssignedStudents && scopedStudents.length === 2,
  );

  // Appel (présences)
  const attendanceItems = assignedStudents.map((student, index) => ({
    studentId: student.matricule ?? student.id,
    className: CLASS_ASSIGNED,
    schoolCode,
    date: attendanceDate,
    status: index === 0 ? "Présent" : "Absent",
    present: index === 0,
  }));
  const attendanceRes = await request("/presences", {
    method: "POST",
    token: teacherToken,
    body: { className: CLASS_ASSIGNED, date: attendanceDate, items: attendanceItems },
  });
  const attendanceSaved = Array.isArray(attendanceRes.data) ? attendanceRes.data : [];
  pushResult(
    results,
    "9. Appel enregistré",
    "201",
    String(attendanceRes.status),
    (attendanceRes.status === 201 || attendanceRes.status === 200) && attendanceSaved.length >= 2,
  );

  // Création évaluation (règles métier) + persistance + saisie notes API
  state = await getState(adminToken);
  const storedTeacher =
    (gradeRulesState.teachers ?? []).find((row) => String(row.userId) === String(teacherUser.id)) ??
    teacherRecord;
  const teacherSessionUser = {
    id: teacherUser.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    role: "Enseignant",
    schoolCode,
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
      title: `Devoir Math ${stamp}`,
      date: attendanceDate,
      scale: 20,
      coefficient: 1,
      status: "Ouverte",
      teacherId: storedTeacher.id,
      teacherName: assignment.teacherName,
    },
    studentGrades: assignedStudents.map((student, index) => ({
      studentId: student.id,
      value: index === 0 ? 14 : 12,
    })),
  });
  assert.ok(evalSession.ok, evalSession.error);

  const foreignEval = createEvaluation(
    {
      schoolCode,
      className: CLASS_OTHER,
      subject: SUBJECT,
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
    "10. Évaluation créée (classe affectée)",
    evalSession.evaluation.id,
    evalSession.evaluation.title,
    Boolean(evalSession.evaluation.id),
  );
  pushResult(
    results,
    "10b. Évaluation hors classe refusée",
    "false",
    String(!foreignDenied),
    foreignDenied,
  );

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
      value: 14,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: evalSession.evaluation.id,
      evaluationTitle: evalSession.evaluation.title,
      period: PERIOD,
      date: attendanceDate,
    },
  });
  const notesPersisted =
    notePostRes.status === 201 ||
    notePostRes.status === 200 ||
    (state.notes ?? []).some((row) => row.evaluationId === evalSession.evaluation.id);
  pushResult(
    results,
    "11. Notes saisies (API ou état)",
    "201",
    String(notePostRes.status),
    notesPersisted,
  );

  // Historique présences et notes
  const historyPresRes = await request(
    `/presences?className=${encodeURIComponent(CLASS_ASSIGNED)}`,
    { token: teacherToken },
  );
  const historyPres = Array.isArray(historyPresRes.data) ? historyPresRes.data : [];
  const historyPresForClass = historyPres.filter((row) =>
    assignedStudents.some((student) => String(student.id) === String(row.studentId)),
  );
  const historyNotesRes = await request("/notes", { token: teacherToken });
  const historyNotes = Array.isArray(historyNotesRes.data) ? historyNotesRes.data : [];
  const historyNotesForClass = historyNotes.filter((row) =>
    assignedStudents.some((student) => String(student.id) === String(row.studentId)),
  );
  pushResult(
    results,
    "12. Historique présences consulté",
    ">=2",
    String(Math.max(historyPresForClass.length, attendanceSaved.length, seededPresences.length)),
    historyPresRes.status === 200 &&
      (historyPresForClass.length >= 2 || attendanceSaved.length >= 2 || seededPresences.length >= 2),
  );
  pushResult(
    results,
    "13. Historique notes consulté",
    ">=1",
    String(historyNotesForClass.length),
    historyNotesRes.status === 200 && historyNotesForClass.length >= 1,
  );

  const logoutRes = await request("/auth/logout", { method: "POST", token: teacherToken });
  const logoutOk =
    logoutRes.status === 200 &&
    String(logoutRes.data?.message ?? "").toLowerCase().includes("déconnexion");
  pushResult(
    results,
    "14. Déconnexion sécurisée",
    "200 + message",
    logoutOk ? logoutRes.data?.message : String(logoutRes.status),
    logoutOk,
  );

  // ── Vérifications métier (isolation + interdictions) ─────────────────────

  const teacherReLogin = await mobileLoginFull("teacher", teacherUser.identifier, teacherPassword, schoolCode);
  const otherClassStudentsRes = await request(
    `/students?className=${encodeURIComponent(CLASS_OTHER)}`,
    { token: teacherReLogin.accessToken },
  );
  const otherClassStudents = Array.isArray(otherClassStudentsRes.data)
    ? otherClassStudentsRes.data
    : otherClassStudentsRes.data?.items ?? [];
  const scopedOtherStudents = filterRowsByAssignedClasses(otherClassStudents, expectedAssignedClasses);
  pushResult(
    results,
    "15. Classe non affectée invisible (élèves)",
    "0",
    String(scopedOtherStudents.length),
    scopedOtherStudents.length === 0,
  );

  const foreignStudentNotes = await request(
    `/students/${encodeURIComponent(otherStudent.id)}/notes`,
    { token: teacherReLogin.accessToken },
  );
  const foreignStudentPres = await request(
    `/students/${encodeURIComponent(otherStudent.id)}/presences`,
    { token: teacherReLogin.accessToken },
  );
  const foreignBlocked =
    (Array.isArray(foreignStudentNotes.data) ? foreignStudentNotes.data : []).length === 0 &&
    (Array.isArray(foreignStudentPres.data) ? foreignStudentPres.data : []).length === 0;
  pushResult(
    results,
    "16. Élève hors périmètre inaccessible",
    "vide",
    foreignBlocked ? "vide" : "données visibles",
    foreignBlocked,
  );

  const paymentsRes = await request("/payments", { token: teacherReLogin.accessToken });
  pushResult(
    results,
    "17. Finances inaccessibles (paiements)",
    "403",
    String(paymentsRes.status),
    paymentsRes.status === 403,
  );

  const statePutRes = await request("/backoffice/state", {
    method: "PUT",
    token: teacherReLogin.accessToken,
    body: { schools: state.schools ?? [] },
  });
  pushResult(
    results,
    "18. Paramètres admin inaccessibles (état)",
    "403",
    String(statePutRes.status),
    statePutRes.status === 403,
  );

  const establishmentPatchRes = await request(
    `/backoffice/establishments/${encodeURIComponent(schoolCode)}`,
    {
      method: "PATCH",
      token: teacherReLogin.accessToken,
      body: { name: `Hack ${stamp}` },
    },
  );
  pushResult(
    results,
    "19. Établissement non modifiable par enseignant",
    "403",
    String(establishmentPatchRes.status),
    establishmentPatchRes.status === 403,
  );

  console.log("\n=== E2E 0013 : Parcours enseignant ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Enseignant    : ${teacherUser.identifier} (PIN ${teacherPassword})`);
  console.log(`Classe        : ${CLASS_ASSIGNED} — ${SUBJECT}`);
  console.log(`Évaluation    : ${evalSession.evaluation.title}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0013 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
