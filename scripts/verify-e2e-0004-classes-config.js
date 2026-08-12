/**
 * E2E 0004 : Parcours configuration des classes (Mon établissement > Classes)
 *
 * Vérifie (post-clôture CRUD legacy) :
 * - Création via POST /api/classes
 * - Présence dans la projection lecture state.classes
 * - Disponibilité pour affectations élève/enseignant
 * - Refus d'écriture legacy PUT /api/backoffice/state { classes }
 * - Doublon API (même année scolaire) → 409
 * - Classe inactive exclue des nouvelles inscriptions (CLASSE-003)
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0004
 */
const assert = require("assert");
const {
  login,
  getState,
  putStatePatch,
  request,
  createClassViaApi,
  patchClassViaApi,
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const {
  filterSchoolClassRecords,
  pickUnusedClassName,
  ensureExplicitAcademicClassNames,
  isKnownClassName,
  getAssignmentSelectOptions,
  getEnrollmentClassNameSelectOptions,
  scopedClasses,
  resolveSchoolYear,
  getSchoolAcademicLists,
} = require("./e2e-class-rules");

async function main() {
  const results = [];
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);

  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  let state = await getState(adminToken);
  const scopeUser = (state.users ?? []).find(
    (user) => normalize(user.identifier) === normalize(schoolAdminIdentifier),
  );
  assert.ok(scopeUser, "Utilisateur admin introuvable dans le state");

  const academicSetup = ensureExplicitAcademicClassNames(state, schoolCode);
  if (academicSetup.patch) {
    state = await putStatePatch(adminToken, academicSetup.patch);
  }

  const className = pickUnusedClassName(state, schoolCode);
  const schoolYear = resolveSchoolYear();
  const { levels, tracks } = getSchoolAcademicLists(state, schoolCode);

  const created = await createClassViaApi(adminToken, {
    name: className,
    level: levels[0] ?? "1ère",
    track: tracks[0] ?? "Générale",
    schoolYear,
    status: "active",
  });
  state = created.state;
  const storedClass = filterSchoolClassRecords(state.classes ?? [], schoolCode).find(
    (row) => normalize(row.name) === normalize(className),
  );

  pushResult(
    results,
    "2. Classe créée via /api/classes",
    className,
    storedClass?.name ?? "—",
    Boolean(storedClass),
  );

  const fieldsOk =
    storedClass &&
    normalize(storedClass.level) === normalize(levels[0] ?? "1ère") &&
    (normalize(storedClass.track) === normalize(tracks[0] ?? "Générale") ||
      normalize(storedClass.section) === normalize(tracks[0] ?? "Générale"));

  pushResult(
    results,
    "3. Champs classe enregistrés (projection)",
    "nom+niveau+filière",
    fieldsOk ? "complets" : "incomplets",
    Boolean(fieldsOk),
  );

  const classes = scopedClasses(scopeUser, state);
  const known = isKnownClassName(className, classes, state, schoolCode);
  const assignmentOptions = getAssignmentSelectOptions(scopeUser, state, undefined, schoolCode);
  const inAssignments = assignmentOptions.classes.some(
    (option) => normalize(option.value) === normalize(className),
  );

  pushResult(
    results,
    "4. Classe reconnue (isKnownClassName)",
    "true",
    known ? "true" : "false",
    known,
  );

  pushResult(
    results,
    "5. Classe disponible (affectations)",
    className,
    inAssignments ? className : "—",
    inAssignments,
  );

  const legacyPut = await request("/backoffice/state", {
    method: "PUT",
    token: adminToken,
    body: {
      classes: [
        ...(state.classes ?? []),
        { id: `CLS-LEGACY-${Date.now()}`, name: `Legacy ${Date.now()}`, schoolCode },
      ],
    },
  });
  pushResult(
    results,
    "6. Écriture legacy state.classes refusée",
    "400",
    String(legacyPut.status),
    legacyPut.status === 400 &&
      String(legacyPut.data?.code ?? "") === "LEGACY_CLASSES_STATE_WRITE_FORBIDDEN",
  );

  const duplicate = await request("/classes", {
    method: "POST",
    token: adminToken,
    body: {
      name: className,
      academicYearName: schoolYear,
      status: "active",
    },
  });
  pushResult(
    results,
    "7. Doublon API bloqué (même année scolaire)",
    "409",
    String(duplicate.status),
    duplicate.status === 409,
  );

  const classCode = String(
    created.api?.classCode ?? storedClass?.id ?? storedClass?.publicId ?? "",
  );
  assert.ok(classCode, "classCode manquant pour PATCH");
  const archived = await patchClassViaApi(adminToken, classCode, { status: "inactive" });
  state = archived.state;
  const enrollmentOptions = getEnrollmentClassNameSelectOptions(state, schoolCode);
  const archivedExcluded = !enrollmentOptions.some(
    (option) => normalize(option) === normalize(className),
  );

  pushResult(
    results,
    "8. Classe inactive exclue (CLASSE-003)",
    "exclue",
    archivedExcluded ? "exclue" : "proposée",
    archivedExcluded,
  );

  console.log("\n=== E2E 0004 : Configuration des classes ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe test    : ${className}`);
  console.log(`Année scolaire : ${schoolYear}\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0004 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
