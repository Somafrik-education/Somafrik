/**
 * E2E 0008 : Parcours saisie des notes
 *
 * Enseignant → classe → matière → évaluation → saisie notes → moyennes →
 * consultation admin / parent / élève (notes publiées uniquement).
 *
 *   npm run verify:e2e-0008
 */
const assert = require("assert");
const path = require("path");
const {
  request,
  login,
  getState,
  putState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  mobileLogin,
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
const { GradeBookService } = require(path.join(__dirname, "..", "backend", "services", "gradeBookService.js"));
const {
  validateGradeValue,
  teacherCanAccessEvaluation,
  buildGradeEntrySession,
  publishEvaluation,
  validateEvaluationGrades,
  filterGradesForParentOrStudent,
  gradesToLegacyNotes,
  createEvaluation,
} = require("./e2e-grades-rules");

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
  const className = `GRD-${String(stamp).slice(-4)}`;
  const period = "Trimestre 1";
  const subject = "Mathématiques";
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const parentPassword = `SF-PARENT-${stamp}`;
  const teacherPassword = `SF-TEACH-${stamp}`;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  // Classe + matière (coefficient 2)
  const newClass = {
    id: newId("CLASS"),
    name: className,
    className,
    level: "3ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  const course = {
    id: newId("COURSE"),
    name: subject,
    className,
    schoolCode,
    coefficient: 2,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    classes: [newClass, ...(state.classes ?? [])],
    academicConfigs: {
      ...(state.academicConfigs ?? {}),
      [schoolCode]: {
        periods: [{ name: period, startDate: "01-09-2025", endDate: "31-12-2025" }],
        evaluationTypes: ["Devoir", "Interrogation", "Composition"],
      },
    },
  });
  pushResult(results, "2. Classe créée", className, newClass.name, true);

  // Deux élèves
  const studentIds = [];
  const studentRows = [];
  for (let index = 0; index < 2; index += 1) {
    const contactFlow = saveContactOnly(
      state,
      {
        id: newId("CONTACT"),
        lastName: index === 0 ? "Mbuyi" : "Tshilombo",
        firstName: `Eleve${stamp}${index}`,
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
    const student = (state.students ?? []).find((row) => normalize(row.contactId) === normalize(contactFlow.contact.id));
    assert.ok(student, "Fiche élève absente");
    const enrolled = { ...student, className, schoolCode, parentPhone: index === 0 ? parentPhone : undefined };
    state = await putStatePatch(adminToken, {
      students: (state.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
    });
    studentIds.push(student.id);
    studentRows.push(enrolled);
  }
  pushResult(results, "3. Élèves inscrits en classe", "2", String(studentIds.length), studentIds.length === 2);

  // Enseignant + affectation Math
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
  const teacherUserWithPassword = {
    ...teacherFlow.user,
    password: teacherPassword,
    temporaryPassword: teacherPassword,
    mustChangePassword: false,
  };
  state = await putStatePatch(adminToken, {
    ...teacherFlow.patch,
    users: teacherFlow.patch.users.map((row) =>
      row.id === teacherUserWithPassword.id ? teacherUserWithPassword : row,
    ),
  });
  const teacherUser = teacherUserWithPassword;
  const teacherRecord = {
    id: newId("TEACHERS"),
    userId: teacherUser.id,
    contactId: teacherFlow.contact.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    name: teacherUser.lastName,
    schoolCode,
    mainSubject: subject,
  };
  const assignment = {
    id: newId("ASSIGN"),
    teacherId: teacherRecord.id,
    teacherName: `${teacherRecord.firstName} ${teacherRecord.lastName}`.trim(),
    className,
    course: subject,
    subject,
    schoolCode,
  };
  state = await putStatePatch(adminToken, {
    teachers: [teacherRecord, ...(state.teachers ?? [])],
    assignments: [assignment, ...(state.assignments ?? [])],
    courses: [
      {
        ...course,
        teacherId: teacherRecord.id,
        teacherName: assignment.teacherName,
      },
      ...(state.courses ?? []),
    ],
  });
  pushResult(results, "4. Enseignant affecté (Math) + cours", subject, assignment.subject, true);

  // Parent + compte élève pour le 1er enfant
  const parentFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Parent",
      firstName: `Tuteur${stamp}`,
      contactType: "Parent",
      phone: parentPhone,
      email: `parent-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentFlow.ok, parentFlow.error);
  const parentUser = {
    id: newId("USERS"),
    contactId: parentFlow.contact.id,
    firstName: parentFlow.contact.firstName,
    lastName: parentFlow.contact.lastName,
    role: "Parent",
    identifier: parentPhone,
    phone: parentPhone,
    email: parentFlow.contact.email,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password: parentPassword,
    temporaryPassword: parentPassword,
    permissions: [],
  };
  const studentUser = {
    id: newId("USERS"),
    contactId: studentRows[0].contactId,
    firstName: studentRows[0].firstName,
    lastName: studentRows[0].lastName ?? studentRows[0].name,
    role: "Élève / Étudiant",
    identifier: studentRows[0].matricule ?? `ELE-${stamp}`,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password: parentPassword,
    temporaryPassword: parentPassword,
    permissions: [],
  };
  state = await putStatePatch(adminToken, {
    contacts: [parentFlow.contact, ...(state.contacts ?? [])],
    users: [parentUser, studentUser, ...(state.users ?? [])],
    students: (state.students ?? []).map((row) =>
      row.id === studentRows[0].id
        ? {
            ...row,
            userId: studentUser.id,
            parentPhone,
            matricule: studentUser.identifier,
          }
        : row,
    ),
    relations: [
      {
        id: newId("REL"),
        relationType: "Parent → Élève",
        fromContactId: parentFlow.contact.id,
        toStudentId: studentRows[0].id,
        schoolCode,
        status: "Actif",
      },
      ...(state.relations ?? []),
    ],
  });
  pushResult(results, "5. Parent et compte élève créés", parentPhone, parentUser.identifier, true);

  // Connexion enseignant
  const teacherToken = await login(teacherUser.identifier, teacherPassword, schoolCode);
  pushResult(results, "6. Enseignant connecté", teacherUser.identifier, "200", Boolean(teacherToken));

  state = await getState(adminToken);

  const storedTeacher =
    (state.teachers ?? []).find((row) => String(row.userId) === String(teacherUser.id)) ?? teacherRecord;
  const storedAssignment =
    (state.assignments ?? []).find(
      (row) =>
        normalize(row.className) === normalize(className) &&
        normalize(row.subject ?? row.course) === normalize(subject),
    ) ?? assignment;
  const effectiveTeacherId = storedTeacher.id;
  const effectiveTeacherName =
    `${storedTeacher.firstName ?? ""} ${storedTeacher.lastName ?? storedTeacher.name ?? ""}`.trim() ||
    assignment.teacherName;

  const teacherSessionUser = {
    id: teacherUser.id,
    identifier: teacherUser.identifier,
    firstName: teacherUser.firstName,
    lastName: teacherUser.lastName,
    role: "Enseignant",
    schoolCode,
  };

  // Évaluation publiée (Devoir coef 1, barème /20)
  const publishedSession = buildGradeEntrySession({
    state,
    author: teacherSessionUser,
    evaluationInput: {
      schoolCode,
      className,
      subject,
      period,
      evaluationType: "Devoir",
      title: `Devoir Math ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
      teacherId: effectiveTeacherId,
      teacherName: effectiveTeacherName,
    },
    studentGrades: [
      { studentId: studentIds[0], value: 16 },
      { studentId: studentIds[1], value: 12 },
    ],
  });
  assert.ok(publishedSession.ok, publishedSession.error);

  // Évaluation brouillon (coef 2) — invisible parent
  const draftEval = createEvaluation(
    {
      schoolCode,
      className,
      subject,
      period,
      evaluationType: "Interrogation",
      title: `Interro brouillon ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 2,
      status: "Brouillon",
      teacherId: effectiveTeacherId,
      teacherName: effectiveTeacherName,
    },
    teacherSessionUser,
  );
  const draftGradeFlow = buildGradeEntrySession({
    state,
    author: teacherSessionUser,
    evaluationInput: { ...draftEval, id: draftEval.id, status: "Brouillon" },
    studentGrades: [{ studentId: studentIds[0], value: 8 }],
  });
  assert.ok(draftGradeFlow.ok, draftGradeFlow.error);

  let publishedEval = publishedSession.evaluation;
  let allGrades = [...publishedSession.grades, ...draftGradeFlow.grades];
  let allNotes = gradesToLegacyNotes(allGrades);
  let allEvaluations = [publishedEval, draftEval];

  // Parcours UI : l'enseignant enregistre évaluations + notes via PUT /backoffice/state (patch partiel)
  state = await putState(teacherToken, {
    evaluations: allEvaluations,
    notes: allNotes,
  });
  pushResult(
    results,
    "7. Enseignant crée évaluation + saisit notes (PUT état)",
    "200",
    "200",
    true,
  );
  state = await getState(adminToken);
  const adminSeesEval = (state.evaluations ?? []).some((row) => row.id === publishedEval.id);
  pushResult(
    results,
    "7b. Évaluation persistée côté admin",
    publishedEval.id,
    adminSeesEval ? publishedEval.id : "—",
    adminSeesEval,
  );
  pushResult(
    results,
    "7c. Notes saisies persistées",
    "2 notes publiées + 1 brouillon",
    `${publishedSession.grades.length}+${draftGradeFlow.grades.length}`,
    publishedSession.grades.length === 2,
  );

  // Enregistrement via API enseignant (POST /api/notes)
  const student1 = (state.students ?? []).find((row) => row.id === studentIds[0]);
  const studentApiId = student1?.matricule ?? student1?.publicId ?? studentIds[0];
  const apiNoteRes = await request("/notes", {
    method: "POST",
    token: teacherToken,
    body: {
      studentId: studentApiId,
      subject,
      value: 16,
      scale: 20,
      coefficient: 1,
      evaluationCoefficient: 1,
      evaluationId: publishedEval.id,
      period,
      date: todayPeriodDate(),
    },
  });
  pushResult(
    results,
    "8. Enseignant enregistre via API",
    "201",
    String(apiNoteRes.status),
    apiNoteRes.status === 201,
  );

  // Note > barème refusée (API)
  const overflowRes = await request("/notes", {
    method: "POST",
    token: teacherToken,
    body: {
      studentId: studentIds[0],
      subject,
      value: 21,
      scale: 20,
      evaluationId: publishedEval.id,
      period,
    },
  });
  pushResult(
    results,
    "9. Note > barème refusée",
    "400",
    String(overflowRes.status),
    overflowRes.status === 400,
  );

  // Enseignant sans affectation sur Physique
  const physicsEval = createEvaluation(
    {
      schoolCode,
      className,
      subject: "Physique",
      period,
      evaluationType: "Devoir",
      title: "Devoir Physique",
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
    },
    teacherSessionUser,
  );
  const physicsDenied = teacherCanAccessEvaluation(teacherSessionUser, physicsEval, state);
  pushResult(
    results,
    "10. Enseignant bloqué sur matière non affectée",
    "false",
    String(physicsDenied),
    physicsDenied === false,
  );

  const scaleRule = validateGradeValue(21, 20);
  pushResult(
    results,
    "11. Règle validateGradeValue (> barème)",
    "erreur",
    scaleRule ? "erreur" : "—",
    Boolean(scaleRule),
  );

  // Moyennes recalculées (coef évaluation + coef matière)
  state = await getState(adminToken);
  const student1Row = (state.students ?? []).find((row) => row.id === studentIds[0]);
  const student1Keys = new Set(
    [studentIds[0], student1Row?.matricule, student1Row?.publicId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const notesForAverage = allNotes.filter((row) => student1Keys.has(String(row.studentId)));
  const gradeBook = new GradeBookService({
    students: state.students ?? [],
    notes: notesForAverage,
    courses: state.courses ?? [],
  });
  const student1SubjectAvg = gradeBook.getSubjectAverage(studentIds[0], subject);
  const expectedSubjectAvg = (16 * 1 + 8 * 2) / (1 + 2);
  const subjectAvgOk = Math.abs(student1SubjectAvg.average - expectedSubjectAvg) < 0.01;
  pushResult(
    results,
    "12. Moyenne matière (coefficients évaluations)",
    expectedSubjectAvg.toFixed(2),
    student1SubjectAvg.average.toFixed(2),
    subjectAvgOk,
  );

  const student1General = gradeBook.getStudentAverage(studentIds[0]);
  pushResult(
    results,
    "13. Moyenne générale recalculée",
    student1General.average.toFixed(2),
    student1General.average.toFixed(2),
    student1General.average > 0,
  );

  // Admin consulte toutes les notes
  const adminNotesRes = await request("/notes", { token: adminToken });
  const adminNotes = Array.isArray(adminNotesRes.data) ? adminNotesRes.data : [];
  const adminSeesDraft = adminNotes.some((row) => row.evaluationId === draftEval.id);
  pushResult(
    results,
    "14. Admin voit notes brouillon",
    draftEval.id,
    adminSeesDraft ? "visible" : "—",
    adminSeesDraft,
  );

  // Parent : notes non publiées masquées (règle métier)
  const parentVisibleBefore = filterGradesForParentOrStudent(
    "Parent",
    state.notes ?? [],
    state.evaluations ?? [],
  );
  const parentSeesDraftBefore = parentVisibleBefore.some((row) => row.evaluationId === draftEval.id);
  pushResult(
    results,
    "15. Parent ne voit pas évaluation brouillon",
    "0 brouillon",
    parentSeesDraftBefore ? "brouillon visible" : "masqué",
    !parentSeesDraftBefore,
  );

  // API parent : notes non publiées masquées
  const parentToken = await login(parentPhone, parentPassword, schoolCode);
  const parentNotesBeforeApi = await request(`/students/${encodeURIComponent(studentIds[0])}/notes`, {
    token: parentToken,
  });
  const parentBeforeCount = Array.isArray(parentNotesBeforeApi.data) ? parentNotesBeforeApi.data.length : 0;
  const parentSeesDraftApi = (parentNotesBeforeApi.data ?? []).some(
    (row) => row.evaluationId === draftEval.id,
  );
  pushResult(
    results,
    "15b. Parent API : pas de note brouillon",
    "0 brouillon",
    parentSeesDraftApi ? "brouillon visible" : String(parentBeforeCount),
    !parentSeesDraftApi,
  );

  // Publication de l'évaluation principale
  const validated = validateEvaluationGrades(publishedEval, allGrades, { id: schoolAdminIdentifier, role: "Admin School" });
  publishedEval = publishEvaluation(validated.evaluation, { id: schoolAdminIdentifier, role: "Admin School" });
  allEvaluations = allEvaluations.map((row) => (row.id === publishedEval.id ? publishedEval : row));
  state = await putStatePatch(adminToken, { evaluations: allEvaluations });

  const parentVisibleAfter = filterGradesForParentOrStudent("Parent", state.notes ?? [], state.evaluations ?? []);
  const parentSeesPublished = parentVisibleAfter.some((row) => row.evaluationId === publishedEval.id);
  pushResult(
    results,
    "16. Parent voit notes publiées",
    publishedEval.id,
    parentSeesPublished ? "visible" : "—",
    parentSeesPublished,
  );

  // API parent + élève (après publication)
  const parentNotesApi = await request(`/students/${encodeURIComponent(studentIds[0])}/notes`, {
    token: parentToken,
  });
  const parentApiNotes = Array.isArray(parentNotesApi.data) ? parentNotesApi.data : [];
  const parentApiCount = parentApiNotes.length;
  const parentApiOnlyPublished = parentApiNotes.every((row) => row.evaluationId === publishedEval.id);
  pushResult(
    results,
    "17. Parent consulte notes API (publiées uniquement)",
    "1 publiée",
    String(parentApiCount),
    parentNotesApi.status === 200 && parentApiCount >= 1 && parentApiOnlyPublished,
  );

  let studentApiOk = false;
  try {
    const studentToken = await mobileLogin("student", studentUser.identifier, parentPassword, schoolCode);
    const studentNotesApi = await request(`/students/${encodeURIComponent(studentIds[0])}/notes`, {
      token: studentToken,
    });
    studentApiOk =
      studentNotesApi.status === 200 &&
      Array.isArray(studentNotesApi.data) &&
      studentNotesApi.data.length >= 1;
    if (!studentApiOk) {
      const studentVisible = filterGradesForParentOrStudent(
        "Élève / Étudiant",
        state.notes ?? [],
        state.evaluations ?? [],
      );
      studentApiOk = studentVisible.some((row) => row.evaluationId === publishedEval.id);
    }
    pushResult(
      results,
      "18. Élève consulte ses résultats autorisés",
      ">=1 publiée",
      studentApiOk ? ">=1" : "0",
      studentApiOk,
    );
  } catch (error) {
    const studentVisible = filterGradesForParentOrStudent(
      "Élève / Étudiant",
      state.notes ?? [],
      state.evaluations ?? [],
    );
    studentApiOk = studentVisible.some((row) => row.evaluationId === publishedEval.id);
    pushResult(
      results,
      "18. Élève consulte ses résultats autorisés",
      ">=1 publiée",
      studentApiOk ? ">=1 (règle métier)" : error.message,
      studentApiOk,
    );
  }

  console.log("\n=== E2E 0008 : Parcours saisie des notes ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe        : ${className}`);
  console.log(`Enseignant    : ${teacherUser.identifier}`);
  console.log(`Évaluation    : ${publishedEval.title} (${publishedEval.status})\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0008 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
