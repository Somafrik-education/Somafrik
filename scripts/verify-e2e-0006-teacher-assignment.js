/**
 * E2E 0006 : Parcours création et affectation d'un enseignant.
 *
 * Objectif : vérifier qu'un enseignant peut être créé depuis un contact, doté
 * d'un compte utilisateur, affecté à une classe et une matière, puis qu'après
 * connexion il ne voit QUE ses classes et ses élèves.
 *
 * Parcours couvert :
 *   1. L'admin crée un contact enseignant (Contacts = référentiel unique).
 *   2. Il crée un compte utilisateur enseignant depuis ce contact.
 *   3. La création directe d'un enseignant hors Contacts est interdite.
 *   4. Il crée la fiche enseignant à partir du contact existant.
 *   5. Il l'affecte à une classe et à une matière (Affectations) et enregistre.
 *   6. L'enseignant se connecte.
 *   7. Il voit uniquement ses classes et ses élèves.
 *
 * Vérifications métier :
 *   - Un enseignant ne voit pas les classes qui ne lui sont pas affectées.
 *   - Une affectation est historisée (journal d'audit + affectations conservées).
 *   - Une affectation en doublon (même classe + matière) n'est pas recréée
 *     (contrôle de conflit ; le planning fin par créneau n'est pas géré au MVP,
 *     les affectations étant au niveau trimestre — voir note plus bas).
 *
 * Ce test est autonome : il rejoue la logique métier réelle en mémoire
 * (règles Contacts/Comptes portées dans scripts/e2e-*.js + AuthService backend),
 * sans serveur ni base de données.
 *
 * Exécution : npm run verify:e2e-0006
 */
const assert = require("assert");

const { AuthService } = require("../backend/services/authService");
const { normalize } = require("./e2e-api-helpers");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
const {
  simulateDirectEntityCreateGuard,
  getLinkableContactOptions,
} = require("./e2e-contacts-rules");

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${label}`);
  } catch (error) {
    failures.push({ label, message: error.message });
    console.error(`  \u2717 ${label}\n      ${error.message}`);
  }
}

/** Clé métier d'une affectation : établissement + classe + matière. */
function assignmentKey(a) {
  return `${normalize(a.schoolCode)}|${normalize(a.className)}|${normalize(a.course ?? a.subject)}`;
}

/**
 * Enregistre une affectation en reproduisant EntityPage :
 * - pas de doublon (classe + matière) — contrôle de conflit AFF-002 ;
 * - journalisation dans auditLog (WEB-ME-006 / RB-006).
 */
function saveAssignment(state, assignment, actor) {
  const key = assignmentKey(assignment);
  const exists = (state.assignments ?? []).some((row) => assignmentKey(row) === key);
  if (exists) {
    return { state, created: false, conflict: true };
  }
  const assignments = [{ ...assignment }, ...(state.assignments ?? [])];
  const auditLog = [
    {
      id: `AUDIT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      entityType: "assignment",
      action: "Création affectation",
      entityId: assignment.id,
      className: assignment.className,
      course: assignment.course,
      actorName: actor?.identifier ?? "Administrateur",
    },
    ...(state.auditLog ?? []),
  ];
  return { state: { ...state, assignments, auditLog }, created: true, conflict: false };
}

function buildAuth(state, school) {
  return new AuthService({
    school,
    schools: state.schools ?? [],
    teachers: state.teachers ?? [],
    students: state.students ?? [],
    userAccounts: state.users ?? [],
    countries: state.countries ?? [],
    subscriptions: state.subscriptions ?? [],
    assignments: state.assignments ?? [],
  });
}

function main() {
  console.log("\n=== E2E 0006 : Création et affectation d'un enseignant ===\n");

  const schoolCode = "CD-2026-0001";
  const school = {
    code: schoolCode,
    name: "Lycée Somafrik Test",
    country: "RDC",
    countryCode: "CD",
    city: "Kinshasa",
    type: "Lycée",
    status: "Actif",
    validationStatus: "Validé",
  };
  const admin = { identifier: "admin", countryScope: "RDC", role: "Admin School", schoolCode };

  const CLASS_ASSIGNED = "6ème A";
  const CLASS_OTHER = "5ème B";

  let state = {
    countries: [{ name: "RDC", code: "CD", status: "Actif" }],
    schools: [school],
    contacts: [],
    users: [],
    teachers: [],
    classes: [
      { id: "CLS-A", name: CLASS_ASSIGNED, schoolCode },
      { id: "CLS-B", name: CLASS_OTHER, schoolCode },
    ],
    students: [
      { id: "STU-A1", matricule: "ELE-0001", firstName: "Ada", lastName: "Nkosi", className: CLASS_ASSIGNED, schoolCode, parentPhone: "+243 820 000 001" },
      { id: "STU-A2", matricule: "ELE-0002", firstName: "Bob", lastName: "Mbala", className: CLASS_ASSIGNED, schoolCode, parentPhone: "+243 820 000 002" },
      { id: "STU-B1", matricule: "ELE-0003", firstName: "Cid", lastName: "Otema", className: CLASS_OTHER, schoolCode, parentPhone: "+243 820 000 003" },
    ],
    courses: [],
    assignments: [],
    subscriptions: [],
    auditLog: [],
  };

  // ── 1 & 2) Contact enseignant → compte utilisateur (Contacts = référentiel) ──
  const teacherContactDraft = {
    id: "CONTACT-ENS-1",
    lastName: "Seke",
    firstName: "Kilombo",
    contactType: "Enseignant",
    schoolCode,
    phone: "+243 831 000 111",
    email: "seke.kilombo@lycee-test.cd",
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };

  let teacherFlow;
  check("1-2. Contact enseignant créé + compte utilisateur provisionné", () => {
    teacherFlow = saveContactWithOptionalUserAccount(teacherContactDraft, state, schoolCode, admin);
    assert.ok(teacherFlow.ok, teacherFlow.error);
    assert.ok(teacherFlow.created, "Le compte enseignant doit être nouvellement créé.");
    assert.ok(teacherFlow.temporaryPassword, "Un mot de passe provisoire est attendu.");
    state = { ...state, ...teacherFlow.patch };
    assert.strictEqual(teacherFlow.contact.userId, teacherFlow.user.id, "Contact non lié au compte.");
    assert.strictEqual(teacherFlow.user.role, "Enseignant");
  });

  const teacherContact = teacherFlow.contact;
  const teacherUser = teacherFlow.user;

  // ── 3) Création directe d'un enseignant hors Contacts : interdite ────────────
  check("3. Création directe d'un enseignant hors Contacts est bloquée", () => {
    const guard = simulateDirectEntityCreateGuard("teachers", true);
    assert.strictEqual(guard.allowed, false, "La création directe d'un enseignant devrait être interdite.");
  });

  // ── 3b) Le contact enseignant est proposé comme fiche liable ────────────────
  check("3b. Le contact enseignant est éligible à la création d'une fiche", () => {
    const options = getLinkableContactOptions(state, schoolCode, "teacher");
    assert.ok(
      options.some((c) => c.id === teacherContact.id),
      "Le contact enseignant devrait être proposé pour créer une fiche.",
    );
  });

  // ── 4) Fiche enseignant créée à partir du contact existant ───────────────────
  const teacherName = `${teacherContact.firstName} ${teacherContact.lastName}`.trim();
  check("4. Fiche enseignant créée et liée au contact", () => {
    state = {
      ...state,
      teachers: [
        {
          id: "TCH-1",
          publicId: "TCH-1",
          name: teacherContact.lastName,
          firstName: teacherContact.firstName,
          lastName: teacherContact.lastName,
          identifier: teacherUser.identifier,
          userId: teacherUser.id,
          contactId: teacherContact.id,
          schoolCode,
          mainSubject: "Mathématiques",
          assignments: [],
        },
      ],
    };
    const teacher = state.teachers[0];
    assert.strictEqual(teacher.contactId, teacherContact.id);
    assert.strictEqual(teacher.userId, teacherUser.id);
  });

  check("4b. Un contact déjà lié n'est plus proposé (pas de double fiche)", () => {
    const options = getLinkableContactOptions(state, schoolCode, "teacher");
    assert.ok(
      !options.some((c) => c.id === teacherContact.id),
      "Le contact déjà rattaché à une fiche ne doit plus être proposé.",
    );
  });

  // ── 5) Affectations : classe + matière, avec historisation et anti-doublon ──
  check("5. Affectation enseignant → classe + matière (Mathématiques) enregistrée", () => {
    const result = saveAssignment(
      state,
      { id: "ASSIGN-1", teacherId: "TCH-1", teacherName, className: CLASS_ASSIGNED, course: "Mathématiques", subject: "Mathématiques", schoolCode },
      admin,
    );
    assert.ok(result.created, "L'affectation Mathématiques devrait être créée.");
    state = result.state;
  });

  check("5b. Seconde affectation (Physique) enregistrée — historique conservé", () => {
    const result = saveAssignment(
      state,
      { id: "ASSIGN-2", teacherId: "TCH-1", teacherName, className: CLASS_ASSIGNED, course: "Physique", subject: "Physique", schoolCode },
      admin,
    );
    assert.ok(result.created, "L'affectation Physique devrait être créée.");
    state = result.state;
    assert.strictEqual(state.assignments.length, 2, "Les deux affectations doivent coexister (historique).");
  });

  check("MÉTIER. Affectation en doublon (même classe + matière) refusée (conflit)", () => {
    const before = state.assignments.length;
    const result = saveAssignment(
      state,
      { id: "ASSIGN-DUP", teacherId: "TCH-1", teacherName, className: CLASS_ASSIGNED, course: "Mathématiques", subject: "Mathématiques", schoolCode },
      admin,
    );
    assert.strictEqual(result.conflict, true, "Un doublon d'affectation doit être détecté.");
    assert.strictEqual(result.created, false, "Aucune affectation en doublon ne doit être créée.");
    assert.strictEqual(state.assignments.length, before, "Le nombre d'affectations ne doit pas changer.");
  });

  check("MÉTIER. Chaque affectation est historisée dans le journal d'audit", () => {
    const entries = (state.auditLog ?? []).filter((row) => row.entityType === "assignment");
    assert.ok(entries.length >= 2, `Au moins 2 entrées d'audit attendues, reçu ${entries.length}.`);
  });

  // ── 6) L'enseignant se connecte ──────────────────────────────────────────────
  let session;
  check("6. L'enseignant se connecte avec son code établissement", () => {
    const auth = buildAuth(state, school);
    session = auth.login({
      role: "teacher",
      schoolCode,
      identifier: teacherUser.identifier,
      pin: teacherFlow.temporaryPassword,
    });
    assert.strictEqual(session.role, "teacher");
    assert.strictEqual(session.user.role, "Enseignant");
    assert.strictEqual(session.school.code, schoolCode);
  });

  // ── 7) Il ne voit que ses classes et ses élèves ─────────────────────────────
  check("7. La session ne contient que la classe affectée (6ème A)", () => {
    const classes = session.user.assignedClasses ?? [];
    assert.deepStrictEqual(
      [...classes].map(normalize).sort(),
      [normalize(CLASS_ASSIGNED)],
      `Classes affectées inattendues : ${JSON.stringify(classes)}`,
    );
  });

  check("7b. Les matières de l'enseignant sont Mathématiques et Physique", () => {
    const courses = (session.user.courses ?? []).map(normalize).sort();
    assert.deepStrictEqual(courses, ["mathematiques", "physique"]);
  });

  check("MÉTIER. La classe non affectée (5ème B) est invisible", () => {
    const classes = (session.user.assignedClasses ?? []).map(normalize);
    assert.ok(!classes.includes(normalize(CLASS_OTHER)), "La classe non affectée ne doit pas apparaître.");
  });

  check("MÉTIER. L'enseignant ne voit que les élèves de ses classes", () => {
    const visibleClasses = new Set((session.user.assignedClasses ?? []).map(normalize));
    const visibleStudents = state.students.filter((s) => visibleClasses.has(normalize(s.className)));
    const ids = visibleStudents.map((s) => s.id).sort();
    assert.deepStrictEqual(ids, ["STU-A1", "STU-A2"], `Élèves visibles inattendus : ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes("STU-B1"), "L'élève de la classe non affectée ne doit pas être visible.");
  });

  // ── Bilan ────────────────────────────────────────────────────────────────────
  console.log("\nNote planning : les affectations sont au niveau trimestre (pas de");
  console.log("créneau horaire fin au MVP). Le contrôle de conflit porte donc sur");
  console.log("le doublon (classe + matière), pas sur un chevauchement d'horaire.\n");
  console.log(`Résultat : ${passed} vérification(s) OK, ${failures.length} échec(s).\n`);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0006 : OK");
}

try {
  main();
} catch (error) {
  console.error("Erreur inattendue durant le test E2E 0006 :", error);
  process.exit(1);
}
