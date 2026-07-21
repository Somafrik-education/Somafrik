import type { StudentDocument } from "./studentDomain";
import { parseCivilDate } from "./studentWorkspaceDates";

/**
 * Agrégat documents élève (C1.5) — source unique de l'état administratif.
 * Lecture seule ; cycle de vie Requis → Déposé → Vérifié → Expiré.
 */

export type DocumentVisibility = "STAFF" | "ADMIN";

export type StudentDocumentType =
  | "BIRTH_CERTIFICATE"
  | "PHOTO"
  | "IDENTITY_CARD"
  | "PASSPORT"
  | "VACCINATION_RECORD"
  | "MEDICAL_CERTIFICATE"
  | "REPORT_CARD"
  | "TRANSFER_CERTIFICATE"
  | "PROOF_OF_ADDRESS"
  | "OTHER";

export const STUDENT_DOCUMENT_TYPES = [
  "BIRTH_CERTIFICATE",
  "PHOTO",
  "IDENTITY_CARD",
  "PASSPORT",
  "VACCINATION_RECORD",
  "MEDICAL_CERTIFICATE",
  "REPORT_CARD",
  "TRANSFER_CERTIFICATE",
  "PROOF_OF_ADDRESS",
  "OTHER",
] as const satisfies readonly StudentDocumentType[];

export type StudentDocumentStatus =
  | "MISSING"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED";

export const STUDENT_DOCUMENT_STATUSES = [
  "REJECTED",
  "EXPIRED",
  "MISSING",
  "SUBMITTED",
  "VERIFIED",
] as const satisfies readonly StudentDocumentStatus[];

export type DocumentDataSource = "STRUCTURED" | "LEGACY" | "EMPTY";

export type FutureStudentDocumentPermission =
  | "student.documents.read"
  | "student.documents.upload"
  | "student.documents.verify"
  | "student.documents.delete";

export const FUTURE_STUDENT_DOCUMENT_PERMISSIONS: readonly FutureStudentDocumentPermission[] =
  [
    "student.documents.read",
    "student.documents.upload",
    "student.documents.verify",
    "student.documents.delete",
  ];

/** Seuil de conformité overview (pourcentage). */
export const DOCUMENT_COMPLIANCE_ALERT_THRESHOLD = 80;

export interface StudentDocumentItem {
  id: string;
  type: StudentDocumentType;
  label: string;
  status: StudentDocumentStatus;
  required: boolean;
  issuedAt: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  fileName: string | null;
  visibility: DocumentVisibility;
  notes: string | null;
  /** Document critique pour la conformité administrative. */
  critical: boolean;
}

export interface StudentDocumentSummary {
  total: number;
  verified: number;
  pending: number;
  missing: number;
  expired: number;
  rejected: number;
  /** Pourcentage 0–100 basé sur les documents requis. */
  complianceRate: number;
  hasCriticalMissingDocument: boolean;
}

export interface StudentDocumentDiagnostics {
  hasMissingRequiredDocument: boolean;
  hasExpiredRequiredDocument: boolean;
  hasRejectedDocument: boolean;
  complianceRate: number;
  hasCriticalMissingDocument: boolean;
  hasLowCompliance: boolean;
}

export interface StudentDocumentRecord {
  studentId: string;
  documents: StudentDocumentItem[];
  /** Exigences de conformité (distinctes des documents physiques). */
  requirements: RequiredDocumentRequirement[];
  summary: StudentDocumentSummary;
  source: DocumentDataSource;
}

/**
 * Exigence administrative pouvant être satisfaite par plusieurs types de pièces.
 * Ex. IDENTITY ← IDENTITY_CARD | PASSPORT (uniquement si VERIFIED).
 */
export interface RequiredDocumentRequirement {
  id: string;
  label: string;
  acceptedTypes: readonly StudentDocumentType[];
  critical: boolean;
  visibility: DocumentVisibility;
}

export type RequirementSatisfactionStatus =
  | "MISSING"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED";

export interface RequirementEvaluation {
  requirementId: string;
  status: RequirementSatisfactionStatus;
  /** true uniquement si au moins un candidat accepté est VERIFIED. */
  satisfied: boolean;
  critical: boolean;
  matchingDocuments: StudentDocumentItem[];
}

/**
 * Catalogue d'exigences du dossier administratif.
 * TRANSFER_CERTIFICATE n'est requis que si `requireTransferCertificate`.
 */
export function getDocumentRequirements(options: {
  requireTransferCertificate?: boolean;
  requireMedicalCertificate?: boolean;
} = {}): readonly RequiredDocumentRequirement[] {
  const requireMedical = options.requireMedicalCertificate !== false;
  const requireTransfer = Boolean(options.requireTransferCertificate);

  const requirements: RequiredDocumentRequirement[] = [
    {
      id: "BIRTH_CERTIFICATE",
      label: "Acte de naissance",
      acceptedTypes: ["BIRTH_CERTIFICATE"],
      critical: true,
      visibility: "STAFF",
    },
    {
      id: "PHOTO",
      label: "Photo",
      acceptedTypes: ["PHOTO"],
      critical: false,
      visibility: "STAFF",
    },
    {
      id: "IDENTITY",
      label: "Pièce d'identité",
      acceptedTypes: ["IDENTITY_CARD", "PASSPORT"],
      critical: true,
      visibility: "ADMIN",
    },
  ];

  if (requireMedical) {
    requirements.push({
      id: "MEDICAL_CERTIFICATE",
      label: "Certificat médical",
      acceptedTypes: ["MEDICAL_CERTIFICATE"],
      critical: true,
      visibility: "STAFF",
    });
  }

  if (requireTransfer) {
    requirements.push({
      id: "TRANSFER_CERTIFICATE",
      label: "Certificat de transfert",
      acceptedTypes: ["TRANSFER_CERTIFICATE"],
      critical: true,
      visibility: "STAFF",
    });
  }

  return requirements;
}

/** @deprecated préférer getDocumentRequirements — conservé pour méta d'item. */
interface RequiredDocumentSpec {
  type: StudentDocumentType;
  required: boolean;
  critical: boolean;
  visibility: DocumentVisibility;
}

function requirementsToItemCatalog(
  requirements: readonly RequiredDocumentRequirement[],
): readonly RequiredDocumentSpec[] {
  const specs: RequiredDocumentSpec[] = [];
  for (const requirement of requirements) {
    for (const type of requirement.acceptedTypes) {
      specs.push({
        type,
        // Les alternatives d'une même exigence sont toutes « obligatoires »
        // au sens UI, mais la conformité se calcule sur l'exigence.
        required: true,
        critical: requirement.critical,
        visibility: requirement.visibility,
      });
    }
  }
  return specs;
}

function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

const DOCUMENT_TYPE_LABELS: Record<StudentDocumentType, string> = {
  BIRTH_CERTIFICATE: "Acte de naissance",
  PHOTO: "Photo",
  IDENTITY_CARD: "Carte d'identité",
  PASSPORT: "Passeport",
  VACCINATION_RECORD: "Carnet de vaccination",
  MEDICAL_CERTIFICATE: "Certificat médical",
  REPORT_CARD: "Bulletin scolaire",
  TRANSFER_CERTIFICATE: "Certificat de transfert",
  PROOF_OF_ADDRESS: "Justificatif de domicile",
  OTHER: "Autre document",
};

const DOCUMENT_TYPE_ALIASES: Record<string, StudentDocumentType> = {
  birth_certificate: "BIRTH_CERTIFICATE",
  "birth certificate": "BIRTH_CERTIFICATE",
  "acte de naissance": "BIRTH_CERTIFICATE",
  "acte naissance": "BIRTH_CERTIFICATE",
  "extrait de naissance": "BIRTH_CERTIFICATE",
  photo: "PHOTO",
  "photo d identite": "PHOTO",
  "photo identite": "PHOTO",
  identity_card: "IDENTITY_CARD",
  "identity card": "IDENTITY_CARD",
  "carte d identite": "IDENTITY_CARD",
  "carte identite": "IDENTITY_CARD",
  "piece d identite": "IDENTITY_CARD",
  "piece identite": "IDENTITY_CARD",
  cni: "IDENTITY_CARD",
  passport: "PASSPORT",
  passeport: "PASSPORT",
  vaccination_record: "VACCINATION_RECORD",
  "vaccination record": "VACCINATION_RECORD",
  "carnet de vaccination": "VACCINATION_RECORD",
  "carnet vaccination": "VACCINATION_RECORD",
  vaccinations: "VACCINATION_RECORD",
  medical_certificate: "MEDICAL_CERTIFICATE",
  "medical certificate": "MEDICAL_CERTIFICATE",
  "certificat medical": "MEDICAL_CERTIFICATE",
  report_card: "REPORT_CARD",
  "report card": "REPORT_CARD",
  "bulletin scolaire": "REPORT_CARD",
  bulletin: "REPORT_CARD",
  transfer_certificate: "TRANSFER_CERTIFICATE",
  "transfer certificate": "TRANSFER_CERTIFICATE",
  "certificat de transfert": "TRANSFER_CERTIFICATE",
  "certificat transfert": "TRANSFER_CERTIFICATE",
  proof_of_address: "PROOF_OF_ADDRESS",
  "proof of address": "PROOF_OF_ADDRESS",
  "justificatif de domicile": "PROOF_OF_ADDRESS",
  "justificatif domicile": "PROOF_OF_ADDRESS",
  other: "OTHER",
  autre: "OTHER",
};

const DOCUMENT_STATUS_ALIASES: Record<string, StudentDocumentStatus> = {
  missing: "MISSING",
  manquant: "MISSING",
  absent: "MISSING",
  submitted: "SUBMITTED",
  depose: "SUBMITTED",
  "en attente": "SUBMITTED",
  pending: "SUBMITTED",
  uploaded: "SUBMITTED",
  verified: "VERIFIED",
  verifie: "VERIFIED",
  valide: "VERIFIED",
  validated: "VERIFIED",
  approved: "VERIFIED",
  rejected: "REJECTED",
  refuse: "REJECTED",
  refused: "REJECTED",
  expired: "EXPIRED",
  expire: "EXPIRED",
};

const STATUS_SORT_RANK: Record<StudentDocumentStatus, number> = {
  REJECTED: 0,
  EXPIRED: 1,
  MISSING: 2,
  SUBMITTED: 3,
  VERIFIED: 4,
};

export function getStudentDocumentTypeLabel(type: StudentDocumentType): string {
  return DOCUMENT_TYPE_LABELS[type];
}

export function normalizeStudentDocumentType(
  value: unknown,
): StudentDocumentType {
  const raw = String(value ?? "").trim();
  if (!raw) return "OTHER";

  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if ((STUDENT_DOCUMENT_TYPES as readonly string[]).includes(upper)) {
    return upper as StudentDocumentType;
  }

  return DOCUMENT_TYPE_ALIASES[foldKey(raw)] ?? "OTHER";
}

export function normalizeStudentDocumentStatus(
  value: unknown,
): StudentDocumentStatus | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if ((STUDENT_DOCUMENT_STATUSES as readonly string[]).includes(upper)) {
    return upper as StudentDocumentStatus;
  }

  // Gère les littéraux mojibake éventuels (VÃ©rifiÃ©, etc.).
  const folded = foldKey(raw);
  return DOCUMENT_STATUS_ALIASES[folded] ?? null;
}

export function compareDocumentStatus(
  left: StudentDocumentStatus,
  right: StudentDocumentStatus,
): number {
  return STATUS_SORT_RANK[left] - STATUS_SORT_RANK[right];
}

export function sortStudentDocuments(
  documents: readonly StudentDocumentItem[],
): StudentDocumentItem[] {
  return [...documents].sort((left, right) => {
    const statusDelta = compareDocumentStatus(left.status, right.status);
    if (statusDelta !== 0) return statusDelta;
    if (left.critical !== right.critical) {
      return left.critical ? -1 : 1;
    }
    if (left.required !== right.required) {
      return left.required ? -1 : 1;
    }
    return left.label.localeCompare(right.label, "fr", { sensitivity: "base" });
  });
}

export function isDocumentExpired(
  expiresAt: string | null | undefined,
  referenceDate: Date = new Date(),
): boolean {
  const raw = String(expiresAt ?? "").trim();
  if (!raw) return false;
  const expiry = parseCivilDate(raw);
  if (!expiry) return false;

  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return expiry.getTime() < ref.getTime();
}

function extractFileName(fileUrl: string | null | undefined): string | null {
  const url = String(fileUrl ?? "").trim();
  if (!url) return null;
  try {
    const path = url.includes("://") ? new URL(url).pathname : url;
    const segment = path.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    const segment = url.split("/").filter(Boolean).pop();
    return segment || null;
  }
}

function resolveCatalogMeta(
  type: StudentDocumentType,
  catalog: readonly RequiredDocumentSpec[],
): { required: boolean; critical: boolean; visibility: DocumentVisibility } {
  const spec = catalog.find((item) => item.type === type);
  if (spec) {
    return {
      required: spec.required,
      critical: spec.critical,
      visibility: spec.visibility,
    };
  }

  return { required: false, critical: false, visibility: "STAFF" };
}

function resolveItemStatus(input: {
  rawStatus: unknown;
  fileUrl: string | null | undefined;
  expiresAt: string | null | undefined;
  referenceDate: Date;
}): StudentDocumentStatus {
  const normalized = normalizeStudentDocumentStatus(input.rawStatus);

  // Un refus explicite prime sur l'expiration (action administrative prioritaire).
  if (normalized === "REJECTED") {
    return "REJECTED";
  }

  if (isDocumentExpired(input.expiresAt, input.referenceDate)) {
    return "EXPIRED";
  }

  if (normalized) {
    return normalized;
  }

  if (String(input.fileUrl ?? "").trim()) {
    return "SUBMITTED";
  }

  return "MISSING";
}

export function toStudentDocumentItem(
  document: StudentDocument,
  options: {
    catalog?: readonly RequiredDocumentSpec[];
    requirements?: readonly RequiredDocumentRequirement[];
    referenceDate?: Date;
  } = {},
): StudentDocumentItem {
  const requirements =
    options.requirements ?? getDocumentRequirements();
  const catalog =
    options.catalog ?? requirementsToItemCatalog(requirements);
  const referenceDate = options.referenceDate ?? new Date();
  const type = normalizeStudentDocumentType(document.documentType);
  const meta = resolveCatalogMeta(type, catalog);
  const expiresAt = normalizeOptionalText(document.expiresAt);
  const status = resolveItemStatus({
    rawStatus: document.status,
    fileUrl: document.fileUrl,
    expiresAt,
    referenceDate,
  });

  return {
    id: document.id,
    type,
    label: getStudentDocumentTypeLabel(type),
    status,
    required: meta.required,
    issuedAt: normalizeOptionalText(document.issuedAt),
    expiresAt,
    verifiedAt: normalizeOptionalText(document.verifiedAt),
    verifiedBy: normalizeOptionalText(document.verifiedBy),
    fileName: extractFileName(document.fileUrl),
    visibility: meta.visibility,
    notes: normalizeOptionalText(document.documentNumber),
    critical: meta.critical,
  };
}

function createMissingPlaceholder(
  requirement: RequiredDocumentRequirement,
  studentId: string,
): StudentDocumentItem {
  const type = requirement.acceptedTypes[0] ?? "OTHER";
  return {
    id: `MISSING-${requirement.id}-${studentId}`,
    type,
    label: requirement.label || getStudentDocumentTypeLabel(type),
    status: "MISSING",
    required: true,
    issuedAt: null,
    expiresAt: null,
    verifiedAt: null,
    verifiedBy: null,
    fileName: null,
    visibility: requirement.visibility,
    notes: null,
    critical: requirement.critical,
  };
}

function isPhysicalDocument(item: StudentDocumentItem): boolean {
  return !item.id.startsWith("MISSING-");
}

/**
 * Évalue une exigence : conforme uniquement si un candidat accepté est VERIFIED.
 * Ordre hors vérification : REJECTED → EXPIRED → SUBMITTED → MISSING.
 */
export function evaluateDocumentRequirement(
  requirement: RequiredDocumentRequirement,
  documents: readonly StudentDocumentItem[],
): RequirementEvaluation {
  const matchingDocuments = documents.filter((item) =>
    requirement.acceptedTypes.includes(item.type),
  );
  const candidates = matchingDocuments.filter(
    (item) => isPhysicalDocument(item) && item.status !== "MISSING",
  );

  if (candidates.some((item) => item.status === "VERIFIED")) {
    return {
      requirementId: requirement.id,
      status: "VERIFIED",
      satisfied: true,
      critical: requirement.critical,
      matchingDocuments,
    };
  }
  if (candidates.some((item) => item.status === "REJECTED")) {
    return {
      requirementId: requirement.id,
      status: "REJECTED",
      satisfied: false,
      critical: requirement.critical,
      matchingDocuments,
    };
  }
  if (candidates.some((item) => item.status === "EXPIRED")) {
    return {
      requirementId: requirement.id,
      status: "EXPIRED",
      satisfied: false,
      critical: requirement.critical,
      matchingDocuments,
    };
  }
  if (candidates.some((item) => item.status === "SUBMITTED")) {
    return {
      requirementId: requirement.id,
      status: "SUBMITTED",
      satisfied: false,
      critical: requirement.critical,
      matchingDocuments,
    };
  }

  return {
    requirementId: requirement.id,
    status: "MISSING",
    satisfied: false,
    critical: requirement.critical,
    matchingDocuments,
  };
}

export function evaluateDocumentRequirements(
  requirements: readonly RequiredDocumentRequirement[],
  documents: readonly StudentDocumentItem[],
): RequirementEvaluation[] {
  return requirements.map((requirement) =>
    evaluateDocumentRequirement(requirement, documents),
  );
}

export function buildStudentDocumentSummary(
  documents: readonly StudentDocumentItem[],
  requirements: readonly RequiredDocumentRequirement[] = getDocumentRequirements(),
): StudentDocumentSummary {
  const evaluations = evaluateDocumentRequirements(requirements, documents);
  const requirementCount = evaluations.length;
  const verifiedRequirements = evaluations.filter(
    (item) => item.satisfied,
  ).length;
  const complianceRate =
    requirementCount === 0
      ? 100
      : Math.round((verifiedRequirements / requirementCount) * 100);

  const hasCriticalMissingDocument = evaluations.some(
    (item) => item.critical && item.status === "MISSING",
  );

  return {
    total: documents.length,
    verified: documents.filter((item) => item.status === "VERIFIED").length,
    pending: documents.filter((item) => item.status === "SUBMITTED").length,
    missing: documents.filter((item) => item.status === "MISSING").length,
    expired: documents.filter((item) => item.status === "EXPIRED").length,
    rejected: documents.filter((item) => item.status === "REJECTED").length,
    complianceRate,
    hasCriticalMissingDocument,
  };
}

export function diagnoseStudentDocuments(
  record: StudentDocumentRecord,
): StudentDocumentDiagnostics {
  const evaluations = evaluateDocumentRequirements(
    record.requirements,
    record.documents,
  );

  return {
    hasMissingRequiredDocument: evaluations.some(
      (item) => item.status === "MISSING",
    ),
    hasExpiredRequiredDocument: evaluations.some(
      (item) => item.status === "EXPIRED",
    ),
    hasRejectedDocument:
      record.documents.some((item) => item.status === "REJECTED") ||
      evaluations.some((item) => item.status === "REJECTED"),
    complianceRate: record.summary.complianceRate,
    hasCriticalMissingDocument: record.summary.hasCriticalMissingDocument,
    hasLowCompliance:
      record.summary.complianceRate < DOCUMENT_COMPLIANCE_ALERT_THRESHOLD,
  };
}

export function isDocumentVisibilityAllowed(
  visibility: DocumentVisibility,
  allowedVisibility: readonly DocumentVisibility[],
): boolean {
  return allowedVisibility.includes(visibility);
}

/**
 * Filtre l'agrégat selon le niveau d'accès.
 * ADMIN voit STAFF + ADMIN ; STAFF ne voit pas ADMIN.
 */
export function filterStudentDocumentRecordByVisibility(
  record: StudentDocumentRecord,
  allowedVisibility: readonly DocumentVisibility[],
): StudentDocumentRecord {
  const documents = record.documents.filter((item) =>
    isDocumentVisibilityAllowed(item.visibility, allowedVisibility),
  );
  const requirements = record.requirements.filter((requirement) =>
    isDocumentVisibilityAllowed(requirement.visibility, allowedVisibility),
  );
  const sorted = sortStudentDocuments(documents);
  const summary = buildStudentDocumentSummary(sorted, requirements);
  return {
    ...record,
    documents: sorted,
    requirements,
    summary,
  };
}

export function createEmptyStudentDocumentRecord(
  studentId: string,
): StudentDocumentRecord {
  const requirements = getDocumentRequirements();
  return {
    studentId,
    documents: [],
    requirements: [...requirements],
    summary: {
      total: 0,
      verified: 0,
      pending: 0,
      missing: 0,
      expired: 0,
      rejected: 0,
      complianceRate: 0,
      hasCriticalMissingDocument: true,
    },
    source: "EMPTY",
  };
}

export function collectStudentDocumentRecord(input: {
  studentId: string;
  documents?: readonly StudentDocument[] | null;
  requireTransferCertificate?: boolean;
  requireMedicalCertificate?: boolean;
  referenceDate?: Date;
}): StudentDocumentRecord {
  const studentId = input.studentId.trim();
  const referenceDate = input.referenceDate ?? new Date();
  const requirements = getDocumentRequirements({
    requireTransferCertificate: input.requireTransferCertificate,
    requireMedicalCertificate: input.requireMedicalCertificate,
  });
  const catalog = requirementsToItemCatalog(requirements);

  const rawDocuments = (input.documents ?? []).filter(
    (document) => document.studentId === studentId,
  );

  const items = rawDocuments.map((document) =>
    toStudentDocumentItem(document, { catalog, requirements, referenceDate }),
  );

  // Placeholder uniquement si aucun document physique d'un type accepté n'existe.
  const placeholders = requirements
    .filter((requirement) => {
      const hasPhysicalCandidate = items.some(
        (item) =>
          requirement.acceptedTypes.includes(item.type) &&
          isPhysicalDocument(item),
      );
      return !hasPhysicalCandidate;
    })
    .map((requirement) => createMissingPlaceholder(requirement, studentId));

  const documents = sortStudentDocuments([...items, ...placeholders]);
  const summary = buildStudentDocumentSummary(documents, requirements);

  let source: DocumentDataSource = "EMPTY";
  if (rawDocuments.length > 0) {
    source = "LEGACY";
  } else if (placeholders.length > 0) {
    source = "EMPTY";
  }

  return {
    studentId,
    documents,
    requirements: [...requirements],
    summary,
    source,
  };
}
