/**
 * C1.7 — Édition contrôlée du dossier élève.
 *
 * Principe : l'UI ne mute jamais un agrégat. Pipeline obligatoire :
 * Draft → Commande → Validation → ChangeSet → Confirmation → Repository → Agrégat.
 *
 * Audit métier ≠ Historique (C1.6 projection).
 */

export type StudentGender = "M" | "F" | "OTHER" | "UNKNOWN";

export type PreferredContactChannel = "PHONE" | "EMAIL" | "SMS";

export type StudentEditSensitivity = "STANDARD" | "SENSITIVE";

export const SENSITIVE_STUDENT_FIELDS = [
  "birthDate",
  "nationality",
  "isEmergencyContact",
  "pickupAuthorized",
  "priority",
] as const;

export type SensitiveStudentField = (typeof SENSITIVE_STUDENT_FIELDS)[number];

export function isSensitiveStudentField(field: string): boolean {
  return (SENSITIVE_STUDENT_FIELDS as readonly string[]).includes(field);
}

/** Champs identité autorisés dans UPDATE_STUDENT_IDENTITY. */
export const ALLOWED_IDENTITY_CHANGE_FIELDS = [
  "firstName",
  "lastName",
  "preferredName",
  "gender",
  "birthDate",
  "birthPlace",
  "nationality",
  "address",
  "phone",
  "email",
] as const;

/** Champs contact responsable autorisés. */
export const ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS = [
  "phone",
  "email",
  "address",
  "isEmergencyContact",
  "pickupAuthorized",
  "priority",
] as const;

/** Champs administratifs autorisés. */
export const ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS = [
  "administrativeNotes",
  "preferredContactChannel",
] as const;

export interface StudentEditAuthorizationContext {
  userId: string;
  role: string;
  schoolCode: string;
  permissions: string[];
}

export interface StudentEditConflict {
  code: "VERSION_CONFLICT";
  expectedVersion: number;
  currentVersion: number;
  currentUpdatedAt: string;
}

export interface StudentEditValidationError {
  field: string | null;
  code: string;
  message: string;
}

export interface StudentEditValidationWarning {
  field: string | null;
  code: string;
  message: string;
  requiresConfirmation: boolean;
}

export interface CommandValidationResult {
  valid: boolean;
  errors: StudentEditValidationError[];
  warnings: StudentEditValidationWarning[];
}

export interface StudentBusinessAuditEvent {
  id: string;
  studentId: string;
  commandType: string;
  actorId: string;
  actorRole: string;
  occurredAt: string;
  changedFields: string[];
  reason: string | null;
  visibility: "ADMIN";
}

export interface StudentCommandSuccess<TAggregate = unknown> {
  success: true;
  updatedAggregate: TAggregate;
  changeSet: import("./studentEditingChangeSet").StudentChangeSet;
  auditEvent: StudentBusinessAuditEvent;
  newVersion: number;
  updatedAt: string;
}

export interface StudentCommandFailure {
  success: false;
  code:
    | "VALIDATION_ERROR"
    | "PERMISSION_DENIED"
    | "VERSION_CONFLICT"
    | "NOT_FOUND"
    | "NO_CHANGES"
    | "UNSUPPORTED_FIELD";
  errors: StudentEditValidationError[];
  conflict?: StudentEditConflict;
}

export type StudentCommandResult<TAggregate = unknown> =
  | StudentCommandSuccess<TAggregate>
  | StudentCommandFailure;

/** Snapshot versionné — identité administrative éditable. */
export interface EditableStudentIdentity {
  studentId: string;
  schoolCode: string;
  matricule: string;
  version: number;
  updatedAt: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  gender: StudentGender | null;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

/** Snapshot versionné — contact d'un responsable existant. */
export interface EditableGuardianContact {
  studentId: string;
  schoolCode: string;
  relationId: string;
  guardianId: string;
  displayName: string;
  version: number;
  updatedAt: string;
  isActive: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  isEmergencyContact: boolean;
  pickupAuthorized: boolean;
  priority: number;
}

/** Snapshot versionné — détails administratifs non sensibles. */
export interface EditableStudentAdministrativeDetails {
  studentId: string;
  schoolCode: string;
  version: number;
  updatedAt: string;
  administrativeNotes: string | null;
  preferredContactChannel: PreferredContactChannel | null;
}

/**
 * Snapshot versionné — inscription annuelle (C1.8a).
 * Les mutations passent uniquement par VALIDATE_ENROLLMENT / ASSIGN_ENROLLMENT_CLASS.
 */
export interface EditableEnrollment {
  enrollmentId: string;
  studentId: string;
  schoolCode: string;
  academicYear: string;
  version: number;
  updatedAt: string;
  status: import("./studentEnrollmentStatus").StudentEnrollmentStatus;
  classId: string | null;
  className: string | null;
  programId: string | null;
  programName: string | null;
  source: import("./studentEnrollment").StudentEnrollmentSource;
  applicationReference: string | null;
  requestedAt: string | null;
  validatedAt: string | null;
  enrolledAt: string | null;
  endedAt: string | null;
  previousSchoolName: string | null;
  notes: string | null;
  schoolName: string | null;
  createdAt: string;
}

/** Classe connue de l'établissement (catalogue pour affectation). */
export interface SchoolClassCatalogEntry {
  id: string;
  name: string;
  schoolCode: string;
}

export type StudentEditMode =
  | "READ"
  | "EDITING"
  | "REVIEWING"
  | "SUBMITTING"
  | "SUCCESS"
  | "CONFLICT"
  | "ERROR";

/** Champs inscription autorisés dans ASSIGN_ENROLLMENT_CLASS. */
export const ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS = [
  "classId",
  "className",
] as const;

/** Champs autorisés dans TRANSFER_ENROLLMENT. */
export const ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS = [
  "targetSchoolName",
] as const;

export const FIELD_LABELS: Record<string, string> = {
  firstName: "Prénom",
  lastName: "Nom",
  preferredName: "Nom d'usage",
  gender: "Sexe",
  birthDate: "Date de naissance",
  birthPlace: "Lieu de naissance",
  nationality: "Nationalité",
  address: "Adresse",
  phone: "Téléphone",
  email: "Adresse e-mail",
  isEmergencyContact: "Contact d'urgence",
  pickupAuthorized: "Autorisé à récupérer l'élève",
  priority: "Priorité",
  administrativeNotes: "Notes administratives",
  preferredContactChannel: "Canal de contact préféré",
  status: "Statut d'inscription",
  validatedAt: "Date de validation",
  enrolledAt: "Date d'inscription",
  endedAt: "Date de fin",
  classId: "Identifiant de classe",
  className: "Classe",
  targetSchoolName: "Établissement de destination",
  notes: "Notes d'inscription",
};
