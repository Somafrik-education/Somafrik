import { ApiError } from "../api/client";
import type {
  EditableStudentAdministrativeDetails,
  PreferredContactChannel,
  StudentCommandFailure,
  StudentCommandResult,
} from "./studentEditing";
import { buildChangeSetForCommand, normalizeOptionalText } from "./studentEditingChangeSet";
import type { UpdateStudentAdministrativeDetailsCommand } from "./studentEditingCommands";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import { toEditableAdministrativeDetails } from "./studentEditingAdapters";
import {
  studentsApi,
  type SchoolStudent,
  type UpdateSchoolStudentPayload,
} from "./studentsApi";

const CHANNELS = new Set<PreferredContactChannel>(["PHONE", "EMAIL", "SMS"]);

function normalizeChannel(value: unknown): PreferredContactChannel | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (CHANNELS.has(text as PreferredContactChannel)) {
    return text as PreferredContactChannel;
  }
  return null;
}

/**
 * Les notes et l'identité sont deux commandes d'interface.
 * Un succès de l'une n'est jamais un succès de l'autre.
 * Un corps PATCH qui contient les deux champs est une seule écriture SQL.
 */
export function buildAdministrativeNotesPatchPayload(
  command: UpdateStudentAdministrativeDetailsCommand,
  current: EditableStudentAdministrativeDetails,
): { ok: true; payload: UpdateSchoolStudentPayload } | { ok: false; message: string } {
  const expectedUpdatedAt = String(current.updatedAt ?? "").trim();
  if (!expectedUpdatedAt) {
    return {
      ok: false,
      message: "Jeton de conflit manquant (updatedAt). Rechargez la fiche puis réessayez.",
    };
  }

  const changes = command.changes ?? {};
  if (Object.prototype.hasOwnProperty.call(changes, "preferredContactChannel")) {
    const next = normalizeChannel(changes.preferredContactChannel);
    const previous = normalizeChannel(current.preferredContactChannel);
    if (next !== previous) {
      return {
        ok: false,
        message:
          "Le canal de contact préféré n'est pas enregistré. Seules les notes administratives sont persistées.",
      };
    }
  }

  if (!Object.prototype.hasOwnProperty.call(changes, "administrativeNotes")) {
    return {
      ok: false,
      message: "Aucune note administrative à enregistrer.",
    };
  }

  return {
    ok: true,
    payload: {
      expectedUpdatedAt,
      administrativeNotes: normalizeOptionalText(changes.administrativeNotes),
    },
  };
}

function deriveVersion(updatedAt: string | null | undefined): number {
  if (!updatedAt) return 1;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 1;
  return Math.max(1, Math.floor(ts / 1000) % 1_000_000_000);
}

function httpFailure(error: unknown): StudentCommandFailure {
  const status = error instanceof ApiError ? error.status : 0;
  const raw = error instanceof Error ? error.message : "";
  const networkFailure = status === 0 || /failed to fetch|networkerror|aborted/i.test(raw);
  const message = networkFailure
    ? "Enregistrement impossible : la connexion a échoué. La saisie est conservée, vous pouvez réessayer."
    : raw || "Enregistrement des notes administratives refusé par le serveur.";
  const errors = [{ field: null, code: "ADMINISTRATIVE_HTTP", message }];
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

function notesMatch(expected: string | null, received: string | null | undefined): boolean {
  return normalizeOptionalText(expected) === normalizeOptionalText(received ?? null);
}

export function wrapRepositoryWithHttpAdministrative(
  base: StudentWorkspaceCommandRepository,
  options: {
    /** Code canonique élève (student_code). Jamais l'identifiant DataContext. */
    studentCode: string;
    onUpdated?: (details: EditableStudentAdministrativeDetails, dossier: SchoolStudent) => void;
    onPersisted?: () => void | Promise<void>;
  },
): StudentWorkspaceCommandRepository {
  return {
    ...base,
    async updateAdministrativeDetails(command, context) {
      const current = await base.getAdministrativeDetails(command.studentId);
      if (!current) {
        return {
          success: false,
          code: "NOT_FOUND",
          errors: [
            {
              field: null,
              code: "NOT_FOUND",
              message: "Détails administratifs introuvables.",
            },
          ],
        };
      }

      const studentCode = String(options.studentCode ?? "").trim();
      if (!studentCode) {
        return {
          success: false,
          code: "VALIDATION_ERROR",
          errors: [
            {
              field: null,
              code: "STUDENT_CODE",
              message: "Code élève canonique manquant. Rechargez la fiche puis réessayez.",
            },
          ],
        };
      }

      const built = buildAdministrativeNotesPatchPayload(command, current);
      if (!built.ok) {
        return {
          success: false,
          code: "VALIDATION_ERROR",
          errors: [{ field: null, code: "ADMINISTRATIVE_PATCH", message: built.message }],
        };
      }

      try {
        const dossier = await studentsApi.update(studentCode, built.payload);
        const expected = built.payload.administrativeNotes ?? null;
        if (!notesMatch(expected, dossier.administrativeNotes)) {
          return {
            success: false,
            code: "VALIDATION_ERROR",
            errors: [
              {
                field: "administrativeNotes",
                code: "PERSISTENCE_UNCONFIRMED",
                message:
                  "Le serveur n'a pas confirmé l'enregistrement des notes administratives.",
              },
            ],
          };
        }

        const updated = toEditableAdministrativeDetails({
          studentId: current.studentId,
          schoolCode: current.schoolCode,
          administrativeNotes: dossier.administrativeNotes ?? null,
          preferredContactChannel: current.preferredContactChannel,
          updatedAt: dossier.updatedAt,
        });
        const changeSet = buildChangeSetForCommand(command, current);
        const occurredAt = updated.updatedAt;
        const result: StudentCommandResult<EditableStudentAdministrativeDetails> = {
          success: true,
          updatedAggregate: updated,
          newVersion: updated.version || deriveVersion(occurredAt),
          updatedAt: occurredAt,
          changeSet,
          auditEvent: {
            id: `administrative-${updated.studentId}-${occurredAt}`,
            studentId: updated.studentId,
            commandType: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
            actorId: context.userId,
            actorRole: context.role,
            occurredAt,
            changedFields: changeSet.changes.map((item) => item.field),
            reason: command.reason ?? null,
            visibility: "ADMIN",
          },
        };
        options.onUpdated?.(updated, dossier);
        await options.onPersisted?.();
        return result;
      } catch (error) {
        return httpFailure(error);
      }
    },
  };
}
