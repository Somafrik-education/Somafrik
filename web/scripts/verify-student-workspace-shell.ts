/**
 * Vérifications C1.1 — navigation et vue d'ensemble du dossier élève.
 * Exécution : npx tsx scripts/verify-student-workspace-shell.ts
 */
import {
  buildStudentWorkspacePath,
  getStudentWorkspaceNavigationModules,
  isStudentWorkspaceModuleImplemented,
  resolveStudentWorkspaceModuleIdFromSection,
} from "../src/lib/studentWorkspaceNavigation";
import {
  canReadStudentWorkspaceModule,
  filterAccessibleStudentWorkspaceModules,
} from "../src/lib/studentWorkspacePermissions";
import {
  formatAgeLabel,
  formatCivilDateLabel,
  parseCivilDate,
} from "../src/lib/studentWorkspaceDates";
import { buildStudentWorkspaceAlerts } from "../src/lib/studentWorkspaceAlerts";
import { buildStudentWorkspace } from "../src/lib/studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "../src/lib/studentWorkspaceViewModel";
import type { PermissionContext } from "../src/lib/permissions";
import type {
  Guardian,
  Person,
  Student,
  StudentEnrollment,
  StudentGuardianRelation,
} from "../src/lib/studentDomain";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} (reçu: ${JSON.stringify(actual)}, attendu: ${JSON.stringify(expected)})`);
  }
}

function createPermissionCtx(
  permissions: string[],
  role = "Secrétaire",
): PermissionContext {
  return {
    user: {
      id: "u-1",
      role,
      identifier: "secretaire@test.local",
      permissions,
      schoolCode: "CD-2026-0001",
    } as PermissionContext["user"],
    rolePermissions: {
      [role]: permissions,
    },
  };
}

function testNavigationOrderFromConfig() {
  const modules = getStudentWorkspaceNavigationModules();
  assertEqual(modules.length, 7, "7 modules navigables attendus");
  assertEqual(
    modules.map((module) => module.id).join(","),
    "overview,identity,enrollments,guardians,health,documents,history",
    "Ordre issu de la configuration",
  );
  assertEqual(modules[2]?.title, "Inscription", "Titre Inscription");
  assertEqual(modules[4]?.title, "Médical", "Titre Médical");
}

function testUrlAsSourceOfTruth() {
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection(undefined),
    "overview",
    "Route sans suffixe = vue d'ensemble",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection(""),
    "overview",
    "Section vide = vue d'ensemble",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("identite"),
    "identity",
    "Slug identité",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("inscription"),
    "enrollments",
    "Slug inscription",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("responsables"),
    "guardians",
    "Slug responsables",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("medical"),
    "health",
    "Slug médical",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("documents"),
    "documents",
    "Slug documents",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("historique"),
    "history",
    "Slug historique",
  );
  assertEqual(
    resolveStudentWorkspaceModuleIdFromSection("inconnu"),
    null,
    "Onglet inconnu → null (redirection)",
  );

  assertEqual(
    buildStudentWorkspacePath("STU-1"),
    "/etablissement/eleves/STU-1",
    "Chemin overview",
  );
  assertEqual(
    buildStudentWorkspacePath("STU-1", "identity"),
    "/etablissement/eleves/STU-1/identite",
    "Chemin identité",
  );
  assertEqual(
    buildStudentWorkspacePath("STU-1", "enrollments"),
    "/etablissement/eleves/STU-1/inscription",
    "Chemin inscription",
  );
}

function testActiveTabAndNavigationBetweenTabs() {
  const overview = resolveStudentWorkspaceModuleIdFromSection("");
  const identity = resolveStudentWorkspaceModuleIdFromSection("identite");
  assertEqual(overview, "overview", "Onglet actif overview");
  assertEqual(identity, "identity", "Onglet actif identité");
  assert(overview !== identity, "Navigation entre deux onglets distincts");

  const directIdentity = resolveStudentWorkspaceModuleIdFromSection("identite");
  assertEqual(
    directIdentity,
    "identity",
    "Conservation de l'onglet après accès direct par URL",
  );
}

function testPermissionsHideAndDeny() {
  const modules = getStudentWorkspaceNavigationModules();

  const fullAccess = createPermissionCtx(["Élèves:READ"]);
  const visibleFull = filterAccessibleStudentWorkspaceModules(modules, fullAccess);
  assertEqual(visibleFull.length, 7, "Élèves:READ ouvre tous les modules dossier");

  const granular = createPermissionCtx([
    "Élèves:READ",
    "student.overview.read",
    "student.identity.read",
  ]);
  const visibleGranular = filterAccessibleStudentWorkspaceModules(modules, granular);
  assertEqual(visibleGranular.length, 2, "Masquage des modules non autorisés");
  assert(
    visibleGranular.every((module) =>
      ["overview", "identity"].includes(module.id),
    ),
    "Seuls overview et identity restent visibles",
  );

  assert(
    !canReadStudentWorkspaceModule(granular, "student.guardians.read"),
    "Refus d'accès direct à un module non autorisé",
  );
  assert(
    canReadStudentWorkspaceModule(granular, "student.identity.read"),
    "Accès autorisé à identity",
  );

  const noStudents = createPermissionCtx(["Notes:READ"], "Élève / Étudiant");
  assert(
    !canReadStudentWorkspaceModule(noStudents, "student.overview.read"),
    "Sans Élèves:READ, aucun module dossier",
  );

  const anonymous: PermissionContext = { user: null, rolePermissions: {} };
  assert(
    !canReadStudentWorkspaceModule(anonymous, "student.overview.read"),
    "Utilisateur non authentifié refusé",
  );
}

function testCivilDateFormatting() {
  const parsed = parseCivilDate("2012-07-15");
  assert(parsed !== null, "Date civile parsée");
  assertEqual(parsed?.getFullYear(), 2012, "Année civile");
  assertEqual(parsed?.getMonth(), 6, "Mois civil (juillet = 6)");
  assertEqual(parsed?.getDate(), 15, "Jour civil sans décalage");

  const label = formatCivilDateLabel("2012-07-15");
  assert(label.includes("2012"), "Libellé contient l'année");
  assert(!label.includes("Invalid Date"), "Pas de Invalid Date");
  assertEqual(formatCivilDateLabel(null), "Non renseigné", "Fallback date absente");
  assertEqual(formatCivilDateLabel(""), "Non renseigné", "Fallback date vide");

  const age = formatAgeLabel("2012-07-15", "Non renseigné", new Date(2026, 6, 20));
  assertEqual(age, "14 ans", "Calcul d'âge stable");
}

function testMissingDataFallbacksAndNoActiveEnrollment() {
  const student: Student = {
    id: "STU-EMPTY",
    matricule: "M-EMPTY",
    schoolCode: "CD-2026-0001",
    lastName: "Mukendi",
    firstName: "Amina",
    archived: false,
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-EMPTY",
    academicYear: "2025-2026",
    data: {
      students: [student],
      persons: [],
      schools: [{ code: "CD-2026-0001", name: "Collège Test" }],
      enrollments: [],
      guardians: [],
      guardianRelations: [],
      documents: [],
      medicalProfiles: [],
    },
  });

  assert(workspace !== null, "Workspace sans inscription active");
  const vm = buildStudentWorkspaceViewModel(workspace!);

  assertEqual(vm.enrollmentStatus, null, "Pas de statut d'inscription");
  assertEqual(
    vm.enrollmentStatusLabel,
    "Aucune inscription active",
    "Fallback inscription",
  );
  assertEqual(vm.genderLabel, "Non renseigné", "Fallback sexe");
  assertEqual(vm.phoneLabel, "Non renseigné", "Fallback téléphone");
  assertEqual(
    vm.guardiansCountLabel,
    "Aucun responsable associé",
    "Fallback responsables",
  );
  assertEqual(vm.schoolNameLabel, "Collège Test", "Nom établissement");
  assert(!String(vm.birthDateLabel).includes("undefined"), "Pas de undefined");
  assert(!String(vm.birthDateLabel).includes("null"), "Pas de null affiché");
  assert(vm.isActive === true, "Élève non archivé = actif");
}

function testComputedAlerts() {
  const alerts = buildStudentWorkspaceAlerts({
    gender: null,
    birthDate: null,
    phone: null,
    email: null,
    nationality: null,
    enrollmentStatus: null,
    currentClassName: null,
    hasGuardians: false,
    guardiansCount: 0,
    hasActiveEnrollment: false,
    enrollmentIsIncomplete: false,
    enrollmentApprovedWithoutClass: false,
    enrollmentActiveWithoutDate: false,
    hasDuplicateActiveEnrollments: false,
    enrollmentYearMismatch: false,
    hasLegalGuardian: false,
    hasGuardianPhone: false,
    hasEmergencyContact: false,
    hasFinancialResponsible: false,
    multiplePriorityOneGuardians: false,
    multipleFinancialResponsibles: false,
    hasExpiredGuardianRelation: false,
  });

  const ids = alerts.map((alert) => alert.id);
  assert(ids.includes("missing-active-enrollment"), "Alerte inscription");
  assert(ids.includes("missing-guardians"), "Alerte responsables");
  assert(ids.includes("missing-contact"), "Alerte contact");
  assert(ids.includes("missing-identity-fields"), "Alerte identité");

  const healthy = buildStudentWorkspaceAlerts({
    gender: "F",
    birthDate: "2012-07-15",
    phone: "+243800000000",
    email: "a@test.local",
    nationality: "Congolaise",
    enrollmentStatus: "ENROLLED",
    currentClassName: "6ème A",
    hasGuardians: true,
    guardiansCount: 1,
    hasActiveEnrollment: true,
    enrollmentIsIncomplete: false,
    enrollmentApprovedWithoutClass: false,
    enrollmentActiveWithoutDate: false,
    hasDuplicateActiveEnrollments: false,
    enrollmentYearMismatch: false,
    hasLegalGuardian: true,
    hasGuardianPhone: true,
    hasEmergencyContact: true,
    hasFinancialResponsible: true,
    multiplePriorityOneGuardians: false,
    multipleFinancialResponsibles: false,
    hasExpiredGuardianRelation: false,
  });
  assertEqual(healthy.length, 0, "Aucune alerte si dossier complet");
}

function testGuardiansSummaryAndImplementedFlags() {
  const student: Student = {
    id: "STU-1",
    personId: "PER-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
  };
  const person: Person = {
    id: "PER-1",
    lastName: "Kabongo",
    firstName: "Léa",
    gender: "F",
    birthDate: "2011-03-04",
    nationality: "Congolaise",
    phone: "+243811111111",
  };
  const guardianPerson: Person = {
    id: "PER-G1",
    lastName: "Kabongo",
    firstName: "Paul",
    phone: "+243822222222",
  };
  const guardian: Guardian = { id: "G-1", personId: "PER-G1" };
  const relation: StudentGuardianRelation = {
    id: "R-1",
    studentId: "STU-1",
    guardianId: "G-1",
    relationshipType: "Père",
    isPrimaryContact: true,
    status: "Actif",
  };
  const enrollment: StudentEnrollment = {
    id: "E-1",
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    academicYear: "2025-2026",
    className: "5ème B",
    status: "ENROLLED",
    enrollmentDate: "2025-09-01",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2025-2026",
    data: {
      students: [student],
      persons: [person, guardianPerson],
      schools: [{ code: "CD-2026-0001", name: "Lycée Horizon" }],
      enrollments: [enrollment],
      guardians: [guardian],
      guardianRelations: [relation],
    },
  });

  assert(workspace !== null, "Workspace avec inscription");
  const vm = buildStudentWorkspaceViewModel(workspace!, {
    referenceDate: new Date(2026, 6, 20),
  });

  assertEqual(vm.guardiansCount, 1, "Nombre de responsables");
  assertEqual(vm.primaryGuardianNameLabel, "Kabongo Paul", "Responsable principal");
  assertEqual(vm.primaryGuardianPhoneLabel, "+243822222222", "Téléphone principal");
  assertEqual(vm.classLabel, "5ème B", "Classe actuelle");
  assertEqual(vm.enrollmentDateLabel.includes("2025"), true, "Date d'entrée formatée");
  assert(isStudentWorkspaceModuleImplemented("overview"), "Overview implémenté");
  assert(isStudentWorkspaceModuleImplemented("identity"), "Identity implémenté");
  assert(
    isStudentWorkspaceModuleImplemented("guardians"),
    "Guardians implémenté (C1.3)",
  );
}

function main() {
  const tests = [
    ["ordre navigation depuis config", testNavigationOrderFromConfig],
    ["URL source de vérité", testUrlAsSourceOfTruth],
    ["onglet actif et navigation", testActiveTabAndNavigationBetweenTabs],
    ["permissions masquage et refus", testPermissionsHideAndDeny],
    ["formatage date civile", testCivilDateFormatting],
    ["fallbacks et sans inscription", testMissingDataFallbacksAndNoActiveEnrollment],
    ["alertes dossier", testComputedAlerts],
    ["responsables et modules implémentés", testGuardiansSummaryAndImplementedFlags],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student workspace shell C1.1`);
}

main();
