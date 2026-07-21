import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "./studentEditing";
import type {
  UpdateGuardianContactCommand,
  UpdateStudentAdministrativeDetailsCommand,
  UpdateStudentIdentityCommand,
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
}
