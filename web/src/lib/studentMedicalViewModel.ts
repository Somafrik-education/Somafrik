import {
  diagnoseMedicalRecord,
  resolveVaccinationAggregateStatus,
  sortAllergiesBySeverity,
  type AllergyRecord,
  type AllergySeverity,
  type DisabilityRecord,
  type DisabilityType,
  type MedicalConditionRecord,
  type MedicalConditionSeverity,
  type MedicalRiskDiagnostics,
  type MedicationRecord,
  type PhysicianRecord,
  type StudentMedicalRecord,
  type VaccinationAggregateStatus,
} from "./studentMedical";
import { formatCivilDateLabel } from "./studentWorkspaceDates";

export type MedicalBadgeKind =
  | "critical_allergy"
  | "medication"
  | "disability"
  | "monitoring"
  | "physician"
  | "vaccination";

export interface MedicalBadge {
  kind: MedicalBadgeKind;
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface AllergyViewModel {
  id: string;
  label: string;
  severity: AllergySeverity;
  severityLabel: string;
  notesLabel: string;
  isCritical: boolean;
}

export interface ConditionViewModel {
  id: string;
  label: string;
  severity: MedicalConditionSeverity;
  severityLabel: string;
  notesLabel: string;
  isCritical: boolean;
}

export interface MedicationViewModel {
  id: string;
  label: string;
  dosageLabel: string;
  frequencyLabel: string;
  statusLabel: string;
  isActive: boolean;
}

export interface DisabilityViewModel {
  id: string;
  type: DisabilityType;
  typeLabel: string;
  label: string;
  accommodationLabel: string;
  accommodationRequested: boolean;
}

export interface PhysicianViewModel {
  nameLabel: string;
  phoneLabel: string;
}

export interface StudentMedicalViewModel {
  studentId: string;
  bloodTypeLabel: string;
  allergyBadges: MedicalBadge[];
  conditionBadges: MedicalBadge[];
  vaccinationStatus: VaccinationAggregateStatus;
  vaccinationStatusLabel: string;
  hasCriticalRisk: boolean;
  hasMedication: boolean;
  hasPhysician: boolean;
  lastUpdateLabel: string;
  badges: MedicalBadge[];
  allergies: AllergyViewModel[];
  conditions: ConditionViewModel[];
  medications: MedicationViewModel[];
  disabilities: DisabilityViewModel[];
  physician: PhysicianViewModel | null;
  emergencyInstructionsLabel: string;
  medicalNotesLabel: string;
  hasProfile: boolean;
  diagnostics: MedicalRiskDiagnostics;
  summary: {
    bloodTypeLabel: string;
    criticalAllergiesLabel: string;
    conditionsLabel: string;
    medicationsLabel: string;
    physicianLabel: string;
    lastUpdateLabel: string;
  };
}

const MISSING = "Non renseigné";

const ALLERGY_SEVERITY_LABELS: Record<AllergySeverity, string> = {
  CRITICAL: "Critique",
  HIGH: "Élevée",
  MEDIUM: "Moyenne",
  LOW: "Faible",
};

const CONDITION_SEVERITY_LABELS: Record<MedicalConditionSeverity, string> = {
  CRITICAL: "Critique",
  MONITORED: "Surveillance",
  CONTROLLED: "Contrôlée",
};

const DISABILITY_TYPE_LABELS: Record<DisabilityType, string> = {
  VISUAL: "Handicap visuel",
  HEARING: "Handicap auditif",
  MOTOR: "Handicap moteur",
  COGNITIVE: "Handicap cognitif",
  OTHER: "Handicap",
};

export function getAllergySeverityLabel(severity: AllergySeverity): string {
  return ALLERGY_SEVERITY_LABELS[severity];
}

export function getConditionSeverityLabel(
  severity: MedicalConditionSeverity,
): string {
  return CONDITION_SEVERITY_LABELS[severity];
}

export function getDisabilityTypeLabel(type: DisabilityType): string {
  return DISABILITY_TYPE_LABELS[type];
}

export function getVaccinationStatusLabel(
  status: VaccinationAggregateStatus,
): string {
  return status === "UP_TO_DATE" ? "À jour" : "Incomplètes";
}

function buildCentralizedBadges(
  record: StudentMedicalRecord,
  diagnostics: MedicalRiskDiagnostics,
): MedicalBadge[] {
  const badges: MedicalBadge[] = [];

  if (diagnostics.hasCriticalAllergy) {
    badges.push({
      kind: "critical_allergy",
      label: "ALLERGIE CRITIQUE",
      tone: "danger",
    });
  }
  if (diagnostics.hasMedication) {
    badges.push({
      kind: "medication",
      label: "TRAITEMENT",
      tone: "info",
    });
  }
  if (record.disabilities.length > 0) {
    badges.push({
      kind: "disability",
      label: "HANDICAP",
      tone: "neutral",
    });
  }
  if (
    diagnostics.hasCriticalCondition ||
    record.chronicConditions.some((item) => item.severity === "MONITORED")
  ) {
    badges.push({
      kind: "monitoring",
      label: "SURVEILLANCE",
      tone: "warning",
    });
  }
  if (diagnostics.hasPhysician) {
    badges.push({
      kind: "physician",
      label: "MÉDECIN",
      tone: "success",
    });
  }
  badges.push({
    kind: "vaccination",
    label: "VACCINS",
    tone: diagnostics.vaccinationStatus === "UP_TO_DATE" ? "success" : "warning",
  });

  return badges;
}

function buildAllergyBadges(allergies: readonly AllergyRecord[]): MedicalBadge[] {
  return sortAllergiesBySeverity(allergies)
    .filter((item) => item.severity === "CRITICAL" || item.severity === "HIGH")
    .map((item) => ({
      kind: "critical_allergy" as const,
      label: item.label,
      tone:
        item.severity === "CRITICAL"
          ? ("danger" as const)
          : ("warning" as const),
    }));
}

function buildConditionBadges(
  conditions: readonly MedicalConditionRecord[],
): MedicalBadge[] {
  return conditions
    .filter(
      (item) =>
        item.severity === "CRITICAL" || item.severity === "MONITORED",
    )
    .map((item) => ({
      kind: "monitoring" as const,
      label: item.label,
      tone:
        item.severity === "CRITICAL"
          ? ("danger" as const)
          : ("warning" as const),
    }));
}

function toAllergyViewModel(record: AllergyRecord): AllergyViewModel {
  return {
    id: record.id,
    label: record.label,
    severity: record.severity,
    severityLabel: getAllergySeverityLabel(record.severity),
    notesLabel: record.notes?.trim() || MISSING,
    isCritical: record.severity === "CRITICAL",
  };
}

function toConditionViewModel(
  record: MedicalConditionRecord,
): ConditionViewModel {
  return {
    id: record.id,
    label: record.label,
    severity: record.severity,
    severityLabel: getConditionSeverityLabel(record.severity),
    notesLabel: record.notes?.trim() || MISSING,
    isCritical: record.severity === "CRITICAL",
  };
}

function toMedicationViewModel(record: MedicationRecord): MedicationViewModel {
  const statusLabel =
    record.status === "ACTIVE"
      ? "En cours"
      : record.status === "COMPLETED"
        ? "Terminé"
        : "Inactif";

  return {
    id: record.id,
    label: record.label,
    dosageLabel: record.dosage?.trim() || MISSING,
    frequencyLabel: record.frequency?.trim() || MISSING,
    statusLabel,
    isActive: record.status === "ACTIVE",
  };
}

function toDisabilityViewModel(
  record: DisabilityRecord,
): DisabilityViewModel {
  return {
    id: record.id,
    type: record.type,
    typeLabel: getDisabilityTypeLabel(record.type),
    label: record.label,
    accommodationLabel: record.accommodationRequested
      ? "Aménagement demandé"
      : "Aucun aménagement indiqué",
    accommodationRequested: record.accommodationRequested,
  };
}

function toPhysicianViewModel(
  physician: PhysicianRecord | null,
): PhysicianViewModel | null {
  if (!physician?.name.trim()) return null;
  return {
    nameLabel: physician.name.trim(),
    phoneLabel: physician.phone?.trim() || MISSING,
  };
}

function formatCriticalAllergiesSummary(
  allergies: readonly AllergyViewModel[],
): string {
  const critical = allergies.filter((item) => item.isCritical);
  if (critical.length === 0) return "Aucune allergie critique";
  return critical.map((item) => item.label).join(", ");
}

function formatListSummary(
  labels: readonly string[],
  emptyLabel: string,
): string {
  if (labels.length === 0) return emptyLabel;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} (+${labels.length - 2})`;
}

export function buildStudentMedicalViewModel(
  record: StudentMedicalRecord,
  options: { missingValueLabel?: string } = {},
): StudentMedicalViewModel {
  const missingValueLabel = options.missingValueLabel?.trim() || MISSING;
  const diagnostics = diagnoseMedicalRecord(record);
  const allergies = sortAllergiesBySeverity(record.allergies).map(
    toAllergyViewModel,
  );
  const conditions = record.chronicConditions.map(toConditionViewModel);
  const medications = record.medications.map(toMedicationViewModel);
  const disabilities = record.disabilities.map(toDisabilityViewModel);
  const physician = toPhysicianViewModel(record.physician);
  const vaccinationStatus = resolveVaccinationAggregateStatus(
    record.vaccinations,
  );
  const lastUpdateLabel = formatCivilDateLabel(
    record.updatedAt,
    missingValueLabel,
  );

  const bloodTypeLabel = record.bloodType ?? missingValueLabel;

  return {
    studentId: record.studentId,
    bloodTypeLabel,
    allergyBadges: buildAllergyBadges(record.allergies),
    conditionBadges: buildConditionBadges(record.chronicConditions),
    vaccinationStatus,
    vaccinationStatusLabel: getVaccinationStatusLabel(vaccinationStatus),
    hasCriticalRisk: diagnostics.hasCriticalRisk,
    hasMedication: diagnostics.hasMedication,
    hasPhysician: diagnostics.hasPhysician,
    lastUpdateLabel,
    badges: buildCentralizedBadges(record, diagnostics),
    allergies,
    conditions,
    medications,
    disabilities,
    physician,
    emergencyInstructionsLabel:
      record.emergencyInstructions?.trim() || missingValueLabel,
    medicalNotesLabel: record.medicalNotes?.trim() || missingValueLabel,
    hasProfile: record.hasProfile,
    diagnostics,
    summary: {
      bloodTypeLabel,
      criticalAllergiesLabel: formatCriticalAllergiesSummary(allergies),
      conditionsLabel: formatListSummary(
        conditions.map((item) => item.label),
        "Aucune pathologie",
      ),
      medicationsLabel: formatListSummary(
        medications.map((item) => item.label),
        "Aucun traitement",
      ),
      physicianLabel: physician?.nameLabel ?? missingValueLabel,
      lastUpdateLabel,
    },
  };
}
