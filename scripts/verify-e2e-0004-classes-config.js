/**
 * E2E 0004 : Parcours configuration des classes (Mon établissement > Classes)
 *
 * Vérifie :
 * - Création d'une classe (nom, niveau, filière, cycle, année, capacité)
 * - Présence dans state.classes pour l'établissement
 * - Disponibilité pour affectations élève/enseignant
 * - Unicité du nom par établissement (pas par année scolaire)
 * - Classe archivée exclue des nouvelles inscriptions (CLASSE-003)
 * - Classe supprimée indisponible pour nouvelles affectations
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
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  resolveSchoolContext,
} = require("./e2e-api-helpers");
const {
  filterSchoolClassRecords,
  validateUniqueClassName,
  saveSchoolClassFlow,
  pickUnusedClassName,
  ensureExplicitAcademicClassNames,
  isKnownClassName,
  getAssignmentSelectOptions,
  getEnrollmentClassNameSelectOptions,
  removeSchoolClassFromState,
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
  const superState = await getState(superToken);
  const scopeUser = (state.users ?? []).find(
    (user) => normalize(user.identifier) === normalize(schoolAdminIdentifier),
  );
  assert.ok(scopeUser, "Utilisateur admin introuvable dans le state");

  const academicSetup = ensureExplicitAcademicClassNames(state, schoolCode);
  if (academicSetup.patch) {
    state = await putStatePatch(adminToken, academicSetup.patch);
  }

  const className = pickUnusedClassName(superState, schoolCode);
  const schoolYear = resolveSchoolYear();
  const { levels, tracks } = getSchoolAcademicLists(state, schoolCode);

  const classDraft = {
    name: className,
    level: levels[0] ?? "1ère",
    track: tracks[0] ?? "Générale",
    cycle: "Secondaire",
    schoolYear,
    capacity: "40",
    status: "Active",
  };

  const createFlow = saveSchoolClassFlow(state, classDraft, schoolCode);
  assert.ok(createFlow.ok, createFlow.error);
  state = await putStatePatch(adminToken, createFlow.patch);

  const storedClass = filterSchoolClassRecords(state.classes ?? [], schoolCode).find(
    (row) => normalize(row.name) === normalize(className),
  );

  pushResult(
    results,
    "2. Classe créée (state patch)",
    className,
    storedClass?.name ?? "—",
    Boolean(storedClass),
  );

  const fieldsOk =
    storedClass &&
    normalize(storedClass.level) === normalize(classDraft.level) &&
    normalize(storedClass.track) === normalize(classDraft.track) &&
    normalize(storedClass.cycle) === normalize(classDraft.cycle) &&
    normalize(storedClass.schoolYear) === normalize(classDraft.schoolYear) &&
    String(storedClass.capacity ?? "") === classDraft.capacity;

  pushResult(
    results,
    "3. Champs classe enregistrés",
    "nom+niveau+filière+cycle+année+capacité",
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

  const duplicateError = validateUniqueClassName(
    className,
    filterSchoolClassRecords(state.classes ?? [], schoolCode),
  );
  const duplicateSameYear = saveSchoolClassFlow(
    state,
    { ...classDraft, schoolYear: "2099-2100" },
    schoolCode,
  );

  pushResult(
    results,
    "6. Doublon nom de classe bloqué (par établissement)",
    "erreur",
    duplicateError || duplicateSameYear.error ? "erreur" : "créé",
    Boolean(duplicateError || duplicateSameYear.error),
  );

  const archivedClasses = (state.classes ?? []).map((row) =>
    normalize(row.name) === normalize(className) ? { ...row, status: "Archivée" } : row,
  );
  state = await putStatePatch(adminToken, { classes: archivedClasses });
  const enrollmentOptions = getEnrollmentClassNameSelectOptions(state, schoolCode);
  const archivedExcluded = !enrollmentOptions.some((option) => normalize(option) === normalize(className));

  pushResult(
    results,
    "7. Classe archivée exclue (CLASSE-003)",
    "exclue",
    archivedExcluded ? "exclue" : "proposée",
    archivedExcluded,
  );

  const archivedRow = filterSchoolClassRecords(state.classes ?? [], schoolCode).find(
    (row) => normalize(row.name) === normalize(className),
  );
  assert.ok(archivedRow, "Classe archivée introuvable avant suppression");

  const deleteResult = removeSchoolClassFromState(state, archivedRow, schoolCode);
  assert.ok(deleteResult.ok, deleteResult.error);
  state = await putStatePatch(adminToken, deleteResult.patch);

  const deletedFromList = !filterSchoolClassRecords(state.classes ?? [], schoolCode).some(
    (row) => normalize(row.name) === normalize(className),
  );
  const knownAfterDelete = isKnownClassName(
    className,
    scopedClasses(scopeUser, state),
    state,
    schoolCode,
  );
  const optionsAfterDelete = getAssignmentSelectOptions(scopeUser, state, undefined, schoolCode);
  const stillInAssignments = optionsAfterDelete.classes.some(
    (option) => normalize(option.value) === normalize(className),
  );

  pushResult(
    results,
    "8. Classe supprimée indisponible (affectations)",
    "indisponible",
    deletedFromList && !knownAfterDelete && !stillInAssignments ? "indisponible" : "disponible",
    deletedFromList && !knownAfterDelete && !stillInAssignments,
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
