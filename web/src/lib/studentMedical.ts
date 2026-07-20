import type { StudentMedicalProfile } from "./studentDomain";

/**
 * Agrégat médical élève (C1.4) — point d'entrée unique pour l'affichage ERP.
 * Lecture seule ; aucune règle métier dans l'UI.
 */

export type MedicalVisibility = "STAFF" | "MEDICAL";

export type BloodType =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "AB+"
  | "AB-"
  | "O+"
  | "O-";

export const BLOOD_TYPES = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const satisfies readonly BloodType[];

export type AllergySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const ALLERGY_SEVERITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly AllergySeverity[];

export type MedicalConditionSeverity =
  | "CONTROLLED"
  | "MONITORED"
  | "CRITICAL";

export type DisabilityType =
  | "VISUAL"
  | "HEARING"
  | "MOTOR"
  | "COGNITIVE"
  | "OTHER";

export type MedicationStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "COMPLETED"
  | "UNKNOWN";

export type VaccinationItemStatus = "UP_TO_DATE" | "INCOMPLETE" | "UNKNOWN";

export type VaccinationAggregateStatus = "UP_TO_DATE" | "INCOMPLETE";

export type MedicalDataSource = "STRUCTURED" | "LEGACY" | "EMPTY";

export type FutureStudentMedicalPermission =
  | "student.medical.read"
  | "student.medical.update"
  | "student.medical.validate"
  | "student.health.read";

export const FUTURE_STUDENT_MEDICAL_PERMISSIONS: readonly FutureStudentMedicalPermission[] =
  [
    "student.medical.read",
    "student.medical.update",
    "student.medical.validate",
  ];

export interface AllergyRecord {
  id: string;
  label: string;
  severity: AllergySeverity;
  notes: string | null;
  visibility: MedicalVisibility;
}

export interface MedicalConditionRecord {
  id: string;
  label: string;
  severity: MedicalConditionSeverity;
  notes: string | null;
  visibility: MedicalVisibility;
}

export interface MedicationRecord {
  id: string;
  label: string;
  dosage: string | null;
  frequency: string | null;
  status: MedicationStatus;
  notes: string | null;
  visibility: MedicalVisibility;
}

export interface DisabilityRecord {
  id: string;
  type: DisabilityType;
  label: string;
  accommodationRequested: boolean;
  notes: string | null;
  visibility: MedicalVisibility;
}

export interface VaccinationRecord {
  id: string;
  label: string;
  status: VaccinationItemStatus;
  administeredAt: string | null;
  visibility: MedicalVisibility;
}

export interface PhysicianRecord {
  name: string;
  phone: string | null;
  visibility: MedicalVisibility;
}

export interface MedicalNoteRecord {
  content: string;
  visibility: MedicalVisibility;
}

/**
 * Profil médical consolidé — agrégat indépendant du dossier élève.
 * Les futurs modules (certificats, PAI, infirmerie) enrichiront cet agrégat.
 */
export interface StudentMedicalRecord {
  studentId: string;
  bloodType: BloodType | null;
  allergies: AllergyRecord[];
  chronicConditions: MedicalConditionRecord[];
  medications: MedicationRecord[];
  disabilities: DisabilityRecord[];
  vaccinations: VaccinationRecord[];
  physician: PhysicianRecord | null;
  emergencyInstructions: string | null;
  /** Notes structurées — les notes legacy `confidentialNotes` sont MEDICAL. */
  medicalNotes: MedicalNoteRecord[];
  updatedAt: string | null;
  /** Cloisonnement futur STAFF vs MEDICAL. */
  visibility: MedicalVisibility;
  source: MedicalDataSource;
  hasProfile: boolean;
}

export interface MedicalRiskDiagnostics {
  hasCriticalAllergy: boolean;
  hasCriticalCondition: boolean;
  hasCriticalRisk: boolean;
  hasPhysician: boolean;
  hasBloodType: boolean;
  hasMedicalUpdate: boolean;
  hasMedication: boolean;
  vaccinationStatus: VaccinationAggregateStatus;
  criticalAllergyCount: number;
  criticalConditionCount: number;
}

function foldKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Conserver + et - (groupes sanguins A+, O-, etc.).
    .replace(/[^a-z0-9+-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

const BLOOD_TYPE_ALIASES: Record<string, BloodType> = {
  "a+": "A+",
  "a +": "A+",
  "a positif": "A+",
  "a positive": "A+",
  "a pos": "A+",
  "groupe a+": "A+",
  "a-": "A-",
  "a -": "A-",
  "a negatif": "A-",
  "a negative": "A-",
  "a neg": "A-",
  "b+": "B+",
  "b +": "B+",
  "b positif": "B+",
  "b positive": "B+",
  "b pos": "B+",
  "b-": "B-",
  "b -": "B-",
  "b negatif": "B-",
  "b negative": "B-",
  "b neg": "B-",
  "ab+": "AB+",
  "ab +": "AB+",
  "ab positif": "AB+",
  "ab positive": "AB+",
  "ab pos": "AB+",
  "ab-": "AB-",
  "ab -": "AB-",
  "ab negatif": "AB-",
  "ab negative": "AB-",
  "ab neg": "AB-",
  "o+": "O+",
  "o +": "O+",
  "o positif": "O+",
  "o positive": "O+",
  "o pos": "O+",
  "0+": "O+",
  "0 +": "O+",
  "0 positif": "O+",
  "0 pos": "O+",
  "o-": "O-",
  "o -": "O-",
  "o negatif": "O-",
  "o negative": "O-",
  "o neg": "O-",
  "0-": "O-",
  "0 -": "O-",
  "0 negatif": "O-",
  "0 neg": "O-",
};

/** Normalise un groupe sanguin legacy (ex. « A Positif », « O POS ») vers le type fermé. */
export function normalizeBloodType(value: unknown): BloodType | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const spaced = foldKey(raw);
  // "a +" / "ab -" → "a+" / "ab-"
  const compact = spaced.replace(/\s*([+-])\s*/g, "$1").replace(/\s+/g, "");

  const upperCompact = compact.toUpperCase();
  if ((BLOOD_TYPES as readonly string[]).includes(upperCompact)) {
    return upperCompact as BloodType;
  }

  return BLOOD_TYPE_ALIASES[spaced] ?? BLOOD_TYPE_ALIASES[compact] ?? null;
}

const ALLERGY_SEVERITY_RANK: Record<AllergySeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function compareAllergySeverity(
  left: AllergySeverity,
  right: AllergySeverity,
): number {
  return ALLERGY_SEVERITY_RANK[left] - ALLERGY_SEVERITY_RANK[right];
}

export function sortAllergiesBySeverity(
  allergies: readonly AllergyRecord[],
): AllergyRecord[] {
  return [...allergies].sort((left, right) => {
    const severityDelta = compareAllergySeverity(left.severity, right.severity);
    if (severityDelta !== 0) return severityDelta;
    return left.label.localeCompare(right.label, "fr", { sensitivity: "base" });
  });
}

function detectAllergySeverity(text: string): AllergySeverity {
  const key = foldKey(text);
  if (
    key.includes("critique") ||
    key.includes("critical") ||
    key.includes("severe") ||
    key.includes("anaphylaxie") ||
    key.includes("anaphylactic")
  ) {
    return "CRITICAL";
  }
  if (
    key.includes("eleve") ||
    key.includes("high") ||
    key.includes("haute") ||
    key.includes("importante")
  ) {
    return "HIGH";
  }
  if (
    key.includes("faible") ||
    key.includes("low") ||
    key.includes("legere") ||
    key.includes("mild")
  ) {
    return "LOW";
  }
  if (
    key.includes("moyen") ||
    key.includes("medium") ||
    key.includes("modere")
  ) {
    return "MEDIUM";
  }
  return "MEDIUM";
}

function detectConditionSeverity(text: string): MedicalConditionSeverity {
  const key = foldKey(text);
  if (key.includes("critique") || key.includes("critical")) {
    return "CRITICAL";
  }
  if (
    key.includes("controle") ||
    key.includes("controlled") ||
    key.includes("stable")
  ) {
    return "CONTROLLED";
  }
  if (
    key.includes("surveillance") ||
    key.includes("suivi") ||
    key.includes("monitored") ||
    key.includes("monitor")
  ) {
    return "MONITORED";
  }
  return "MONITORED";
}

function detectDisabilityType(text: string): DisabilityType {
  const key = foldKey(text);
  if (key.includes("visuel") || key.includes("visual") || key.includes("vue")) {
    return "VISUAL";
  }
  if (
    key.includes("auditif") ||
    key.includes("hearing") ||
    key.includes("ouie")
  ) {
    return "HEARING";
  }
  if (
    key.includes("moteur") ||
    key.includes("motor") ||
    key.includes("mobilite")
  ) {
    return "MOTOR";
  }
  if (
    key.includes("cognitif") ||
    key.includes("cognitive") ||
    key.includes("apprentissage")
  ) {
    return "COGNITIVE";
  }
  return "OTHER";
}

function stripSeverityAnnotations(label: string): string {
  return label
    .replace(
      /\s*[([]\s*(critique|critical|elevee?|élevée?|high|haute|moyenne?|medium|faible|low|legere|légère|surveillance|suivi|controlee?|contrôlée?|controlled|monitored)\s*[)\]]\s*/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function splitLegacyList(raw: string | null | undefined): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  return text
    .split(/[\n;|]+|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseAllergiesFromLegacy(
  raw: string | null | undefined,
  studentId: string,
): AllergyRecord[] {
  return splitLegacyList(raw).map((entry, index) => {
    const severity = detectAllergySeverity(entry);
    const label = stripSeverityAnnotations(entry) || entry;
    return {
      id: `LEGACY-ALLERGY-${studentId}-${index + 1}`,
      label,
      severity,
      notes: null,
      visibility: "STAFF" as const,
    };
  });
}

function parseConditionsFromLegacy(
  raw: string | null | undefined,
  studentId: string,
): MedicalConditionRecord[] {
  return splitLegacyList(raw).map((entry, index) => {
    const severity = detectConditionSeverity(entry);
    const label = stripSeverityAnnotations(entry) || entry;
    return {
      id: `LEGACY-CONDITION-${studentId}-${index + 1}`,
      label,
      severity,
      notes: null,
      visibility: "STAFF" as const,
    };
  });
}

/** Détecte un statut médicament uniquement si un marqueur explicite est présent. */
export function detectMedicationStatus(text: string): MedicationStatus {
  const key = foldKey(text);
  if (
    key.includes("en cours") ||
    key.includes("actuel") ||
    key.includes("actuelle") ||
    key.includes("active") ||
    key.includes("actif") ||
    key.includes("activee")
  ) {
    return "ACTIVE";
  }
  if (
    key.includes("termine") ||
    key.includes("terminee") ||
    key.includes("completed") ||
    key.includes("complete") ||
    key.includes("arrete") ||
    key.includes("fini") ||
    key.includes("anterieur") ||
    key.includes("historique")
  ) {
    return "COMPLETED";
  }
  if (
    key.includes("suspendu") ||
    key.includes("inactif") ||
    key.includes("inactive") ||
    key.includes("stoppe") ||
    key.includes("pause")
  ) {
    return "INACTIVE";
  }
  return "UNKNOWN";
}

function parseMedicationsFromLegacy(
  raw: string | null | undefined,
  studentId: string,
): MedicationRecord[] {
  return splitLegacyList(raw).map((entry, index) => {
    const paren = entry.match(/^(.+?)\s*\((.+)\)\s*$/);
    const label = (paren?.[1] ?? entry).trim();
    const detail = paren?.[2]?.trim() ?? null;
    const looksLikeFrequency =
      detail &&
      /(fois|prise|jour|semaine|matin|soir|\/\s*j|par jour)/i.test(detail) &&
      detectMedicationStatus(detail) === "UNKNOWN";
    const status = detectMedicationStatus(entry);

    return {
      id: `LEGACY-MED-${studentId}-${index + 1}`,
      label: stripSeverityAnnotations(label) || label,
      dosage: looksLikeFrequency ? null : detail,
      frequency: looksLikeFrequency ? detail : null,
      // Absence de statut explicite ≠ traitement actif confirmé.
      status,
      notes: null,
      visibility: "STAFF" as const,
    };
  });
}

function parseDisabilitiesFromLegacy(
  disabilitiesRaw: string | null | undefined,
  specialNeedsRaw: string | null | undefined,
  studentId: string,
): DisabilityRecord[] {
  const entries = [
    ...splitLegacyList(disabilitiesRaw),
    ...splitLegacyList(specialNeedsRaw).filter((entry) => {
      const key = foldKey(entry);
      if (
        key.includes("vaccin") ||
        key.includes("vaccination") ||
        key.includes("immunisation")
      ) {
        return false;
      }
      return (
        key.includes("handicap") ||
        key.includes("amenagement") ||
        key.includes("accommodation") ||
        key.includes("besoin") ||
        detectDisabilityType(entry) !== "OTHER"
      );
    }),
  ];

  const seen = new Set<string>();
  const records: DisabilityRecord[] = [];

  for (const entry of entries) {
    const key = foldKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);

    const type = detectDisabilityType(entry);
    const accommodationRequested =
      key.includes("amenagement") ||
      key.includes("accommodation") ||
      key.includes("demande");

    records.push({
      id: `LEGACY-DISABILITY-${studentId}-${records.length + 1}`,
      type,
      label: entry,
      accommodationRequested,
      notes: null,
      visibility: "STAFF",
    });
  }

  return records;
}

function parseVaccinationsFromLegacy(
  specialNeedsRaw: string | null | undefined,
  studentId: string,
): VaccinationRecord[] {
  const entries = splitLegacyList(specialNeedsRaw).filter((entry) => {
    const key = foldKey(entry);
    return (
      key.includes("vaccin") ||
      key.includes("vaccination") ||
      key.includes("immunisation")
    );
  });

  return entries.map((entry, index) => {
    const key = foldKey(entry);
    const upToDate =
      key.includes("a jour") ||
      key.includes("complete") ||
      key.includes("up to date");
    const incomplete =
      key.includes("incomplet") ||
      key.includes("manquant") ||
      key.includes("incomplete");

    return {
      id: `LEGACY-VACC-${studentId}-${index + 1}`,
      label: entry,
      status: upToDate
        ? ("UP_TO_DATE" as const)
        : incomplete
          ? ("INCOMPLETE" as const)
          : ("UNKNOWN" as const),
      administeredAt: null,
      // Statut vaccinal agrégé = information administrative établissement (STAFF).
      visibility: "STAFF" as const,
    };
  });
}

/**
 * Sémantique C1.4 : aucune preuve vaccinale enregistrée ⇒ dossier administratif
 * incomplet (`INCOMPLETE`). Ce n'est pas un diagnostic clinique « non vacciné ».
 * Une distinction future `UNKNOWN` pourra être introduite hors C1.4.
 */
export function resolveVaccinationAggregateStatus(
  vaccinations: readonly VaccinationRecord[],
): VaccinationAggregateStatus {
  if (vaccinations.length === 0) {
    return "INCOMPLETE";
  }
  const allUpToDate = vaccinations.every(
    (item) => item.status === "UP_TO_DATE",
  );
  return allUpToDate ? "UP_TO_DATE" : "INCOMPLETE";
}

export function isMedicalVisibilityAllowed(
  visibility: MedicalVisibility,
  allowedVisibility: readonly MedicalVisibility[],
): boolean {
  return allowedVisibility.includes(visibility);
}

/**
 * Filtre l'agrégat selon le niveau d'accès.
 * MEDICAL voit STAFF + MEDICAL ; STAFF ne voit pas MEDICAL.
 */
export function filterStudentMedicalRecordByVisibility(
  record: StudentMedicalRecord,
  allowedVisibility: readonly MedicalVisibility[],
): StudentMedicalRecord {
  const allow = (visibility: MedicalVisibility) =>
    isMedicalVisibilityAllowed(visibility, allowedVisibility);

  return {
    ...record,
    allergies: record.allergies.filter((item) => allow(item.visibility)),
    chronicConditions: record.chronicConditions.filter((item) =>
      allow(item.visibility),
    ),
    medications: record.medications.filter((item) => allow(item.visibility)),
    disabilities: record.disabilities.filter((item) => allow(item.visibility)),
    vaccinations: record.vaccinations.filter((item) => allow(item.visibility)),
    physician:
      record.physician && allow(record.physician.visibility)
        ? record.physician
        : null,
    emergencyInstructions: allow("STAFF")
      ? record.emergencyInstructions
      : null,
    medicalNotes: record.medicalNotes.filter((note) => allow(note.visibility)),
  };
}

export function diagnoseMedicalRecord(
  record: StudentMedicalRecord,
): MedicalRiskDiagnostics {
  const criticalAllergyCount = record.allergies.filter(
    (item) => item.severity === "CRITICAL",
  ).length;
  const criticalConditionCount = record.chronicConditions.filter(
    (item) => item.severity === "CRITICAL",
  ).length;

  return {
    hasCriticalAllergy: criticalAllergyCount > 0,
    hasCriticalCondition: criticalConditionCount > 0,
    hasCriticalRisk: criticalAllergyCount > 0 || criticalConditionCount > 0,
    hasPhysician: Boolean(record.physician?.name.trim()),
    hasBloodType: Boolean(record.bloodType),
    hasMedicalUpdate: Boolean(record.updatedAt?.trim()),
    // Uniquement un traitement ACTIVE explicitement confirmé.
    hasMedication: record.medications.some((item) => item.status === "ACTIVE"),
    vaccinationStatus: resolveVaccinationAggregateStatus(record.vaccinations),
    criticalAllergyCount,
    criticalConditionCount,
  };
}

export function createEmptyStudentMedicalRecord(
  studentId: string,
): StudentMedicalRecord {
  return {
    studentId,
    bloodType: null,
    allergies: [],
    chronicConditions: [],
    medications: [],
    disabilities: [],
    vaccinations: [],
    physician: null,
    emergencyInstructions: null,
    medicalNotes: [],
    updatedAt: null,
    visibility: "STAFF",
    source: "EMPTY",
    hasProfile: false,
  };
}

/** Transforme le DTO legacy `StudentMedicalProfile` en agrégat métier. */
export function toStudentMedicalRecord(
  profile: StudentMedicalProfile | null | undefined,
  studentId: string,
): StudentMedicalRecord {
  if (!profile || profile.studentId !== studentId) {
    return createEmptyStudentMedicalRecord(studentId);
  }

  const doctorName = normalizeOptionalText(profile.doctorName);
  const doctorPhone = normalizeOptionalText(profile.doctorPhone);

  const allergies = sortAllergiesBySeverity(
    parseAllergiesFromLegacy(profile.allergies, studentId),
  );
  const chronicConditions = parseConditionsFromLegacy(
    profile.chronicConditions,
    studentId,
  );
  const medications = parseMedicationsFromLegacy(
    profile.medications,
    studentId,
  );
  const disabilities = parseDisabilitiesFromLegacy(
    profile.disabilities,
    profile.specialNeeds,
    studentId,
  );
  const vaccinations = parseVaccinationsFromLegacy(
    profile.specialNeeds,
    studentId,
  );

  return {
    studentId,
    bloodType: normalizeBloodType(profile.bloodType),
    allergies,
    chronicConditions,
    medications,
    disabilities,
    vaccinations,
    physician: doctorName
      ? {
          name: doctorName,
          phone: doctorPhone,
          visibility: "STAFF",
        }
      : null,
    emergencyInstructions: normalizeOptionalText(profile.emergencyInstructions),
    medicalNotes: (() => {
      const confidential = normalizeOptionalText(profile.confidentialNotes);
      if (!confidential) return [];
      // Les notes legacy sont explicitement confidentielles → MEDICAL.
      return [
        {
          content: confidential,
          visibility: "MEDICAL" as const,
        },
      ];
    })(),
    updatedAt: normalizeOptionalText(profile.updatedAt),
    visibility: "STAFF",
    source: "LEGACY",
    hasProfile: true,
  };
}

export function collectStudentMedicalRecord(input: {
  studentId: string;
  medicalProfiles?: readonly StudentMedicalProfile[] | null;
  medicalProfile?: StudentMedicalProfile | null;
}): StudentMedicalRecord {
  const studentId = input.studentId.trim();
  const profile =
    input.medicalProfile ??
    input.medicalProfiles?.find((item) => item.studentId === studentId) ??
    null;
  return toStudentMedicalRecord(profile, studentId);
}

