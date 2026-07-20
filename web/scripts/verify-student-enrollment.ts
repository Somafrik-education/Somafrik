/**
 * Vérifications C1.2 — inscription et parcours scolaire.
 * Exécution : npm run verify:student-enrollment
 */
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

function main() {
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
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student enrollment C1.2`);
}

main();
