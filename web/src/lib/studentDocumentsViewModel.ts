import {
  diagnoseStudentDocuments,
  filterStudentDocumentRecordByVisibility,
  getStudentDocumentTypeLabel,
  sortStudentDocuments,
  type DocumentVisibility,
  type StudentDocumentDiagnostics,
  type StudentDocumentItem,
  type StudentDocumentRecord,
  type StudentDocumentStatus,
  type StudentDocumentSummary,
  type StudentDocumentType,
} from "./studentDocuments";
import { formatCivilDateLabel } from "./studentWorkspaceDates";

export type DocumentBadgeKind =
  | "verified"
  | "pending"
  | "expired"
  | "missing"
  | "rejected"
  | "required";

export interface DocumentBadge {
  kind: DocumentBadgeKind;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface StudentDocumentItemViewModel {
  id: string;
  type: StudentDocumentType;
  label: string;
  status: StudentDocumentStatus;
  statusLabel: string;
  required: boolean;
  critical: boolean;
  issuedAtLabel: string;
  expiresAtLabel: string;
  verifiedAtLabel: string;
  verifiedByLabel: string;
  fileNameLabel: string;
  badges: DocumentBadge[];
  visibility: DocumentVisibility;
}

export interface StudentDocumentViewModel {
  studentId: string;
  summary: StudentDocumentSummary;
  documents: StudentDocumentItemViewModel[];
  badges: DocumentBadge[];
  diagnostics: StudentDocumentDiagnostics;
  complianceLabel: string;
  criticalAlerts: string[];
  hasDocuments: boolean;
}

export interface BuildStudentDocumentViewModelOptions {
  missingValueLabel?: string;
  allowedVisibility?: readonly DocumentVisibility[];
}

const MISSING = "Non renseigné";
/** Bridge Élèves:READ : le personnel voit STAFF ; ADMIN reste cloisonné. */
const DEFAULT_ALLOWED_VISIBILITY: readonly DocumentVisibility[] = ["STAFF"];

const STATUS_LABELS: Record<StudentDocumentStatus, string> = {
  MISSING: "Manquant",
  SUBMITTED: "En attente",
  VERIFIED: "Vérifié",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
};

const STATUS_BADGE: Record<
  StudentDocumentStatus,
  { kind: DocumentBadgeKind; label: string; tone: DocumentBadge["tone"] }
> = {
  VERIFIED: { kind: "verified", label: "VÉRIFIÉ", tone: "success" },
  SUBMITTED: { kind: "pending", label: "EN ATTENTE", tone: "warning" },
  EXPIRED: { kind: "expired", label: "EXPIRÉ", tone: "danger" },
  MISSING: { kind: "missing", label: "MANQUANT", tone: "danger" },
  REJECTED: { kind: "rejected", label: "REFUSÉ", tone: "danger" },
};

export function getStudentDocumentStatusLabel(
  status: StudentDocumentStatus,
): string {
  return STATUS_LABELS[status];
}

function buildItemBadges(item: StudentDocumentItem): DocumentBadge[] {
  const badges: DocumentBadge[] = [STATUS_BADGE[item.status]];
  if (item.required) {
    badges.push({
      kind: "required",
      label: "OBLIGATOIRE",
      tone: "info",
    });
  }
  return badges;
}

function buildSummaryBadges(summary: StudentDocumentSummary): DocumentBadge[] {
  const badges: DocumentBadge[] = [];
  if (summary.verified > 0) {
    badges.push({ kind: "verified", label: "VÉRIFIÉ", tone: "success" });
  }
  if (summary.pending > 0) {
    badges.push({ kind: "pending", label: "EN ATTENTE", tone: "warning" });
  }
  if (summary.expired > 0) {
    badges.push({ kind: "expired", label: "EXPIRÉ", tone: "danger" });
  }
  if (summary.missing > 0) {
    badges.push({ kind: "missing", label: "MANQUANT", tone: "danger" });
  }
  if (summary.rejected > 0) {
    badges.push({ kind: "rejected", label: "REFUSÉ", tone: "danger" });
  }
  return badges;
}

function buildCriticalAlerts(
  diagnostics: StudentDocumentDiagnostics,
): string[] {
  const alerts: string[] = [];
  if (diagnostics.hasMissingRequiredDocument) {
    alerts.push("Document obligatoire manquant");
  }
  if (diagnostics.hasExpiredRequiredDocument) {
    alerts.push("Document obligatoire expiré");
  }
  if (diagnostics.hasRejectedDocument) {
    alerts.push("Document refusé");
  }
  if (diagnostics.hasLowCompliance) {
    alerts.push("Conformité documentaire insuffisante");
  }
  return alerts;
}

function toItemViewModel(
  item: StudentDocumentItem,
  missingValueLabel: string,
): StudentDocumentItemViewModel {
  return {
    id: item.id,
    type: item.type,
    label: item.label || getStudentDocumentTypeLabel(item.type),
    status: item.status,
    statusLabel: getStudentDocumentStatusLabel(item.status),
    required: item.required,
    critical: item.critical,
    issuedAtLabel: formatCivilDateLabel(item.issuedAt, missingValueLabel),
    expiresAtLabel: formatCivilDateLabel(item.expiresAt, missingValueLabel),
    verifiedAtLabel: formatCivilDateLabel(item.verifiedAt, missingValueLabel),
    verifiedByLabel: item.verifiedBy?.trim() || missingValueLabel,
    fileNameLabel: item.fileName?.trim() || missingValueLabel,
    badges: buildItemBadges(item),
    visibility: item.visibility,
  };
}

export function buildStudentDocumentViewModel(
  record: StudentDocumentRecord,
  options: BuildStudentDocumentViewModelOptions = {},
): StudentDocumentViewModel {
  const missingValueLabel = options.missingValueLabel?.trim() || MISSING;
  const allowedVisibility =
    options.allowedVisibility ?? DEFAULT_ALLOWED_VISIBILITY;

  const visibleRecord = filterStudentDocumentRecordByVisibility(
    record,
    allowedVisibility,
  );
  const documents = sortStudentDocuments(visibleRecord.documents).map((item) =>
    toItemViewModel(item, missingValueLabel),
  );
  const diagnostics = diagnoseStudentDocuments(visibleRecord);

  return {
    studentId: visibleRecord.studentId,
    summary: visibleRecord.summary,
    documents,
    badges: buildSummaryBadges(visibleRecord.summary),
    diagnostics,
    complianceLabel: `${visibleRecord.summary.complianceRate} %`,
    criticalAlerts: buildCriticalAlerts(diagnostics),
    hasDocuments: visibleRecord.documents.some(
      (item) => item.status !== "MISSING",
    ),
  };
}
