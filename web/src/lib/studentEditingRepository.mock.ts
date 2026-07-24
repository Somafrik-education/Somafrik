/**
 * Implémentation simulée du repository C1.7 / C1.8a — séparée de la logique métier.
 * Ne pas importer ce fichier depuis la logique de validation / ChangeSet.
 */

import type {
  EditableEnrollment,
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  SchoolClassCatalogEntry,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "./studentEditing";
import { buildChangeSetForCommand } from "./studentEditingChangeSet";
import type {
  AssignEnrollmentClassCommand,
  UpdateGuardianContactCommand,
  UpdateStudentAdministrativeDetailsCommand,
  UpdateStudentIdentityCommand,
  ValidateEnrollmentCommand,
} from "./studentEditingCommands";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import {
  applyAdministrativeChanges,
  applyAssignEnrollmentClass,
  applyGuardianContactChanges,
  applyIdentityChanges,
  applyValidateEnrollment,
  createAuditEvent,
} from "./studentEditingService";
import type { StudentEnrollmentSource } from "./studentEnrollment";
import type { StudentEnrollmentStatus } from "./studentEnrollmentStatus";

export interface MockEditingStore {
  identities: Map<string, EditableStudentIdentity>;
  guardians: Map<string, EditableGuardianContact>;
  administrative: Map<string, EditableStudentAdministrativeDetails>;
  enrollments: Map<string, EditableEnrollment>;
  schoolClasses: Map<string, SchoolClassCatalogEntry>;
  auditLog: ReturnType<typeof createAuditEvent>[];
}

export function createMockEditingStore(
  seed?: {
    identities?: EditableStudentIdentity[];
    guardians?: EditableGuardianContact[];
    administrative?: EditableStudentAdministrativeDetails[];
    enrollments?: EditableEnrollment[];
    schoolClasses?: SchoolClassCatalogEntry[];
  },
): MockEditingStore {
  const store: MockEditingStore = {
    identities: new Map(),
    guardians: new Map(),
    administrative: new Map(),
    enrollments: new Map(),
    schoolClasses: new Map(),
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
  for (const item of seed?.enrollments ?? []) {
    store.enrollments.set(
      enrollmentKey(item.studentId, item.enrollmentId),
      structuredClone(item),
    );
  }
  for (const item of seed?.schoolClasses ?? []) {
    store.schoolClasses.set(item.id, structuredClone(item));
  }
  return store;
}

function guardianKey(studentId: string, relationId: string): string {
  return `${studentId}:${relationId}`;
}

function enrollmentKey(studentId: string, enrollmentId: string): string {
  return `${studentId}:${enrollmentId}`;
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

    async getEnrollment(studentId, enrollmentId) {
      return (
        store.enrollments.get(
          enrollmentKey(studentId.trim(), enrollmentId.trim()),
        ) ?? null
      );
    },

    async listSchoolClasses(schoolCode) {
      const school = schoolCode.trim().toLowerCase();
      return [...store.schoolClasses.values()].filter(
        (item) => item.schoolCode.trim().toLowerCase() === school,
      );
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

    async validateEnrollment(command, context) {
      return applyUpdate({
        store,
        context,
        command,
        load: () =>
          store.enrollments.get(
            enrollmentKey(command.studentId, command.enrollmentId),
          ) ?? null,
        apply: (current, at) => applyValidateEnrollment(current, at),
        save: (next) =>
          store.enrollments.set(
            enrollmentKey(next.studentId, next.enrollmentId),
            next,
          ),
        now,
      });
    },

    async assignEnrollmentClass(command, context) {
      const schoolClasses = [...store.schoolClasses.values()];
      return applyUpdate({
        store,
        context,
        command,
        load: () =>
          store.enrollments.get(
            enrollmentKey(command.studentId, command.enrollmentId),
          ) ?? null,
        apply: (current, at) =>
          applyAssignEnrollmentClass(current, command, at, schoolClasses),
        save: (next) =>
          store.enrollments.set(
            enrollmentKey(next.studentId, next.enrollmentId),
            next,
          ),
        now,
      });
    },
  };
}

function applyUpdate<
  TCommand extends
    | UpdateStudentIdentityCommand
    | UpdateGuardianContactCommand
    | UpdateStudentAdministrativeDetailsCommand
    | ValidateEnrollmentCommand
    | AssignEnrollmentClassCommand,
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

  const updatedAt = input.now();
  const changeSet = buildChangeSetForCommand(input.command, current as never, {
    now: updatedAt,
  });
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

  const next = input.apply(current, updatedAt);
  // Garde transactionnelle : une application incomplète ne doit pas persister.
  if (next.version !== current.version + 1) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      errors: [
        {
          field: null,
          code: "APPLY_ABORTED",
          message: "Application interrompue : aucun état intermédiaire enregistré.",
        },
      ],
    };
  }

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

export function seedEditableEnrollment(
  partial: Partial<EditableEnrollment> &
    Pick<
      EditableEnrollment,
      "enrollmentId" | "studentId" | "schoolCode" | "academicYear" | "status"
    >,
): EditableEnrollment {
  const createdAt = partial.createdAt ?? "2026-01-01T00:00:00.000Z";
  return {
    version: partial.version ?? 1,
    updatedAt: partial.updatedAt ?? createdAt,
    classId: partial.classId ?? null,
    className: partial.className ?? null,
    programId: partial.programId ?? null,
    programName: partial.programName ?? null,
    source: (partial.source ?? "SCHOOL_ADMINISTRATION") as StudentEnrollmentSource,
    applicationReference: partial.applicationReference ?? null,
    requestedAt: partial.requestedAt ?? null,
    validatedAt: partial.validatedAt ?? null,
    enrolledAt: partial.enrolledAt ?? null,
    endedAt: partial.endedAt ?? null,
    previousSchoolName: partial.previousSchoolName ?? null,
    notes: partial.notes ?? null,
    schoolName: partial.schoolName ?? null,
    createdAt,
    ...partial,
  };
}

export function seedSchoolClass(
  partial: Partial<SchoolClassCatalogEntry> &
    Pick<SchoolClassCatalogEntry, "id" | "name" | "schoolCode">,
): SchoolClassCatalogEntry {
  return {
    id: partial.id,
    name: partial.name,
    schoolCode: partial.schoolCode,
  };
}

export type { StudentEnrollmentStatus };
