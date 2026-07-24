/**
 * Orchestration d'exécution des commandes C1.7 / C1.8a.
 * Ne mute jamais l'historique : après succès, les agrégats mis à jour
 * pourront être re-projetés (C1.6).
 */

import type {
  EditableEnrollment,
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentBusinessAuditEvent,
  StudentCommandFailure,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "./studentEditing";
import type { StudentChangeSet } from "./studentEditingChangeSet";
import {
  buildChangeSetForCommand,
  formatTransferDestinationNote,
  listUnsupportedFields,
  normalizeAdministrativeChanges,
  normalizeEnrollmentClassChanges,
  normalizeGuardianContactChanges,
  normalizeIdentityChanges,
  normalizeOptionalText,
} from "./studentEditingChangeSet";
import type { StudentWorkspaceCommand } from "./studentEditingCommands";
import {
  assertSameSchool,
  canUpdateStudentWorkspace,
  permissionForCommand,
} from "./studentEditingPermissions";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import {
  resolveSchoolClass,
  validateStudentWorkspaceCommand,
} from "./studentEditingValidation";
import {
  ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS,
  ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS,
  ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  ALLOWED_IDENTITY_CHANGE_FIELDS,
} from "./studentEditing";
import {
  nextStatusAfterAssignClass,
  nextStatusAfterClose,
  nextStatusAfterTransfer,
  nextStatusAfterValidate,
} from "./studentEnrollmentTransitions";

function failure(
  code: StudentCommandFailure["code"],
  errors: StudentCommandFailure["errors"],
  conflict?: StudentCommandFailure["conflict"],
): StudentCommandFailure {
  return { success: false, code, errors, conflict };
}

function createAuditEvent(
  command: StudentWorkspaceCommand,
  context: StudentEditAuthorizationContext,
  changeSet: StudentChangeSet,
  occurredAt: string,
): StudentBusinessAuditEvent {
  return {
    id: `audit-${command.type}-${command.studentId}-${occurredAt}`,
    studentId: command.studentId,
    commandType: command.type,
    actorId: context.userId,
    actorRole: context.role,
    occurredAt,
    changedFields: changeSet.changes.map((item) => item.field),
    reason: command.reason ?? null,
    visibility: "ADMIN",
  };
}

async function loadCurrent(
  repository: StudentWorkspaceCommandRepository,
  command: StudentWorkspaceCommand,
): Promise<
  | EditableStudentIdentity
  | EditableGuardianContact
  | EditableStudentAdministrativeDetails
  | EditableEnrollment
  | null
> {
  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return repository.getStudentIdentity(command.studentId);
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return repository.getGuardianContact(command.studentId, command.relationId);
  }
  if (
    command.type === "VALIDATE_ENROLLMENT" ||
    command.type === "ASSIGN_ENROLLMENT_CLASS" ||
    command.type === "TRANSFER_ENROLLMENT" ||
    command.type === "CLOSE_ENROLLMENT"
  ) {
    return repository.getEnrollment(command.studentId, command.enrollmentId);
  }
  return repository.getAdministrativeDetails(command.studentId);
}

function allowedFieldsForCommand(
  command: StudentWorkspaceCommand,
): readonly string[] | null {
  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return ALLOWED_IDENTITY_CHANGE_FIELDS;
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS;
  }
  if (command.type === "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS") {
    return ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS;
  }
  if (command.type === "ASSIGN_ENROLLMENT_CLASS") {
    return ALLOWED_ENROLLMENT_CLASS_CHANGE_FIELDS;
  }
  if (command.type === "TRANSFER_ENROLLMENT") {
    return ALLOWED_ENROLLMENT_TRANSFER_CHANGE_FIELDS;
  }
  return null;
}

function isEnrollmentCommand(
  command: StudentWorkspaceCommand,
): boolean {
  return (
    command.type === "VALIDATE_ENROLLMENT" ||
    command.type === "ASSIGN_ENROLLMENT_CLASS" ||
    command.type === "TRANSFER_ENROLLMENT" ||
    command.type === "CLOSE_ENROLLMENT"
  );
}

/**
 * Point d'entrée unique : validate → ChangeSet → permission → version → apply.
 */
export async function executeStudentUpdateCommand(
  command: StudentWorkspaceCommand,
  context: StudentEditAuthorizationContext,
  repository: StudentWorkspaceCommandRepository,
  options: { referenceDate?: Date; now?: string } = {},
): Promise<StudentCommandResult> {
  const permission = permissionForCommand(command);
  if (!canUpdateStudentWorkspace(context, permission)) {
    return failure("PERMISSION_DENIED", [
      {
        field: null,
        code: "PERMISSION_DENIED",
        message: "Permission insuffisante pour cette modification.",
      },
    ]);
  }

  const current = await loadCurrent(repository, command);
  if (!current) {
    return failure("NOT_FOUND", [
      {
        field: null,
        code: "NOT_FOUND",
        message: "Ressource introuvable.",
      },
    ]);
  }

  if (!assertSameSchool(context.schoolCode, current.schoolCode)) {
    return failure("PERMISSION_DENIED", [
      {
        field: null,
        code: "CROSS_SCHOOL",
        message: "Modification interdite hors établissement.",
      },
    ]);
  }

  if (current.version !== command.expectedVersion) {
    return failure(
      "VERSION_CONFLICT",
      [
        {
          field: null,
          code: "VERSION_CONFLICT",
          message:
            "Le dossier a été modifié par un autre utilisateur. Rechargez les données avant de réessayer.",
        },
      ],
      {
        code: "VERSION_CONFLICT",
        expectedVersion: command.expectedVersion,
        currentVersion: current.version,
        currentUpdatedAt: current.updatedAt,
      },
    );
  }

  const siblings =
    command.type === "UPDATE_GUARDIAN_CONTACT"
      ? await repository.listGuardianContacts(command.studentId)
      : [];

  const schoolClasses =
    command.type === "ASSIGN_ENROLLMENT_CLASS"
      ? await repository.listSchoolClasses(current.schoolCode)
      : [];

  const allowedFields = allowedFieldsForCommand(command);
  if (allowedFields && "changes" in command) {
    const unsupported = listUnsupportedFields(
      command.changes as Record<string, unknown>,
      allowedFields,
    );
    if (unsupported.length > 0) {
      return failure(
        "UNSUPPORTED_FIELD",
        unsupported.map((field) => ({
          field,
          code: "UNSUPPORTED_FIELD",
          message: `Champ non autorisé : ${field}`,
        })),
      );
    }
  }

  const now = options.now ?? new Date().toISOString();
  const changeSet = buildChangeSetForCommand(command, current, { now });
  if (changeSet.isEmpty) {
    return failure("NO_CHANGES", [
      {
        field: null,
        code: "NO_CHANGES",
        message: "Aucun changement réel à enregistrer.",
      },
    ]);
  }

  const validation = validateStudentWorkspaceCommand(command, {
    identity:
      command.type === "UPDATE_STUDENT_IDENTITY"
        ? (current as EditableStudentIdentity)
        : null,
    guardian:
      command.type === "UPDATE_GUARDIAN_CONTACT"
        ? (current as EditableGuardianContact)
        : null,
    administrative:
      command.type === "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS"
        ? (current as EditableStudentAdministrativeDetails)
        : null,
    enrollment: isEnrollmentCommand(command)
      ? (current as EditableEnrollment)
      : null,
    siblingGuardians: siblings,
    schoolClasses,
    referenceDate: options.referenceDate,
    changeSet,
  });

  if (!validation.valid) {
    const unsupported = validation.errors.some(
      (item) => item.code === "UNSUPPORTED_FIELD",
    );
    return failure(
      unsupported ? "UNSUPPORTED_FIELD" : "VALIDATION_ERROR",
      validation.errors,
    );
  }

  // Délègue l'application au repository (pas d'optimistic UI définitive ici).
  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return repository.updateStudentIdentity(command, context);
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return repository.updateGuardianContact(command, context);
  }
  if (command.type === "VALIDATE_ENROLLMENT") {
    return repository.validateEnrollment(command, context);
  }
  if (command.type === "ASSIGN_ENROLLMENT_CLASS") {
    return repository.assignEnrollmentClass(command, context);
  }
  if (command.type === "TRANSFER_ENROLLMENT") {
    return repository.transferEnrollment(command, context);
  }
  if (command.type === "CLOSE_ENROLLMENT") {
    return repository.closeEnrollment(command, context);
  }
  return repository.updateAdministrativeDetails(command, context);
}

/** Applique les changements normalisés en mémoire (utilisé par le mock). */
export function applyIdentityChanges(
  current: EditableStudentIdentity,
  command: Extract<StudentWorkspaceCommand, { type: "UPDATE_STUDENT_IDENTITY" }>,
  updatedAt: string,
): EditableStudentIdentity {
  const changes = normalizeIdentityChanges(command.changes);
  return {
    ...current,
    ...changes,
    firstName: changes.firstName ?? current.firstName,
    lastName: changes.lastName ?? current.lastName,
    version: current.version + 1,
    updatedAt,
  };
}

export function applyGuardianContactChanges(
  current: EditableGuardianContact,
  command: Extract<StudentWorkspaceCommand, { type: "UPDATE_GUARDIAN_CONTACT" }>,
  updatedAt: string,
): EditableGuardianContact {
  const changes = normalizeGuardianContactChanges(command.changes);
  return {
    ...current,
    phone: "phone" in changes ? changes.phone ?? null : current.phone,
    email: "email" in changes ? changes.email ?? null : current.email,
    address: "address" in changes ? changes.address ?? null : current.address,
    isEmergencyContact:
      "isEmergencyContact" in changes
        ? Boolean(changes.isEmergencyContact)
        : current.isEmergencyContact,
    pickupAuthorized:
      "pickupAuthorized" in changes
        ? Boolean(changes.pickupAuthorized)
        : current.pickupAuthorized,
    priority:
      "priority" in changes && changes.priority != null
        ? changes.priority
        : current.priority,
    version: current.version + 1,
    updatedAt,
  };
}

export function applyAdministrativeChanges(
  current: EditableStudentAdministrativeDetails,
  command: Extract<
    StudentWorkspaceCommand,
    { type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS" }
  >,
  updatedAt: string,
): EditableStudentAdministrativeDetails {
  const changes = normalizeAdministrativeChanges(command.changes);
  return {
    ...current,
    administrativeNotes:
      "administrativeNotes" in changes
        ? changes.administrativeNotes ?? null
        : current.administrativeNotes,
    preferredContactChannel:
      "preferredContactChannel" in changes
        ? changes.preferredContactChannel ?? null
        : current.preferredContactChannel,
    version: current.version + 1,
    updatedAt,
  };
}

export function applyValidateEnrollment(
  current: EditableEnrollment,
  updatedAt: string,
): EditableEnrollment {
  return {
    ...current,
    status: nextStatusAfterValidate(),
    validatedAt: current.validatedAt ?? updatedAt.slice(0, 10),
    version: current.version + 1,
    updatedAt,
  };
}

export function applyAssignEnrollmentClass(
  current: EditableEnrollment,
  command: Extract<
    StudentWorkspaceCommand,
    { type: "ASSIGN_ENROLLMENT_CLASS" }
  >,
  updatedAt: string,
  schoolClasses: readonly import("./studentEditing").SchoolClassCatalogEntry[],
): EditableEnrollment {
  const changes = normalizeEnrollmentClassChanges(command.changes);
  const resolved = resolveSchoolClass(
    {
      classId: "classId" in changes ? changes.classId : current.classId,
      className: "className" in changes ? changes.className : current.className,
    },
    schoolClasses,
    current.schoolCode,
  );

  if (!resolved.ok) {
    // La validation amont doit empêcher ce cas ; conserver l'agrégat inchangé
    // côté structure pour éviter un état partiel.
    return current;
  }

  const nextStatus =
    current.status === "APPROVED" || current.status === "ENROLLED"
      ? nextStatusAfterAssignClass(current.status)
      : current.status;

  return {
    ...current,
    classId: resolved.classId,
    className: resolved.className,
    status: nextStatus,
    enrolledAt: current.enrolledAt ?? updatedAt.slice(0, 10),
    version: current.version + 1,
    updatedAt,
  };
}

export function applyTransferEnrollment(
  current: EditableEnrollment,
  command: Extract<StudentWorkspaceCommand, { type: "TRANSFER_ENROLLMENT" }>,
  updatedAt: string,
): EditableEnrollment {
  const target = normalizeOptionalText(command.changes.targetSchoolName);
  if (!target) {
    return current;
  }
  return {
    ...current,
    status: nextStatusAfterTransfer(),
    endedAt: current.endedAt ?? updatedAt.slice(0, 10),
    notes: formatTransferDestinationNote(target),
    version: current.version + 1,
    updatedAt,
  };
}

export function applyCloseEnrollment(
  current: EditableEnrollment,
  updatedAt: string,
): EditableEnrollment {
  return {
    ...current,
    status: nextStatusAfterClose(),
    endedAt: current.endedAt ?? updatedAt.slice(0, 10),
    version: current.version + 1,
    updatedAt,
  };
}

export { createAuditEvent };
