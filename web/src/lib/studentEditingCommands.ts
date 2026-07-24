import type {
  PreferredContactChannel,
  StudentGender,
} from "./studentEditing";

export interface UpdateStudentIdentityCommand {
  type: "UPDATE_STUDENT_IDENTITY";
  studentId: string;
  expectedVersion: number;
  changes: {
    firstName?: string;
    lastName?: string;
    preferredName?: string | null;
    gender?: StudentGender | null;
    birthDate?: string | null;
    birthPlace?: string | null;
    nationality?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  reason?: string | null;
}

export interface UpdateGuardianContactCommand {
  type: "UPDATE_GUARDIAN_CONTACT";
  studentId: string;
  relationId: string;
  expectedVersion: number;
  changes: {
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    isEmergencyContact?: boolean;
    pickupAuthorized?: boolean;
    priority?: number | null;
  };
  reason?: string | null;
}

export interface UpdateStudentAdministrativeDetailsCommand {
  type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS";
  studentId: string;
  expectedVersion: number;
  changes: {
    administrativeNotes?: string | null;
    preferredContactChannel?: PreferredContactChannel | null;
  };
  reason?: string | null;
}

/** C1.8a — Valider une inscription (→ APPROVED). */
export interface ValidateEnrollmentCommand {
  type: "VALIDATE_ENROLLMENT";
  studentId: string;
  enrollmentId: string;
  expectedVersion: number;
  reason?: string | null;
}

/** C1.8a — Affecter une classe (→ ENROLLED + classe). */
export interface AssignEnrollmentClassCommand {
  type: "ASSIGN_ENROLLMENT_CLASS";
  studentId: string;
  enrollmentId: string;
  expectedVersion: number;
  changes: {
    classId?: string | null;
    className?: string | null;
  };
  reason?: string | null;
}

export type StudentWorkspaceCommand =
  | UpdateStudentIdentityCommand
  | UpdateGuardianContactCommand
  | UpdateStudentAdministrativeDetailsCommand
  | ValidateEnrollmentCommand
  | AssignEnrollmentClassCommand;

export type StudentWorkspaceCommandType = StudentWorkspaceCommand["type"];
