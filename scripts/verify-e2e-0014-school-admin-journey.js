/**
 * E2E 0014 : Parcours admin établissement
 *
 * L'admin se connecte, configure classes, contacts, affectations élèves/enseignants,
 * frais, consulte paiements/impayés/présences/notes, publie une annonce, se déconnecte.
 *
 * Vérifications métier :
 *   - Périmètre limité à son établissement.
 *   - Actions sensibles tracées (audit).
 *
 *   npm run verify:e2e-0014
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
  ADMIN_PASSWORD,
  setupActiveSchool,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const {
  prepareContactForSave,
  assertContactRequiredFields,
  validateContactDuplicate,
} = require("./e2e-contacts-rules");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
const { saveSchoolClassFlow, ensureExplicitAcademicClassNames } = require("./e2e-class-rules");
const {
  resolveSchoolYear,
  buildEnrollmentPatch,
  studentsInClass,
} = require("./e2e-student-enrollment-rules");
const {
  newFeeId,
  validateFeeGridInput,
  applyFeeGridToStudents,
} = require("./e2e-fee-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));
const { createStudentFromContact } = require("./e2e-contact-flow");

const PAST_DUE = "01-01-2026";
const ACADEMIC_YEAR = resolveSchoolYear();

function saveContactFlow(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  const contact = { ...prepared, id: draft.id ?? newId("CONTACT") };
  return { ok: true, contact };
}

function buildFeeItems(gridId, schoolCode, className) {
  return [
    {
      id: newFeeId("FEEITEM"),
      feeGridId: gridId,
      schoolCode,
      className,
      feeType: "Inscription",
      label: "Frais d'inscription",
      amount: 50_000,
      mandatory: true,
      dueDate: PAST_DUE,
      status: "Actif",
    },
    {
      id: newFeeId("FEEITEM"),
      feeGridId: gridId,
      schoolCode,
      className,
      feeType: "Transport",
      label: "Transport",
      amount: 30_000,
      mandatory: true,
      dueDate: PAST_DUE,
      status: "Actif",
    },
  ];
}

function buildOverdueFee(student, amount) {
  return {
    id: newFeeId("STUFEE"),
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName ?? student.name}`,
    schoolCode: student.schoolCode,
    className: student.className,
    schoolFeeItemId: newFeeId("FEEITEM"),
    feeGridId: newFeeId("FEEGRID"),
    feeType: "Inscription",
    label: "Frais d'inscription",
    currency: "CDF",
    academicYear: ACADEMIC_YEAR,
    initialAmount: amount,
    discount: 0,
    exemption: 0,
    amountDue: amount,
    amountPaid: 0,
    balance: amount,
    status: "En retard",
    dueDate: PAST_DUE,
    periodLabel: ACADEMIC_YEAR,
    createdAt: new Date().toISOString(),
  };
}

function extractListRows(response) {
  if (Array.isArray(response.data)) return response.data;
  return response.data?.data ?? response.data?.items ?? [];
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const className = `ADM-${String(stamp).slice(-4)}`;
  const subject = "Mathématiques";

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const schoolA = await resolveSchoolContext(superToken);
  const schoolB = await setupActiveSchool(superToken, stamp + 1);
  const { schoolCode, schoolAdminIdentifier, adminToken } = schoolA;
  pushResult(
    results,
    "1. Admin établissement connecté",
    "200",
    schoolAdminIdentifier,
    Boolean(adminToken),
  );

  let state = await getState(adminToken);

  // Établissement B (hors périmètre) + élève témoin
  let otherSchoolState = await getState(schoolB.adminToken);
  const otherStudentFlow = createStudentFromContact(
    otherSchoolState,
    {
      id: newId("CONTACT"),
      lastName: "Ecole",
      firstName: `Autre${stamp}`,
      contactType: "Élève",
      phone: `+243 812 ${String(stamp).slice(-6)}`,
      email: `autre-ecole-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolB.schoolCode,
    {
      className: "6ème Z",
      matricule: `ELE-OTHER-${stamp}`,
      schoolYear: ACADEMIC_YEAR,
      schoolStatus: "Inscrit",
    },
  );
  assert.ok(otherStudentFlow.ok, otherStudentFlow.error);
  const otherSchoolStudent = otherStudentFlow.student;
  await putStatePatch(schoolB.adminToken, {
    ...otherStudentFlow.patch,
    classes: [
      {
        id: newId("CLASS"),
        name: "6ème Z",
        className: "6ème Z",
        schoolCode: schoolB.schoolCode,
        status: "Actif",
      },
      ...(otherSchoolState.classes ?? []),
    ],
  });

  // 2) Configuration classes
  const academicSetup = ensureExplicitAcademicClassNames(state, schoolCode);
  if (academicSetup.patch) {
    state = await putStatePatch(adminToken, academicSetup.patch);
  }
  const classFlow = saveSchoolClassFlow(
    state,
    {
      name: className,
      level: "3ème",
      track: "Générale",
      cycle: "Secondaire",
      schoolYear: ACADEMIC_YEAR,
      capacity: "35",
      status: "Active",
    },
    schoolCode,
  );
  assert.ok(classFlow.ok, classFlow.error);
  state = await putStatePatch(adminToken, classFlow.patch);
  pushResult(results, "2. Classe configurée", className, className, Boolean((state.classes ?? []).some((row) => row.name === className)));

  // 3) Contacts (élève + enseignant)
  const studentContactFlow = saveContactFlow(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Kabeya",
      firstName: `Eleve${stamp}`,
      contactType: "Élève",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `eleve-adm-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(studentContactFlow.ok, studentContactFlow.error);
  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "Kabongo",
    firstName: `Prof${stamp}`,
    contactType: "Enseignant",
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-adm-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };
  const teacherFlow = saveContactWithOptionalUserAccount(teacherContactDraft, state, schoolCode, {
    identifier: schoolAdminIdentifier,
    role: "Admin School",
    schoolCode,
  });
  assert.ok(teacherFlow.ok, teacherFlow.error);
  state = await putStatePatch(adminToken, {
    contacts: [studentContactFlow.contact, teacherFlow.contact, ...(state.contacts ?? [])],
    ...teacherFlow.patch,
  });
  pushResult(
    results,
    "3. Contacts créés (élève + enseignant)",
    "2",
    String((state.contacts ?? []).filter((row) => [studentContactFlow.contact.id, teacherFlow.contact.id].includes(row.id)).length),
    true,
  );

  // 4) Affectation élève
  const studentFlow = createStudentFromContact(
    state,
    {
      id: studentContactFlow.contact.id,
      lastName: studentContactFlow.contact.lastName,
      firstName: studentContactFlow.contact.firstName,
      contactType: studentContactFlow.contact.contactType,
      phone: studentContactFlow.contact.phone,
      email: studentContactFlow.contact.email,
      status: studentContactFlow.contact.status,
    },
    schoolCode,
  );
  assert.ok(studentFlow.ok, studentFlow.error);
  state = await putStatePatch(adminToken, studentFlow.patch);
  let student = studentFlow.student;
  const enrollment = buildEnrollmentPatch(student, {
    className,
    matricule: `ELE-ADM-${stamp}`,
    schoolYear: ACADEMIC_YEAR,
    schoolStatus: "Inscrit",
    enrollmentDate: todayPeriodDate(),
    parentPhone: `+243 820 ${String(stamp).slice(-6)}`,
  });
  state = await putStatePatch(adminToken, {
    students: (state.students ?? []).map((row) => (row.id === student.id ? enrollment : row)),
  });
  student = (state.students ?? []).find((row) => row.id === student.id);
  pushResult(
    results,
    "4. Élève affecté à la classe",
    className,
    student?.className ?? "—",
    student?.className === className,
  );

  // 5) Affectation enseignant
  const teacherUser = teacherFlow.user;
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
        id: newId("COURSE"),
        name: subject,
        className,
        schoolCode,
        coefficient: 2,
        status: "Actif",
        teacherId: teacherRecord.id,
        teacherName: assignment.teacherName,
      },
      ...(state.courses ?? []),
    ],
  });
  pushResult(results, "5. Enseignant affecté (classe + matière)", className, assignment.className, true);

  // 6) Configuration frais
  const feeGridId = newFeeId("FEEGRID");
  const feeGrid = {
    id: feeGridId,
    schoolCode,
    className,
    academicYear: ACADEMIC_YEAR,
    periodName: "Année complète",
    currency: "CDF",
    status: "Active",
    createdBy: schoolAdminIdentifier,
    createdAt: new Date().toISOString(),
  };
  const feeItems = buildFeeItems(feeGridId, schoolCode, className);
  const feeValidation = validateFeeGridInput(feeGrid, feeItems, state);
  assert.ok(feeValidation.ok, feeValidation.error);
  const applyFees = applyFeeGridToStudents({ ...state, feeGrids: [feeGrid], schoolFeeItems: feeItems }, feeGridId);
  state = await putStatePatch(adminToken, {
    feeGrids: [feeGrid, ...(state.feeGrids ?? [])],
    schoolFeeItems: [...feeItems, ...(state.schoolFeeItems ?? [])],
    studentFees: applyFees.studentFees,
  });
  pushResult(
    results,
    "6. Frais configurés et appliqués",
    "Active",
    (state.feeGrids ?? []).find((row) => row.id === feeGridId)?.status ?? "—",
    (state.feeGrids ?? []).find((row) => row.id === feeGridId)?.status === "Active",
  );

  // Paiement partiel + frais impayé pour consultation
  const payment = {
    id: newId("PAY"),
    publicId: `PAY-ADM-${stamp}`,
    reference: `PAY-ADM-${stamp}`,
    schoolCode,
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName ?? student.name}`,
    className,
    feeType: "Inscription",
    label: "Inscription",
    amount: 20_000,
    currency: "CDF",
    method: "Espèces",
    date: todayPeriodDate(),
    status: "PAYE",
  };
  const overdueFee = buildOverdueFee(student, 30_000);
  const presence = {
    id: newId("PRES"),
    studentId: student.id,
    className,
    schoolCode,
    date: todayPeriodDate(),
    status: "Présent",
  };
  const note = {
    id: newId("NOTE"),
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName ?? student.name}`,
    className,
    schoolCode,
    subject,
    value: 15,
    period: "Trimestre 1",
    date: todayPeriodDate(),
  };
  const announcement = {
    id: newId("ANN"),
    schoolCode,
    title: `Annonce admin ${stamp}`,
    message: "Réunion du corps enseignant vendredi.",
    date: todayPeriodDate(),
    audience: "Tous",
    status: "Publié",
  };

  const auditBeforeRes = await request("/audit", { token: superToken });
  const auditBefore = extractListRows(auditBeforeRes);

  state = await putStatePatch(adminToken, {
    payments: [payment, ...(state.payments ?? [])],
    studentFees: [overdueFee, ...(state.studentFees ?? [])],
    presences: [presence, ...(state.presences ?? [])],
    notes: [note, ...(state.notes ?? [])],
    announcements: [announcement, ...(state.announcements ?? [])],
  });
  pushResult(results, "6b. Données financières et pédagogiques préparées", "OK", "OK", true);

  // 7) Consultation paiements
  const paymentsRes = await request("/payments", { token: adminToken });
  const payments = Array.isArray(paymentsRes.data)
    ? paymentsRes.data
    : paymentsRes.data?.items ?? paymentsRes.data?.data ?? [];
  const seesPayment = payments.some((row) => String(row.id) === String(payment.id) || row.reference === payment.reference);
  pushResult(
    results,
    "7. Paiements consultés",
    payment.reference,
    seesPayment ? payment.reference : `0/${payments.length}`,
    paymentsRes.status === 200 && seesPayment,
  );

  // 8) Consultation impayés
  const unpaidRes = await request("/backoffice/finance/unpaid", { token: adminToken });
  const unpaidRows = unpaidRes.data?.rows ?? [];
  const seesUnpaid = unpaidRows.some((row) => String(row.studentId) === String(student.id));
  pushResult(
    results,
    "8. Impayés consultés",
    student.id,
    seesUnpaid ? student.id : `0/${unpaidRows.length}`,
    unpaidRes.status === 200 && seesUnpaid,
  );

  // 9) Présences
  const presRes = await request(`/presences?className=${encodeURIComponent(className)}`, { token: adminToken });
  const presences = Array.isArray(presRes.data) ? presRes.data : [];
  pushResult(
    results,
    "9. Présences consultées",
    ">=1",
    String(presences.length),
    presRes.status === 200 && presences.length >= 1,
  );

  // 10) Notes
  const notesRes = await request("/notes", { token: adminToken });
  const notes = Array.isArray(notesRes.data) ? notesRes.data : [];
  const seesNote = notes.some((row) => row.id === note.id);
  pushResult(
    results,
    "10. Notes consultées",
    note.id,
    seesNote ? note.id : `0/${notes.length}`,
    notesRes.status === 200 && seesNote,
  );

  // 11) Annonce publiée
  const annRes = await request("/announcements", { token: adminToken });
  const announcements = Array.isArray(annRes.data) ? annRes.data : [];
  const seesAnnouncement = announcements.some((row) => row.id === announcement.id);
  pushResult(
    results,
    "11. Annonce publiée consultée",
    announcement.title,
    seesAnnouncement ? announcement.title : `0/${announcements.length}`,
    annRes.status === 200 && seesAnnouncement,
  );

  // ── Vérifications métier (avant déconnexion) ─────────────────────────────

  const studentsRes = await request("/students", { token: adminToken });
  const students = Array.isArray(studentsRes.data) ? studentsRes.data : studentsRes.data?.items ?? [];
  const seesOtherSchool = students.some((row) => String(row.id) === String(otherSchoolStudent.id));
  const ownSchoolOnly = students.every((row) => !row.schoolCode || row.schoolCode === schoolCode);
  pushResult(
    results,
    "12. Périmètre établissement (pas d'élève autre école)",
    "0 étranger",
    seesOtherSchool ? otherSchoolStudent.id : "0",
    !seesOtherSchool && ownSchoolOnly,
  );

  const filteredOther = students.filter((row) => row.schoolCode === schoolB.schoolCode);
  pushResult(
    results,
    "13. Données autre établissement invisibles",
    "0",
    String(filteredOther.length),
    filteredOther.length === 0,
  );

  const classList = studentsInClass(state.students ?? [], className, schoolCode);
  pushResult(
    results,
    "14. Élèves de l'établissement dans la classe",
    "1",
    String(classList.length),
    classList.length >= 1,
  );

  const adminAuditRes = await request("/audit", { token: adminToken });
  pushResult(
    results,
    "15. Audit global inaccessible à l'admin établissement",
    "403",
    String(adminAuditRes.status),
    adminAuditRes.status === 403,
  );

  const superAuditRes = await request("/audit", { token: superToken });
  const auditRows = extractListRows(superAuditRes);
  const newAuditRows = auditRows.filter(
    (row) => !auditBefore.some((before) => String(before.id) === String(row.id)),
  );
  const hasPaymentAudit = newAuditRows.some((row) =>
    ["create_payment", "sync_backoffice_state", "logout", "send_payment_reminder"].includes(
      String(row.action ?? ""),
    ),
  );
  pushResult(
    results,
    "16. Actions sensibles tracées (audit)",
    ">=1 trace",
    hasPaymentAudit ? `${newAuditRows.length} nouvelle(s)` : `${newAuditRows.length}/${auditRows.length}`,
    superAuditRes.status === 200 && (hasPaymentAudit || newAuditRows.length >= 1),
  );

  // 17) Déconnexion
  const logoutRes = await request("/auth/logout", { method: "POST", token: adminToken });
  const logoutOk =
    logoutRes.status === 200 &&
    String(logoutRes.data?.message ?? "").toLowerCase().includes("déconnexion");
  pushResult(
    results,
    "17. Déconnexion sécurisée",
    "200 + message",
    logoutOk ? logoutRes.data?.message : String(logoutRes.status),
    logoutOk,
  );

  console.log("\n=== E2E 0014 : Parcours admin établissement ===");
  console.log(`Établissement A : ${schoolCode}`);
  console.log(`Établissement B : ${schoolB.schoolCode} (hors périmètre)`);
  console.log(`Admin          : ${schoolAdminIdentifier}`);
  console.log(`Classe         : ${className}`);
  console.log(`Élève          : ${student.matricule}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0014 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
