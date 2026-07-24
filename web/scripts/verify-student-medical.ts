/**
 * Vérifications C1.4 — profil médical élève.
 * Exécution : npm run verify:student-medical
 */
import {
  BLOOD_TYPES,
  FUTURE_STUDENT_MEDICAL_PERMISSIONS,
  collectStudentMedicalRecord,
  compareAllergySeverity,
  createEmptyStudentMedicalRecord,
  detectMedicationStatus,
  diagnoseMedicalRecord,
  filterStudentMedicalRecordByVisibility,
  normalizeBloodType,
  resolveVaccinationAggregateStatus,
  sortAllergiesBySeverity,
  toStudentMedicalRecord,
  type AllergyRecord,
  type StudentMedicalRecord,
} from "../src/lib/studentMedical";
import {
  buildStudentMedicalViewModel,
  getAllergySeverityLabel,
  getMedicationStatusLabel,
  getVaccinationStatusLabel,
} from "../src/lib/studentMedicalViewModel";
import { buildStudentWorkspace } from "../src/lib/studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "../src/lib/studentWorkspaceViewModel";
import { buildStudentWorkspaceAlerts } from "../src/lib/studentWorkspaceAlerts";
import {
  canReadStudentWorkspaceModule,
  filterAccessibleStudentWorkspaceModules,
} from "../src/lib/studentWorkspacePermissions";
import {
  getStudentWorkspaceNavigationModules,
  isStudentWorkspaceModuleImplemented,
} from "../src/lib/studentWorkspaceNavigation";
import { getStudentWorkspaceModule } from "../src/lib/studentWorkspace";
import type { PermissionContext } from "../src/lib/permissions";
import type { Student, StudentMedicalProfile } from "../src/lib/studentDomain";

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

function createAllergy(
  partial: Partial<AllergyRecord> & Pick<AllergyRecord, "id" | "label" | "severity">,
): AllergyRecord {
  return {
    notes: null,
    visibility: "STAFF",
    ...partial,
  };
}

function testBloodTypeNormalization() {
  assertEqual(normalizeBloodType("A+"), "A+", "A+");
  assertEqual(normalizeBloodType("A Positif"), "A+", "A Positif");
  assertEqual(normalizeBloodType("A POS"), "A+", "A POS");
  assertEqual(normalizeBloodType("O positif"), "O+", "O positif");
  assertEqual(normalizeBloodType("O+"), "O+", "O+");
  assertEqual(normalizeBloodType("O POS"), "O+", "O POS");
  assertEqual(normalizeBloodType("AB-"), "AB-", "AB-");
  assertEqual(normalizeBloodType("B negatif"), "B-", "B negatif");
  assertEqual(normalizeBloodType(""), null, "vide");
  assertEqual(normalizeBloodType("inconnu"), null, "inconnu");
  assertEqual(BLOOD_TYPES.length, 8, "8 groupes sanguins");
}

function testAllergySorting() {
  const sorted = sortAllergiesBySeverity([
    createAllergy({ id: "1", label: "Pollen", severity: "LOW" }),
    createAllergy({ id: "2", label: "Arachides", severity: "CRITICAL" }),
    createAllergy({ id: "3", label: "Pénicilline", severity: "HIGH" }),
    createAllergy({ id: "4", label: "Lactose", severity: "MEDIUM" }),
  ]);

  assertEqual(sorted.map((item) => item.severity).join(","), "CRITICAL,HIGH,MEDIUM,LOW", "Ordre sévérité");
  assert(compareAllergySeverity("CRITICAL", "HIGH") < 0, "CRITICAL < HIGH");
  assertEqual(getAllergySeverityLabel("CRITICAL"), "Critique", "Label critique");
}

function testCriticalConditionsAndRisk() {
  const record: StudentMedicalRecord = {
    ...createEmptyStudentMedicalRecord("STU-1"),
    hasProfile: true,
    source: "LEGACY",
    allergies: [
      createAllergy({ id: "a1", label: "Arachides", severity: "CRITICAL" }),
    ],
    chronicConditions: [
      {
        id: "c1",
        label: "Épilepsie",
        severity: "CRITICAL",
        notes: null,
        visibility: "STAFF",
      },
      {
        id: "c2",
        label: "Asthme",
        severity: "MONITORED",
        notes: null,
        visibility: "STAFF",
      },
    ],
  };

  const diagnostics = diagnoseMedicalRecord(record);
  assert(diagnostics.hasCriticalAllergy, "Allergie critique");
  assert(diagnostics.hasCriticalCondition, "Pathologie critique");
  assert(diagnostics.hasCriticalRisk, "Risque critique agrégé");
  assertEqual(diagnostics.criticalAllergyCount, 1, "Count allergie");
  assertEqual(diagnostics.criticalConditionCount, 1, "Count pathologie");
}

function testVaccinations() {
  // Sémantique documentée : aucune preuve enregistrée = dossier administratif incomplet.
  assertEqual(
    resolveVaccinationAggregateStatus([]),
    "INCOMPLETE",
    "Vide = dossier administratif incomplet (pas UNKNOWN clinique)",
  );
  assertEqual(
    resolveVaccinationAggregateStatus([
      {
        id: "v1",
        label: "DTP",
        status: "UP_TO_DATE",
        administeredAt: null,
        visibility: "MEDICAL",
      },
    ]),
    "UP_TO_DATE",
    "À jour",
  );
  assertEqual(
    resolveVaccinationAggregateStatus([
      {
        id: "v1",
        label: "DTP",
        status: "UP_TO_DATE",
        administeredAt: null,
        visibility: "MEDICAL",
      },
      {
        id: "v2",
        label: "ROR",
        status: "INCOMPLETE",
        administeredAt: null,
        visibility: "MEDICAL",
      },
    ]),
    "INCOMPLETE",
    "Mixte = incomplet",
  );
  assertEqual(getVaccinationStatusLabel("UP_TO_DATE"), "À jour", "Label à jour");
  assertEqual(
    getVaccinationStatusLabel("INCOMPLETE"),
    "Incomplètes",
    "Label incomplet",
  );
}

function testMissingPhysicianAndBloodType() {
  const empty = createEmptyStudentMedicalRecord("STU-1");
  const diagnostics = diagnoseMedicalRecord(empty);
  assert(!diagnostics.hasPhysician, "Pas de médecin");
  assert(!diagnostics.hasBloodType, "Pas de groupe sanguin");
  assert(!diagnostics.hasMedicalUpdate, "Pas de mise à jour");

  const withPhysician = toStudentMedicalRecord(
    {
      id: "MED-1",
      studentId: "STU-1",
      doctorName: "Dr Martin",
      doctorPhone: "+243900000000",
      bloodType: "A+",
      updatedAt: "2026-01-10",
    },
    "STU-1",
  );
  const filled = diagnoseMedicalRecord(withPhysician);
  assert(filled.hasPhysician, "Médecin présent");
  assert(filled.hasBloodType, "Groupe présent");
  assert(filled.hasMedicalUpdate, "Mise à jour présente");
}

function testCriticalBadgeAndViewModel() {
  const record = toStudentMedicalRecord(
    {
      id: "MED-1",
      studentId: "STU-1",
      bloodType: "O POS",
      allergies: "Arachides (critique), Pénicilline (élevée)",
      chronicConditions: "Asthme (surveillance), Épilepsie (critique)",
      medications: "Ventoline (2 prises/jour)",
      disabilities: "Handicap moteur — aménagement demandé",
      doctorName: "Dr Martin",
      doctorPhone: "+243811111111",
      emergencyInstructions:
        "En cas de crise :\nAdministrer Ventoline.\nAppeler immédiatement les parents.",
      updatedAt: "2026-03-01",
    },
    "STU-1",
  );

  const vm = buildStudentMedicalViewModel(record);
  assertEqual(vm.bloodTypeLabel, "O+", "VM groupe sanguin");
  assert(vm.hasCriticalRisk, "VM risque critique");
  assert(!vm.hasMedication, "Legacy sans marqueur ≠ traitement actif");
  assert(vm.hasPhysician, "VM médecin");
  assertEqual(vm.vaccinationStatusLabel, "Incomplètes", "VM vaccins");
  assert(
    vm.badges.some((badge) => badge.label === "ALLERGIE CRITIQUE"),
    "Badge allergie critique",
  );
  assert(
    !vm.badges.some((badge) => badge.label === "TRAITEMENT"),
    "Pas de badge TRAITEMENT sans ACTIVE confirmé",
  );
  assert(
    vm.badges.some((badge) => badge.label === "HANDICAP"),
    "Badge handicap",
  );
  assert(
    vm.badges.some((badge) => badge.label === "SURVEILLANCE"),
    "Badge surveillance",
  );
  assert(
    vm.badges.some((badge) => badge.label === "MÉDECIN"),
    "Badge médecin",
  );
  assert(
    vm.badges.some((badge) => badge.label === "VACCINS"),
    "Badge vaccins",
  );
  assertEqual(vm.allergies[0]?.severity, "CRITICAL", "Allergie triée en tête");
  assertEqual(vm.allergies[0]?.label, "Arachides", "Label arachides");
  assertEqual(
    vm.medications[0]?.statusLabel,
    "Statut à confirmer",
    "Traitement legacy à confirmer",
  );
  assert(
    vm.disabilities[0]?.accommodationRequested,
    "Aménagement demandé",
  );
  assertEqual(record.visibility, "STAFF", "Visibility préparée");
  assert(
    record.allergies.every((item) => item.visibility === "STAFF"),
    "Visibility allergies",
  );
}

function testLegacyMedicationsUnknown() {
  const record = toStudentMedicalRecord(
    {
      id: "MED-1",
      studentId: "STU-1",
      medications: "Ventoline",
    },
    "STU-1",
  );

  assertEqual(record.medications.length, 1, "1 médicament legacy");
  assertEqual(record.medications[0]?.status, "UNKNOWN", "status UNKNOWN");
  assertEqual(
    diagnoseMedicalRecord(record).hasMedication,
    false,
    "hasMedication false",
  );

  const vm = buildStudentMedicalViewModel(record);
  assertEqual(vm.hasMedication, false, "VM hasMedication false");
  assertEqual(
    vm.medications[0]?.statusLabel,
    "Statut à confirmer",
    "statusLabel à confirmer",
  );
  assertEqual(
    getMedicationStatusLabel("UNKNOWN"),
    "Statut à confirmer",
    "Label UNKNOWN",
  );

  assertEqual(
    detectMedicationStatus("Ventoline (en cours)"),
    "ACTIVE",
    "Marqueur actif",
  );
  assertEqual(
    detectMedicationStatus("Amoxicilline (terminé)"),
    "COMPLETED",
    "Marqueur terminé",
  );

  const activeRecord = toStudentMedicalRecord(
    {
      id: "MED-2",
      studentId: "STU-1",
      medications: "Ventoline (en cours)",
    },
    "STU-1",
  );
  assertEqual(activeRecord.medications[0]?.status, "ACTIVE", "ACTIVE explicite");
  assert(
    diagnoseMedicalRecord(activeRecord).hasMedication,
    "hasMedication si ACTIVE",
  );
  assertEqual(
    buildStudentMedicalViewModel(activeRecord).medications[0]?.statusLabel,
    "En cours",
    "Label En cours si ACTIVE",
  );
}

function testConfidentialNotesAndVisibility() {
  const confidential = "Information strictement médicale";
  const record = toStudentMedicalRecord(
    {
      id: "MED-1",
      studentId: "STU-1",
      bloodType: "A+",
      doctorName: "Dr Martin",
      confidentialNotes: confidential,
      emergencyInstructions: "Appeler les parents",
    },
    "STU-1",
  );

  assertEqual(record.medicalNotes.length, 1, "Note legacy présente");
  assertEqual(
    record.medicalNotes[0]?.visibility,
    "MEDICAL",
    "Note legacy = MEDICAL",
  );
  assertEqual(record.medicalNotes[0]?.content, confidential, "Contenu stocké");

  const staffVm = buildStudentMedicalViewModel(record, {
    allowedVisibility: ["STAFF"],
  });
  assertEqual(staffVm.medicalNotesLabel, null, "STAFF ne reçoit pas la note");
  assert(
    !String(staffVm.medicalNotesLabel ?? "").includes(confidential),
    "Contenu confidentiel absent du VM STAFF",
  );
  assertEqual(
    staffVm.emergencyInstructionsLabel,
    "Appeler les parents",
    "STAFF voit consignes urgence",
  );

  const medicalVm = buildStudentMedicalViewModel(record, {
    allowedVisibility: ["STAFF", "MEDICAL"],
  });
  assertEqual(
    medicalVm.medicalNotesLabel,
    confidential,
    "MEDICAL voit la note",
  );

  // Filtrage générique : STAFF voit STAFF, pas MEDICAL ; MEDICAL voit les deux.
  const mixed: StudentMedicalRecord = {
    ...record,
    allergies: [
      {
        id: "a-staff",
        label: "Pollen",
        severity: "LOW",
        notes: null,
        visibility: "STAFF",
      },
      {
        id: "a-medical",
        label: "Secret médical",
        severity: "HIGH",
        notes: null,
        visibility: "MEDICAL",
      },
    ],
  };

  const staffFiltered = filterStudentMedicalRecordByVisibility(mixed, [
    "STAFF",
  ]);
  assertEqual(staffFiltered.allergies.length, 1, "STAFF : 1 allergie");
  assertEqual(staffFiltered.allergies[0]?.id, "a-staff", "STAFF voit STAFF");
  assertEqual(staffFiltered.medicalNotes.length, 0, "STAFF : 0 note MEDICAL");

  const medicalFiltered = filterStudentMedicalRecordByVisibility(mixed, [
    "STAFF",
    "MEDICAL",
  ]);
  assertEqual(medicalFiltered.allergies.length, 2, "MEDICAL voit STAFF+MEDICAL");
  assertEqual(medicalFiltered.medicalNotes.length, 1, "MEDICAL voit notes");
}

function testOverviewAlerts() {
  const student: Student = {
    id: "STU-1",
    personId: "PER-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
  };

  const profile: StudentMedicalProfile = {
    id: "MED-1",
    studentId: "STU-1",
    allergies: "Arachides (critique)",
    chronicConditions: "Épilepsie (critique)",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [student],
      medicalProfiles: [profile],
    },
  });

  assert(workspace !== null, "Workspace médical");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  const alertIds = vm.alerts.map((alert) => alert.id);

  assert(alertIds.includes("critical-allergy"), "Alerte allergie critique");
  assert(alertIds.includes("critical-condition"), "Alerte pathologie critique");
  assert(alertIds.includes("missing-physician"), "Alerte médecin manquant");
  assert(alertIds.includes("missing-blood-type"), "Alerte groupe sanguin");
  assert(alertIds.includes("missing-medical-update"), "Alerte mise à jour");

  assertEqual(alertIds[0], "critical-allergy", "Critique en priorité");
  assertEqual(alertIds[1], "critical-condition", "Pathologie critique en 2e");

  const alerts = buildStudentWorkspaceAlerts({
    gender: "F",
    birthDate: "2012-01-01",
    phone: "+243800000000",
    email: "a@test.local",
    nationality: "Congolaise",
    enrollmentStatus: "ENROLLED",
    currentClassName: "6ème",
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
    hasCriticalAllergy: true,
    hasCriticalCondition: false,
    hasPhysician: true,
    hasBloodType: true,
    hasMedicalUpdate: true,
  });
  assertEqual(alerts[0]?.id, "critical-allergy", "Priorité alerte critique");
}

function testPermissionsAndLegacyCompat() {
  assert(
    FUTURE_STUDENT_MEDICAL_PERMISSIONS.includes("student.medical.read"),
    "Permission read préparée",
  );
  assert(
    FUTURE_STUDENT_MEDICAL_PERMISSIONS.includes("student.medical.update"),
    "Permission update préparée",
  );
  assert(
    FUTURE_STUDENT_MEDICAL_PERMISSIONS.includes("student.medical.validate"),
    "Permission validate préparée",
  );

  assertEqual(
    getStudentWorkspaceModule("health")?.requiredPermission,
    "student.medical.read",
    "Module health exige medical.read",
  );

  const bridge = createPermissionCtx(["Élèves:READ"]);
  assert(
    canReadStudentWorkspaceModule(bridge, "student.medical.read"),
    "Bridge Élèves:READ",
  );

  const medicalOnly = createPermissionCtx([
    "Élèves:READ",
    "student.medical.read",
  ]);
  assert(
    canReadStudentWorkspaceModule(medicalOnly, "student.medical.read"),
    "Accès medical.read",
  );
  assert(
    canReadStudentWorkspaceModule(medicalOnly, "student.health.read"),
    "Alias health.read accepté",
  );

  const healthOnly = createPermissionCtx([
    "Élèves:READ",
    "student.health.read",
  ]);
  assert(
    canReadStudentWorkspaceModule(healthOnly, "student.medical.read"),
    "Alias médical via health.read",
  );

  const modules = getStudentWorkspaceNavigationModules();
  const visible = filterAccessibleStudentWorkspaceModules(modules, medicalOnly);
  assert(
    visible.some((module) => module.id === "health"),
    "Module médical visible",
  );

  const legacy = collectStudentMedicalRecord({
    studentId: "STU-1",
    medicalProfiles: [
      {
        id: "MED-1",
        studentId: "STU-1",
        bloodType: "A Positif",
        allergies: "Pollen",
      },
    ],
  });
  assertEqual(legacy.bloodType, "A+", "Compat legacy A Positif");
  assertEqual(legacy.source, "LEGACY", "Source legacy");
  assert(legacy.hasProfile, "Profil présent");
}

function testWorkspaceBuildAndShell() {
  assert(
    isStudentWorkspaceModuleImplemented("health"),
    "Module health implémenté",
  );

  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [student],
      medicalProfiles: [
        {
          id: "MED-1",
          studentId: "STU-1",
          bloodType: "B+",
          doctorName: "Dr Test",
          updatedAt: "2026-02-02",
          medications: "Ventoline",
        },
      ],
    },
  });

  assert(workspace !== null, "Workspace");
  assert(workspace!.medical.hasProfile, "Medical agrégé");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assertEqual(vm.medical.bloodTypeLabel, "B+", "VM workspace groupe");
  assert(vm.hasMedicalProfile, "hasMedicalProfile");
  assert(vm.medical.hasPhysician, "hasPhysician VM");
  assert(
    !vm.medical.hasMedication,
    "Ventoline legacy ≠ hasMedication ACTIVE",
  );
  assertEqual(
    vm.medical.medications[0]?.status,
    "UNKNOWN",
    "Workspace médication UNKNOWN",
  );
  assertEqual(vm.medical.medicalNotesLabel, null, "Pas de notes MEDICAL en STAFF");

  // Confirmation lecture seule : aucune API mutative exportée du domaine.
  assert(
    typeof (workspace as { updateMedical?: unknown }).updateMedical ===
      "undefined",
    "Pas de mutation workspace",
  );
}

function main() {
  const tests = [
    ["normalisation groupe sanguin", testBloodTypeNormalization],
    ["tri allergies", testAllergySorting],
    ["pathologies critiques", testCriticalConditionsAndRisk],
    ["vaccinations", testVaccinations],
    ["absence médecin et groupe sanguin", testMissingPhysicianAndBloodType],
    ["badge critique et ViewModel", testCriticalBadgeAndViewModel],
    ["traitements legacy UNKNOWN", testLegacyMedicationsUnknown],
    ["notes confidentielles et visibilité", testConfidentialNotesAndVisibility],
    ["alertes overview", testOverviewAlerts],
    ["permissions et compat legacy", testPermissionsAndLegacyCompat],
    ["build workspace et shell", testWorkspaceBuildAndShell],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student medical C1.4`);
}

main();
