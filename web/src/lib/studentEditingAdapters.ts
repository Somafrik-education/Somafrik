import type { Person, Student } from "./studentDomain";
import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  PreferredContactChannel,
  StudentGender,
} from "./studentEditing";
import { normalizeGender, normalizePhone, normalizeEmail } from "./studentEditingChangeSet";
import type { StudentGuardianRelationRecord } from "./studentGuardian";

function deriveVersion(updatedAt: string | null | undefined): number {
  if (!updatedAt) return 1;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 1;
  // Version déterministe dérivée de updatedAt (pas un compteur serveur).
  return Math.max(1, Math.floor(ts / 1000) % 1_000_000_000);
}

export function toEditableStudentIdentity(input: {
  student: Student;
  person?: Person | null;
  schoolCode?: string | null;
}): EditableStudentIdentity {
  const { student, person } = input;
  const updatedAt =
    person?.updatedAt?.trim() ||
    student.updatedAt?.trim() ||
    student.createdAt?.trim() ||
    new Date(0).toISOString();

  const firstName =
    person?.firstName?.trim() ||
    String(student.firstName ?? "").trim() ||
    "";
  const lastName =
    person?.lastName?.trim() ||
    String(student.lastName ?? "").trim() ||
    "";

  return {
    studentId: student.id,
    schoolCode: (input.schoolCode ?? student.schoolCode).trim(),
    matricule: student.matricule,
    version: deriveVersion(updatedAt),
    updatedAt,
    firstName,
    lastName,
    preferredName: person?.middleName?.trim() || null,
    gender: normalizeGender(person?.gender ?? student.gender),
    birthDate:
      (person?.birthDate ?? student.birthDate)?.trim().slice(0, 10) || null,
    birthPlace: person?.birthPlace?.trim() || null,
    nationality: person?.nationality?.trim() || null,
    address: person?.address?.trim() || null,
    phone: normalizePhone(person?.phone ?? student.phone),
    email: normalizeEmail(person?.email ?? student.email),
  };
}

export function toEditableGuardianContact(input: {
  relation: StudentGuardianRelationRecord;
  schoolCode: string;
  version?: number;
  updatedAt?: string | null;
}): EditableGuardianContact {
  const updatedAt =
    input.updatedAt?.trim() ||
    input.relation.startDate ||
    new Date(0).toISOString();

  return {
    studentId: input.relation.studentId,
    schoolCode: input.schoolCode.trim(),
    relationId: input.relation.id,
    guardianId: input.relation.guardianId,
    displayName: input.relation.displayName,
    version: input.version ?? deriveVersion(updatedAt),
    updatedAt,
    isActive: input.relation.isActive,
    phone: normalizePhone(input.relation.phone),
    email: normalizeEmail(input.relation.email),
    address: input.relation.address?.trim() || null,
    isEmergencyContact: input.relation.isEmergencyContact,
    pickupAuthorized: input.relation.pickupAuthorized,
    priority: input.relation.priority,
  };
}

export function toEditableAdministrativeDetails(input: {
  studentId: string;
  schoolCode: string;
  administrativeNotes?: string | null;
  preferredContactChannel?: PreferredContactChannel | null;
  version?: number;
  updatedAt?: string | null;
}): EditableStudentAdministrativeDetails {
  const updatedAt = input.updatedAt?.trim() || new Date(0).toISOString();
  return {
    studentId: input.studentId,
    schoolCode: input.schoolCode.trim(),
    version: input.version ?? deriveVersion(updatedAt),
    updatedAt,
    administrativeNotes: input.administrativeNotes?.trim() || null,
    preferredContactChannel: input.preferredContactChannel ?? null,
  };
}

export type { StudentGender };
