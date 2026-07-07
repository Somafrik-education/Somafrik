/**
 * E2E 0005 : Parcours inscription / affectation d'un élève
 *
 * Contact élève → Mon établissement > Élèves → affectation classe → parents →
 * visibilité fiche (identité, parents, paiements, présences, notes).
 *
 *   npm run verify:e2e-0005
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
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const {
  prepareContactForSave,
  validateContactDuplicate,
  getLinkableContactOptions,
  assertContactRequiredFields,
} = require("./e2e-contacts-rules");
const {
  resolveSchoolYear,
  assertStudentHasContact,
  validateDuplicateClassEnrollment,
  buildEnrollmentPatch,
  studentsInClass,
} = require("./e2e-student-enrollment-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block, duplicate };
  const contact = { ...prepared, id: draft.id ?? newId("CONTACT") };
  return { ok: true, contact };
}

function createFicheFromContact(state, contactId, schoolCode) {
  const contact = (state.contacts ?? []).find((row) => String(row.id) === String(contactId));
  if (!contact) return { ok: false, error: "Contact introuvable." };
  const link = linkContactToOperationalRecord(contact, state, schoolCode);
  if (!link.linkedType || link.linkedType !== "student") {
    return { ok: false, error: "Ce contact ne peut pas devenir une fiche élève." };
  }
  return {
    ok: true,
    link,
    patch: {
      contacts: (state.contacts ?? []).map((row) =>
        String(row.id) === String(contactId) ? link.contact : row,
      ),
      students: link.students,
    },
  };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const className = `INS-${String(stamp).slice(-4)}`;
  const schoolYear = resolveSchoolYear();
  const matricule = `ELE-E2E-${stamp}`;
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const parentPassword = `SF-PARENT-${stamp}`;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  // Classe cible
  const newClass = {
    id: newId("CLASS"),
    name: className,
    className,
    level: "2ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    classes: [newClass, ...(state.classes ?? [])],
  });
  pushResult(results, "2. Classe créée", className, newClass.name, true);

  // Contact parent (référentiel Contacts)
  const parentContactId = newId("CONTACT");
  const parentFlow = saveContactOnly(
    state,
    {
      id: parentContactId,
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
    contactId: parentContactId,
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
  state = await putStatePatch(adminToken, {
    contacts: [parentFlow.contact, ...(state.contacts ?? [])],
    users: [parentUser, ...(state.users ?? [])],
  });
  pushResult(results, "3. Contact parent créé", "Parent", parentFlow.contact.contactType, true);

  // Contact élève SANS fiche opérationnelle (étape Contacts uniquement)
  const studentContactId = newId("CONTACT");
  const studentContactFlow = saveContactOnly(
    state,
    {
      id: studentContactId,
      lastName: "Kabeya",
      firstName: `Eleve${stamp}`,
      contactType: "Élève",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `eleve-${stamp}@somafrik.app`,
      gender: "Masculin",
      birthDate: "12-08-2011",
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(studentContactFlow.ok, studentContactFlow.error);
  state = await putStatePatch(adminToken, {
    contacts: [studentContactFlow.contact, ...(state.contacts ?? [])],
  });
  pushResult(results, "4. Contact élève créé (Contacts)", "Élève", studentContactFlow.contact.contactType, true);

  // Mon établissement > Élèves > Ajouter depuis un contact
  const linkable = getLinkableContactOptions(state, schoolCode, "student");
  const isLinkable = linkable.some((row) => row.id === studentContactId);
  pushResult(
    results,
    "5. Contact disponible (Ajouter depuis un contact)",
    studentContactId,
    isLinkable ? studentContactId : "—",
    isLinkable,
  );
  assert.ok(isLinkable, "Contact élève non proposé dans le sélecteur");

  const fiche = createFicheFromContact(state, studentContactId, schoolCode);
  assert.ok(fiche.ok, fiche.error);
  state = await putStatePatch(adminToken, fiche.patch);
  let student = (state.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(studentContactId),
  );
  assert.ok(student, "Fiche élève absente après liaison contact");
  pushResult(
    results,
    "6. Fiche élève créée depuis contact",
    studentContactId,
    student.id,
    Boolean(student?.contactId),
  );

  // Affectation classe + matricule + statut + année scolaire
  const enrollment = buildEnrollmentPatch(student, {
    className,
    matricule,
    schoolYear,
    schoolStatus: "Inscrit",
    enrollmentDate: todayPeriodDate(),
    parentPhone,
    parentName: `${parentFlow.contact.lastName} ${parentFlow.contact.firstName}`.trim(),
  });
  const dupError = validateDuplicateClassEnrollment(state.students ?? [], enrollment);
  assert.strictEqual(dupError, null, dupError);
  state = await putStatePatch(adminToken, {
    students: (state.students ?? []).map((row) =>
      String(row.id) === String(student.id) ? enrollment : row,
    ),
  });
  student = (state.students ?? []).find((row) => row.id === student.id);
  pushResult(
    results,
    "7. Élève affecté (classe + matricule + année)",
    `${className}/${schoolYear}`,
    `${student?.className}/${student?.schoolYear}`,
    student?.className === className && student?.matricule === matricule,
  );

  // Relation parent → élève
  const relation = {
    id: newId("REL"),
    relationType: "Parent → Élève",
    fromContactId: parentContactId,
    fromContactName: `${parentFlow.contact.lastName} ${parentFlow.contact.firstName}`.trim(),
    toStudentId: student.id,
    toStudentName: `${student.firstName} ${student.name}`.trim(),
    schoolCode,
    isPrincipal: "Oui",
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    relations: [relation, ...(state.relations ?? [])],
  });
  pushResult(
    results,
    "8. Parent/tuteur associé",
    parentContactId,
    (state.relations ?? []).find((row) => row.id === relation.id)?.fromContactId ?? "—",
    Boolean((state.relations ?? []).some((row) => row.toStudentId === student.id)),
  );

  // Données pédagogiques & financières pour la fiche détail
  const note = {
    id: newId("NOTE"),
    studentId: student.id,
    studentName: `${student.firstName} ${student.name}`.trim(),
    className,
    schoolCode,
    subject: "Mathématiques",
    value: 14,
    period: "Trimestre 1",
    date: todayPeriodDate(),
  };
  const presence = {
    id: newId("PRES"),
    studentId: student.id,
    className,
    schoolCode,
    date: todayPeriodDate(),
    status: "Présent",
  };
  const payment = {
    id: newId("PAY"),
    publicId: `PAY-E2E-${stamp}`,
    reference: `PAY-E2E-${stamp}`,
    schoolCode,
    studentId: student.id,
    studentName: `${student.firstName} ${student.name}`.trim(),
    className,
    feeType: "Inscription",
    label: "Inscription",
    amount: 25_000,
    currency: "CDF",
    method: "Espèces",
    date: todayPeriodDate(),
    status: "Payé",
  };
  state = await putStatePatch(adminToken, {
    notes: [note, ...(state.notes ?? [])],
    presences: [presence, ...(state.presences ?? [])],
    payments: [payment, ...(state.payments ?? [])],
  });

  // Élève visible dans la liste de la classe (API Mon établissement)
  const classListRes = await request(
    `/students?className=${encodeURIComponent(className)}`,
    { token: adminToken },
  );
  const classStudents = Array.isArray(classListRes.data)
    ? classListRes.data
    : classListRes.data?.items ?? [];
  const inClassList = classStudents.some(
    (row) => String(row.id) === String(student.id) || row.matricule === matricule,
  );
  pushResult(
    results,
    "9. Élève dans la liste de la classe",
    matricule,
    inClassList ? matricule : `0/${classStudents.length}`,
    inClassList && classListRes.status === 200,
  );

  // Fiche détail : identité + parents + notes + présences + paiements
  const detailRes = await request(`/students/${encodeURIComponent(student.id)}`, {
    token: adminToken,
  });
  const notesRes = await request(`/students/${encodeURIComponent(student.id)}/notes`, {
    token: adminToken,
  });
  const presRes = await request(`/students/${encodeURIComponent(student.id)}/presences`, {
    token: adminToken,
  });
  const payRes = await request(`/students/${encodeURIComponent(student.id)}/payments`, {
    token: adminToken,
  });
  const identityOk =
    detailRes.status === 200 &&
    detailRes.data?.className === className &&
    detailRes.data?.matricule === matricule;
  const notesOk = Array.isArray(notesRes.data) && notesRes.data.some((row) => row.id === note.id);
  const presOk = Array.isArray(presRes.data) && presRes.data.some((row) => row.id === presence.id);
  const payOk = Array.isArray(payRes.data) && payRes.data.some((row) => row.id === payment.id);
  pushResult(
    results,
    "10. Fiche détail (identité + classe + parent)",
    className,
    detailRes.data?.className ?? String(detailRes.status),
    identityOk && detailRes.data?.parentPhone === parentPhone,
  );
  pushResult(results, "10b. Notes visibles", "1", String(notesRes.data?.length ?? 0), notesOk);
  pushResult(results, "10c. Présences visibles", "1", String(presRes.data?.length ?? 0), presOk);
  pushResult(results, "10d. Paiements visibles", "1", String(payRes.data?.length ?? 0), payOk);

  // Règles métier
  pushResult(
    results,
    "11. Élève lié à un contact",
    "contactId",
    student.contactId ? "OK" : "—",
    assertStudentHasContact(student),
  );

  const duplicateAttempt = validateDuplicateClassEnrollment(state.students ?? [], {
    ...student,
    id: newId("STUDENTS-DUP"),
  });
  pushResult(
    results,
    "12. Double affectation même classe/année bloquée",
    "erreur",
    duplicateAttempt ? "erreur" : "—",
    Boolean(duplicateAttempt),
  );

  // Parent voit l'élève (connexion web + liste API)
  const parentToken = await login(parentPhone, parentPassword, schoolCode);
  const parentStudentsRes = await request("/students", { token: parentToken });
  const parentStudents = Array.isArray(parentStudentsRes.data)
    ? parentStudentsRes.data
    : parentStudentsRes.data?.items ?? [];
  const parentSeesChild = parentStudents.some((row) => String(row.id) === String(student.id));
  pushResult(
    results,
    "13. Lien parent-élève visible côté parent",
    student.id,
    parentSeesChild ? student.id : `0/${parentStudents.length}`,
    parentSeesChild,
  );

  const parentRelations = (state.relations ?? []).filter(
    (row) => row.toStudentId === student.id && row.fromContactId === parentContactId,
  );
  pushResult(
    results,
    "13b. Relation parent-enfant enregistrée",
    relation.id,
    parentRelations[0]?.id ?? "—",
    parentRelations.length === 1,
  );

  console.log("\n=== E2E 0005 : Inscription / affectation élève ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe        : ${className} (${schoolYear})`);
  console.log(`Élève         : ${matricule} — ${student.firstName} ${student.name}`);
  console.log(`Parent        : ${parentPhone}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0005 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
