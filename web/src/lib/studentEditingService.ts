/**
 * Orchestration d'exécution des commandes C1.7.
 * Ne mute jamais l'historique : après succès, les agrégats mis à jour
 * pourront être re-projetés (C1.6).
 */

import type {
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
  listUnsupportedFields,
  normalizeAdministrativeChanges,
  normalizeGuardianContactChanges,
  normalizeIdentityChanges,
} from "./studentEditingChangeSet";
import type { StudentWorkspaceCommand } from "./studentEditingCommands";
import {
  assertSameSchool,
  canUpdateStudentWorkspace,
  permissionForCommand,
} from "./studentEditingPermissions";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import { validateStudentWorkspaceCommand } from "./studentEditingValidation";
import {
  ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS,
  ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS,
  ALLOWED_IDENTITY_CHANGE_FIELDS,
} from "./studentEditing";

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
  | null
> {
  if (command.type === "UPDATE_STUDENT_IDENTITY") {
    return repository.getStudentIdentity(command.studentId);
  }
  if (command.type === "UPDATE_GUARDIAN_CONTACT") {
    return repository.getGuardianContact(command.studentId, command.relationId);
  }
  return repository.getAdministrativeDetails(command.studentId);
}

/**
 * Point d'entrée unique : validate → ChangeSet → permission → version → apply.
 */
export async function executeStudentUpdateCommand(
  command: StudentWorkspaceCommand,
  context: StudentEditAuthorizationContext,
  repository: StudentWorkspaceCommandRepository,
  options: { referenceDate?: Date } = {},
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

  const allowedFields =
    command.type === "UPDATE_STUDENT_IDENTITY"
      ? ALLOWED_IDENTITY_CHANGE_FIELDS
      : command.type === "UPDATE_GUARDIAN_CONTACT"
        ? ALLOWED_GUARDIAN_CONTACT_CHANGE_FIELDS
        : ALLOWED_ADMINISTRATIVE_CHANGE_FIELDS;
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

  const changeSet = buildChangeSetForCommand(command, current);
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
    siblingGuardians: siblings,
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

export { createAuditEvent };
