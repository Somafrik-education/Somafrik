/**
 * Vérifications C1.2 / C1.8a — inscription et parcours scolaire.
 * Exécution : npm run verify:student-enrollment
 */
import { fromEditableEnrollment } from "../src/lib/studentEditingAdapters";
import { canUpdateStudentWorkspace } from "../src/lib/studentEditingPermissions";
import {
  createMockEditingStore,
  createMockStudentWorkspaceCommandRepository,
  seedEditableEnrollment,
  seedSchoolClass,
} from "../src/lib/studentEditingRepository.mock";
import { executeStudentUpdateCommand } from "../src/lib/studentEditingService";
import {
  assertSingleActiveEnrollmentPerYear,
  collectStudentEnrollmentRecords,
  getEnrollmentSourceLabel,
  isClassOptionalForStatus,
  listEnrollmentSourceLabels,
  requiresClassWhenEnrolled,
  toStudentEnrollmentRecord,
  validateEnrollmentDateOrder,
  type StudentEnrollmentRecord,
} from "../src/lib/studentEnrollment";
import {
  canAssignClassEnrollmentStatus,
  canValidateEnrollmentStatus,
  nextStatusAfterAssignClass,
  nextStatusAfterValidate,
} from "../src/lib/studentEnrollmentTransitions";
import { resolveSchoolClass } from "../src/lib/studentEditingValidation";
import { collectStudentHistoryRecord } from "../src/lib/studentHistory";
import {
  listEnrollmentStatusLabels,
  normalizeStudentEnrollmentStatus,
  STUDENT_ENROLLMENT_STATUSES,
  getEnrollmentStatusPresentation,
} from "../src/lib/studentEnrollmentStatus";
import {
  selectCurrentStudentEnrollment,
  sortEnrollmentHistory,
} from "../src/lib/studentEnrollmentSelection";
import {
  buildStudentEnrollmentViewModel,
  buildStudentEnrollmentViewModels,
  buildEnrollmentTimeline,
} from "../src/lib/studentEnrollmentViewModel";
import { buildStudentWorkspace } from "../src/lib/studentWorkspaceService";
import { buildStudentWorkspaceViewModel } from "../src/lib/studentWorkspaceViewModel";
import { formatCivilDateLabel } from "../src/lib/studentWorkspaceDates";
import {
  canReadStudentWorkspaceModule,
  filterAccessibleStudentWorkspaceModules,
} from "../src/lib/studentWorkspacePermissions";
import { getStudentWorkspaceNavigationModules } from "../src/lib/studentWorkspaceNavigation";
import type { PermissionContext } from "../src/lib/permissions";
import type { Student, StudentEnrollment } from "../src/lib/studentDomain";
import { isStudentWorkspaceModuleImplemented } from "../src/lib/studentWorkspaceNavigation";

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

function createEnrollment(
  partial: Partial<StudentEnrollmentRecord> &
    Pick<StudentEnrollmentRecord, "id" | "academicYear" | "status">,
): StudentEnrollmentRecord {
  return {
    studentId: "STU-1",
    schoolCode: "CD-2026-0001",
    classId: null,
    className: null,
    programId: null,
    programName: null,
    source: "SCHOOL_ADMINISTRATION",
    applicationReference: null,
    requestedAt: null,
    enrolledAt: null,
    validatedAt: null,
    endedAt: null,
    previousSchoolName: null,
    notes: null,
    schoolName: "Collège Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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

function testSelectCurrentEnrollmentDeterministic() {
  const enrollments = [
    createEnrollment({
      id: "E-OLD",
      academicYear: "2024-2025",
      status: "COMPLETED",
      className: "6e A",
      enrolledAt: "2024-09-01",
    }),
    createEnrollment({
      id: "E-NEW",
      academicYear: "2026-2027",
      status: "ENROLLED",
      className: "4e A",
      enrolledAt: "2026-09-02",
    }),
    createEnrollment({
      id: "E-MID",
      academicYear: "2025-2026",
      status: "COMPLETED",
      className: "5e B",
      enrolledAt: "2025-09-01",
    }),
  ];

  const shuffled = [enrollments[1], enrollments[0], enrollments[2]];
  const selectedA = selectCurrentStudentEnrollment({
    enrollments,
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });
  const selectedB = selectCurrentStudentEnrollment({
    enrollments: shuffled,
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });

  assertEqual(selectedA?.id, "E-NEW", "Sélection inscription active");
  assertEqual(selectedB?.id, "E-NEW", "Indépendant de l'ordre du tableau");

  const transferred = selectCurrentStudentEnrollment({
    enrollments: [
      createEnrollment({
        id: "E-TR",
        academicYear: "2026-2027",
        status: "TRANSFERRED",
        className: "4e A",
      }),
      createEnrollment({
        id: "E-CL",
        academicYear: "2025-2026",
        status: "COMPLETED",
        className: "5e B",
      }),
    ],
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });
  assertEqual(
    transferred,
    null,
    "Transférée / clôturée non sélectionnée comme active",
  );
}

function testRecencyBreaksTiesAgainstAlphabeticalIds() {
  // id "A" est alphabétiquement avant "B" — sans récence réelle, A serait choisi.
  const olderFirst = [
    createEnrollment({
      id: "A",
      academicYear: "2026-2027",
      status: "ENROLLED",
      schoolCode: "CD-2026-0001",
      enrolledAt: "2026-01-01",
    }),
    createEnrollment({
      id: "B",
      academicYear: "2026-2027",
      status: "ENROLLED",
      schoolCode: "CD-2026-0001",
      enrolledAt: "2026-09-01",
    }),
  ];

  const selectedFromOlderFirst = selectCurrentStudentEnrollment({
    enrollments: olderFirst,
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });
  assertEqual(
    selectedFromOlderFirst?.id,
    "B",
    "Récence : date plus récente gagne malgré id alphabétique défavorable",
  );

  const selectedFromReversed = selectCurrentStudentEnrollment({
    enrollments: [...olderFirst].reverse(),
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });
  assertEqual(
    selectedFromReversed?.id,
    "B",
    "Récence indépendante de l'ordre du tableau et des ids",
  );
}

function testSingleActivePerYearAndDuplicates() {
  const ok = assertSingleActiveEnrollmentPerYear([
    createEnrollment({
      id: "A",
      academicYear: "2026-2027",
      status: "ENROLLED",
    }),
    createEnrollment({
      id: "B",
      academicYear: "2025-2026",
      status: "ENROLLED",
    }),
  ]);
  assert(ok.ok, "Une seule inscription active par année OK");

  const dup = assertSingleActiveEnrollmentPerYear([
    createEnrollment({
      id: "A",
      academicYear: "2026-2027",
      status: "ENROLLED",
    }),
    createEnrollment({
      id: "B",
      academicYear: "2026-2027",
      status: "APPROVED",
    }),
  ]);
  assert(!dup.ok, "Détection de plusieurs inscriptions actives");
  assertEqual(dup.duplicates.length, 1, "Un groupe de doublons");
}

function testClassRulesAndStatuses() {
  assert(
    isClassOptionalForStatus("PRE_REGISTERED"),
    "Classe optionnelle avant validation",
  );
  assert(
    isClassOptionalForStatus("PENDING_REVIEW"),
    "Classe optionnelle en examen",
  );
  assert(
    requiresClassWhenEnrolled(
      createEnrollment({
        id: "E",
        academicYear: "2026-2027",
        status: "ENROLLED",
        className: null,
      }),
    ),
    "ENROLLED sans classe signalé",
  );
  assert(
    !requiresClassWhenEnrolled(
      createEnrollment({
        id: "E2",
        academicYear: "2026-2027",
        status: "ENROLLED",
        className: "4e A",
      }),
    ),
    "ENROLLED avec classe OK",
  );
}

function testLegacyNormalizationAndLabels() {
  assertEqual(
    normalizeStudentEnrollmentStatus("Inscrit"),
    "ENROLLED",
    "Normalisation Inscrit",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus("En attente"),
    "PENDING_REVIEW",
    "Normalisation En attente",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus("Transféré"),
    "TRANSFERRED",
    "Normalisation Transféré",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus("PrÃ©inscrit"),
    "PRE_REGISTERED",
    "Normalisation mojibake Préinscrit",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus("Sorti"),
    "WITHDRAWN",
    "Normalisation Sorti",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus(""),
    "PENDING_REVIEW",
    "Valeur vide → PENDING_REVIEW (pas ENROLLED silencieux)",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus("STATUT-CORROMPU"),
    "PENDING_REVIEW",
    "Valeur inconnue → PENDING_REVIEW",
  );
  assertEqual(
    normalizeStudentEnrollmentStatus(null, { fallback: "ENROLLED" }),
    "ENROLLED",
    "Fallback explicite legacy ENROLLED",
  );

  const labels = listEnrollmentStatusLabels();
  for (const status of STUDENT_ENROLLMENT_STATUSES) {
    assert(Boolean(labels[status]), `Libellé statut ${status}`);
    assert(
      Boolean(getEnrollmentStatusPresentation(status).label),
      `Presentation ${status}`,
    );
  }

  const sources = listEnrollmentSourceLabels();
  assertEqual(
    sources.PUBLIC_WEBSITE,
    "Préinscription en ligne",
    "Libellé source publique",
  );
  assertEqual(
    getEnrollmentSourceLabel("SCHOOL_ADMINISTRATION"),
    "Administration",
    "Libellé administration",
  );
  for (const label of Object.values(sources)) {
    assert(Boolean(label), "Tous les libellés de source");
  }
}

function testHistorySortingAndFallbacks() {
  const history = sortEnrollmentHistory([
    createEnrollment({
      id: "E1",
      academicYear: "2024-2025",
      status: "COMPLETED",
      enrolledAt: "2024-09-01",
    }),
    createEnrollment({
      id: "E3",
      academicYear: "2026-2027",
      status: "ENROLLED",
      enrolledAt: "2026-09-01",
    }),
    createEnrollment({
      id: "E2",
      academicYear: "2025-2026",
      status: "COMPLETED",
      enrolledAt: "2025-09-01",
    }),
  ]);
  assertEqual(
    history.map((row) => row.id).join(","),
    "E3,E2,E1",
    "Historique du plus récent au plus ancien",
  );

  const empty = buildStudentEnrollmentViewModels({
    enrollments: [],
    academicYear: "2026-2027",
    schoolCode: "CD-2026-0001",
  });
  assertEqual(empty.currentEnrollment, null, "Fallback sans inscription");
  assertEqual(empty.enrollmentHistory.length, 0, "Historique vide");
}

function testCivilDatesAndReferences() {
  assertEqual(
    formatCivilDateLabel("2026-09-15"),
    new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(2026, 8, 15)),
    "Date civile sans décalage",
  );

  const publicEnrollment = createEnrollment({
    id: "PUB",
    academicYear: "2026-2027",
    status: "PRE_REGISTERED",
    source: "PUBLIC_WEBSITE",
    applicationReference: "PRE-2027-000184",
    requestedAt: "2026-06-01",
  });
  const publicVm = buildStudentEnrollmentViewModel(publicEnrollment);
  assertEqual(
    publicVm.applicationReferenceLabel,
    "PRE-2027-000184",
    "Référence publique affichée",
  );
  assert(publicVm.hasApplicationReference, "Flag référence");

  const adminVm = buildStudentEnrollmentViewModel(
    createEnrollment({
      id: "ADM",
      academicYear: "2026-2027",
      status: "ENROLLED",
      source: "SCHOOL_ADMINISTRATION",
      applicationReference: null,
      className: "4e A",
      enrolledAt: "2026-09-01",
    }),
  );
  assertEqual(
    adminVm.applicationReferenceLabel,
    "Aucune référence",
    "Absence de référence pour inscription administrative",
  );
  assert(!adminVm.hasApplicationReference, "Pas de référence admin");

  const dateCheck = validateEnrollmentDateOrder({
    requestedAt: "2026-06-01",
    validatedAt: "2026-07-01",
    enrolledAt: "2026-09-01",
    endedAt: null,
  });
  assert(dateCheck.ok, "Ordre des dates cohérent");

  const badDates = validateEnrollmentDateOrder({
    requestedAt: "2026-09-01",
    validatedAt: "2026-07-01",
    enrolledAt: null,
    endedAt: null,
  });
  assert(!badDates.ok, "Ordre des dates incohérent détecté");
}

function testPermissionsAndPartialData() {
  const modules = getStudentWorkspaceNavigationModules();
  const denied = createPermissionCtx(
    ["Élèves:READ", "student.overview.read", "student.identity.read"],
  );
  const visible = filterAccessibleStudentWorkspaceModules(modules, denied);
  assert(
    !visible.some((module) => module.id === "enrollments"),
    "Onglet masqué sans student.enrollments.read",
  );
  assert(
    !canReadStudentWorkspaceModule(denied, "student.enrollments.read"),
    "Onglet refusé sans droit de lecture",
  );

  const student: Student = {
    id: "STU-PARTIAL",
    matricule: "M-P",
    schoolCode: "CD-2026-0001",
    lastName: "Test",
  };
  const workspace = buildStudentWorkspace({
    studentId: "STU-PARTIAL",
    academicYear: "2026-2027",
    data: { students: [student], enrollments: [] },
  });
  assert(workspace !== null, "Données partielles sans crash");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assertEqual(vm.currentEnrollment, null, "Pas d'inscription");
  assert(vm.alerts.some((a) => a.id === "missing-active-enrollment"), "Alerte");
}

function testMultiYearAndLegacyBridge() {
  const domainEnrollments: StudentEnrollment[] = [
    {
      id: "D1",
      studentId: "STU-1",
      schoolCode: "CD-2026-0001",
      academicYear: "2024-2025",
      className: "6e A",
      status: "COMPLETED" as never,
      enrollmentDate: "2024-09-01",
      source: "IMPORT",
    },
    {
      id: "D2",
      studentId: "STU-1",
      schoolCode: "CD-2026-0001",
      academicYear: "2025-2026",
      className: "5e B",
      status: "COMPLETED" as never,
      enrollmentDate: "2025-09-01",
    },
    {
      id: "D3",
      studentId: "STU-1",
      schoolCode: "CD-2026-0001",
      academicYear: "2026-2027",
      className: "4e A",
      status: "Inscrit" as never,
      enrollmentDate: "2026-09-01",
      programName: "Général",
      source: "SCHOOL_ADMINISTRATION",
    },
  ];

  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    lastName: "Kabongo",
    firstName: "Léa",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [student],
      schools: [{ code: "CD-2026-0001", name: "Lycée Horizon" }],
      enrollments: domainEnrollments.map((row) =>
        toStudentEnrollmentRecord(row, { schoolName: "Lycée Horizon" }),
      ) as unknown as StudentEnrollment[],
    },
  });

  // Rebuild with raw domain enrollments (status normalization inside collect)
  const workspace2 = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    data: {
      students: [student],
      schools: [{ code: "CD-2026-0001", name: "Lycée Horizon" }],
      enrollments: domainEnrollments,
    },
  });

  assert(workspace2 !== null, "Workspace multi-années");
  const vm = buildStudentWorkspaceViewModel(workspace2!);
  assertEqual(vm.enrollmentHistory.length, 3, "Plusieurs années scolaires");
  assertEqual(vm.currentEnrollment?.academicYearLabel, "2026-2027", "Année courante");
  assertEqual(vm.currentEnrollment?.status, "ENROLLED", "Statut normalisé");
  assertEqual(vm.currentEnrollment?.classLabel, "4e A", "Classe");
  assertEqual(vm.currentEnrollment?.programLabel, "Général", "Filière");
  assert(isStudentWorkspaceModuleImplemented("enrollments"), "Module implémenté");

  const legacyStudent: Student = {
    id: "STU-LEG",
    matricule: "M-L",
    schoolCode: "CD-2026-0001",
    schoolYear: "2026-2027",
    className: "3e C",
    schoolStatus: "Inscrit",
    enrollmentDate: "2026-09-10",
  };
  const legacyRecords = collectStudentEnrollmentRecords({
    student: legacyStudent,
    enrollments: [],
    schoolName: "Collège Test",
  });
  assertEqual(legacyRecords.length, 1, "Pont legacy");
  assertEqual(legacyRecords[0]?.source, "MIGRATION", "Source migration");
  assertEqual(legacyRecords[0]?.status, "ENROLLED", "Statut legacy");

  void workspace;
}

function testTimelineAndAlerts() {
  const pre = createEnrollment({
    id: "PRE",
    academicYear: "2026-2027",
    status: "PRE_REGISTERED",
    source: "PUBLIC_WEBSITE",
    applicationReference: "PRE-2027-000001",
    requestedAt: "2026-05-01",
  });
  const timeline = buildEnrollmentTimeline(pre);
  assertEqual(timeline[0]?.state, "current", "Demande reçue en cours");
  assertEqual(timeline[1]?.state, "upcoming", "Examen à venir");

  const enrolledNoClass = createEnrollment({
    id: "ENC",
    academicYear: "2026-2027",
    status: "ENROLLED",
    enrolledAt: "2026-09-01",
  });
  const enrolledTimeline = buildEnrollmentTimeline(enrolledNoClass);
  assertEqual(
    enrolledTimeline.find((step) => step.key === "class_assignment")?.state,
    "current",
    "Affectation en cours si ENROLLED sans classe",
  );

  const student: Student = {
    id: "STU-AL",
    matricule: "M-A",
    schoolCode: "CD-2026-0001",
    gender: "F",
    birthDate: "2012-01-01",
    phone: "+243800",
    nationality: "CD",
  };
  const workspace = buildStudentWorkspace({
    studentId: "STU-AL",
    academicYear: "2026-2027",
    data: {
      students: [student],
      schools: [{ code: "CD-2026-0001", name: "École" }],
      enrollments: [
        {
          id: "E-INC",
          studentId: "STU-AL",
          schoolCode: "CD-2026-0001",
          academicYear: "2026-2027",
          status: "INCOMPLETE",
          source: "PUBLIC_WEBSITE",
          applicationReference: "PRE-1",
        },
      ],
      guardians: [{ id: "G1", personId: "P1" }],
      guardianRelations: [
        {
          id: "R1",
          studentId: "STU-AL",
          guardianId: "G1",
          relationshipType: "Père",
          status: "Actif",
        },
      ],
      persons: [
        { id: "P1", lastName: "Parent", firstName: "Jean", phone: "+243811" },
      ],
    },
  });
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assert(
    vm.alerts.some((alert) => alert.id === "incomplete-pre-enrollment"),
    "Alerte dossier incomplet",
  );
}

async function testC18aValidateAndAssignClass() {
  assert(canValidateEnrollmentStatus("PRE_REGISTERED"), "validate depuis brouillon");
  assert(canValidateEnrollmentStatus("PENDING_REVIEW"), "validate depuis en attente");
  assert(canValidateEnrollmentStatus("INCOMPLETE"), "validate depuis incomplet");
  assert(!canValidateEnrollmentStatus("APPROVED"), "pas de re-validation");
  assert(!canValidateEnrollmentStatus("ENROLLED"), "pas de validate depuis inscrit");
  assertEqual(nextStatusAfterValidate(), "APPROVED", "cible validation");

  assert(canAssignClassEnrollmentStatus("APPROVED"), "assign depuis validé");
  assert(canAssignClassEnrollmentStatus("ENROLLED"), "réaffectation");
  assert(!canAssignClassEnrollmentStatus("PENDING_REVIEW"), "assign interdit avant validation");
  assertEqual(nextStatusAfterAssignClass("APPROVED"), "ENROLLED", "cible affectation");

  const enrollment = seedEditableEnrollment({
    enrollmentId: "E-C18A",
    studentId: "STU-C18A",
    schoolCode: "CD-2026-0001",
    academicYear: "2026-2027",
    status: "PENDING_REVIEW",
    requestedAt: "2026-05-01",
    version: 1,
  });
  const schoolClass = seedSchoolClass({
    id: "CLS-4A",
    name: "4e A",
    schoolCode: "CD-2026-0001",
  });
  const store = createMockEditingStore({
    enrollments: [enrollment],
    schoolClasses: [schoolClass],
  });
  const repo = createMockStudentWorkspaceCommandRepository(store, {
    now: () => "2026-07-23T10:00:00.000Z",
  });

  const denied = await executeStudentUpdateCommand(
    {
      type: "VALIDATE_ENROLLMENT",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 1,
    },
    {
      userId: "u-deny",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      permissions: ["Élèves:UPDATE", "Élèves:READ"],
    },
    repo,
  );
  assertEqual(denied.success, false, "RBAC validate refusé via bridge");
  if (!denied.success) {
    assertEqual(denied.code, "PERMISSION_DENIED", "code permission validate");
  }
  assertEqual(
    store.enrollments.get("STU-C18A:E-C18A")?.status,
    "PENDING_REVIEW",
    "aucun état intermédiaire après refus",
  );

  assert(
    canUpdateStudentWorkspace(
      {
        userId: "u-ok",
        role: "Secrétaire",
        schoolCode: "CD-2026-0001",
        permissions: ["student.enrollments.validate"],
      },
      "student.enrollments.validate",
    ),
    "RBAC validate autorisé",
  );

  const validated = await executeStudentUpdateCommand(
    {
      type: "VALIDATE_ENROLLMENT",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 1,
    },
    {
      userId: "u-ok",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.validate"],
    },
    repo,
  );
  assert(validated.success, "validation OK");
  if (validated.success) {
    const agg = validated.updatedAggregate as {
      status: string;
      validatedAt: string | null;
      version: number;
    };
    assertEqual(agg.status, "APPROVED", "statut VALIDÉ");
    assertEqual(agg.validatedAt, "2026-07-23", "validatedAt posé");
    assertEqual(agg.version, 2, "version incrémentée");
    assert(
      store.auditLog.some((item) => item.commandType === "VALIDATE_ENROLLMENT"),
      "audit validate",
    );
  }

  const assignDenied = await executeStudentUpdateCommand(
    {
      type: "ASSIGN_ENROLLMENT_CLASS",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 2,
      changes: { classId: "CLS-4A", className: "4e A" },
    },
    {
      userId: "u-deny",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.validate"],
    },
    repo,
  );
  assertEqual(assignDenied.success, false, "RBAC assign refusé sans jeton");

  const assignMissingClass = await executeStudentUpdateCommand(
    {
      type: "ASSIGN_ENROLLMENT_CLASS",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 2,
      changes: { classId: "CLS-UNKNOWN" },
    },
    {
      userId: "u-ok",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.assign-class"],
    },
    repo,
  );
  assertEqual(assignMissingClass.success, false, "classe inexistante refusée");
  assertEqual(
    store.enrollments.get("STU-C18A:E-C18A")?.status,
    "APPROVED",
    "statut inchangé si classe invalide",
  );

  const assigned = await executeStudentUpdateCommand(
    {
      type: "ASSIGN_ENROLLMENT_CLASS",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 2,
      changes: { classId: "CLS-4A" },
    },
    {
      userId: "u-ok",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.assign-class"],
    },
    repo,
  );
  assert(assigned.success, "affectation OK");
  if (assigned.success) {
    const agg = assigned.updatedAggregate as {
      status: string;
      classId: string | null;
      className: string | null;
      enrolledAt: string | null;
    };
    assertEqual(agg.status, "ENROLLED", "statut AFFECTÉ/Inscrit");
    assertEqual(agg.classId, "CLS-4A", "classId");
    assertEqual(agg.className, "4e A", "className résolu");
    assertEqual(agg.enrolledAt, "2026-07-23", "enrolledAt posé");
  }

  const invalidBack = await executeStudentUpdateCommand(
    {
      type: "VALIDATE_ENROLLMENT",
      studentId: "STU-C18A",
      enrollmentId: "E-C18A",
      expectedVersion: 3,
    },
    {
      userId: "u-ok",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.validate"],
    },
    repo,
  );
  assertEqual(invalidBack.success, false, "pas de retour arrière implicite");

  const record = fromEditableEnrollment(
    store.enrollments.get("STU-C18A:E-C18A")!,
  );
  const history = collectStudentHistoryRecord({
    studentId: "STU-C18A",
    enrollments: [record],
  });
  assert(
    history.events.some((event) => event.type === "STATUS_CHANGED"),
    "historique validation projeté",
  );
  assert(
    history.events.some((event) => event.type === "CLASS_ASSIGNED"),
    "historique affectation projeté",
  );

  const timeline = buildEnrollmentTimeline(record);
  assertEqual(
    timeline.find((step) => step.key === "class_assignment")?.state,
    "completed",
    "timeline affectation complétée",
  );

  // classId valide + className contradictoire → libellé canonique du catalogue.
  const reassignStore = createMockEditingStore({
    enrollments: [
      seedEditableEnrollment({
        enrollmentId: "E-CANON",
        studentId: "STU-CANON",
        schoolCode: "CD-2026-0001",
        academicYear: "2026-2027",
        status: "APPROVED",
        validatedAt: "2026-07-20",
        version: 2,
      }),
    ],
    schoolClasses: [
      seedSchoolClass({
        id: "CLS-5B",
        name: "5e B",
        schoolCode: "CD-2026-0001",
      }),
    ],
  });
  const reassignRepo = createMockStudentWorkspaceCommandRepository(reassignStore, {
    now: () => "2026-07-23T12:00:00.000Z",
  });
  const canonical = await executeStudentUpdateCommand(
    {
      type: "ASSIGN_ENROLLMENT_CLASS",
      studentId: "STU-CANON",
      enrollmentId: "E-CANON",
      expectedVersion: 2,
      changes: { classId: "CLS-5B", className: "Nom Contredit Par Client" },
    },
    {
      userId: "u-ok",
      role: "Secrétaire",
      schoolCode: "CD-2026-0001",
      permissions: ["student.enrollments.assign-class"],
    },
    reassignRepo,
  );
  assert(canonical.success, "affectation avec nom contradictoire acceptée");
  if (canonical.success) {
    const agg = canonical.updatedAggregate as {
      classId: string | null;
      className: string | null;
    };
    assertEqual(agg.classId, "CLS-5B", "classId canonique");
    assertEqual(agg.className, "5e B", "className catalogue, pas le client");
  }
}

async function testC18aCanonicalClassCatalogRefusals() {
  const emptyCatalog = resolveSchoolClass(
    { className: "4e A" },
    [],
    "CD-2026-0001",
  );
  assertEqual(emptyCatalog.ok, false, "catalogue vide → refus");
  if (!emptyCatalog.ok) {
    assertEqual(emptyCatalog.code, "CLASS_NOT_FOUND", "code catalogue vide");
  }

  const catalog = [
    seedSchoolClass({
      id: "CLS-4A",
      name: "4e A",
      schoolCode: "CD-2026-0001",
    }),
    seedSchoolClass({
      id: "CLS-OTHER",
      name: "6e Z",
      schoolCode: "CD-OTHER-9999",
    }),
  ];

  const unknownLabel = resolveSchoolClass(
    { className: "Classe Fantôme" },
    catalog,
    "CD-2026-0001",
  );
  assertEqual(unknownLabel.ok, false, "libellé inconnu → refus");
  if (!unknownLabel.ok) {
    assertEqual(unknownLabel.code, "CLASS_NOT_FOUND", "code libellé inconnu");
  }

  const otherSchoolById = resolveSchoolClass(
    { classId: "CLS-OTHER" },
    catalog,
    "CD-2026-0001",
  );
  assertEqual(otherSchoolById.ok, false, "classe autre établissement → refus");
  if (!otherSchoolById.ok) {
    assertEqual(otherSchoolById.code, "CLASS_NOT_FOUND", "code autre établissement");
  }

  const otherSchoolByName = resolveSchoolClass(
    { className: "6e Z" },
    catalog,
    "CD-2026-0001",
  );
  assertEqual(
    otherSchoolByName.ok,
    false,
    "libellé d'un autre établissement → refus",
  );

  const validIdContradictoryName = resolveSchoolClass(
    { classId: "CLS-4A", className: "Nom Contredit" },
    catalog,
    "CD-2026-0001",
  );
  assert(validIdContradictoryName.ok, "classId valide → succès");
  if (validIdContradictoryName.ok) {
    assertEqual(validIdContradictoryName.classId, "CLS-4A", "classId non nul");
    assertEqual(
      validIdContradictoryName.className,
      "4e A",
      "nom canonique catalogue",
    );
  }

  // Refus commande : agrégat + audit inchangés.
  async function assertAssignRefusalUnchanged(input: {
    label: string;
    schoolClasses: ReturnType<typeof seedSchoolClass>[];
    changes: { classId?: string | null; className?: string | null };
  }) {
    const enrollment = seedEditableEnrollment({
      enrollmentId: "E-REFUSE",
      studentId: "STU-REFUSE",
      schoolCode: "CD-2026-0001",
      academicYear: "2026-2027",
      status: "APPROVED",
      validatedAt: "2026-07-20",
      version: 2,
      classId: null,
      className: null,
    });
    const store = createMockEditingStore({
      enrollments: [enrollment],
      schoolClasses: input.schoolClasses,
    });
    const before = structuredClone(store.enrollments.get("STU-REFUSE:E-REFUSE")!);
    const auditBefore = store.auditLog.length;
    const repo = createMockStudentWorkspaceCommandRepository(store);
    const result = await executeStudentUpdateCommand(
      {
        type: "ASSIGN_ENROLLMENT_CLASS",
        studentId: "STU-REFUSE",
        enrollmentId: "E-REFUSE",
        expectedVersion: 2,
        changes: input.changes,
      },
      {
        userId: "u-ok",
        role: "Secrétaire",
        schoolCode: "CD-2026-0001",
        permissions: ["student.enrollments.assign-class"],
      },
      repo,
    );
    assertEqual(result.success, false, `${input.label}: commande refusée`);
    if (!result.success) {
      assertEqual(result.code, "VALIDATION_ERROR", `${input.label}: code validation`);
      assert(
        result.errors.some((item) => item.code === "CLASS_NOT_FOUND"),
        `${input.label}: CLASS_NOT_FOUND`,
      );
    }
    const after = store.enrollments.get("STU-REFUSE:E-REFUSE")!;
    assertEqual(after.status, before.status, `${input.label}: statut inchangé`);
    assertEqual(after.version, before.version, `${input.label}: version inchangée`);
    assertEqual(after.classId, before.classId, `${input.label}: classId inchangé`);
    assertEqual(after.className, before.className, `${input.label}: className inchangé`);
    assertEqual(
      store.auditLog.length,
      auditBefore,
      `${input.label}: audit inchangé`,
    );
  }

  await assertAssignRefusalUnchanged({
    label: "catalogue vide + className",
    schoolClasses: [],
    changes: { className: "4e A" },
  });
  await assertAssignRefusalUnchanged({
    label: "libellé inconnu",
    schoolClasses: [
      seedSchoolClass({
        id: "CLS-4A",
        name: "4e A",
        schoolCode: "CD-2026-0001",
      }),
    ],
    changes: { className: "Classe Fantôme" },
  });
  await assertAssignRefusalUnchanged({
    label: "classe autre établissement",
    schoolClasses: [
      seedSchoolClass({
        id: "CLS-LOCAL",
        name: "4e A",
        schoolCode: "CD-2026-0001",
      }),
      seedSchoolClass({
        id: "CLS-FOREIGN",
        name: "6e Z",
        schoolCode: "CD-OTHER-9999",
      }),
    ],
    changes: { classId: "CLS-FOREIGN", className: "6e Z" },
  });
}

async function main() {
  const tests = [
    ["sélection déterministe", testSelectCurrentEnrollmentDeterministic],
    ["récence vs ids alphabétiques", testRecencyBreaksTiesAgainstAlphabeticalIds],
    ["unicité inscription active", testSingleActivePerYearAndDuplicates],
    ["règles de classe", testClassRulesAndStatuses],
    ["normalisation et libellés", testLegacyNormalizationAndLabels],
    ["historique et fallbacks", testHistorySortingAndFallbacks],
    ["dates et références", testCivilDatesAndReferences],
    ["permissions et données partielles", testPermissionsAndPartialData],
    ["multi-années et legacy", testMultiYearAndLegacyBridge],
    ["timeline et alertes", testTimelineAndAlerts],
    ["C1.8a validate + assign + RBAC + audit", testC18aValidateAndAssignClass],
    ["C1.8a catalogue classe canonique", testC18aCanonicalClassCatalogRefusals],
  ] as const;

  for (const [name, run] of tests) {
    await run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student enrollment C1.2 / C1.8a`);
}

void main();
