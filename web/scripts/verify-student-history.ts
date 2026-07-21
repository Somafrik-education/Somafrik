/**
 * Vérifications C1.6 — historique chronologique élève.
 * Exécution : npm run verify:student-history
 */
import {
  FUTURE_STUDENT_HISTORY_PERMISSIONS,
  collectStudentHistoryRecord,
  compareHistorySeverity,
  createClassChangedEvent,
  diagnoseStudentHistory,
  filterStudentHistoryRecordByVisibility,
  isRecentHistoryEvent,
  sortStudentHistoryEvents,
  type StudentHistoryEvent,
} from "../src/lib/studentHistory";
import {
  buildStudentHistoryViewModel,
  resolveHistoryGroupKey,
} from "../src/lib/studentHistoryViewModel";
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
import type { Student } from "../src/lib/studentDomain";
import type { StudentEnrollmentRecord } from "../src/lib/studentEnrollment";
import type { StudentGuardianRelationRecord } from "../src/lib/studentGuardian";
import {
  createEmptyStudentMedicalRecord,
  type StudentMedicalRecord,
} from "../src/lib/studentMedical";
import {
  collectStudentDocumentRecord,
} from "../src/lib/studentDocuments";

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

function createEvent(
  partial: Partial<StudentHistoryEvent> &
    Pick<StudentHistoryEvent, "id" | "occurredAt" | "title" | "type">,
): StudentHistoryEvent {
  const occurredAt = partial.occurredAt ?? null;
  return {
    description: null,
    severity: "INFO",
    sourceModule: "SYSTEM",
    actor: null,
    visibility: "STAFF",
    metadata: {},
    iconKey: "system",
    dateQuality: occurredAt ? "EXACT" : "UNKNOWN",
    ...partial,
    occurredAt,
  };
}

function testChronologicalSort() {
  const sorted = sortStudentHistoryEvents([
    createEvent({
      id: "a",
      type: "OTHER",
      occurredAt: "2026-01-01",
      title: "Ancien",
    }),
    createEvent({
      id: "b",
      type: "OTHER",
      occurredAt: "2026-06-15",
      title: "Récent",
    }),
    createEvent({
      id: "c",
      type: "OTHER",
      occurredAt: "2026-03-01",
      title: "Milieu",
    }),
  ]);

  assertEqual(
    sorted.map((item) => item.id).join(","),
    "b,c,a",
    "Tri plus récent → plus ancien",
  );
}

function testSeverityTieBreak() {
  assert(compareHistorySeverity("IMPORTANT", "WARNING") < 0, "IMPORTANT < WARNING");
  assert(compareHistorySeverity("WARNING", "INFO") < 0, "WARNING < INFO");

  const sorted = sortStudentHistoryEvents([
    createEvent({
      id: "info",
      type: "OTHER",
      occurredAt: "2026-07-01",
      title: "Info",
      severity: "INFO",
    }),
    createEvent({
      id: "important",
      type: "OTHER",
      occurredAt: "2026-07-01",
      title: "Important",
      severity: "IMPORTANT",
    }),
    createEvent({
      id: "warning",
      type: "OTHER",
      occurredAt: "2026-07-01",
      title: "Warning",
      severity: "WARNING",
    }),
  ]);

  assertEqual(
    sorted.map((item) => item.id).join(","),
    "important,warning,info",
    "Tie-break sévérité",
  );
}

function testTemporalGrouping() {
  const referenceDate = new Date(2026, 6, 21); // 21 juillet 2026
  assertEqual(
    resolveHistoryGroupKey("2026-07-21", referenceDate),
    "TODAY",
    "Aujourd'hui",
  );
  assertEqual(
    resolveHistoryGroupKey("2026-07-20", referenceDate),
    "YESTERDAY",
    "Hier",
  );
  assertEqual(
    resolveHistoryGroupKey("2026-07-18", referenceDate),
    "THIS_WEEK",
    "Cette semaine",
  );
  assertEqual(
    resolveHistoryGroupKey("2026-07-05", referenceDate),
    "THIS_MONTH",
    "Ce mois",
  );
  assertEqual(
    resolveHistoryGroupKey("2026-05-01", referenceDate),
    "OLDER",
    "Plus ancien",
  );
  assertEqual(
    resolveHistoryGroupKey(null, referenceDate),
    "DATE_UNKNOWN",
    "Date non renseignée",
  );
}

function testUndatedEventsSortAfterDated() {
  const sorted = sortStudentHistoryEvents([
    createEvent({
      id: "undated",
      type: "GUARDIAN_ADDED",
      occurredAt: null,
      title: "Sans date",
      severity: "IMPORTANT",
    }),
    createEvent({
      id: "dated",
      type: "OTHER",
      occurredAt: "2020-01-01",
      title: "Ancien daté",
      severity: "INFO",
    }),
  ]);
  assertEqual(sorted[0]?.id, "dated", "Daté avant non daté");
  assertEqual(sorted[1]?.id, "undated", "Non daté en fin");
  assert(
    !isRecentHistoryEvent(null),
    "occurredAt null n'est jamais récent",
  );
}

function testLegacyProjection() {
  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
    createdAt: "2025-05-02",
  };

  const enrollments: StudentEnrollmentRecord[] = [
    {
      id: "ENR-1",
      studentId: "STU-1",
      schoolCode: "CD-2026-0001",
      academicYear: "2025-2026",
      classId: "C1",
      className: "6ème A",
      programId: null,
      programName: null,
      status: "ENROLLED",
      source: "SCHOOL_ADMINISTRATION",
      applicationReference: null,
      requestedAt: "2025-06-01",
      enrolledAt: "2025-06-12",
      validatedAt: "2025-06-10",
      endedAt: null,
      previousSchoolName: null,
      notes: null,
      schoolName: "École",
      createdAt: "2025-06-01",
      updatedAt: "2025-06-12",
    },
  ];

  const guardians: StudentGuardianRelationRecord[] = [
    {
      id: "G1",
      studentId: "STU-1",
      guardianId: "G-1",
      relationshipType: "MOTHER",
      isLegalGuardian: true,
      livesWithStudent: true,
      isEmergencyContact: true,
      pickupAuthorized: false,
      financialResponsible: true,
      priority: 1,
      startDate: "2025-06-11",
      endDate: null,
      notes: null,
      phone: "+243800",
      email: null,
      address: null,
      displayName: "Marie Test",
      isActive: true,
      isExpired: false,
      source: "LEGACY",
      requiresVerification: true,
      dataQuality: "UNVERIFIED",
    },
  ];

  const medical: StudentMedicalRecord = {
    ...createEmptyStudentMedicalRecord("STU-1"),
    hasProfile: true,
    source: "LEGACY",
    updatedAt: "2026-07-20",
  };

  const documents = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      {
        id: "D1",
        studentId: "STU-1",
        documentType: "Acte de naissance",
        fileUrl: "/files/acte.pdf",
        status: "Vérifié",
        verifiedAt: "2026-07-21",
        verifiedBy: "Administration",
      },
      {
        id: "D2",
        studentId: "STU-1",
        documentType: "Photo",
        fileUrl: "/files/photo.jpg",
        status: "En attente",
        issuedAt: "2026-07-15",
      },
      {
        id: "D3",
        studentId: "STU-1",
        documentType: "Certificat médical",
        fileUrl: "/files/med.pdf",
        status: "Refusé",
        verifiedAt: "2026-07-10",
      },
    ],
  });

  const record = collectStudentHistoryRecord({
    studentId: "STU-1",
    student,
    enrollments,
    guardians,
    medical,
    documents,
    referenceDate: new Date(2026, 6, 21),
  });

  assert(record.events.length > 0, "Événements projetés");
  assertEqual(record.source, "LEGACY", "Source legacy");
  assert(
    record.events.some((event) => event.type === "STUDENT_CREATED"),
    "Élève créé",
  );
  assert(
    record.events.some((event) => event.type === "STATUS_CHANGED"),
    "Inscription validée/inscrite",
  );
  assert(
    record.events.some((event) => event.type === "GUARDIAN_ADDED"),
    "Responsable",
  );
  assert(
    record.events.some((event) => event.type === "MEDICAL_UPDATED"),
    "Médical",
  );
  assert(
    record.events.some((event) => event.type === "DOCUMENT_VERIFIED"),
    "Document vérifié",
  );
  assert(
    record.events.some((event) => event.type === "DOCUMENT_SUBMITTED"),
    "Document déposé",
  );
  assert(
    record.events.some((event) => event.type === "DOCUMENT_REJECTED"),
    "Document refusé",
  );
}

function testDiagnosticsAndViewModel() {
  const referenceDate = new Date(2026, 6, 21);
  const record = collectStudentHistoryRecord({
    studentId: "STU-1",
    student: {
      id: "STU-1",
      matricule: "M-1",
      schoolCode: "CD-2026-0001",
      createdAt: "2026-07-21",
    },
    medical: {
      ...createEmptyStudentMedicalRecord("STU-1"),
      hasProfile: true,
      updatedAt: "2026-07-21",
      source: "LEGACY",
    },
    referenceDate,
  });

  const diagnostics = diagnoseStudentHistory(record, referenceDate);
  assert(diagnostics.hasImportantEvent, "Important présent");
  assert(diagnostics.hasRecentActivity, "Activité récente");
  assert(diagnostics.latestEvent !== null, "Dernier événement");
  assert(isRecentHistoryEvent("2026-07-21", referenceDate), "isRecent");

  const vm = buildStudentHistoryViewModel(record, {
    referenceDate,
    allowedVisibility: ["STAFF", "ADMIN"],
  });
  assert(vm.groups.length > 0, "Groupes temporels");
  assertEqual(vm.groups[0]?.key, "TODAY", "Groupe aujourd'hui");
  assert(vm.timeline.length > 0, "Timeline");
  assert(vm.latestImportantEventLabel !== null, "Label important");
}

function testPermissionsAndVisibility() {
  assert(
    FUTURE_STUDENT_HISTORY_PERMISSIONS.includes("student.history.read"),
    "read",
  );
  assert(
    FUTURE_STUDENT_HISTORY_PERMISSIONS.includes("student.history.export"),
    "export",
  );
  assert(
    FUTURE_STUDENT_HISTORY_PERMISSIONS.includes("student.history.audit"),
    "audit",
  );
  assertEqual(
    getStudentWorkspaceModule("history")?.requiredPermission,
    "student.history.read",
    "Permission module",
  );

  const bridge = createPermissionCtx(["Élèves:READ"]);
  assert(
    canReadStudentWorkspaceModule(bridge, "student.history.read"),
    "Bridge",
  );

  const record = collectStudentHistoryRecord({
    studentId: "STU-1",
    student: {
      id: "STU-1",
      matricule: "M-1",
      schoolCode: "CD-2026-0001",
      archived: true,
      archivedAt: "2026-01-01",
      createdAt: "2025-01-01",
    },
  });

  assert(
    record.events.some((event) => event.visibility === "ADMIN"),
    "Événement ADMIN (archive)",
  );

  const staffOnly = filterStudentHistoryRecordByVisibility(record, ["STAFF"]);
  assert(
    !staffOnly.events.some((event) => event.visibility === "ADMIN"),
    "STAFF ne voit pas ADMIN",
  );
  assert(
    staffOnly.events.some((event) => event.type === "STUDENT_CREATED"),
    "STAFF voit STAFF",
  );

  const adminView = filterStudentHistoryRecordByVisibility(record, [
    "STAFF",
    "ADMIN",
  ]);
  assert(
    adminView.events.some((event) => event.visibility === "ADMIN"),
    "ADMIN voit STAFF+ADMIN",
  );
}

function testCtoNoFakeGuardianDate() {
  const referenceDate = new Date(2026, 6, 21);
  const record = collectStudentHistoryRecord({
    studentId: "STU-1",
    guardians: [
      {
        id: "G1",
        studentId: "STU-1",
        guardianId: "G-1",
        relationshipType: "MOTHER",
        isLegalGuardian: true,
        livesWithStudent: true,
        isEmergencyContact: true,
        pickupAuthorized: false,
        financialResponsible: true,
        priority: 1,
        startDate: null,
        endDate: null,
        notes: null,
        phone: "+243800",
        email: null,
        address: null,
        displayName: "Marie Test",
        isActive: true,
        isExpired: false,
        source: "LEGACY",
        requiresVerification: true,
        dataQuality: "UNVERIFIED",
      },
    ],
    referenceDate,
  });

  const guardianEvents = record.events.filter(
    (event) => event.type === "GUARDIAN_ADDED",
  );
  assertEqual(guardianEvents.length, 1, "Responsable projeté");
  assertEqual(guardianEvents[0]?.occurredAt, null, "Pas de date inventée");
  assertEqual(guardianEvents[0]?.dateQuality, "UNKNOWN", "dateQuality UNKNOWN");
  assert(
    !JSON.stringify(record.events).includes("1970"),
    "Aucune date 1970",
  );
  assertEqual(
    record.summary.hasRecentActivity,
    false,
    "hasRecentActivity false sans date",
  );

  const vm = buildStudentHistoryViewModel(record, { referenceDate });
  assert(
    vm.groups.some((group) => group.key === "DATE_UNKNOWN"),
    "Groupe Date non renseignée",
  );
  assertEqual(vm.groups[vm.groups.length - 1]?.key, "DATE_UNKNOWN", "En dernier");
}

function testCtoDocumentDatesNotInvented() {
  const referenceDate = new Date(2026, 6, 21);

  const submittedLegacy = collectStudentHistoryRecord({
    studentId: "STU-1",
    documents: collectStudentDocumentRecord({
      studentId: "STU-1",
      documents: [
        {
          id: "D-SUB",
          studentId: "STU-1",
          documentType: "Photo",
          fileUrl: "/files/photo.jpg",
          status: "En attente",
          issuedAt: "2015-03-10",
        },
      ],
      referenceDate,
    }),
    referenceDate,
  });
  const submitted = submittedLegacy.events.find(
    (event) => event.type === "DOCUMENT_SUBMITTED",
  );
  assert(submitted != null, "Document déposé projeté");
  assertEqual(
    submitted!.occurredAt,
    null,
    "issuedAt 2015 ne date pas le dépôt",
  );
  assertEqual(submitted!.dateQuality, "UNKNOWN", "dépôt non daté");

  const verifiedWithoutVerifiedAt = collectStudentHistoryRecord({
    studentId: "STU-1",
    documents: collectStudentDocumentRecord({
      studentId: "STU-1",
      documents: [
        {
          id: "D-VER",
          studentId: "STU-1",
          documentType: "Acte de naissance",
          fileUrl: "/files/acte.pdf",
          status: "Vérifié",
          issuedAt: "2015-03-10",
        },
      ],
      referenceDate,
    }),
    referenceDate,
  });
  const verified = verifiedWithoutVerifiedAt.events.find(
    (event) => event.type === "DOCUMENT_VERIFIED",
  );
  assert(verified != null, "Document vérifié projeté");
  assertEqual(
    verified!.occurredAt,
    null,
    "issuedAt ne date pas la vérification",
  );

  const rejectedWithoutRejectedAt = collectStudentHistoryRecord({
    studentId: "STU-1",
    documents: collectStudentDocumentRecord({
      studentId: "STU-1",
      documents: [
        {
          id: "D-REJ",
          studentId: "STU-1",
          documentType: "Certificat médical",
          fileUrl: "/files/med.pdf",
          status: "Refusé",
          issuedAt: "2018-01-01",
          verifiedAt: "2026-07-10",
        },
      ],
      referenceDate,
    }),
    referenceDate,
  });
  const rejected = rejectedWithoutRejectedAt.events.find(
    (event) => event.type === "DOCUMENT_REJECTED",
  );
  assert(rejected != null, "Document refusé projeté");
  assertEqual(
    rejected!.occurredAt,
    null,
    "verifiedAt/issuedAt ne datent pas le refus",
  );
}

function testCtoClassAssignedNotChanged() {
  const referenceDate = new Date(2026, 6, 21);
  const record = collectStudentHistoryRecord({
    studentId: "STU-1",
    enrollments: [
      {
        id: "ENR-1",
        studentId: "STU-1",
        schoolCode: "CD-2026-0001",
        academicYear: "2025-2026",
        classId: "C1",
        className: "6ème A",
        programId: null,
        programName: null,
        status: "ENROLLED",
        source: "SCHOOL_ADMINISTRATION",
        applicationReference: null,
        requestedAt: "2025-06-01",
        enrolledAt: "2025-06-12",
        validatedAt: "2025-06-10",
        endedAt: null,
        previousSchoolName: null,
        notes: null,
        schoolName: "École",
        createdAt: "2025-06-01",
        updatedAt: "2025-06-12",
      },
    ],
    referenceDate,
  });

  assert(
    record.events.some((event) => event.type === "CLASS_ASSIGNED"),
    "CLASS_ASSIGNED pour première affectation",
  );
  assert(
    !record.events.some((event) => event.type === "CLASS_CHANGED"),
    "Pas de faux CLASS_CHANGED",
  );

  const changed = createClassChangedEvent({
    enrollmentId: "ENR-1",
    previousClassId: "C1",
    previousClassName: "6ème A",
    newClassId: "C2",
    newClassName: "6ème B",
    changedAt: "2026-01-15",
  });
  assertEqual(changed.type, "CLASS_CHANGED", "Transition réelle → CLASS_CHANGED");
  assert(
    changed.description?.includes("6ème A") === true &&
      changed.description?.includes("6ème B") === true,
    "Description ancienne → nouvelle classe",
  );
}

function testOverviewAlertsAndWorkspace() {
  assert(
    isStudentWorkspaceModuleImplemented("history"),
    "Module history implémenté",
  );

  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
    createdAt: "2026-07-01",
  };

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    referenceDate: new Date(2026, 6, 21),
    data: {
      students: [student],
      medicalProfiles: [
        {
          id: "MED-1",
          studentId: "STU-1",
          bloodType: "A+",
          doctorName: "Dr Test",
          updatedAt: "2026-07-20",
        },
      ],
      documents: [
        {
          id: "D1",
          studentId: "STU-1",
          documentType: "Acte de naissance",
          fileUrl: "/f.pdf",
          status: "Vérifié",
          verifiedAt: "2026-07-21",
        },
      ],
    },
  });

  assert(workspace !== null, "Workspace");
  assert(workspace!.history.events.length > 0, "History projeté");
  const vm = buildStudentWorkspaceViewModel(workspace!, {
    referenceDate: new Date(2026, 6, 21),
  });
  assert(vm.historyModule.timeline.length > 0, "VM history");
  assert(
    vm.alerts.some((alert) => alert.id === "important-history-event"),
    "Alerte historique",
  );

  const healthy = buildStudentWorkspaceAlerts({
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
    hasCriticalAllergy: false,
    hasCriticalCondition: false,
    hasPhysician: true,
    hasBloodType: true,
    hasMedicalUpdate: true,
    hasMissingRequiredDocument: false,
    hasExpiredRequiredDocument: false,
    hasRejectedDocument: false,
    hasLowDocumentCompliance: false,
    hasImportantHistoryEvent: false,
    latestImportantHistoryEventTitle: null,
  });
  assertEqual(healthy.length, 0, "Healthy sans alerte historique");

  assert(
    typeof (workspace as { appendHistory?: unknown }).appendHistory ===
      "undefined",
    "Pas de mutation",
  );

  const modules = filterAccessibleStudentWorkspaceModules(
    getStudentWorkspaceNavigationModules(),
    createPermissionCtx(["Élèves:READ", "student.history.read"]),
  );
  assert(
    modules.some((module) => module.id === "history"),
    "Module visible",
  );
}

function main() {
  const tests = [
    ["tri chronologique", testChronologicalSort],
    ["ordre sévérité", testSeverityTieBreak],
    ["regroupement temporel", testTemporalGrouping],
    ["tri non datés après datés", testUndatedEventsSortAfterDated],
    ["événements legacy", testLegacyProjection],
    ["diagnostics et ViewModel", testDiagnosticsAndViewModel],
    ["permissions et visibilité", testPermissionsAndVisibility],
    ["CTO responsable sans date", testCtoNoFakeGuardianDate],
    ["CTO dates documentaires", testCtoDocumentDatesNotInvented],
    ["CTO affectation vs changement classe", testCtoClassAssignedNotChanged],
    ["alertes overview et workspace", testOverviewAlertsAndWorkspace],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student history C1.6`);
}

main();
