import { ApiError } from "../api/client";
import { toApiDate } from "./dates";
import type {
  EditableStudentIdentity,
  StudentCommandFailure,
  StudentCommandResult,
  StudentGender,
} from "./studentEditing";
import { buildChangeSetForCommand } from "./studentEditingChangeSet";
import type { UpdateStudentIdentityCommand } from "./studentEditingCommands";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import {
  studentsApi,
  type SchoolStudent,
  type UpdateSchoolStudentPayload,
} from "./studentsApi";
import { toEditableStudentIdentityFromDossier } from "./studentEditingAdapters";

/** Champs C1.7 réellement portés par PATCH /api/students/:id. */
export const PERSISTABLE_IDENTITY_PATCH_FIELDS = [
  "firstName",
  "lastName",
  "gender",
  "birthDate",
  "birthPlace",
  "phone",
  "email",
] as const;

export type PersistableIdentityPatchField =
  (typeof PERSISTABLE_IDENTITY_PATCH_FIELDS)[number];

const PERSISTABLE = new Set<string>(PERSISTABLE_IDENTITY_PATCH_FIELDS);

export function isPersistableIdentityPatchField(
  field: string,
): field is PersistableIdentityPatchField {
  return PERSISTABLE.has(field);
}

/** UI C1.7 (F/M/OTHER) → contrat PATCH PostgreSQL. */
export function toSchoolStudentApiGender(
  gender: StudentGender | null | undefined,
): string | null {
  if (gender === "M") return "Masculin";
  if (gender === "F") return "Féminin";
  if (gender === "OTHER") return "Autre";
  return null;
}

export function buildIdentityPatchPayload(
  command: UpdateStudentIdentityCommand,
  current: EditableStudentIdentity,
): { ok: true; payload: UpdateSchoolStudentPayload } | { ok: false; message: string } {
  const expectedUpdatedAt = String(current.updatedAt ?? "").trim();
  if (!expectedUpdatedAt) {
    return {
      ok: false,
      message:
        "Jeton de conflit manquant (updatedAt). Rechargez la fiche puis réessayez.",
    };
  }

  const changes = command.changes;
  const payload: UpdateSchoolStudentPayload = { expectedUpdatedAt };
  let hasPatch = false;

  if (Object.prototype.hasOwnProperty.call(changes, "firstName")) {
    payload.firstName = String(changes.firstName ?? "").trim();
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "lastName")) {
    payload.lastName = String(changes.lastName ?? "").trim();
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "gender")) {
    payload.gender = toSchoolStudentApiGender(changes.gender ?? null);
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "birthDate")) {
    const apiDate = toApiDate(changes.birthDate ?? null);
    payload.birthDate = apiDate || null;
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "birthPlace")) {
    payload.birthPlace = String(changes.birthPlace ?? "").trim() || null;
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "phone")) {
    payload.parentPhone = changes.phone ?? null;
    hasPatch = true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "email")) {
    payload.parentEmail = changes.email ?? null;
    hasPatch = true;
  }

  if (!hasPatch) {
    return {
      ok: false,
      message:
        "Aucun champ persistable : nationalité, adresse et nom d'usage ne sont pas encore enregistrés côté PostgreSQL.",
    };
  }

  return { ok: true, payload };
}

function deriveVersion(updatedAt: string | null | undefined): number {
  if (!updatedAt) return 1;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 1;
  return Math.max(1, Math.floor(ts / 1000) % 1_000_000_000);
}

function httpFailure(error: unknown): StudentCommandFailure {
  const status = error instanceof ApiError ? error.status : 0;
  const message =
    error instanceof Error
      ? error.message
      : "Modification d'identité refusée par le serveur.";
  const errors = [{ field: null, code: "IDENTITY_HTTP", message }];
  if (status === 403) return { success: false, code: "PERMISSION_DENIED", errors };
  if (status === 404) return { success: false, code: "NOT_FOUND", errors };
  if (status === 409) {
    return {
      success: false,
      code: "VERSION_CONFLICT",
      errors: [
        {
          field: null,
          code: "VERSION_CONFLICT",
          message:
            "Le dossier a été modifié par un autre utilisateur. Rechargez les données avant de réessayer.",
        },
      ],
      conflict: {
        code: "VERSION_CONFLICT",
        expectedVersion: 0,
        currentVersion: 0,
        currentUpdatedAt: "",
      },
    };
  }
  return { success: false, code: "VALIDATION_ERROR", errors };
}

function successFromDossier(
  dossier: SchoolStudent,
  command: UpdateStudentIdentityCommand,
  current: EditableStudentIdentity,
  contextActor: { userId: string; role: string },
): StudentCommandResult<EditableStudentIdentity> {
  const updated = toEditableStudentIdentityFromDossier(dossier);
  const changeSet = buildChangeSetForCommand(command, current);
  const occurredAt = updated.updatedAt;
  return {
    success: true,
    updatedAggregate: updated,
    newVersion: updated.version || deriveVersion(occurredAt),
    updatedAt: occurredAt,
    changeSet,
    auditEvent: {
      id: `identity-${updated.studentId}-${occurredAt}`,
      studentId: updated.studentId,
      commandType: "UPDATE_STUDENT_IDENTITY",
      actorId: contextActor.userId,
      actorRole: contextActor.role,
      occurredAt,
      changedFields: changeSet.changes.map((item) => item.field),
      reason: command.reason ?? null,
      visibility: "ADMIN",
    },
  };
}

export function wrapRepositoryWithHttpIdentity(
  base: StudentWorkspaceCommandRepository,
  options: {
    onUpdated?: (identity: EditableStudentIdentity, dossier: SchoolStudent) => void;
    onPersisted?: () => void | Promise<void>;
  } = {},
): StudentWorkspaceCommandRepository {
  return {
    ...base,
    async updateStudentIdentity(command, context) {
      const current = await base.getStudentIdentity(command.studentId);
      if (!current) {
        return {
          success: false,
          code: "NOT_FOUND",
          errors: [
            { field: null, code: "NOT_FOUND", message: "Identité introuvable." },
          ],
        };
      }

      const built = buildIdentityPatchPayload(command, current);
      if (!built.ok) {
        return {
          success: false,
          code: "VALIDATION_ERROR",
          errors: [{ field: null, code: "IDENTITY_PATCH", message: built.message }],
        };
      }

      try {
        const dossier = await studentsApi.update(command.studentId, built.payload);
        const result = successFromDossier(dossier, command, current, context);
        if (result.success) {
          options.onUpdated?.(result.updatedAggregate, dossier);
          await options.onPersisted?.();
        }
        return result;
      } catch (error) {
        return httpFailure(error);
      }
    },
  };
}

export function shouldUseHttpStudentIdentityRepository(): boolean {
  try {
    const env = import.meta.env as { VITEST?: boolean; MODE?: string };
    if (env?.VITEST) return false;
    if (env?.MODE === "test") return false;
  } catch {
    /* import.meta may be unavailable in some runners */
  }
  return true;
}
