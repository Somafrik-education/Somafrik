/**
 * E2E 0002 : Parcours création des contacts
 *
 * Vérifie que les personnes sont créées d'abord dans Contacts, avec contrôle
 * des doublons, puis disponibles dans les autres modules (élève, enseignant, parent).
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0002
 */
const assert = require("assert");
const path = require("path");
const {
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const {
  prepareContactForSave,
  validateContactDuplicate,
  getLinkableContactOptions,
  getRelationParentContactOptions,
  simulateDirectEntityCreateGuard,
  assertContactRequiredFields,
  entityCreateViaContactsOnly,
} = require("./e2e-contacts-rules");
const {
  linkContactToOperationalRecord,
  syncContactRegistry,
} = require(path.join(__dirname, "..", "backend", "lib", "contactRegistrySync"));

function saveContactFlow(state, contactDraft, schoolCode) {
  const prepared = prepareContactForSave({ ...contactDraft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) {
    return { ok: false, error: requiredError };
  }
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) {
    return { ok: false, error: duplicate.block, duplicate };
  }
  const contact = { ...prepared, id: contactDraft.id ?? newId("CONTACT") };
  const contacts = [contact, ...(state.contacts ?? [])];
  let patch = { contacts };
  let link = null;

  if (["Élève", "Étudiant", "Enseignant"].includes(contact.contactType)) {
    link = linkContactToOperationalRecord(contact, { ...state, contacts });
    patch.contacts = contacts.map((row) =>
      String(row.id) === String(contact.id) ? link.contact : row,
    );
    if (link.students) patch.students = link.students;
    if (link.teachers) patch.teachers = link.teachers;
  }

  return { ok: true, contact: link?.contact ?? contact, patch, link, duplicate };
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const sharedPhone = `+243 810 ${String(stamp).slice(-6)}`;
  const sharedEmail = `contact-${stamp}@somafrik.app`;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);

  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);

  // 2–5) Création des types de contacts
  const contactSpecs = [
    {
      key: "eleve",
      label: "2. Contact élève",
      contactType: "Élève",
      lastName: "Kabeya",
      firstName: `Eleve${stamp}`,
      phone: sharedPhone,
      email: sharedEmail,
      birthDate: "10-05-2012",
    },
    {
      key: "parent",
      label: "3. Contact parent",
      contactType: "Parent",
      lastName: "Kabeya",
      firstName: `Parent${stamp}`,
      phone: `+243 820 ${String(stamp).slice(-6)}`,
      email: `parent-${stamp}@somafrik.app`,
    },
    {
      key: "enseignant",
      label: "4. Contact enseignant",
      contactType: "Enseignant",
      lastName: "Mukendi",
      firstName: `Prof${stamp}`,
      phone: `+243 830 ${String(stamp).slice(-6)}`,
      email: `prof-${stamp}@somafrik.app`,
    },
    {
      key: "admin",
      label: "5. Contact personnel admin (Secrétaire)",
      contactType: "Secrétaire",
      lastName: "Ilunga",
      firstName: `Sec${stamp}`,
      phone: `+243 840 ${String(stamp).slice(-6)}`,
      email: `sec-${stamp}@somafrik.app`,
    },
  ];

  const savedContacts = {};
  let pendingPatch = { contacts: state.contacts ?? [] };

  for (const spec of contactSpecs) {
    const workingState = { ...state, ...pendingPatch };
    const flow = saveContactFlow(workingState, spec, schoolCode);
    assert.ok(flow.ok, `${spec.label}: ${flow.error}`);
    pendingPatch = {
      contacts: flow.patch.contacts,
      students: flow.patch.students ?? pendingPatch.students ?? workingState.students ?? [],
      teachers: flow.patch.teachers ?? pendingPatch.teachers ?? workingState.teachers ?? [],
    };
    savedContacts[spec.key] = flow.contact;
    pushResult(results, spec.label, spec.contactType, flow.contact.contactType, true);
  }

  state = await putStatePatch(adminToken, pendingPatch);

  // 6) Doublon téléphone bloqué (même établissement)
  const dupPhone = validateContactDuplicate(
    prepareContactForSave(
      {
        lastName: "Doublon",
        firstName: "Tel",
        contactType: "Parent",
        schoolCode,
        phone: sharedPhone,
        email: `autre-${stamp}@somafrik.app`,
      },
      state,
    ),
    state.contacts ?? [],
  );
  pushResult(
    results,
    "6. Doublon téléphone bloqué",
    "block",
    dupPhone.block ? "block" : "—",
    Boolean(dupPhone.block),
  );

  // 7) Doublon email bloqué (même établissement)
  const dupEmail = validateContactDuplicate(
    prepareContactForSave(
      {
        lastName: "Doublon",
        firstName: "Mail",
        contactType: "Parent",
        schoolCode,
        phone: `+243 850 ${String(stamp).slice(-6)}`,
        email: sharedEmail,
      },
      state,
    ),
    state.contacts ?? [],
  );
  pushResult(
    results,
    "7. Doublon email bloqué",
    "block",
    dupEmail.block ? "block" : "—",
    Boolean(dupEmail.block),
  );

  // 8) Contacts enregistrés en base
  const storedIds = contactSpecs.map((spec) => savedContacts[spec.key]?.id).filter(Boolean);
  const allStored = storedIds.every((id) => (state.contacts ?? []).some((row) => row.id === id));
  pushResult(
    results,
    "8. Contacts enregistrés",
    String(storedIds.length),
    String((state.contacts ?? []).filter((row) => storedIds.includes(row.id)).length),
    allStored,
  );

  // 9) Fiche élève provisionnée depuis contact
  const studentContact = savedContacts.eleve;
  const studentRecord = (state.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(studentContact.id),
  );
  pushResult(
    results,
    "9. Élève disponible via contact (fiche liée)",
    studentContact.studentId ?? "studentId",
    studentRecord?.id ?? "—",
    Boolean(studentRecord && studentRecord.contactId === studentContact.id),
  );

  // 10) Fiche enseignant provisionnée depuis contact
  const teacherContact = savedContacts.enseignant;
  const teacherRecord = (state.teachers ?? []).find(
    (row) => normalize(row.contactId) === normalize(teacherContact.id),
  );
  pushResult(
    results,
    "10. Enseignant disponible via contact (fiche liée)",
    teacherContact.teacherId ?? "teacherId",
    teacherRecord?.id ?? "—",
    Boolean(teacherRecord && teacherRecord.contactId === teacherContact.id),
  );

  // 11) Parent disponible pour relations (module Parents / relations)
  const parentOptions = getRelationParentContactOptions(state, schoolCode);
  const parentVisible = parentOptions.some((row) => row.id === savedContacts.parent.id);
  pushResult(
    results,
    "11. Parent disponible (module relations)",
    savedContacts.parent.id,
    parentVisible ? savedContacts.parent.id : "—",
    parentVisible,
  );

  // 12) Nouveau contact élève non lié → sélecteur « créer fiche depuis contact »
  const pendingStudentContact = {
    id: newId("CONTACT"),
    lastName: "Pending",
    firstName: `Eleve2-${stamp}`,
    contactType: "Élève",
    schoolCode,
    phone: `+243 860 ${String(stamp).slice(-6)}`,
    email: `eleve2-${stamp}@somafrik.app`,
    status: "Actif",
  };
  state = await putStatePatch(adminToken, {
    contacts: [pendingStudentContact, ...(state.contacts ?? [])],
  });
  const linkableStudents = getLinkableContactOptions(state, schoolCode, "student");
  pushResult(
    results,
    "12. Contact élève disponible (sélecteur fiche)",
    pendingStudentContact.id,
    linkableStudents.some((row) => row.id === pendingStudentContact.id) ? pendingStudentContact.id : "—",
    linkableStudents.some((row) => row.id === pendingStudentContact.id),
  );

  // 13) Garde-fou UI : création directe élève/enseignant interdite
  const guardStudent = simulateDirectEntityCreateGuard("students", true);
  const guardTeacher = simulateDirectEntityCreateGuard("teachers", true);
  const guardContacts = simulateDirectEntityCreateGuard("contacts", true);
  pushResult(
    results,
    "13. Création directe Élèves bloquée (UI)",
    "refus",
    guardStudent.allowed ? "autorisé" : "refus",
    !guardStudent.allowed,
  );
  pushResult(
    results,
    "13b. Création directe Enseignants bloquée (UI)",
    "refus",
    guardTeacher.allowed ? "autorisé" : "refus",
    !guardTeacher.allowed,
  );
  pushResult(
    results,
    "13c. Contacts reste créable directement",
    "autorisé",
    guardContacts.allowed ? "autorisé" : "refus",
    guardContacts.allowed,
  );

  // 14) Règle registre : fiche élève sans contact = orpheline (purge sync)
  const orphanStudent = {
    id: newId("STUDENTS-ORPHAN"),
    name: "Orphelin",
    firstName: "Test",
    schoolCode,
    className: "X",
    matricule: "ORPHAN-001",
  };
  const withOrphan = {
    ...state,
    students: [orphanStudent, ...(state.students ?? [])],
  };
  const syncResult = syncContactRegistry(withOrphan);
  const orphanRemoved = !(syncResult.state.students ?? []).some(
    (row) => row.id === orphanStudent.id,
  );
  pushResult(
    results,
    "14. Fiche élève sans contact = orpheline (sync)",
    "supprimée",
    orphanRemoved ? "supprimée" : "conservée",
    orphanRemoved && syncResult.report.removed.students >= 1,
  );

  // 15) Tentative API directe : l'UI bloque, le registre nettoie
  pushResult(
    results,
    "15. Règle métier contacts-only active",
    "students+teachers",
    [...CONTACT_PROVISIONED_KEYS()].join("+"),
    entityCreateViaContactsOnly("students") && entityCreateViaContactsOnly("teachers"),
  );

  console.log("\n=== E2E 0002 : Parcours création des contacts ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Contacts créés : ${storedIds.length} (+ 1 en attente de fiche)`);
  console.log(`Élève lié     : ${studentRecord?.id ?? "—"}`);
  console.log(`Enseignant lié: ${teacherRecord?.id ?? "—"}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0002 : OK");
}

function CONTACT_PROVISIONED_KEYS() {
  return ["students", "teachers"].filter((key) => entityCreateViaContactsOnly(key));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
