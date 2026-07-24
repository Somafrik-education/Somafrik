import type {
  EditableEnrollment,
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  SchoolClassCatalogEntry,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "./studentEditing";
import type {
  AssignEnrollmentClassCommand,
  UpdateGuardianContactCommand,
  UpdateStudentAdministrativeDetailsCommand,
  UpdateStudentIdentityCommand,
  ValidateEnrollmentCommand,
} from "./studentEditingCommands";

/**
 * Abstraction repository — aucune donnée mock ici.
 * L'implémentation simulée vit dans studentEditingRepository.mock.ts.
 */
export interface StudentWorkspaceCommandRepository {
  getStudentIdentity(
    studentId: string,
  ): Promise<EditableStudentIdentity | null>;

  getGuardianContact(
    studentId: string,
    relationId: string,
  ): Promise<EditableGuardianContact | null>;

  listGuardianContacts(
    studentId: string,
  ): Promise<EditableGuardianContact[]>;

  getAdministrativeDetails(
    studentId: string,
  ): Promise<EditableStudentAdministrativeDetails | null>;

  getEnrollment(
    studentId: string,
    enrollmentId: string,
  ): Promise<EditableEnrollment | null>;

  listSchoolClasses(schoolCode: string): Promise<SchoolClassCatalogEntry[]>;

  updateStudentIdentity(
    command: UpdateStudentIdentityCommand,
    context: StudentEditAuthorizationContext,
  ): Promise<StudentCommandResult<EditableStudentIdentity>>;

  updateGuardianContact(
    command: UpdateGuardianContactCommand,
    context: StudentEditAuthorizationContext,
  ): Promise<StudentCommandResult<EditableGuardianContact>>;

  updateAdministrativeDetails(
    command: UpdateStudentAdministrativeDetailsCommand,
    context: StudentEditAuthorizationContext,
  ): Promise<StudentCommandResult<EditableStudentAdministrativeDetails>>;

  validateEnrollment(
    command: ValidateEnrollmentCommand,
    context: StudentEditAuthorizationContext,
  ): Promise<StudentCommandResult<EditableEnrollment>>;

  assignEnrollmentClass(
    command: AssignEnrollmentClassCommand,
    context: StudentEditAuthorizationContext,
  ): Promise<StudentCommandResult<EditableEnrollment>>;
}
