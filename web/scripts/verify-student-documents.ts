/**
 * Vérifications C1.5 — documents administratifs élève.
 * Exécution : npm run verify:student-documents
 */
import {
  DOCUMENT_COMPLIANCE_ALERT_THRESHOLD,
  FUTURE_STUDENT_DOCUMENT_PERMISSIONS,
  buildStudentDocumentSummary,
  collectStudentDocumentRecord,
  compareDocumentStatus,
  diagnoseStudentDocuments,
  evaluateDocumentRequirement,
  filterStudentDocumentRecordByVisibility,
  getDocumentRequirements,
  isDocumentExpired,
  normalizeStudentDocumentStatus,
  normalizeStudentDocumentType,
  sortStudentDocuments,
  type StudentDocumentItem,
} from "../src/lib/studentDocuments";
import { buildStudentDocumentViewModel } from "../src/lib/studentDocumentsViewModel";
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
import type { Student, StudentDocument } from "../src/lib/studentDomain";

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

function createItem(
  partial: Partial<StudentDocumentItem> &
    Pick<StudentDocumentItem, "id" | "type" | "status">,
): StudentDocumentItem {
  return {
    label: partial.label ?? partial.type,
    required: false,
    issuedAt: null,
    expiresAt: null,
    verifiedAt: null,
    verifiedBy: null,
    fileName: null,
    visibility: "STAFF",
    notes: null,
    critical: false,
    ...partial,
  };
}

function testTypeNormalization() {
  assertEqual(
    normalizeStudentDocumentType("Acte naissance"),
    "BIRTH_CERTIFICATE",
    "Acte naissance",
  );
  assertEqual(
    normalizeStudentDocumentType("Acte de naissance"),
    "BIRTH_CERTIFICATE",
    "Acte de naissance",
  );
  assertEqual(
    normalizeStudentDocumentType("Carte identité"),
    "IDENTITY_CARD",
    "Carte identité",
  );
  assertEqual(
    normalizeStudentDocumentType("Carnet vaccination"),
    "VACCINATION_RECORD",
    "Carnet vaccination",
  );
  assertEqual(
    normalizeStudentDocumentType("Certificat médical"),
    "MEDICAL_CERTIFICATE",
    "Certificat médical",
  );
  assertEqual(normalizeStudentDocumentType("inconnu"), "OTHER", "Autre");
}

function testStatusNormalization() {
  assertEqual(normalizeStudentDocumentStatus("Validé"), "VERIFIED", "Validé");
  assertEqual(normalizeStudentDocumentStatus("Vérifié"), "VERIFIED", "Vérifié");
  assertEqual(normalizeStudentDocumentStatus("Déposé"), "SUBMITTED", "Déposé");
  assertEqual(
    normalizeStudentDocumentStatus("En attente"),
    "SUBMITTED",
    "En attente",
  );
  assertEqual(normalizeStudentDocumentStatus("Refusé"), "REJECTED", "Refusé");
  assertEqual(normalizeStudentDocumentStatus("Expiré"), "EXPIRED", "Expiré");
  assertEqual(normalizeStudentDocumentStatus(""), null, "Vide");
}

function testDocumentSorting() {
  const sorted = sortStudentDocuments([
    createItem({ id: "1", type: "PHOTO", status: "VERIFIED" }),
    createItem({ id: "2", type: "BIRTH_CERTIFICATE", status: "REJECTED" }),
    createItem({ id: "3", type: "IDENTITY_CARD", status: "EXPIRED" }),
    createItem({ id: "4", type: "MEDICAL_CERTIFICATE", status: "MISSING" }),
    createItem({ id: "5", type: "REPORT_CARD", status: "SUBMITTED" }),
  ]);

  assertEqual(
    sorted.map((item) => item.status).join(","),
    "REJECTED,EXPIRED,MISSING,SUBMITTED,VERIFIED",
    "Ordre de tri",
  );
  assert(compareDocumentStatus("REJECTED", "EXPIRED") < 0, "REJECTED < EXPIRED");
}

function testComplianceAndCritical() {
  const referenceDate = new Date(2026, 6, 21);
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    referenceDate,
    documents: [
      {
        id: "D1",
        studentId: "STU-1",
        documentType: "Acte de naissance",
        fileUrl: "/files/acte.pdf",
        status: "Vérifié",
      },
      {
        id: "D2",
        studentId: "STU-1",
        documentType: "Photo",
        fileUrl: "/files/photo.jpg",
        status: "En attente",
      },
      {
        id: "D3",
        studentId: "STU-1",
        documentType: "Carte identité",
        fileUrl: "/files/cni.pdf",
        status: "Vérifié",
      },
    ],
  });

  assert(record.summary.verified >= 2, "Au moins 2 vérifiés");
  assert(record.summary.pending >= 1, "Au moins 1 en attente");
  assert(
    record.documents.some((item) => item.type === "MEDICAL_CERTIFICATE"),
    "Placeholder certificat médical",
  );
  assert(record.summary.hasCriticalMissingDocument, "Critique manquant médical");
  assert(record.summary.complianceRate < 100, "Conformité partielle");

  const diagnostics = diagnoseStudentDocuments(record);
  assert(diagnostics.hasMissingRequiredDocument, "Diagnostic missing");
  assert(diagnostics.hasLowCompliance, "Diagnostic low compliance");
}

function testExpiredDocument() {
  const referenceDate = new Date(2026, 6, 21);
  assert(
    isDocumentExpired("2026-01-01", referenceDate),
    "Date passée = expiré",
  );
  assert(
    !isDocumentExpired("2026-12-31", referenceDate),
    "Date future = non expiré",
  );

  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    referenceDate,
    documents: [
      {
        id: "D1",
        studentId: "STU-1",
        documentType: "Certificat médical",
        fileUrl: "/files/med.pdf",
        status: "Vérifié",
        expiresAt: "2025-12-01",
      },
    ],
  });

  const medical = record.documents.find(
    (item) => item.type === "MEDICAL_CERTIFICATE",
  );
  assertEqual(medical?.status, "EXPIRED", "Statut forcé EXPIRED");
  assert(
    diagnoseStudentDocuments(record).hasExpiredRequiredDocument,
    "Diagnostic expiré requis",
  );
}

function testViewModel() {
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      {
        id: "D1",
        studentId: "STU-1",
        documentType: "Acte de naissance",
        fileUrl: "/files/acte.pdf",
        status: "Validé",
      },
    ],
  });

  const vm = buildStudentDocumentViewModel(record, {
    allowedVisibility: ["STAFF", "ADMIN"],
  });

  assert(vm.complianceLabel.includes("%"), "Label conformité");
  assert(vm.documents.length > 0, "Liste documents");
  assert(
    vm.badges.some((badge) => badge.label === "VÉRIFIÉ"),
    "Badge vérifié",
  );
  assert(
    vm.badges.some((badge) => badge.label === "MANQUANT"),
    "Badge manquant",
  );
  assert(vm.diagnostics.hasMissingRequiredDocument, "Diagnostics exposés");
  assert(vm.criticalAlerts.length > 0, "Alertes critiques VM");
}

function testPermissionsAndVisibility() {
  assert(
    FUTURE_STUDENT_DOCUMENT_PERMISSIONS.includes("student.documents.read"),
    "read",
  );
  assert(
    FUTURE_STUDENT_DOCUMENT_PERMISSIONS.includes("student.documents.upload"),
    "upload",
  );
  assert(
    FUTURE_STUDENT_DOCUMENT_PERMISSIONS.includes("student.documents.verify"),
    "verify",
  );
  assert(
    FUTURE_STUDENT_DOCUMENT_PERMISSIONS.includes("student.documents.delete"),
    "delete",
  );

  assertEqual(
    getStudentWorkspaceModule("documents")?.requiredPermission,
    "student.documents.read",
    "Permission module",
  );

  const bridge = createPermissionCtx(["Élèves:READ"]);
  assert(
    canReadStudentWorkspaceModule(bridge, "student.documents.read"),
    "Bridge",
  );

  const granular = createPermissionCtx([
    "Élèves:READ",
    "student.documents.read",
  ]);
  const modules = filterAccessibleStudentWorkspaceModules(
    getStudentWorkspaceNavigationModules(),
    granular,
  );
  assert(
    modules.some((module) => module.id === "documents"),
    "Module visible",
  );

  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      {
        id: "D1",
        studentId: "STU-1",
        documentType: "Carte identité",
        fileUrl: "/files/cni.pdf",
        status: "Vérifié",
      },
      {
        id: "D2",
        studentId: "STU-1",
        documentType: "Photo",
        fileUrl: "/files/photo.jpg",
        status: "Vérifié",
      },
    ],
  });

  const identity = record.documents.find((item) => item.type === "IDENTITY_CARD");
  assertEqual(identity?.visibility, "ADMIN", "CNI = ADMIN");

  const staffOnly = filterStudentDocumentRecordByVisibility(record, ["STAFF"]);
  assert(
    !staffOnly.documents.some((item) => item.type === "IDENTITY_CARD"),
    "STAFF ne voit pas ADMIN",
  );
  assert(
    staffOnly.documents.some((item) => item.type === "PHOTO"),
    "STAFF voit STAFF",
  );

  const adminView = filterStudentDocumentRecordByVisibility(record, [
    "STAFF",
    "ADMIN",
  ]);
  assert(
    adminView.documents.some((item) => item.type === "IDENTITY_CARD"),
    "ADMIN voit STAFF+ADMIN",
  );

  const staffVm = buildStudentDocumentViewModel(record, {
    allowedVisibility: ["STAFF"],
  });
  assert(
    !staffVm.documents.some((item) => item.type === "IDENTITY_CARD"),
    "VM STAFF filtre CNI",
  );
}

function testOverviewAlerts() {
  const student: Student = {
    id: "STU-1",
    matricule: "M-1",
    schoolCode: "CD-2026-0001",
    status: "Actif",
  };

  const documents: StudentDocument[] = [
    {
      id: "D1",
      studentId: "STU-1",
      documentType: "Certificat médical",
      fileUrl: "/files/med.pdf",
      status: "Refusé",
    },
    {
      id: "D2",
      studentId: "STU-1",
      documentType: "Photo",
      fileUrl: "/files/photo.jpg",
      status: "Vérifié",
      expiresAt: "2025-01-01",
    },
  ];

  const workspace = buildStudentWorkspace({
    studentId: "STU-1",
    academicYear: "2026-2027",
    referenceDate: new Date(2026, 6, 21),
    data: { students: [student], documents },
  });

  assert(workspace !== null, "Workspace");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  const alertIds = vm.alerts.map((alert) => alert.id);

  assert(alertIds.includes("missing-required-document"), "Alerte missing");
  assert(alertIds.includes("expired-required-document"), "Alerte expired");
  assert(alertIds.includes("rejected-document"), "Alerte rejected");
  assert(alertIds.includes("low-document-compliance"), "Alerte compliance");

  const docAlertIndexes = [
    "missing-required-document",
    "expired-required-document",
    "rejected-document",
    "low-document-compliance",
  ].map((id) => alertIds.indexOf(id));
  assert(
    docAlertIndexes.every((index, i, arr) => i === 0 || index > arr[i - 1]!),
    "Ordre alertes documents",
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
  });
  assertEqual(healthy.length, 0, "Aucune alerte si dossier complet");
  assert(
    DOCUMENT_COMPLIANCE_ALERT_THRESHOLD === 80,
    "Seuil conformité documenté",
  );
}

function testWorkspaceBuild() {
  assert(
    isStudentWorkspaceModuleImplemented("documents"),
    "Module documents implémenté",
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
      documents: [
        {
          id: "D1",
          studentId: "STU-1",
          documentType: "Acte de naissance",
          fileUrl: "/files/acte.pdf",
          status: "Vérifié",
        },
      ],
    },
  });

  assert(workspace !== null, "Workspace");
  assertEqual(workspace!.documents.source, "LEGACY", "Source legacy");
  const vm = buildStudentWorkspaceViewModel(workspace!);
  assert(vm.documentsModule.documents.length > 0, "VM documents");
  assert(vm.hasDocuments, "hasDocuments");
  assert(
    typeof (workspace as { uploadDocument?: unknown }).uploadDocument ===
      "undefined",
    "Pas de mutation",
  );

  // Summary helper isolé
  const summary = buildStudentDocumentSummary(
    workspace!.documents.documents,
    workspace!.documents.requirements,
  );
  assertEqual(summary.total, workspace!.documents.summary.total, "Summary sync");
}

function verifiedDocsBase(): StudentDocument[] {
  return [
    {
      id: "D-BIRTH",
      studentId: "STU-1",
      documentType: "Acte de naissance",
      fileUrl: "/files/acte.pdf",
      status: "Vérifié",
    },
    {
      id: "D-PHOTO",
      studentId: "STU-1",
      documentType: "Photo",
      fileUrl: "/files/photo.jpg",
      status: "Vérifié",
    },
    {
      id: "D-MED",
      studentId: "STU-1",
      documentType: "Certificat médical",
      fileUrl: "/files/med.pdf",
      status: "Vérifié",
    },
  ];
}

function testIdentityPassportVerified() {
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      ...verifiedDocsBase(),
      {
        id: "D-PASS",
        studentId: "STU-1",
        documentType: "Passeport",
        fileUrl: "/files/pass.pdf",
        status: "Vérifié",
      },
    ],
  });

  const identity = evaluateDocumentRequirement(
    getDocumentRequirements().find((item) => item.id === "IDENTITY")!,
    record.documents,
  );
  assert(identity.satisfied, "Identité conforme via passeport VERIFIED");
  assertEqual(identity.status, "VERIFIED", "Statut exigence VERIFIED");
  assert(!record.summary.hasCriticalMissingDocument, "Pas de missing critique");
  assertEqual(record.summary.complianceRate, 100, "Conformité 100 %");
  assert(
    !record.documents.some(
      (item) => item.id.startsWith("MISSING-IDENTITY"),
    ),
    "Pas de placeholder CNI",
  );
  assert(
    record.documents.some((item) => item.type === "PASSPORT" && item.required),
    "Passeport compté comme pièce d'identité obligatoire",
  );
}

function testIdentityPassportSubmitted() {
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      ...verifiedDocsBase(),
      {
        id: "D-PASS",
        studentId: "STU-1",
        documentType: "Passeport",
        fileUrl: "/files/pass.pdf",
        status: "En attente",
      },
    ],
  });

  const identity = evaluateDocumentRequirement(
    getDocumentRequirements().find((item) => item.id === "IDENTITY")!,
    record.documents,
  );
  assert(!identity.satisfied, "Identité non vérifiée");
  assertEqual(identity.status, "SUBMITTED", "Exigence en attente");
  assert(record.summary.complianceRate < 100, "Conformité < 100 %");
  assertEqual(record.summary.complianceRate, 75, "3/4 exigences vérifiées");
  assert(!record.summary.hasCriticalMissingDocument, "Pas missing (candidat présent)");
}

function testIdentityPassportExpired() {
  const referenceDate = new Date(2026, 6, 21);
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    referenceDate,
    documents: [
      ...verifiedDocsBase(),
      {
        id: "D-PASS",
        studentId: "STU-1",
        documentType: "Passeport",
        fileUrl: "/files/pass.pdf",
        status: "Vérifié",
        expiresAt: "2025-01-01",
      },
    ],
  });

  const diagnostics = diagnoseStudentDocuments(record);
  assert(diagnostics.hasExpiredRequiredDocument, "Exigence identité expirée");
  const identity = evaluateDocumentRequirement(
    getDocumentRequirements().find((item) => item.id === "IDENTITY")!,
    record.documents,
  );
  assert(!identity.satisfied, "Identité non conforme");
  assertEqual(identity.status, "EXPIRED", "Statut EXPIRED");
}

function testIdentityPassportRejected() {
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      ...verifiedDocsBase(),
      {
        id: "D-PASS",
        studentId: "STU-1",
        documentType: "Passeport",
        fileUrl: "/files/pass.pdf",
        status: "Refusé",
      },
    ],
  });

  const diagnostics = diagnoseStudentDocuments(record);
  assert(diagnostics.hasRejectedDocument, "Rejet détecté");
  const identity = evaluateDocumentRequirement(
    getDocumentRequirements().find((item) => item.id === "IDENTITY")!,
    record.documents,
  );
  assert(!identity.satisfied, "Identité non conforme");
  assertEqual(identity.status, "REJECTED", "Statut REJECTED");
  assert(record.summary.complianceRate < 100, "Pas de faux 100 %");
}

function testIdentityCniRejectedPassportVerified() {
  const record = collectStudentDocumentRecord({
    studentId: "STU-1",
    documents: [
      ...verifiedDocsBase(),
      {
        id: "D-CNI",
        studentId: "STU-1",
        documentType: "Carte identité",
        fileUrl: "/files/cni.pdf",
        status: "Refusé",
      },
      {
        id: "D-PASS",
        studentId: "STU-1",
        documentType: "Passeport",
        fileUrl: "/files/pass.pdf",
        status: "Vérifié",
      },
    ],
  });

  const identity = evaluateDocumentRequirement(
    getDocumentRequirements().find((item) => item.id === "IDENTITY")!,
    record.documents,
  );
  assert(identity.satisfied, "Identité satisfaite par passeport");
  assertEqual(identity.status, "VERIFIED", "Exigence VERIFIED");
  assert(
    record.documents.some((item) => item.status === "REJECTED"),
    "Rejet CNI toujours visible",
  );
  assert(
    diagnoseStudentDocuments(record).hasRejectedDocument,
    "Rejet toujours diagnostiqué",
  );
  assertEqual(record.summary.complianceRate, 100, "Conformité 100 % via passeport");
}

function main() {
  const tests = [
    ["normalisation type", testTypeNormalization],
    ["normalisation statut", testStatusNormalization],
    ["tri documents", testDocumentSorting],
    ["conformité et document critique", testComplianceAndCritical],
    ["document expiré", testExpiredDocument],
    ["ViewModel", testViewModel],
    ["permissions et visibilité", testPermissionsAndVisibility],
    ["overview alerts", testOverviewAlerts],
    ["workspace build", testWorkspaceBuild],
    ["identité passeport vérifié", testIdentityPassportVerified],
    ["identité passeport soumis", testIdentityPassportSubmitted],
    ["identité passeport expiré", testIdentityPassportExpired],
    ["identité passeport refusé", testIdentityPassportRejected],
    ["identité CNI refusée + passeport vérifié", testIdentityCniRejectedPassportVerified],
  ] as const;

  for (const [name, run] of tests) {
    run();
    console.log(`OK — ${name}`);
  }

  console.log(`\n${tests.length} suites validées — student documents C1.5`);
}

main();
