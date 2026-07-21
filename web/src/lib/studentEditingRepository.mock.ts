/**
 * Implémentation simulée du repository C1.7 — séparée de la logique métier.
 * Ne pas importer ce fichier depuis la logique de validation / ChangeSet.
 */

import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "./studentEditing";
import { buildChangeSetForCommand } from "./studentEditingChangeSet";
import type {
  UpdateGuardianContactCommand,
  UpdateStudentAdministrativeDetailsCommand,
  UpdateStudentIdentityCommand,
} from "./studentEditingCommands";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import {
  applyAdministrativeChanges,
  applyGuardianContactChanges,
  applyIdentityChanges,
  createAuditEvent,
} from "./studentEditingService";

export interface MockEditingStore {
  identities: Map<string, EditableStudentIdentity>;
  guardians: Map<string, EditableGuardianContact>;
  administrative: Map<string, EditableStudentAdministrativeDetails>;
  auditLog: ReturnType<typeof createAuditEvent>[];
}

export function createMockEditingStore(
  seed?: {
    identities?: EditableStudentIdentity[];
    guardians?: EditableGuardianContact[];
    administrative?: EditableStudentAdministrativeDetails[];
  },
): MockEditingStore {
  const store: MockEditingStore = {
    identities: new Map(),
    guardians: new Map(),
    administrative: new Map(),
    auditLog: [],
  };
  for (const item of seed?.identities ?? []) {
    store.identities.set(item.studentId, structuredClone(item));
  }
  for (const item of seed?.guardians ?? []) {
    store.guardians.set(`${item.studentId}:${item.relationId}`, structuredClone(item));
  }
  for (const item of seed?.administrative ?? []) {
    store.administrative.set(item.studentId, structuredClone(item));
  }
  return store;
}

function guardianKey(studentId: string, relationId: string): string {
  return `${studentId}:${relationId}`;
}

export function createMockStudentWorkspaceCommandRepository(
  store: MockEditingStore,
  options: { now?: () => Date | string } = {},
): StudentWorkspaceCommandRepository {
  const now = () => {
    const value = options.now ? options.now() : new Date();
    return typeof value === "string" ? value : value.toISOString();
  };

  return {
    async getStudentIdentity(studentId) {
      return store.identities.get(studentId.trim()) ?? null;
    },

    async getGuardianContact(studentId, relationId) {
      return (
        store.guardians.get(guardianKey(studentId.trim(), relationId.trim())) ??
        null
      );
    },

    async listGuardianContacts(studentId) {
      const id = studentId.trim();
      return [...store.guardians.values()].filter(
        (item) => item.studentId === id,
      );
    },

    async getAdministrativeDetails(studentId) {
      return store.administrative.get(studentId.trim()) ?? null;
    },

    async updateStudentIdentity(command, context) {
      return applyUpdate({
        store,
        context,
        command,
        load: () => store.identities.get(command.studentId) ?? null,
        apply: (current, at) => applyIdentityChanges(current, command, at),
        save: (next) => store.identities.set(next.studentId, next),
        now,
      });
    },

    async updateGuardianContact(command, context) {
      return applyUpdate({
        store,
        context,
        command,
        load: () =>
          store.guardians.get(
            guardianKey(command.studentId, command.relationId),
          ) ?? null,
        apply: (current, at) =>
          applyGuardianContactChanges(current, command, at),
        save: (next) =>
          store.guardians.set(
            guardianKey(next.studentId, next.relationId),
            next,
          ),
        now,
      });
    },

    async updateAdministrativeDetails(command, context) {
      return applyUpdate({
        store,
        context,
        command,
        load: () => store.administrative.get(command.studentId) ?? null,
        apply: (current, at) =>
          applyAdministrativeChanges(current, command, at),
        save: (next) => store.administrative.set(next.studentId, next),
        now,
      });
    },
  };
}

function applyUpdate<
  TCommand extends
    | UpdateStudentIdentityCommand
    | UpdateGuardianContactCommand
    | UpdateStudentAdministrativeDetailsCommand,
  TAggregate extends {
    version: number;
    updatedAt: string;
    schoolCode: string;
    studentId: string;
  },
>(input: {
  store: MockEditingStore;
  context: StudentEditAuthorizationContext;
  command: TCommand;
  load: () => TAggregate | null;
  apply: (current: TAggregate, updatedAt: string) => TAggregate;
  save: (next: TAggregate) => void;
  now: () => string;
}): StudentCommandResult<TAggregate> {
  const current = input.load();
  if (!current) {
    return {
      success: false,
      code: "NOT_FOUND",
      errors: [
        { field: null, code: "NOT_FOUND", message: "Ressource introuvable." },
      ],
    };
  }

  if (current.version !== input.command.expectedVersion) {
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
        expectedVersion: input.command.expectedVersion,
        currentVersion: current.version,
        currentUpdatedAt: current.updatedAt,
      },
    };
  }

  const changeSet = buildChangeSetForCommand(input.command, current as never);
  if (changeSet.isEmpty) {
    return {
      success: false,
      code: "NO_CHANGES",
      errors: [
        {
          field: null,
          code: "NO_CHANGES",
          message: "Aucun changement réel à enregistrer.",
        },
      ],
    };
  }

  const updatedAt = input.now();
  const next = input.apply(current, updatedAt);
  input.save(next);

  const auditEvent = createAuditEvent(
    input.command,
    input.context,
    changeSet,
    updatedAt,
  );
  input.store.auditLog.push(auditEvent);

  return {
    success: true,
    updatedAggregate: next,
    changeSet,
    auditEvent,
    newVersion: next.version,
    updatedAt,
  };
}

/** Helpers de seed pour les tests / UI. */
export function seedEditableIdentity(
  partial: Partial<EditableStudentIdentity> &
    Pick<EditableStudentIdentity, "studentId" | "schoolCode">,
): EditableStudentIdentity {
  return {
    matricule: partial.matricule ?? "M-001",
    version: partial.version ?? 1,
    updatedAt: partial.updatedAt ?? "2026-07-01T00:00:00.000Z",
    firstName: partial.firstName ?? "Amina",
    lastName: partial.lastName ?? "Kabila",
    preferredName: partial.preferredName ?? null,
    gender: partial.gender ?? "F",
    birthDate: partial.birthDate ?? "2012-03-15",
    birthPlace: partial.birthPlace ?? "Kinshasa",
    nationality: partial.nationality ?? "Congolaise",
    address: partial.address ?? "Gombe",
    phone: partial.phone ?? "+243800000000",
    email: partial.email ?? "amina@example.com",
    ...partial,
  };
}

export function seedEditableGuardian(
  partial: Partial<EditableGuardianContact> &
    Pick<
      EditableGuardianContact,
      "studentId" | "schoolCode" | "relationId" | "guardianId"
    >,
): EditableGuardianContact {
  return {
    displayName: partial.displayName ?? "Marie Test",
    version: partial.version ?? 1,
    updatedAt: partial.updatedAt ?? "2026-07-01T00:00:00.000Z",
    isActive: partial.isActive ?? true,
    phone: partial.phone ?? "+243811111111",
    email: partial.email ?? "marie@example.com",
    address: partial.address ?? null,
    isEmergencyContact: partial.isEmergencyContact ?? false,
    pickupAuthorized: partial.pickupAuthorized ?? false,
    priority: partial.priority ?? 1,
    ...partial,
  };
}

export function seedEditableAdministrative(
  partial: Partial<EditableStudentAdministrativeDetails> &
    Pick<EditableStudentAdministrativeDetails, "studentId" | "schoolCode">,
): EditableStudentAdministrativeDetails {
  return {
    version: partial.version ?? 1,
    updatedAt: partial.updatedAt ?? "2026-07-01T00:00:00.000Z",
    administrativeNotes: partial.administrativeNotes ?? null,
    preferredContactChannel: partial.preferredContactChannel ?? null,
    ...partial,
  };
}
