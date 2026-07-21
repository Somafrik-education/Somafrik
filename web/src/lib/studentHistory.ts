import type { Student } from "./studentDomain";
import type { StudentDocumentItem, StudentDocumentRecord } from "./studentDocuments";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import { getEnrollmentStatusPresentation } from "./studentEnrollmentStatus";
import type { StudentGuardianRelationRecord } from "./studentGuardian";
import type { StudentMedicalRecord } from "./studentMedical";
import { parseCivilDate } from "./studentWorkspaceDates";

/**
 * Historique élève (C1.6) — projection reconstruite depuis les agrégats métier.
 * Ce n'est PAS un stockage autonome : aucune persistance d'événements ici.
 */

export type HistoryVisibility = "STAFF" | "ADMIN";

export type StudentHistoryEventType =
  | "STUDENT_CREATED"
  | "ENROLLMENT_CREATED"
  | "ENROLLMENT_UPDATED"
  | "CLASS_CHANGED"
  | "STATUS_CHANGED"
  | "GUARDIAN_ADDED"
  | "GUARDIAN_UPDATED"
  | "MEDICAL_UPDATED"
  | "DOCUMENT_SUBMITTED"
  | "DOCUMENT_VERIFIED"
  | "DOCUMENT_REJECTED"
  | "DOCUMENT_EXPIRED"
  | "NOTE_ADDED"
  | "ARCHIVED"
  | "OTHER";

export type HistorySeverity = "INFO" | "WARNING" | "IMPORTANT";

export type HistorySourceModule =
  | "IDENTITY"
  | "ENROLLMENT"
  | "GUARDIANS"
  | "MEDICAL"
  | "DOCUMENTS"
  | "SYSTEM";

export type HistoryIconKey =
  | "enrollment"
  | "documents"
  | "medical"
  | "guardian"
  | "identity"
  | "archive"
  | "system";

export type HistoryDataSource = "STRUCTURED" | "LEGACY" | "EMPTY";

export type FutureStudentHistoryPermission =
  | "student.history.read"
  | "student.history.export"
  | "student.history.audit";

export const FUTURE_STUDENT_HISTORY_PERMISSIONS: readonly FutureStudentHistoryPermission[] =
  [
    "student.history.read",
    "student.history.export",
    "student.history.audit",
  ];

/** Fenêtre d'activité récente (jours civils). */
export const HISTORY_RECENT_ACTIVITY_DAYS = 30;

export interface StudentHistoryEvent {
  id: string;
  type: StudentHistoryEventType;
  occurredAt: string;
  title: string;
  description: string | null;
  severity: HistorySeverity;
  sourceModule: HistorySourceModule;
  actor: string | null;
  visibility: HistoryVisibility;
  metadata: Record<string, string>;
  iconKey: HistoryIconKey;
}

export interface StudentHistorySummary {
  totalEvents: number;
  latestEventDate: string | null;
  hasImportantEvent: boolean;
  hasRecentActivity: boolean;
}

export interface StudentHistoryDiagnostics {
  hasImportantEvent: boolean;
  hasRecentActivity: boolean;
  latestEvent: StudentHistoryEvent | null;
  latestImportantEvent: StudentHistoryEvent | null;
}

export interface StudentHistoryRecord {
  studentId: string;
  events: StudentHistoryEvent[];
  summary: StudentHistorySummary;
  source: HistoryDataSource;
}

const SEVERITY_RANK: Record<HistorySeverity, number> = {
  IMPORTANT: 0,
  WARNING: 1,
  INFO: 2,
};

const EVENT_ICON: Record<StudentHistoryEventType, HistoryIconKey> = {
  STUDENT_CREATED: "identity",
  ENROLLMENT_CREATED: "enrollment",
  ENROLLMENT_UPDATED: "enrollment",
  CLASS_CHANGED: "enrollment",
  STATUS_CHANGED: "enrollment",
  GUARDIAN_ADDED: "guardian",
  GUARDIAN_UPDATED: "guardian",
  MEDICAL_UPDATED: "medical",
  DOCUMENT_SUBMITTED: "documents",
  DOCUMENT_VERIFIED: "documents",
  DOCUMENT_REJECTED: "documents",
  DOCUMENT_EXPIRED: "documents",
  NOTE_ADDED: "system",
  ARCHIVED: "archive",
  OTHER: "system",
};

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function getHistoryEventIconKey(
  type: StudentHistoryEventType,
): HistoryIconKey {
  return EVENT_ICON[type];
}

export function compareHistorySeverity(
  left: HistorySeverity,
  right: HistorySeverity,
): number {
  return SEVERITY_RANK[left] - SEVERITY_RANK[right];
}

/** Parse une date d'événement (ISO ou civile) en timestamp pour le tri. */
export function historyEventTimestamp(occurredAt: string): number {
  const raw = occurredAt.trim();
  if (!raw) return 0;
  const civil = parseCivilDate(raw.slice(0, 10));
  if (civil && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    // Pour les dates civiles pures, minuit local ; pour ISO complet, Date native.
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return civil.getTime();
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  if (civil) return civil.getTime();
  return 0;
}

/**
 * Tri : plus récent → plus ancien ; puis IMPORTANT → WARNING → INFO ; puis id.
 */
export function sortStudentHistoryEvents(
  events: readonly StudentHistoryEvent[],
): StudentHistoryEvent[] {
  return [...events].sort((left, right) => {
    const timeDelta =
      historyEventTimestamp(right.occurredAt) -
      historyEventTimestamp(left.occurredAt);
    if (timeDelta !== 0) return timeDelta;
    const severityDelta = compareHistorySeverity(left.severity, right.severity);
    if (severityDelta !== 0) return severityDelta;
    return left.id.localeCompare(right.id);
  });
}

export function isRecentHistoryEvent(
  occurredAt: string,
  referenceDate: Date = new Date(),
  windowDays = HISTORY_RECENT_ACTIVITY_DAYS,
): boolean {
  const ts = historyEventTimestamp(occurredAt);
  if (!ts) return false;
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const eventDay = new Date(ts);
  const eventCivil = new Date(
    eventDay.getFullYear(),
    eventDay.getMonth(),
    eventDay.getDate(),
  );
  const diffMs = ref.getTime() - eventCivil.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= windowDays;
}

function createEvent(
  partial: Omit<StudentHistoryEvent, "iconKey" | "metadata"> & {
    metadata?: Record<string, string>;
    iconKey?: HistoryIconKey;
  },
): StudentHistoryEvent {
  return {
    ...partial,
    description: partial.description ?? null,
    actor: partial.actor ?? null,
    metadata: partial.metadata ?? {},
    iconKey: partial.iconKey ?? getHistoryEventIconKey(partial.type),
  };
}

function projectStudentCreated(
  student: Student | null | undefined,
): StudentHistoryEvent[] {
  if (!student) return [];
  const occurredAt =
    normalizeOptionalText(student.createdAt) ??
    normalizeOptionalText(student.admissionDate) ??
    normalizeOptionalText(student.enrollmentDate);
  if (!occurredAt) return [];

  return [
    createEvent({
      id: `HIST-STUDENT-CREATED-${student.id}`,
      type: "STUDENT_CREATED",
      occurredAt,
      title: "Élève créé",
      description: student.matricule
        ? `Matricule ${student.matricule}`
        : "Création du dossier élève",
      severity: "IMPORTANT",
      sourceModule: "IDENTITY",
      actor: null,
      visibility: "STAFF",
      metadata: { studentId: student.id },
    }),
  ];
}

function projectStudentArchived(
  student: Student | null | undefined,
): StudentHistoryEvent[] {
  if (!student?.archived && !student?.archivedAt) return [];
  const occurredAt =
    normalizeOptionalText(student.archivedAt) ??
    normalizeOptionalText(student.exitDate) ??
    normalizeOptionalText(student.updatedAt);
  if (!occurredAt) return [];

  return [
    createEvent({
      id: `HIST-ARCHIVED-${student.id}`,
      type: "ARCHIVED",
      occurredAt,
      title: "Élève archivé",
      description: "Le dossier a été archivé",
      severity: "WARNING",
      sourceModule: "SYSTEM",
      actor: null,
      visibility: "ADMIN",
      metadata: { studentId: student.id },
    }),
  ];
}

function projectEnrollmentEvents(
  enrollments: readonly StudentEnrollmentRecord[],
): StudentHistoryEvent[] {
  const events: StudentHistoryEvent[] = [];

  for (const enrollment of enrollments) {
    const createdAt = enrollment.createdAt || enrollment.requestedAt;
    if (createdAt) {
      events.push(
        createEvent({
          id: `HIST-ENR-CREATED-${enrollment.id}`,
          type: "ENROLLMENT_CREATED",
          occurredAt: createdAt,
          title: "Inscription créée",
          description: `Année ${enrollment.academicYear}`,
          severity: "INFO",
          sourceModule: "ENROLLMENT",
          actor: null,
          visibility: "STAFF",
          metadata: {
            enrollmentId: enrollment.id,
            academicYear: enrollment.academicYear,
            status: enrollment.status,
          },
        }),
      );
    }

    if (enrollment.validatedAt) {
      events.push(
        createEvent({
          id: `HIST-ENR-VALIDATED-${enrollment.id}`,
          type: "STATUS_CHANGED",
          occurredAt: enrollment.validatedAt,
          title: "Inscription validée",
          description: getEnrollmentStatusPresentation(enrollment.status).label,
          severity: "IMPORTANT",
          sourceModule: "ENROLLMENT",
          actor: null,
          visibility: "STAFF",
          metadata: {
            enrollmentId: enrollment.id,
            status: enrollment.status,
          },
        }),
      );
    }

    if (
      enrollment.enrolledAt &&
      enrollment.enrolledAt !== enrollment.validatedAt
    ) {
      events.push(
        createEvent({
          id: `HIST-ENR-ENROLLED-${enrollment.id}`,
          type: "STATUS_CHANGED",
          occurredAt: enrollment.enrolledAt,
          title: "Élève inscrit",
          description: enrollment.className
            ? `Classe ${enrollment.className}`
            : getEnrollmentStatusPresentation(enrollment.status).label,
          severity: "IMPORTANT",
          sourceModule: "ENROLLMENT",
          actor: null,
          visibility: "STAFF",
          metadata: {
            enrollmentId: enrollment.id,
            status: enrollment.status,
          },
        }),
      );
    }

    if (enrollment.classId || enrollment.className) {
      const classAt =
        enrollment.enrolledAt ??
        enrollment.validatedAt ??
        enrollment.updatedAt ??
        enrollment.createdAt;
      if (classAt) {
        events.push(
          createEvent({
            id: `HIST-ENR-CLASS-${enrollment.id}`,
            type: "CLASS_CHANGED",
            occurredAt: classAt,
            title: "Affectation de classe",
            description: enrollment.className ?? enrollment.classId,
            severity: "INFO",
            sourceModule: "ENROLLMENT",
            actor: null,
            visibility: "STAFF",
            metadata: {
              enrollmentId: enrollment.id,
              classId: enrollment.classId ?? "",
              className: enrollment.className ?? "",
            },
          }),
        );
      }
    }

    if (
      enrollment.updatedAt &&
      enrollment.updatedAt !== enrollment.createdAt &&
      enrollment.updatedAt !== enrollment.validatedAt &&
      enrollment.updatedAt !== enrollment.enrolledAt
    ) {
      events.push(
        createEvent({
          id: `HIST-ENR-UPDATED-${enrollment.id}`,
          type: "ENROLLMENT_UPDATED",
          occurredAt: enrollment.updatedAt,
          title: "Inscription mise à jour",
          description: getEnrollmentStatusPresentation(enrollment.status).label,
          severity: "INFO",
          sourceModule: "ENROLLMENT",
          actor: null,
          visibility: "STAFF",
          metadata: { enrollmentId: enrollment.id },
        }),
      );
    }
  }

  return events;
}

function projectGuardianEvents(
  guardians: readonly StudentGuardianRelationRecord[],
): StudentHistoryEvent[] {
  return guardians.map((guardian) =>
    createEvent({
      id: `HIST-GUARDIAN-${guardian.id}`,
      type: "GUARDIAN_ADDED",
      occurredAt:
        guardian.startDate ??
        // Repli déterministe pour relations sans date (legacy).
        `1970-01-01T00:00:00.000Z`,
      title:
        guardian.source === "LEGACY"
          ? "Contact parent hérité"
          : "Nouveau responsable",
      description: guardian.displayName,
      severity: guardian.isLegalGuardian ? "IMPORTANT" : "INFO",
      sourceModule: "GUARDIANS",
      actor: null,
      visibility: "STAFF",
      metadata: {
        guardianId: guardian.guardianId,
        relationshipType: guardian.relationshipType,
        source: guardian.source,
      },
    }),
  );
}

function projectMedicalEvents(
  medical: StudentMedicalRecord | null | undefined,
): StudentHistoryEvent[] {
  if (!medical?.hasProfile || !medical.updatedAt) return [];
  return [
    createEvent({
      id: `HIST-MEDICAL-${medical.studentId}`,
      type: "MEDICAL_UPDATED",
      occurredAt: medical.updatedAt,
      title: "Profil médical mis à jour",
      description: "Informations médicales du dossier",
      severity: "WARNING",
      sourceModule: "MEDICAL",
      actor: null,
      visibility: "STAFF",
      metadata: { source: medical.source },
    }),
  ];
}

function documentEventOccurredAt(document: StudentDocumentItem): string | null {
  if (document.status === "VERIFIED") {
    return document.verifiedAt ?? document.issuedAt ?? document.expiresAt;
  }
  if (document.status === "EXPIRED") {
    return document.expiresAt ?? document.verifiedAt ?? document.issuedAt;
  }
  if (document.status === "REJECTED") {
    return document.verifiedAt ?? document.issuedAt ?? document.expiresAt;
  }
  if (document.status === "SUBMITTED") {
    return document.issuedAt ?? document.verifiedAt;
  }
  return null;
}

function projectDocumentEvents(
  documents: StudentDocumentRecord | null | undefined,
): StudentHistoryEvent[] {
  if (!documents) return [];
  const events: StudentHistoryEvent[] = [];

  for (const document of documents.documents) {
    if (document.id.startsWith("MISSING-") || document.status === "MISSING") {
      continue;
    }

    const occurredAt = documentEventOccurredAt(document);
    if (!occurredAt) continue;

    if (document.status === "VERIFIED") {
      events.push(
        createEvent({
          id: `HIST-DOC-VERIFIED-${document.id}`,
          type: "DOCUMENT_VERIFIED",
          occurredAt,
          title: "Document vérifié",
          description: document.label,
          severity: "IMPORTANT",
          sourceModule: "DOCUMENTS",
          actor: document.verifiedBy,
          visibility: document.visibility,
          metadata: { documentId: document.id, type: document.type },
        }),
      );
      continue;
    }

    if (document.status === "REJECTED") {
      events.push(
        createEvent({
          id: `HIST-DOC-REJECTED-${document.id}`,
          type: "DOCUMENT_REJECTED",
          occurredAt,
          title: "Document refusé",
          description: document.label,
          severity: "WARNING",
          sourceModule: "DOCUMENTS",
          actor: document.verifiedBy,
          visibility: document.visibility,
          metadata: { documentId: document.id, type: document.type },
        }),
      );
      continue;
    }

    if (document.status === "EXPIRED") {
      events.push(
        createEvent({
          id: `HIST-DOC-EXPIRED-${document.id}`,
          type: "DOCUMENT_EXPIRED",
          occurredAt,
          title: "Document expiré",
          description: document.label,
          severity: "WARNING",
          sourceModule: "DOCUMENTS",
          actor: null,
          visibility: document.visibility,
          metadata: { documentId: document.id, type: document.type },
        }),
      );
      continue;
    }

    if (document.status === "SUBMITTED") {
      events.push(
        createEvent({
          id: `HIST-DOC-SUBMITTED-${document.id}`,
          type: "DOCUMENT_SUBMITTED",
          occurredAt,
          title: "Document déposé",
          description: document.label,
          severity: "INFO",
          sourceModule: "DOCUMENTS",
          actor: null,
          visibility: document.visibility,
          metadata: { documentId: document.id, type: document.type },
        }),
      );
    }
  }

  return events;
}

export function buildStudentHistorySummary(
  events: readonly StudentHistoryEvent[],
  referenceDate: Date = new Date(),
): StudentHistorySummary {
  const sorted = sortStudentHistoryEvents(events);
  return {
    totalEvents: sorted.length,
    latestEventDate: sorted[0]?.occurredAt ?? null,
    hasImportantEvent: sorted.some((event) => event.severity === "IMPORTANT"),
    hasRecentActivity: sorted.some((event) =>
      isRecentHistoryEvent(event.occurredAt, referenceDate),
    ),
  };
}

export function diagnoseStudentHistory(
  record: StudentHistoryRecord,
  referenceDate: Date = new Date(),
): StudentHistoryDiagnostics {
  const sorted = sortStudentHistoryEvents(record.events);
  const latestImportantEvent =
    sorted.find((event) => event.severity === "IMPORTANT") ?? null;
  const hasRecentActivity = sorted.some((event) =>
    isRecentHistoryEvent(event.occurredAt, referenceDate),
  );

  return {
    hasImportantEvent: sorted.some((event) => event.severity === "IMPORTANT"),
    hasRecentActivity,
    latestEvent: sorted[0] ?? null,
    latestImportantEvent,
  };
}

export function isHistoryVisibilityAllowed(
  visibility: HistoryVisibility,
  allowedVisibility: readonly HistoryVisibility[],
): boolean {
  return allowedVisibility.includes(visibility);
}

export function filterStudentHistoryRecordByVisibility(
  record: StudentHistoryRecord,
  allowedVisibility: readonly HistoryVisibility[],
  referenceDate: Date = new Date(),
): StudentHistoryRecord {
  const events = sortStudentHistoryEvents(
    record.events.filter((event) =>
      isHistoryVisibilityAllowed(event.visibility, allowedVisibility),
    ),
  );
  return {
    ...record,
    events,
    summary: buildStudentHistorySummary(events, referenceDate),
  };
}

export function createEmptyStudentHistoryRecord(
  studentId: string,
): StudentHistoryRecord {
  return {
    studentId,
    events: [],
    summary: {
      totalEvents: 0,
      latestEventDate: null,
      hasImportantEvent: false,
      hasRecentActivity: false,
    },
    source: "EMPTY",
  };
}

/**
 * Reconstruit la chronologie à partir des agrégats existants (projection pure).
 */
export function collectStudentHistoryRecord(input: {
  studentId: string;
  student?: Student | null;
  enrollments?: readonly StudentEnrollmentRecord[] | null;
  guardians?: readonly StudentGuardianRelationRecord[] | null;
  medical?: StudentMedicalRecord | null;
  documents?: StudentDocumentRecord | null;
  referenceDate?: Date;
}): StudentHistoryRecord {
  const studentId = input.studentId.trim();
  const referenceDate = input.referenceDate ?? new Date();

  const events = sortStudentHistoryEvents([
    ...projectStudentCreated(input.student),
    ...projectStudentArchived(input.student),
    ...projectEnrollmentEvents(input.enrollments ?? []),
    ...projectGuardianEvents(input.guardians ?? []),
    ...projectMedicalEvents(input.medical),
    ...projectDocumentEvents(input.documents),
  ]);

  const hasLegacy =
    (input.guardians ?? []).some((item) => item.source === "LEGACY") ||
    input.medical?.source === "LEGACY" ||
    input.documents?.source === "LEGACY" ||
    (input.enrollments ?? []).some((item) => item.source === "MIGRATION");

  let source: HistoryDataSource = "EMPTY";
  if (events.length > 0) {
    source = hasLegacy ? "LEGACY" : "STRUCTURED";
  }

  return {
    studentId,
    events,
    summary: buildStudentHistorySummary(events, referenceDate),
    source,
  };
}
