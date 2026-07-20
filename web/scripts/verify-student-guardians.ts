/**
 * Vérifications C1.3 — responsables légaux et contacts.
 * Exécution : npm run verify:student-guardians
 */
import {
  collectStudentGuardianRelationRecords,
  deriveGuardiansFromLegacyStudent,
  getGuardianRelationshipLabel,
  listGuardianRelationshipLabels,
  normalizeGuardianRelationshipType,
  normalizeGuardianRelationStatus,
  GUARDIAN_RELATIONSHIP_TYPES,
  type StudentGuardianRelationRecord,
} from "../src/lib/studentGuardian";
import {
  diagnoseGuardianRelations,
  getEmergencyContacts,
  getPickupAuthorizedGuardians,
  selectPrimaryGuardian,
  sortGuardiansByPriority,
} from "../src/lib/studentGuardianSelection";
import {
  buildStudentGuardianViewModel,
  buildStudentGuardiansModuleViewModel,
} from "../src/lib/studentGuardianViewModel";
import { buildStudentWorkspace } from "../src/lib/studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "../src/lib/studentWorkspaceViewModel";
import {
  canReadStudentWorkspaceModule,
  filterAccessibleStudentWorkspaceModules,
} from "../src/lib/studentWorkspacePermissions";
import {
  getStudentWorkspaceNavigationModules,
  isStudentWorkspaceModuleImplemented,
} from "../src/lib/studentWorkspaceNavigation";
import type { PermissionContext } from "../src/lib/permissions";
import type {
  Guardian,
  Person,
  Student,
  StudentGuardianRelation,
} from "../src/lib/studentDomain";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message} (reçu: ${JSON.stringify(actual)}, attendu: ${JSON.stringify(expected)})`,
    );
  }
}

function createRelation(
  partial: Partial<StudentGuardianRelationRecord> &
    Pick<StudentGuardianRelationRecord, "id" | "displayName">,
): StudentGuardianRelationRecord {
  return {
    studentId: "STU-1",
    guardianId: `G-${partial.id}`,
    relationshipType: "OTHER",
    isLegalGuardian: false,
    livesWithStudent: false,
    isEmergencyContact: false,
    pickupAuthorized: false,
    financialResponsible: false,
    priority: 99,
    startDate: null,
    endDate: null,
    notes: null,
    phone: null,
    email: null,
    address: null,
    isActive: true,
    isExpired: false,
    source: "STRUCTURED",
    requiresVerification: false,
    dataQuality: "VERIFIED",
    ...partial,
  };
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
    rolePermissions: { [role]: permissions },
  };
}

function testPrimarySelection() {
  const relations = [
    createRelation({
      id: "Z",
      displayName: "Zara Test",
      priority: 2,
      isLegalGuardian: true,
      phone: "+243800",
    }),
    createRelation({
      id: "A",
      displayName: "Alice Test",
      priority: 1,
      isEmergencyContact: true,
      phone: "+243811",
    }),
    createRelation({
      id: "B",
      displayName: "Bob Test",
      priority: 1,
      isLegalGuardian: true,
      phone: "+243822",
    }),
  ];

  // Même priorité 1 : légal gagne, puis alphabétique si égal
  const primary = selectPrimaryGuardian(relations);
  assertEqual(primary?.id, "B", "Priorité 1 + légal = principal");

  const alphabetical = selectPrimaryGuardian([
    createRelation({
      id: "M",
      displayName: "Marie Mukendi",
      priority: 1,
      isLegalGuardian: true,
    }),
    createRelation({
      id: "J",
      displayName: "Jean Kanku",
      priority: 1,
      isLegalGuardian: true,
    }),
  ]);
  assertEqual(alphabetical?.id, "J", "À égalité : ordre alphabétique");
}

function testDiagnosticsAndAlerts() {
  const empty = diagnoseGuardianRelations([]);
  assert(!empty.hasLegalGuardian, "Aucun légal");
  assert(!empty.hasPhone, "Aucun téléphone");
  assert(empty.multiplePriorityOne === false, "Pas de priorité 1 multiple");

  const multi = diagnoseGuardianRelations([
    createRelation({
      id: "1",
      displayName: "A",
      priority: 1,
      isLegalGuardian: true,
      financialResponsible: true,
      phone: "+2431",
    }),
    createRelation({
      id: "2",
      displayName: "B",
      priority: 1,
      financialResponsible: true,
      isEmergencyContact: true,
      phone: "+2432",
    }),
  ]);
  assert(multi.multiplePriorityOne, "Plusieurs priorité 1");
  assert(multi.multipleFinancialResponsible, "Plusieurs financiers");

  const student: Student = {
    id: "STU-AL",
    matricule: "M-A",
    schoolCode: "CD-1",
    gender: "F",
    birthDate: "2012-01-01",
    phone: "+2439",
    nationality: "CD",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-AL",
    academicYear: "2026-2027",
    data: {
      students: [student],
      guardians: [],
      guardianRelations: [],
      persons: [],
    },
  });
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assert(
    vm.alerts.some((alert) => alert.id === "missing-guardians"),
    "Alerte overview aucun responsable",
  );
}

function testNormalizationAndLabels() {
  assertEqual(normalizeGuardianRelationshipType("Father"), "FATHER", "Father");
  assertEqual(normalizeGuardianRelationshipType("Papa"), "FATHER", "Papa");
  assertEqual(normalizeGuardianRelationshipType("Père"), "FATHER", "Père");
  assertEqual(normalizeGuardianRelationshipType("Mother"), "MOTHER", "Mother");
  assertEqual(normalizeGuardianRelationshipType("Tutor"), "TUTOR", "Tutor");
  assertEqual(
    normalizeGuardianRelationshipType("Représentant légal"),
    "LEGAL_GUARDIAN",
    "Représentant légal",
  );

  const labels = listGuardianRelationshipLabels();
  for (const type of GUARDIAN_RELATIONSHIP_TYPES) {
    assert(Boolean(labels[type]), `Libellé ${type}`);
  }
  assertEqual(getGuardianRelationshipLabel("MOTHER"), "Mère", "Label Mère");
}

function testSortingEmergencyPickupExpired() {
  const relations = [
    createRelation({
      id: "E2",
      displayName: "Marie Mukendi",
      priority: 2,
      isEmergencyContact: true,
      pickupAuthorized: true,
      relationshipType: "MOTHER",
      phone: "+2432",
    }),
    createRelation({
      id: "E1",
      displayName: "Jean Kanku",
      priority: 1,
      isEmergencyContact: true,
      pickupAuthorized: true,
      relationshipType: "FATHER",
      phone: "+2431",
    }),
    createRelation({
      id: "X",
      displayName: "Expiré",
      priority: 3,
      isActive: false,
      isExpired: true,
      endDate: "2020-01-01",
      phone: "+2433",
    }),
  ];

  const sorted = sortGuardiansByPriority(relations);
  assertEqual(sorted[0]?.id, "E1", "Tri priorité croissante");

  const emergency = getEmergencyContacts(relations);
  assertEqual(emergency.map((r) => r.id).join(","), "E1,E2", "Urgence triée");

  const pickup = getPickupAuthorizedGuardians(relations);
  assertEqual(pickup.length, 2, "Pickup authorized");
  assert(
    !pickup.some((r) => r.id === "X"),
    "Expiré exclu du pickup actif",
  );

  const moduleVm = buildStudentGuardiansModuleViewModel(relations);
  assertEqual(moduleVm.pickupAuthorizedGuardians.length, 2, "VM pickup");
  assertEqual(moduleVm.emergencyContacts[0]?.displayName, "Jean Kanku", "VM urgence");
  assert(moduleVm.diagnostics.hasExpiredRelation, "Diagnostic expiré");
}

function testBadgesAndMobileViewModel() {
  const record = createRelation({
    id: "P",
    displayName: "Marie Mukendi",
    relationshipType: "MOTHER",
    priority: 1,
    isLegalGuardian: true,
    financialResponsible: true,
    isEmergencyContact: true,
    livesWithStudent: true,
    pickupAuthorized: true,
    phone: "+243800",
    email: "marie@test.local",
  });
  const vm = buildStudentGuardianViewModel(record, { isPrimary: true });
  const kinds = vm.badges.map((badge) => badge.kind);
  assert(kinds.includes("primary"), "Badge principal");
  assert(kinds.includes("legal"), "Badge légal");
  assert(kinds.includes("financial"), "Badge financier");
  assert(kinds.includes("emergency"), "Badge urgence");
  assert(kinds.includes("lives_with"), "Badge vit avec");
  assertEqual(vm.phoneLabel, "+243800", "Phone label");
  assertEqual(vm.relationshipLabel, "Mère", "Relation label");
}

function testPermissionsAndLegacy() {
  const modules = getStudentWorkspaceNavigationModules();
  const denied = createPermissionCtx([
    "Élèves:READ",
    "student.overview.read",
    "student.identity.read",
  ]);
  const visible = filterAccessibleStudentWorkspaceModules(modules, denied);
  assert(
    !visible.some((module) => module.id === "guardians"),
    "Onglet masqué sans student.guardians.read",
  );
  assert(
    !canReadStudentWorkspaceModule(denied, "student.guardians.read"),
    "Lecture refusée",
  );
  assert(
    isStudentWorkspaceModuleImplemented("guardians"),
    "Module guardians implémenté",
  );

  const legacyStudent: Student = {
    id: "STU-LEG",
    matricule: "M-L",
    schoolCode: "CD-1",
    parentName: "Parent Legacy",
    parentPhone: "+243700",
  };
  const legacy = collectStudentGuardianRelationRecords({
    student: legacyStudent,
    guardians: [],
    guardianRelations: [],
    persons: [],
  });
  assertEqual(legacy.length, 1, "Fallback legacy");
  assertEqual(legacy[0]?.displayName, "Parent Legacy", "Nom legacy");
  assertEqual(legacy[0]?.phone, "+243700", "Téléphone legacy");
  assertEqual(legacy[0]?.isLegalGuardian, false, "Legacy sans autorité légale");
}

function testLegacyFallbackNoInventedAuthorizations() {
  const student: Student = {
    id: "STU-LEG2",
    matricule: "M-L2",
    schoolCode: "CD-1",
    parentName: "Marie Test",
    parentPhone: "+243600000000",
  };

  const [legacy] = deriveGuardiansFromLegacyStudent(student);
  assert(Boolean(legacy), "Contact legacy présent");
  assertEqual(legacy.isLegalGuardian, false, "Pas de légal inventé");
  assertEqual(legacy.isEmergencyContact, false, "Pas d'urgence inventée");
  assertEqual(legacy.pickupAuthorized, false, "Pas de pickup inventé");
  assertEqual(legacy.financialResponsible, false, "Pas de financier inventé");
  assertEqual(legacy.source, "LEGACY", "Source LEGACY");
  assertEqual(legacy.requiresVerification, true, "requiresVerification");
  assertEqual(legacy.dataQuality, "UNVERIFIED", "dataQuality UNVERIFIED");

  const vm = buildStudentGuardianViewModel(legacy, { isPrimary: true });
  assertEqual(vm.requiresVerification, true, "VM requiresVerification");
  assertEqual(vm.source, "LEGACY", "VM source");
  assertEqual(
    vm.relationshipLabel,
    "Contact parent hérité",
    "Libellé contact hérité",
  );
  assert(
    vm.badges.some((badge) => badge.kind === "unverified"),
    "Badge informations héritées à vérifier",
  );
  assert(
    !vm.badges.some((badge) => badge.kind === "legal"),
    "Pas de badge légal inventé",
  );
  assert(
    !vm.badges.some((badge) => badge.kind === "pickup"),
    "Pas de badge pickup inventé",
  );

  const workspace = buildStudentWorkspace({
    studentId: "STU-LEG2",
    academicYear: "2026-2027",
    data: {
      students: [student],
      guardians: [],
      guardianRelations: [],
      persons: [],
    },
  });
  const overviewVm = buildStudentWorkspaceViewModel(workspace!);
  const alertIds = overviewVm.alerts.map((alert) => alert.id);
  assert(alertIds.includes("missing-legal-guardian"), "Alerte légal non masquée");
  assert(
    alertIds.includes("missing-emergency-contact"),
    "Alerte urgence non masquée",
  );
  assert(
    alertIds.includes("missing-financial-responsible"),
    "Alerte financier non masquée",
  );
  assert(
    !alertIds.includes("missing-guardian-phone"),
    "Téléphone legacy reconnu",
  );
  assert(
    !alertIds.includes("missing-guardians"),
    "Contact historique visible (pas « aucun responsable »)",
  );

  assertEqual(
    normalizeGuardianRelationStatus("INACTIVE"),
    "INACTIVE",
    "Statut INACTIVE",
  );
  assertEqual(
    normalizeGuardianRelationStatus("Inactif"),
    "INACTIVE",
    "Statut Inactif",
  );
  assertEqual(
    normalizeGuardianRelationStatus("active"),
    "ACTIVE",
    "Statut active",
  );
}

function testDomainBridgeAndOverview() {
  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    gender: "F",
    birthDate: "2011-03-04",
    nationality: "Congolaise",
    phone: "+243811111111",
  };
  const persons: Person[] = [
    {
      id: "PER-M",
      lastName: "Mukendi",
      firstName: "Marie",
      phone: "+243900",
      email: "marie@test.local",
    },
    {
      id: "PER-J",
      lastName: "Kanku",
      firstName: "Jean",
      phone: "+243901",
    },
  ];
  const guardians: Guardian[] = [
    { id: "G-M", personId: "PER-M" },
    { id: "G-J", personId: "PER-J" },
  ];
  const relations: StudentGuardianRelation[] = [
    {
      id: "R-M",
      studentId: "STU-1",
      guardianId: "G-M",
      relationshipType: "Mère",
      isLegalGuardian: true,
      isFinanciallyResponsible: true,
      isEmergencyContact: true,
      canPickUpStudent: true,
      priority: 1,
      status: "Actif",
    },
    {
      id: "R-J",
      studentId: "STU-1",
      guardianId: "G-J",
      relationshipType: "Father",
      isEmergencyContact: true,
      canPickUpStudent: true,
      priority: 2,
      status: "Actif",
    },
  ];

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [student],
      persons,
      guardians,
      guardianRelations: relations,
      schools: [{ code: "CD-2026-0001", name: "École" }],
    },
  });

  assert(workspace !== null, "Workspace");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assertEqual(vm.primaryGuardian?.displayName, "Mukendi Marie", "Principal");
  assertEqual(vm.guardians.length, 2, "Liste complète");
  assertEqual(vm.emergencyContacts.length, 2, "Urgences");
  assertEqual(vm.pickupAuthorizedGuardians.length, 2, "Pickup");
  assertEqual(vm.financialResponsibles.length, 1, "Financier");
  assertEqual(
    vm.primaryGuardianNameLabel,
    "Mukendi Marie",
    "Overview primary name",
  );
  assert(
    !vm.alerts.some((alert) => alert.id === "missing-legal-guardian"),
    "Pas d'alerte légal",
  );
}

function main() {
  const tests = [
    ["sélection responsable principal", testPrimarySelection],
    ["diagnostics et alertes", testDiagnosticsAndAlerts],
    ["normalisation relations", testNormalizationAndLabels],
    ["tri urgence pickup expirées", testSortingEmergencyPickupExpired],
    ["badges et view model", testBadgesAndMobileViewModel],
    ["permissions et legacy", testPermissionsAndLegacy],
    ["fallback legacy sans autorisations", testLegacyFallbackNoInventedAuthorizations],
    ["bridge domaine et overview", testDomainBridgeAndOverview],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student guardians C1.3`);
}

main();
