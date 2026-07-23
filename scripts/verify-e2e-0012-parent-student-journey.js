/**
 * E2E 0012 : Parcours parent / élève (+ contrat identité D3.4b)
 *
 * Le parent se connecte (téléphone + PIN), consulte ses enfants, présences,
 * notes publiées, paiements, annonces, puis se déconnecte.
 * Vérifie l'isolation : pas d'enfants d'autres parents, notes non publiées
 * masquées, paiements limités aux enfants liés.
 *
 * Identité (D3.4b) — scénarios séparés, sans double seed masquant :
 *   - résolution par relation (`fromContactId = contact.id`, sans parentPhone)
 *   - fallback legacy téléphone (sans relations)
 *   - relation avec user.id ne résout pas les enfants
 *
 *   npm run verify:e2e-0012
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
  mobileLoginFull,
  mobileIdentify,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const { prepareContactForSave, assertContactRequiredFields, validateContactDuplicate } = require("./e2e-contacts-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));
const { resolveParentChildren } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "parentChildren",
));
const { migrateParentRelationsToContactId } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "parentRelationIdentity",
));
const {
  buildGradeEntrySession,
  createEvaluation,
  filterGradesForParentOrStudent,
  gradesToLegacyNotes,
  publishEvaluation,
  validateEvaluationGrades,
} = require("./e2e-grades-rules");

const PARENT_PIN = "847392";
const CLASS_NAME = "6ème A";
const PERIOD = "Trimestre 1";
const SUBJECT = "Mathématiques";

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

function createStudentFromContact(state, contactDraft, schoolCode, enrollment) {
  const contactFlow = saveContactOnly(state, contactDraft, schoolCode);
  if (!contactFlow.ok) return contactFlow;
  const link = linkContactToOperationalRecord(contactFlow.contact, state, schoolCode);
  if (link.linkedType !== "student") return { ok: false, error: "Liaison élève impossible." };
  const student = (link.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
  );
  if (!student) return { ok: false, error: "Fiche élève absente." };
  const enrolled = { ...student, ...enrollment, schoolCode };
  return {
    ok: true,
    contact: link.contact,
    student: enrolled,
    students: (link.students ?? []).map((row) => (row.id === student.id ? enrolled : row)),
  };
}

function createParentUser(contact, schoolCode, phone, pin) {
  return {
    id: newId("USERS"),
    contactId: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    role: "Parent",
    identifier: phone,
    phone,
    email: contact.email,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password: pin,
    mustChangePassword: false,
    permissions: [],
  };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const parentAPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const parentBPhone = `+243 821 ${String(stamp).slice(-6)}`;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  // Classe
  const schoolClass = {
    id: newId("CLASS"),
    name: CLASS_NAME,
    className: CLASS_NAME,
    level: "6ème",
    track: "Générale",
    schoolCode,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    classes: [schoolClass, ...(state.classes ?? [])],
    academicConfigs: {
      ...(state.academicConfigs ?? {}),
      [schoolCode]: {
        periods: [{ name: PERIOD, startDate: "01-09-2025", endDate: "31-12-2025" }],
        evaluationTypes: ["Devoir", "Interrogation"],
      },
    },
  });

  // Parent A (2 enfants) + Parent B (1 enfant)
  const parentAContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Mukendi",
      firstName: `ParentA${stamp}`,
      contactType: "Parent",
      phone: parentAPhone,
      email: `parent-a-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentAContactFlow.ok, parentAContactFlow.error);
  const parentBContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Kabasele",
      firstName: `ParentB${stamp}`,
      contactType: "Parent",
      phone: parentBPhone,
      email: `parent-b-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentBContactFlow.ok, parentBContactFlow.error);

  const parentAUser = createParentUser(parentAContactFlow.contact, schoolCode, parentAPhone, PARENT_PIN);
  const parentBUser = createParentUser(parentBContactFlow.contact, schoolCode, parentBPhone, PARENT_PIN);

  // Parcours principal : relations-only (pas de parentPhone — D3.4b).
  const childSpecs = [
    { key: "childA1", firstName: `Jean${stamp}`, lastName: "Dupont" },
    { key: "childA2", firstName: `Marie${stamp}`, lastName: "Martin" },
    { key: "childB1", firstName: `Paul${stamp}`, lastName: "Bernard" },
  ];

  const children = {};
  const allStudents = [...(state.students ?? [])];
  const allContacts = [parentAContactFlow.contact, parentBContactFlow.contact, ...(state.contacts ?? [])];

  for (const [index, spec] of childSpecs.entries()) {
    const flow = createStudentFromContact(
      { ...state, contacts: allContacts, students: allStudents },
      {
        id: newId("CONTACT"),
        lastName: spec.lastName,
        firstName: spec.firstName,
        contactType: "Élève",
        phone: `+243 810 ${String(stamp + index).slice(-6)}`,
        email: `${spec.key}-${stamp}@somafrik.app`,
        status: "Actif",
      },
      schoolCode,
      {
        className: CLASS_NAME,
        matricule: `ELE-${spec.key.toUpperCase()}-${stamp}`,
        schoolStatus: "Inscrit",
      },
    );
    assert.ok(flow.ok, flow.error);
    children[spec.key] = flow.student;
    allContacts.push(flow.contact);
    const idx = allStudents.findIndex((row) => row.id === flow.student.id);
    if (idx >= 0) allStudents[idx] = flow.student;
    else allStudents.push(flow.student);
  }

  // Notes : évaluation publiée + brouillon (invisible parent)
  const publishedEvalInput = {
    schoolCode,
    className: CLASS_NAME,
    subject: SUBJECT,
    period: PERIOD,
    evaluationType: "Devoir",
    title: `Devoir publié ${stamp}`,
    date: todayPeriodDate(),
    scale: 20,
    coefficient: 1,
    status: "Publiée",
    teacherId: "E2E-TEACHER",
    teacherName: "Prof E2E",
  };
  const draftEval = createEvaluation(
    {
      schoolCode,
      className: CLASS_NAME,
      subject: SUBJECT,
      period: PERIOD,
      evaluationType: "Interrogation",
      title: `Interro brouillon ${stamp}`,
      date: todayPeriodDate(),
      scale: 20,
      coefficient: 1,
      status: "Brouillon",
      teacherId: "E2E-TEACHER",
      teacherName: "Prof E2E",
    },
    { id: schoolAdminIdentifier, role: "Admin School", schoolCode },
  );

  const author = { id: schoolAdminIdentifier, role: "Admin School", schoolCode };
  const publishedSession = buildGradeEntrySession({
    state: { students: allStudents },
    author,
    evaluationInput: publishedEvalInput,
    studentGrades: [
      { studentId: children.childA1.id, value: 15 },
      { studentId: children.childA2.id, value: 13 },
      { studentId: children.childB1.id, value: 11 },
    ],
  });
  assert.ok(publishedSession.ok, publishedSession.error);

  const draftSession = buildGradeEntrySession({
    state: { students: allStudents },
    author,
    evaluationInput: { ...draftEval, id: draftEval.id, status: "Brouillon" },
    studentGrades: [{ studentId: children.childA1.id, value: 7 }],
  });
  assert.ok(draftSession.ok, draftSession.error);

  let publishedEval = publishedSession.evaluation;
  const validated = validateEvaluationGrades(publishedEval, publishedSession.grades, author);
  publishedEval = publishEvaluation(validated.evaluation, author);

  const allNotes = gradesToLegacyNotes([...publishedSession.grades, ...draftSession.grades]);
  const allEvaluations = [publishedEval, draftEval];

  // Présences, paiements, annonces
  const presences = childSpecs.map((spec, index) => ({
    id: newId("PRES"),
    studentId: children[spec.key].id,
    className: CLASS_NAME,
    schoolCode,
    date: todayPeriodDate(),
    status: index === 0 ? "Présent" : index === 1 ? "Absent" : "Présent",
  }));

  const payments = [
    {
      id: newId("PAY"),
      publicId: `PAY-PAID-A1-${stamp}`,
      reference: `PAY-PAID-A1-${stamp}`,
      schoolCode,
      studentId: children.childA1.id,
      studentName: `${children.childA1.firstName} ${children.childA1.lastName}`,
      className: CLASS_NAME,
      feeType: "Scolarité",
      label: "Tranche 1",
      amount: 25_000,
      currency: "CDF",
      method: "Mobile Money",
      date: todayPeriodDate(),
      status: "PAYE",
    },
    {
      id: newId("PAY"),
      publicId: `PAY-PEND-A1-${stamp}`,
      reference: `PAY-PEND-A1-${stamp}`,
      schoolCode,
      studentId: children.childA1.id,
      studentName: `${children.childA1.firstName} ${children.childA1.lastName}`,
      className: CLASS_NAME,
      feeType: "Scolarité",
      label: "Tranche 2",
      amount: 15_000,
      currency: "CDF",
      method: "Espèces",
      date: todayPeriodDate(),
      status: "EN_ATTENTE",
    },
    {
      id: newId("PAY"),
      publicId: `PAY-PAID-A2-${stamp}`,
      reference: `PAY-PAID-A2-${stamp}`,
      schoolCode,
      studentId: children.childA2.id,
      studentName: `${children.childA2.firstName} ${children.childA2.lastName}`,
      className: CLASS_NAME,
      feeType: "Scolarité",
      label: "Tranche 1",
      amount: 20_000,
      currency: "CDF",
      method: "Virement",
      date: todayPeriodDate(),
      status: "PAYE",
    },
    {
      id: newId("PAY"),
      publicId: `PAY-PAID-B1-${stamp}`,
      reference: `PAY-PAID-B1-${stamp}`,
      schoolCode,
      studentId: children.childB1.id,
      studentName: `${children.childB1.firstName} ${children.childB1.lastName}`,
      className: CLASS_NAME,
      feeType: "Scolarité",
      label: "Tranche 1",
      amount: 30_000,
      currency: "CDF",
      method: "Espèces",
      date: todayPeriodDate(),
      status: "PAYE",
    },
  ];

  const announcement = {
    id: newId("ANN"),
    schoolCode,
    title: `Réunion parents ${stamp}`,
    message: "Réunion générale samedi à 10h00.",
    date: todayPeriodDate(),
    audience: "Parents",
    status: "Publié",
  };

  const relations = [
    {
      id: newId("REL"),
      relationType: "Parent → Élève",
      fromContactId: parentAContactFlow.contact.id,
      toStudentId: children.childA1.id,
      schoolCode,
      isPrincipal: "Oui",
      status: "Actif",
    },
    {
      id: newId("REL"),
      relationType: "Parent → Élève",
      fromContactId: parentAContactFlow.contact.id,
      toStudentId: children.childA2.id,
      schoolCode,
      isPrincipal: "Oui",
      status: "Actif",
    },
    {
      id: newId("REL"),
      relationType: "Parent → Élève",
      fromContactId: parentBContactFlow.contact.id,
      toStudentId: children.childB1.id,
      schoolCode,
      isPrincipal: "Oui",
      status: "Actif",
    },
  ];

  state = await putStatePatch(adminToken, {
    contacts: allContacts,
    users: [parentAUser, parentBUser, ...(state.users ?? [])],
    students: allStudents,
    relations: [...relations, ...(state.relations ?? [])],
    notes: [...allNotes, ...(state.notes ?? [])],
    evaluations: [...allEvaluations, ...(state.evaluations ?? [])],
    presences: [...presences, ...(state.presences ?? [])],
    payments: [...payments, ...(state.payments ?? [])],
    announcements: [announcement, ...(state.announcements ?? [])],
  });
  pushResult(results, "2. Données test créées (2 parents, 3 enfants)", "OK", "OK", true);

  // ── Parcours parent A (mobile) ───────────────────────────────────────────

  const identifyRes = await mobileIdentify(parentAPhone, schoolCode);
  const roleDetected = normalize(identifyRes.role ?? identifyRes.roleLabel ?? "");
  pushResult(
    results,
    "3. Parent identifié (téléphone)",
    "parent",
    identifyRes.roleLabel ?? identifyRes.role ?? "—",
    roleDetected.includes("parent"),
  );

  const loginData = await mobileLoginFull("parent_student", parentAPhone, PARENT_PIN, schoolCode);
  const parentToken = loginData.accessToken;
  const loginChildren = loginData.user?.children ?? [];
  pushResult(
    results,
    "4. Parent connecté (téléphone + PIN)",
    "200",
    String(loginData.user?.role ?? "—"),
    Boolean(parentToken) && loginData.user?.role === "Parent",
  );

  pushResult(
    results,
    "5. Liste des enfants du parent",
    "2",
    String(loginChildren.length),
    loginChildren.length === 2,
  );

  const childIds = new Set(loginChildren.map((row) => String(row.id)));
  const seesOwnChildren =
    childIds.has(String(children.childA1.id)) && childIds.has(String(children.childA2.id));
  pushResult(
    results,
    "5b. Enfants corrects (A1 + A2)",
    `${children.childA1.id},${children.childA2.id}`,
    [...childIds].join(","),
    seesOwnChildren,
  );

  // Sélection enfant 1 — présences
  const presChild1Res = await request(`/students/${encodeURIComponent(children.childA1.id)}/presences`, {
    token: parentToken,
  });
  const presChild1 = Array.isArray(presChild1Res.data) ? presChild1Res.data : [];
  const presChild1Ok =
    presChild1Res.status === 200 &&
    presChild1.some((row) => row.studentId === children.childA1.id && row.status === "Présent");
  pushResult(
    results,
    "6. Présences enfant sélectionné (A1)",
    "Présent",
    presChild1[0]?.status ?? String(presChild1.length),
    presChild1Ok,
  );

  // Notes publiées
  const notesChild1Res = await request(`/students/${encodeURIComponent(children.childA1.id)}/notes`, {
    token: parentToken,
  });
  const notesChild1 = Array.isArray(notesChild1Res.data) ? notesChild1Res.data : [];
  const parentVisibleNotes = filterGradesForParentOrStudent("Parent", allNotes, allEvaluations).filter(
    (row) => String(row.studentId) === String(children.childA1.id),
  );
  const seesPublishedNote = notesChild1.some((row) => row.evaluationId === publishedEval.id);
  const draftHiddenByRule = !parentVisibleNotes.some((row) => row.evaluationId === draftEval.id);
  pushResult(
    results,
    "7. Notes publiées consultées (A1)",
    publishedEval.id,
    seesPublishedNote ? "publiée" : String(notesChild1.length),
    notesChild1Res.status === 200 && seesPublishedNote,
  );
  pushResult(
    results,
    "7b. Note brouillon masquée (règle métier)",
    "masquée",
    draftHiddenByRule ? "masquée" : "visible",
    draftHiddenByRule,
  );

  // Paiements + reste à payer
  const payChild1Res = await request(`/students/${encodeURIComponent(children.childA1.id)}/payments`, {
    token: parentToken,
  });
  const payChild1 = Array.isArray(payChild1Res.data) ? payChild1Res.data : [];
  const paidRows = payChild1.filter((row) => row.status === "PAYE");
  const pendingRows = payChild1.filter((row) => row.status === "EN_ATTENTE");
  const paidAmount = paidRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const pendingAmount = pendingRows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  pushResult(
    results,
    "8. Paiements enfant A1",
    "PAYE + EN_ATTENTE",
    `${paidRows.length} payé / ${pendingRows.length} attente`,
    payChild1Res.status === 200 && paidRows.length >= 1 && pendingRows.length >= 1,
  );
  pushResult(
    results,
    "8b. Reste à payer (A1)",
    "15000",
    String(pendingAmount),
    pendingAmount === 15_000 && paidAmount === 25_000,
  );

  // Sélection enfant 2
  const presChild2Res = await request(`/students/${encodeURIComponent(children.childA2.id)}/presences`, {
    token: parentToken,
  });
  const presChild2 = Array.isArray(presChild2Res.data) ? presChild2Res.data : [];
  pushResult(
    results,
    "9. Présences enfant sélectionné (A2)",
    "1",
    String(presChild2.length),
    presChild2Res.status === 200 && presChild2.length >= 1,
  );

  const payAllRes = await request("/payments", { token: parentToken });
  const payAll = Array.isArray(payAllRes.data)
    ? payAllRes.data
    : payAllRes.data?.items ?? payAllRes.data?.data ?? [];
  const payStudentIds = new Set(payAll.map((row) => String(row.studentId)));
  const payOnlyLinked =
    payStudentIds.size >= 1 &&
    [...payStudentIds].every(
      (id) => id === String(children.childA1.id) || id === String(children.childA2.id),
    );
  pushResult(
    results,
    "10. Paiements limités aux enfants liés",
    "A1,A2",
    [...payStudentIds].join(","),
    payOnlyLinked && !payStudentIds.has(String(children.childB1.id)),
  );

  // Annonces
  const annRes = await request("/announcements", { token: parentToken });
  const announcements = Array.isArray(annRes.data) ? annRes.data : [];
  const seesAnnouncement = announcements.some((row) => row.id === announcement.id);
  pushResult(
    results,
    "11. Annonces de l'établissement",
    announcement.title,
    seesAnnouncement ? announcement.title : `0/${announcements.length}`,
    annRes.status === 200 && seesAnnouncement,
  );

  // Déconnexion (révoque la session côté serveur ; le JWT reste valide jusqu'à expiration)
  const logoutRes = await request("/auth/logout", { method: "POST", token: parentToken });
  const logoutOk =
    logoutRes.status === 200 &&
    String(logoutRes.data?.message ?? "").toLowerCase().includes("déconnexion");
  pushResult(
    results,
    "12. Déconnexion sécurisée",
    "200 + message",
    logoutOk ? logoutRes.data?.message : String(logoutRes.status),
    logoutOk,
  );

  // ── Vérifications métier (isolation) ─────────────────────────────────────

  const parentBLogin = await mobileLoginFull("parent_student", parentBPhone, PARENT_PIN, schoolCode);
  const parentBToken = parentBLogin.accessToken;
  const parentBChildren = parentBLogin.user?.children ?? [];
  pushResult(
    results,
    "13. Parent B voit uniquement son enfant",
    "1",
    String(parentBChildren.length),
    parentBChildren.length === 1 && String(parentBChildren[0]?.id) === String(children.childB1.id),
  );

  const parentAReLogin = await mobileLoginFull("parent_student", parentAPhone, PARENT_PIN, schoolCode);
  const parentAStudentsRes = await request("/students", { token: parentAReLogin.accessToken });
  const parentAStudents = Array.isArray(parentAStudentsRes.data)
    ? parentAStudentsRes.data
    : parentAStudentsRes.data?.items ?? [];
  const parentASeesBChild = parentAStudents.some((row) => String(row.id) === String(children.childB1.id));
  pushResult(
    results,
    "14. Parent A ne voit pas enfants Parent B",
    "0 enfant B",
    parentASeesBChild ? children.childB1.id : "0",
    !parentASeesBChild && parentAStudents.length === 2,
  );

  const foreignNotesRes = await request(`/students/${encodeURIComponent(children.childB1.id)}/notes`, {
    token: parentAReLogin.accessToken,
  });
  const foreignPresRes = await request(`/students/${encodeURIComponent(children.childB1.id)}/presences`, {
    token: parentAReLogin.accessToken,
  });
  const foreignPayRes = await request(`/students/${encodeURIComponent(children.childB1.id)}/payments`, {
    token: parentAReLogin.accessToken,
  });
  const foreignBlocked =
    (Array.isArray(foreignNotesRes.data) ? foreignNotesRes.data : []).length === 0 &&
    (Array.isArray(foreignPresRes.data) ? foreignPresRes.data : []).length === 0 &&
    (Array.isArray(foreignPayRes.data) ? foreignPayRes.data : []).length === 0;
  pushResult(
    results,
    "15. Accès enfant étranger bloqué (notes/présences/paiements)",
    "vide",
    foreignBlocked ? "vide" : "données visibles",
    foreignBlocked,
  );

  // ── D3.4b identité : scénarios séparés (pas de double seed) ─────────────

  const relationOnlyChildren = resolveParentChildren(
    parentAUser,
    {
      students: [children.childA1, children.childA2, children.childB1],
      relations,
    },
    schoolCode,
  );
  pushResult(
    results,
    "16. Identité — résolution par relation (sans parentPhone)",
    "2",
    String(relationOnlyChildren.length),
    relationOnlyChildren.length === 2 &&
      relationOnlyChildren.every((row) => !String(row.parentPhone ?? "").trim()),
  );

  const parentCPhone = `+243 822 ${String(stamp).slice(-6)}`;
  const parentCContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Legacy",
      firstName: `ParentC${stamp}`,
      contactType: "Parent",
      phone: parentCPhone,
      email: `parent-c-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentCContactFlow.ok, parentCContactFlow.error);
  const parentCUser = createParentUser(parentCContactFlow.contact, schoolCode, parentCPhone, PARENT_PIN);
  const phoneChildFlow = createStudentFromContact(
    { ...state, contacts: [...allContacts, parentCContactFlow.contact], students: allStudents },
    {
      id: newId("CONTACT"),
      lastName: "LegacyChild",
      firstName: `Luc${stamp}`,
      contactType: "Élève",
      phone: `+243 830 ${String(stamp).slice(-6)}`,
      email: `child-c-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
    {
      className: CLASS_NAME,
      matricule: `ELE-PHONE-${stamp}`,
      parentPhone: parentCPhone,
      parentName: "Legacy Parent",
      schoolStatus: "Inscrit",
    },
  );
  assert.ok(phoneChildFlow.ok, phoneChildFlow.error);

  state = await putStatePatch(adminToken, {
    contacts: [parentCContactFlow.contact, phoneChildFlow.contact, ...(state.contacts ?? [])],
    users: [parentCUser, ...(state.users ?? [])],
    students: [phoneChildFlow.student, ...(state.students ?? [])],
  });

  const phoneOnlyChildren = resolveParentChildren(
    parentCUser,
    {
      students: [phoneChildFlow.student],
      relations: [],
    },
    schoolCode,
  );
  pushResult(
    results,
    "17. Identité — fallback legacy téléphone (sans relations)",
    "1",
    String(phoneOnlyChildren.length),
    phoneOnlyChildren.length === 1 &&
      String(phoneOnlyChildren[0]?.id) === String(phoneChildFlow.student.id),
  );

  const wrongKeyChildren = resolveParentChildren(
    parentAUser,
    {
      students: [children.childA1, children.childA2],
      relations: [
        {
          id: newId("REL"),
          relationType: "Parent → Élève",
          fromContactId: parentAUser.id,
          toStudentId: children.childA1.id,
          schoolCode,
          status: "Actif",
        },
      ],
    },
    schoolCode,
  );
  pushResult(
    results,
    "18. Identité — fromContactId=user.id ne résout pas",
    "0",
    String(wrongKeyChildren.length),
    wrongKeyChildren.length === 0,
  );

  const migrated = migrateParentRelationsToContactId({
    contacts: [parentAContactFlow.contact],
    users: [parentAUser],
    relations: [
      {
        id: "REL-LEGACY-UI",
        relationType: "Parent → Élève",
        fromContactId: parentAUser.id,
        toStudentId: children.childA1.id,
        schoolCode,
        status: "Actif",
      },
    ],
  });
  const afterMigration = resolveParentChildren(
    parentAUser,
    {
      students: [children.childA1],
      relations: migrated.relations,
    },
    schoolCode,
  );
  pushResult(
    results,
    "19. Identité — migration user.id → contact.id",
    "1",
    String(afterMigration.length),
    migrated.changed === 1 && afterMigration.length === 1,
  );

  console.log("\n=== E2E 0012 : Parcours parent / élève ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Parent A       : ${parentAPhone} (PIN ${PARENT_PIN}) — enfants Jean + Marie`);
  console.log(`Parent B       : ${parentBPhone} (PIN ${PARENT_PIN}) — enfant Paul`);
  console.log(`Annonce        : ${announcement.title}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0012 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
