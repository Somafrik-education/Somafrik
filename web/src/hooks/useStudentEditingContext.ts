import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../context/DataContext";
import { usePermissionContext } from "../lib/usePermissionContext";
import {
  fromEditableEnrollment,
  toEditableAdministrativeDetails,
  toEditableEnrollment,
  toEditableGuardianContact,
  toEditableStudentIdentity,
} from "../lib/studentEditingAdapters";
import {
  canUpdateStudentWorkspace,
  toEditAuthorizationContext,
} from "../lib/studentEditingPermissions";
import {
  createMockEditingStore,
  createMockStudentWorkspaceCommandRepository,
  type MockEditingStore,
} from "../lib/studentEditingRepository.mock";
import { collectStudentEnrollmentRecords } from "../lib/studentEnrollment";
import { collectStudentGuardianRelationRecords } from "../lib/studentGuardian";
import type { StudentWorkspaceCommandRepository } from "../lib/studentEditingRepository";
import type {
  EditableEnrollment,
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  SchoolClassCatalogEntry,
  StudentEditAuthorizationContext,
} from "../lib/studentEditing";
import type { StudentEnrollmentRecord } from "../lib/studentEnrollment";

export interface StudentEditingContextValue {
  identity: EditableStudentIdentity | null;
  guardians: EditableGuardianContact[];
  administrative: EditableStudentAdministrativeDetails | null;
  enrollments: EditableEnrollment[];
  schoolClasses: SchoolClassCatalogEntry[];
  authContext: StudentEditAuthorizationContext;
  repository: StudentWorkspaceCommandRepository;
  canUpdateIdentity: boolean;
  canUpdateGuardians: boolean;
  canUpdateAdministrative: boolean;
  canValidateEnrollment: boolean;
  canAssignEnrollmentClass: boolean;
  canTransferEnrollment: boolean;
  canCloseEnrollment: boolean;
  /** Inscriptions C1.2 reconstruites depuis le store (overlay dossier). */
  enrollmentRecords: StudentEnrollmentRecord[];
  /** À appeler après un succès d'édition pour relire le store mock. */
  refreshFromStore: () => void;
}

interface SharedEditingSession {
  store: MockEditingStore;
  repository: StudentWorkspaceCommandRepository;
  seededStudentId: string | null;
  listeners: Set<() => void>;
}

/** Une session mock par élève — partagée entre les onglets du dossier. */
const sessionsByStudent = new Map<string, SharedEditingSession>();

/** Réservé aux tests / démo — force un re-seed depuis le DataContext. */
export function resetStudentEditingSessionsForTests(): void {
  sessionsByStudent.clear();
}

function getSharedSession(studentId: string): SharedEditingSession {
  const key = studentId.trim() || "__empty__";
  let session = sessionsByStudent.get(key);
  if (!session) {
    const store = createMockEditingStore();
    session = {
      store,
      repository: createMockStudentWorkspaceCommandRepository(store),
      seededStudentId: null,
      listeners: new Set(),
    };
    sessionsByStudent.set(key, session);
  }
  return session;
}

/**
 * Contexte d'édition C1.7 / C1.8a : snapshots versionnés + repository mock isolé.
 * Les agrégats du DataContext ne sont pas mutés directement.
 */
export function useStudentEditingContext(
  studentId: string,
): StudentEditingContextValue {
  const { state } = useData();
  const permissionCtx = usePermissionContext();
  const session = getSharedSession(studentId);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [revision, setRevision] = useState(0);

  const refreshFromStore = useCallback(() => {
    const current = sessionRef.current;
    for (const listener of current.listeners) {
      listener();
    }
  }, []);

  // Abonnement multi-onglets : une mutation dans Inscription rafraîchit Historique.
  useEffect(() => {
    const listener = () => setRevision((value) => value + 1);
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }, [session]);

  return useMemo(() => {
    const normalizedId = studentId.trim();
    const student = state.students.find((item) => item.id === normalizedId);
    const schoolCode = student?.schoolCode?.trim() || "";
    const authContext = toEditAuthorizationContext(permissionCtx, schoolCode);
    const store = session.store;

    const canUpdateIdentity = canUpdateStudentWorkspace(
      permissionCtx,
      "student.identity.update",
    );
    const canUpdateGuardians = canUpdateStudentWorkspace(
      permissionCtx,
      "student.guardians.update",
    );
    const canUpdateAdministrative = canUpdateStudentWorkspace(
      permissionCtx,
      "student.administrative.update",
    );
    const canValidateEnrollment = canUpdateStudentWorkspace(
      permissionCtx,
      "student.enrollments.validate",
    );
    const canAssignEnrollmentClass = canUpdateStudentWorkspace(
      permissionCtx,
      "student.enrollments.assign-class",
    );
    const canTransferEnrollment = canUpdateStudentWorkspace(
      permissionCtx,
      "student.enrollments.transfer",
    );
    const canCloseEnrollment = canUpdateStudentWorkspace(
      permissionCtx,
      "student.enrollments.close",
    );

    if (!student) {
      return {
        identity: null,
        guardians: [],
        administrative: null,
        enrollments: [],
        schoolClasses: [],
        authContext,
        repository: session.repository,
        canUpdateIdentity,
        canUpdateGuardians,
        canUpdateAdministrative,
        canValidateEnrollment,
        canAssignEnrollmentClass,
        canTransferEnrollment,
        canCloseEnrollment,
        enrollmentRecords: [],
        refreshFromStore,
      };
    }

    if (session.seededStudentId !== student.id) {
      store.identities.clear();
      store.guardians.clear();
      store.administrative.clear();
      store.enrollments.clear();
      store.schoolClasses.clear();
      store.auditLog.length = 0;
      session.seededStudentId = student.id;

      const person =
        (state.persons ?? []).find((item) => item.id === student.personId) ??
        null;
      store.identities.set(
        student.id,
        toEditableStudentIdentity({ student, person, schoolCode }),
      );

      const relations = collectStudentGuardianRelationRecords({
        student,
        guardians: state.guardians,
        guardianRelations: state.studentGuardianRelations,
        persons: state.persons ?? [],
      });
      for (const relation of relations) {
        store.guardians.set(
          `${student.id}:${relation.id}`,
          toEditableGuardianContact({ relation, schoolCode }),
        );
      }

      store.administrative.set(
        student.id,
        toEditableAdministrativeDetails({
          studentId: student.id,
          schoolCode,
          administrativeNotes: student.observations?.trim() || null,
          preferredContactChannel: null,
          updatedAt: student.updatedAt,
        }),
      );

      const schoolName =
        (state.schools ?? []).find(
          (item) =>
            String(item.code ?? "").trim().toLowerCase() ===
            schoolCode.toLowerCase(),
        )?.name ?? null;

      const enrollmentRecords = collectStudentEnrollmentRecords({
        student,
        enrollments: state.studentEnrollments ?? [],
        schoolName: schoolName ? String(schoolName) : null,
      });
      for (const record of enrollmentRecords) {
        store.enrollments.set(
          `${student.id}:${record.id}`,
          toEditableEnrollment(record),
        );
      }

      for (const row of state.classes ?? []) {
        const record = row as { id?: unknown; name?: unknown; schoolCode?: unknown };
        const id = String(record.id ?? "").trim();
        const name = String(record.name ?? "").trim();
        const classSchool = String(record.schoolCode ?? schoolCode).trim();
        if (!id || !name) continue;
        if (classSchool.toLowerCase() !== schoolCode.toLowerCase()) continue;
        store.schoolClasses.set(id, {
          id,
          name,
          schoolCode: classSchool,
        });
      }
    }

    const guardians = [...store.guardians.values()].filter(
      (item) => item.studentId === student.id,
    );
    const enrollments = [...store.enrollments.values()].filter(
      (item) => item.studentId === student.id,
    );
    const schoolClasses = [...store.schoolClasses.values()].filter(
      (item) =>
        item.schoolCode.trim().toLowerCase() === schoolCode.toLowerCase(),
    );

    return {
      identity: store.identities.get(student.id) ?? null,
      guardians,
      administrative: store.administrative.get(student.id) ?? null,
      enrollments,
      schoolClasses,
      authContext,
      repository: session.repository,
      canUpdateIdentity,
      canUpdateGuardians,
      canUpdateAdministrative,
      canValidateEnrollment,
      canAssignEnrollmentClass,
      canTransferEnrollment,
      canCloseEnrollment,
      enrollmentRecords: enrollments.map(fromEditableEnrollment),
      refreshFromStore,
    };
  }, [studentId, state, permissionCtx, revision, refreshFromStore, session]);
}
