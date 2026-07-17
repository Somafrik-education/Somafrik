export type StudentStatus = "Actif" | "Inactif" | "TransfÃ©rÃ©" | "Sorti" | "ArchivÃ©";

export type StudentEnrollmentStatus =
  | "PrÃ©inscrit"
  | "Inscrit"
  | "En attente"
  | "TransfÃ©rÃ©"
  | "Sorti"
  | "AnnulÃ©";

export interface Person {
  id: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  gender?: string;
  birthDate?: string;
  birthPlace?: string;
  nationality?: string;
  photoUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * IdentitÃ© scolaire permanente.
 *
 * Les champs legacy restent optionnels pendant la migration afin de ne pas
 * casser les Ã©crans, l'API ou les donnÃ©es existantes pendant la Phase A.
 */
export interface Student {
  id: string;
  personId?: string;
  matricule: string;
  publicId?: string;
  schoolCode: string;
  status?: StudentStatus;
  admissionDate?: string;
  exitDate?: string;
  exitReason?: string;
  archived?: boolean;
  archivedAt?: string;
  createdAt?: string;
  updatedAt?: string;

  /** Champs legacy conservÃ©s temporairement pour compatibilitÃ©. */
  contactId?: string;
  name?: string;
  lastName?: string;
  firstName?: string;
  gender?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  className?: string;
  schoolYear?: string;
  enrollmentDate?: string;
  schoolStatus?: string;
  regime?: string;
  previousSchool?: string;
  observations?: string;
  parentName?: string;
  parentPhone?: string;
  [key: string]: unknown;
}

export interface StudentEnrollment {
  id: string;
  studentId: string;
  schoolCode: string;
  academicYear: string;

  /**
   * Structure d'Ã©tablissement facultative.
   * Les Ã©coles simples peuvent fonctionner uniquement avec className.
   */
  campusId?: string;
  campusName?: string;
  levelId?: string;
  levelName?: string;
  classId?: string;
  className?: string;
  sectionId?: string;
  sectionName?: string;
  optionId?: string;
  optionName?: string;
  trackId?: string;
  trackName?: string;

  /** Organisation locale de la scolaritÃ©, toujours facultative. */
  shift?: string;
  regime?: string;

  enrollmentDate?: string;
  startDate?: string;
  endDate?: string;
  status: StudentEnrollmentStatus;
  isRepeating?: boolean;
  previousSchool?: string;
  exitReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Guardian {
  id: string;
  personId: string;
  occupation?: string;
  employer?: string;
  preferredLanguage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentGuardianRelation {
  id: string;
  studentId: string;
  guardianId: string;
  relationshipType: string;
  isLegalGuardian?: boolean;
  isPrimaryContact?: boolean;
  isFinanciallyResponsible?: boolean;
  isEmergencyContact?: boolean;
  canPickUpStudent?: boolean;
  priority?: number;
  status?: "Actif" | "Inactif" | "ArchivÃ©";
  startDate?: string;
  endDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentMedicalProfile {
  id: string;
  studentId: string;
  bloodType?: string;
  allergies?: string;
  chronicConditions?: string;
  medications?: string;
  disabilities?: string;
  specialNeeds?: string;
  doctorName?: string;
  doctorPhone?: string;
  emergencyInstructions?: string;
  confidentialNotes?: string;
  updatedAt?: string;
}

export interface StudentDocument {
  id: string;
  studentId: string;
  documentType: string;
  fileUrl: string;
  documentNumber?: string;
  issuedAt?: string;
  expiresAt?: string;
  status?: "En attente" | "VÃ©rifiÃ©" | "RefusÃ©" | "ExpirÃ©";
  verifiedBy?: string;
  verifiedAt?: string;
  createdAt?: string;
}

export interface LegacyStudentRow extends Record<string, unknown> {
  id?: string;
  matricule?: string;
  publicId?: string;
  schoolCode?: string;
  name?: string;
  lastName?: string;
  firstName?: string;
  archived?: boolean;
}

/**
 * Adaptateur non destructif.
 *
 * Il normalise uniquement les champs structurants et conserve toutes les
 * propriÃ©tÃ©s legacy afin de permettre une migration progressive.
 */
export function adaptLegacyStudent(row: LegacyStudentRow): Student {
  const id = String(row.id ?? "").trim();
  const matricule = String(row.matricule ?? row.publicId ?? id).trim();
  const schoolCode = String(row.schoolCode ?? "").trim();
  const lastName = String(row.lastName ?? row.name ?? "").trim();
  const firstName = String(row.firstName ?? "").trim();

  return {
    ...row,
    id,
    matricule,
    publicId: String(row.publicId ?? matricule).trim() || matricule,
    schoolCode,
    lastName,
    name: String(row.name ?? lastName).trim(),
    firstName,
    archived: Boolean(row.archived),
  };
}

export function adaptLegacyStudents(
  rows: readonly LegacyStudentRow[] = [],
): Student[] {
  return rows.map(adaptLegacyStudent);
}

export interface LegacyEnrollmentSource extends Record<string, unknown> {
  id?: string;
  enrollmentId?: string;
  studentId?: string;
  schoolCode?: string;
  schoolYear?: string;
  academicYear?: string;
  classId?: string;
  className?: string;
  levelId?: string;
  levelName?: string;
  sectionId?: string;
  sectionName?: string;
  optionId?: string;
  optionName?: string;
  trackId?: string;
  trackName?: string;
  campusId?: string;
  campusName?: string;
  shift?: string;
  regime?: string;
  enrollmentDate?: string;
  startDate?: string;
  endDate?: string;
  schoolStatus?: string;
  status?: StudentEnrollmentStatus;
  isRepeating?: boolean;
  previousSchool?: string;
  exitReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

const ENROLLMENT_STATUSES: readonly StudentEnrollmentStatus[] = [
  "PrÃ©inscrit",
  "Inscrit",
  "En attente",
  "TransfÃ©rÃ©",
  "Sorti",
  "AnnulÃ©",
];

function normalizeEnrollmentStatus(value: unknown): StudentEnrollmentStatus {
  const normalized = String(value ?? "").trim();
  return ENROLLMENT_STATUSES.includes(normalized as StudentEnrollmentStatus)
    ? (normalized as StudentEnrollmentStatus)
    : "Inscrit";
}

/**
 * Convertit une ancienne fiche Ã©lÃ¨ve ou inscription partielle vers le nouveau
 * modÃ¨le annuel. Aucun champ administratif facultatif ne bloque la conversion.
 */
export function adaptLegacyEnrollment(
  source: LegacyEnrollmentSource,
): StudentEnrollment {
  const studentId = String(source.studentId ?? source.id ?? "").trim();
  const schoolCode = String(source.schoolCode ?? "").trim();
  const academicYear = String(
    source.academicYear ?? source.schoolYear ?? "",
  ).trim();
  const explicitId = String(source.enrollmentId ?? "").trim();
  const generatedId = ["ENROLLMENT", studentId, schoolCode, academicYear]
    .filter(Boolean)
    .join("-");

  return {
    id: explicitId || generatedId || `ENROLLMENT-${studentId || "LEGACY"}`,
    studentId,
    schoolCode,
    academicYear,
    campusId: String(source.campusId ?? "").trim() || undefined,
    campusName: String(source.campusName ?? "").trim() || undefined,
    levelId: String(source.levelId ?? "").trim() || undefined,
    levelName: String(source.levelName ?? "").trim() || undefined,
    classId: String(source.classId ?? "").trim() || undefined,
    className: String(source.className ?? "").trim() || undefined,
    sectionId: String(source.sectionId ?? "").trim() || undefined,
    sectionName: String(source.sectionName ?? "").trim() || undefined,
    optionId: String(source.optionId ?? "").trim() || undefined,
    optionName: String(source.optionName ?? "").trim() || undefined,
    trackId: String(source.trackId ?? "").trim() || undefined,
    trackName: String(source.trackName ?? "").trim() || undefined,
    shift: String(source.shift ?? "").trim() || undefined,
    regime: String(source.regime ?? "").trim() || undefined,
    enrollmentDate:
      String(source.enrollmentDate ?? "").trim() || undefined,
    startDate: String(source.startDate ?? "").trim() || undefined,
    endDate: String(source.endDate ?? "").trim() || undefined,
    status: normalizeEnrollmentStatus(source.status ?? source.schoolStatus),
    isRepeating:
      typeof source.isRepeating === "boolean"
        ? source.isRepeating
        : undefined,
    previousSchool:
      String(source.previousSchool ?? "").trim() || undefined,
    exitReason: String(source.exitReason ?? "").trim() || undefined,
    createdAt: String(source.createdAt ?? "").trim() || undefined,
    updatedAt: String(source.updatedAt ?? "").trim() || undefined,
  };
}

export function adaptLegacyEnrollments(
  sources: readonly LegacyEnrollmentSource[] = [],
): StudentEnrollment[] {
  return sources.map(adaptLegacyEnrollment);
}
export function getActiveEnrollment(
  enrollments: readonly StudentEnrollment[],
  studentId: string,
  schoolCode: string,
  academicYear: string,
): StudentEnrollment | undefined {
  return enrollments.find(
    (enrollment) =>
      enrollment.studentId === studentId &&
      enrollment.schoolCode === schoolCode &&
      enrollment.academicYear === academicYear &&
      !["Sorti", "AnnulÃ©", "TransfÃ©rÃ©"].includes(enrollment.status),
  );
}

