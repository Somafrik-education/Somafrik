import { useCallback, useMemo, useRef, useState } from "react";
import { useData } from "../context/DataContext";
import { usePermissionContext } from "../lib/usePermissionContext";
import {
  toEditableAdministrativeDetails,
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
} from "../lib/studentEditingRepository.mock";
import { collectStudentGuardianRelationRecords } from "../lib/studentGuardian";
import type { StudentWorkspaceCommandRepository } from "../lib/studentEditingRepository";
import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentEditAuthorizationContext,
} from "../lib/studentEditing";

export interface StudentEditingContextValue {
  identity: EditableStudentIdentity | null;
  guardians: EditableGuardianContact[];
  administrative: EditableStudentAdministrativeDetails | null;
  authContext: StudentEditAuthorizationContext;
  repository: StudentWorkspaceCommandRepository;
  canUpdateIdentity: boolean;
  canUpdateGuardians: boolean;
  canUpdateAdministrative: boolean;
  /** À appeler après un succès d'édition pour relire le store mock. */
  refreshFromStore: () => void;
}

/**
 * Contexte d'édition C1.7 : snapshots versionnés + repository mock isolé.
 * Les agrégats du DataContext ne sont pas mutés directement.
 */
export function useStudentEditingContext(
  studentId: string,
): StudentEditingContextValue {
  const { state } = useData();
  const permissionCtx = usePermissionContext();
  const storeRef = useRef(createMockEditingStore());
  const repositoryRef = useRef(
    createMockStudentWorkspaceCommandRepository(storeRef.current),
  );
  const seededForStudent = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);

  const refreshFromStore = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  return useMemo(() => {
    const normalizedId = studentId.trim();
    const student = state.students.find((item) => item.id === normalizedId);
    const schoolCode = student?.schoolCode?.trim() || "";
    const authContext = toEditAuthorizationContext(permissionCtx, schoolCode);

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

    if (!student) {
      return {
        identity: null,
        guardians: [],
        administrative: null,
        authContext,
        repository: repositoryRef.current,
        canUpdateIdentity,
        canUpdateGuardians,
        canUpdateAdministrative,
        refreshFromStore,
      };
    }

    if (seededForStudent.current !== student.id) {
      storeRef.current.identities.clear();
      storeRef.current.guardians.clear();
      storeRef.current.administrative.clear();
      seededForStudent.current = student.id;

      const person =
        (state.persons ?? []).find((item) => item.id === student.personId) ??
        null;
      storeRef.current.identities.set(
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
        storeRef.current.guardians.set(
          `${student.id}:${relation.id}`,
          toEditableGuardianContact({ relation, schoolCode }),
        );
      }

      storeRef.current.administrative.set(
        student.id,
        toEditableAdministrativeDetails({
          studentId: student.id,
          schoolCode,
          administrativeNotes: student.observations?.trim() || null,
          preferredContactChannel: null,
          updatedAt: student.updatedAt,
        }),
      );
    }

    const guardians = [...storeRef.current.guardians.values()].filter(
      (item) => item.studentId === student.id,
    );

    return {
      identity: storeRef.current.identities.get(student.id) ?? null,
      guardians,
      administrative: storeRef.current.administrative.get(student.id) ?? null,
      authContext,
      repository: repositoryRef.current,
      canUpdateIdentity,
      canUpdateGuardians,
      canUpdateAdministrative,
      refreshFromStore,
    };
  }, [studentId, state, permissionCtx, revision, refreshFromStore]);
}
