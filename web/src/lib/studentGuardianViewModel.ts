import {
  getGuardianRelationshipLabel,
  type GuardianRelationshipType,
  type StudentGuardianRelationRecord,
} from "./studentGuardian";
import {
  diagnoseGuardianRelations,
  getEmergencyContacts,
  getFinancialResponsibleGuardians,
  getPickupAuthorizedGuardians,
  selectPrimaryGuardian,
  sortGuardiansByPriority,
  type GuardianRelationDiagnostics,
} from "./studentGuardianSelection";

export type GuardianBadgeKind =
  | "legal"
  | "financial"
  | "emergency"
  | "pickup"
  | "lives_with"
  | "primary"
  | "expired"
  | "unverified";

export interface GuardianBadge {
  kind: GuardianBadgeKind;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface StudentGuardianViewModel {
  id: string;
  guardianId: string;
  displayName: string;
  relationshipType: GuardianRelationshipType;
  relationshipLabel: string;
  phoneLabel: string;
  emailLabel: string;
  addressLabel: string;
  priority: number;
  priorityLabel: string;
  isPrimary: boolean;
  isLegalGuardian: boolean;
  livesWithStudent: boolean;
  isEmergencyContact: boolean;
  pickupAuthorized: boolean;
  financialResponsible: boolean;
  isExpired: boolean;
  isActive: boolean;
  source: StudentGuardianRelationRecord["source"];
  requiresVerification: boolean;
  dataQuality: StudentGuardianRelationRecord["dataQuality"];
  badges: GuardianBadge[];
  notesLabel: string;
}

export interface StudentGuardiansModuleViewModel {
  primaryGuardian: StudentGuardianViewModel | null;
  guardians: StudentGuardianViewModel[];
  emergencyContacts: StudentGuardianViewModel[];
  pickupAuthorizedGuardians: StudentGuardianViewModel[];
  financialResponsibles: StudentGuardianViewModel[];
  diagnostics: GuardianRelationDiagnostics;
}

const MISSING = "Non renseigné";

function buildBadges(
  record: StudentGuardianRelationRecord,
  isPrimary: boolean,
): GuardianBadge[] {
  const badges: GuardianBadge[] = [];

  if (record.requiresVerification || record.source === "LEGACY") {
    badges.push({
      kind: "unverified",
      label: "Informations héritées à vérifier",
      tone: "warning",
    });
  }
  if (isPrimary) {
    badges.push({ kind: "primary", label: "Principal", tone: "info" });
  }
  if (record.isLegalGuardian) {
    badges.push({ kind: "legal", label: "Responsable légal", tone: "success" });
  }
  if (record.financialResponsible) {
    badges.push({
      kind: "financial",
      label: "Responsable financier",
      tone: "info",
    });
  }
  if (record.isEmergencyContact) {
    badges.push({
      kind: "emergency",
      label: "Contact d'urgence",
      tone: "warning",
    });
  }
  if (record.pickupAuthorized) {
    badges.push({
      kind: "pickup",
      label: "Autorisé à récupérer",
      tone: "neutral",
    });
  }
  if (record.livesWithStudent) {
    badges.push({
      kind: "lives_with",
      label: "Vit avec l'élève",
      tone: "neutral",
    });
  }
  if (record.isExpired) {
    badges.push({ kind: "expired", label: "Relation expirée", tone: "danger" });
  }

  return badges;
}

export function buildStudentGuardianViewModel(
  record: StudentGuardianRelationRecord,
  options: { isPrimary?: boolean } = {},
): StudentGuardianViewModel {
  const isPrimary = Boolean(options.isPrimary);
  const relationshipLabel =
    record.source === "LEGACY"
      ? "Contact parent hérité"
      : getGuardianRelationshipLabel(record.relationshipType);

  return {
    id: record.id,
    guardianId: record.guardianId,
    displayName: record.displayName.trim() || "Responsable",
    relationshipType: record.relationshipType,
    relationshipLabel,
    phoneLabel: record.phone?.trim() || MISSING,
    emailLabel: record.email?.trim() || MISSING,
    addressLabel: record.address?.trim() || MISSING,
    priority: record.priority,
    priorityLabel: String(record.priority),
    isPrimary,
    isLegalGuardian: record.isLegalGuardian,
    livesWithStudent: record.livesWithStudent,
    isEmergencyContact: record.isEmergencyContact,
    pickupAuthorized: record.pickupAuthorized,
    financialResponsible: record.financialResponsible,
    isExpired: record.isExpired,
    isActive: record.isActive,
    source: record.source,
    requiresVerification: record.requiresVerification,
    dataQuality: record.dataQuality,
    badges: buildBadges(record, isPrimary),
    notesLabel: record.notes?.trim() || MISSING,
  };
}

export function buildStudentGuardiansModuleViewModel(
  relations: readonly StudentGuardianRelationRecord[],
): StudentGuardiansModuleViewModel {
  const primary = selectPrimaryGuardian(relations);
  const sorted = sortGuardiansByPriority(relations);

  const guardians = sorted.map((record) =>
    buildStudentGuardianViewModel(record, {
      isPrimary: primary?.id === record.id,
    }),
  );

  const byId = new Map(guardians.map((guardian) => [guardian.id, guardian]));

  return {
    primaryGuardian: primary
      ? buildStudentGuardianViewModel(primary, { isPrimary: true })
      : null,
    guardians,
    emergencyContacts: getEmergencyContacts(relations)
      .map((record) => byId.get(record.id))
      .filter((item): item is StudentGuardianViewModel => Boolean(item)),
    pickupAuthorizedGuardians: getPickupAuthorizedGuardians(relations)
      .map((record) => byId.get(record.id))
      .filter((item): item is StudentGuardianViewModel => Boolean(item)),
    financialResponsibles: getFinancialResponsibleGuardians(relations)
      .map((record) => byId.get(record.id))
      .filter((item): item is StudentGuardianViewModel => Boolean(item)),
    diagnostics: diagnoseGuardianRelations(relations),
  };
}
