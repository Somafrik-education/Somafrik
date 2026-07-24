/**
 * D2.8d1 — Workflow d’affectations enseignants (modale Enseignants).
 *
 * Périmètre : prepare / validate / merge / delete / audit plan pour la modale
 * d’affectations. Aucun hook ni contexte React.
 *
 * Hors lot : paiements, contacts, relations, rendu modale, buildPedagogyPatch
 * (injecté), autres workflows D2.8d*.
 */
import type { BackOfficeState, SessionUser } from "../../types";
import { appendAuditLog, auditActor, makeAuditEntry } from "../../lib/audit";
import {
  listTeacherAssignments,
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../../lib/assignments";
import { getScopedEntityRows, type SchoolEntityKey } from "../../lib/entityModules";
import { scopedClasses, scopedCourses, scopedTeachers } from "../../lib/establishment";
import {
  applyEntitySchoolScope,
  auditEntityLabel,
  deleteEntityFromState,
  mergeEntityIntoState,
  prepareEntityRowForSave,
} from "./entityCrudCore";

export type EntityRow = Record<string, unknown>;

export type ToastFn = (
  message: string,
  tone?: "info" | "success" | "error" | "warning",
) => void;

export type BuildPedagogyPatchFn = (
  key: SchoolEntityKey,
  nextItem: EntityRow,
  nextEntityRows: EntityRow[],
) => Partial<BackOfficeState>;

export type TeacherAssignmentWorkflowDeps = {
  scopeUser: SessionUser | null;
  state: BackOfficeState;
  effectiveSchoolCode: string;
  showToast: ToastFn;
  buildPedagogyPatch: BuildPedagogyPatchFn;
};

export type AssignmentField = {
  key: string;
  label: string;
  required?: boolean;
};

export type AssignmentPermissions = {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

/** Formulaire vide après création / retrait. */
export function emptyEditingAssignment(teacherId: string): EntityRow {
  return {
    teacherId,
    className: "",
    subject: "",
  };
}

/**
 * AFF-001 — réapplique période / salle après reconstruction pédagogique.
 */
export function reapplyAssignmentPeriodRoom(
  assignments: EntityRow[],
  targetId: string,
  period: string,
  room: string,
): EntityRow[] {
  return assignments.map((row) =>
    String(row.id) === targetId ? { ...row, period, room } : row,
  );
}

export function resolveLinkedTeacher(
  teachers: EntityRow[],
  teacherAssignmentContext: EntityRow,
): EntityRow {
  const contextId = String(teacherAssignmentContext.id ?? "");
  return (
    teachers.find((row) => String(row.id) === contextId) ??
    teachers.find((row) =>
      [row.publicId, row.identifier, row.userId, row.contactId].some(
        (value) => String(value ?? "") === contextId,
      ),
    ) ??
    teacherAssignmentContext
  );
}

export function findMissingRequiredAssignmentField(
  fields: AssignmentField[],
  workingItem: EntityRow,
): AssignmentField | undefined {
  return fields.find(
    (field) => field.required && !String(workingItem[field.key] ?? "").trim(),
  );
}

export function buildTeacherAssignmentDeleteConfirmCopy(assignment: EntityRow): {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "danger";
} {
  const className = String(assignment.className ?? "").trim();
  const subject = String(assignment.subject ?? assignment.course ?? "").trim();
  return {
    title: "Retirer cette affectation ?",
    description:
      className && subject
        ? `Retirer la matière « ${subject} » pour la classe ${className} ?`
        : "Retirer cette affectation enseignant ↔ classe ↔ matière ?",
    confirmLabel: "Retirer",
    tone: "danger",
  };
}

export type TeacherAssignmentSubmitInput = {
  editingAssignment: EntityRow;
  teacherAssignmentContext: EntityRow;
  assignmentFields: AssignmentField[];
  scopedAssignments: EntityRow[];
  permissions: Pick<AssignmentPermissions, "canCreate" | "canUpdate">;
};

export type TeacherAssignmentSubmitPlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: string;
      linkedTeacher: EntityRow;
      resetEditingAssignment: EntityRow;
      refreshTeacherContext: EntityRow;
    };

export function buildTeacherAssignmentSubmitPlan(
  deps: TeacherAssignmentWorkflowDeps,
  input: TeacherAssignmentSubmitInput,
): TeacherAssignmentSubmitPlan {
  const { scopeUser, state, effectiveSchoolCode, showToast, buildPedagogyPatch } = deps;
  const {
    editingAssignment,
    teacherAssignmentContext,
    assignmentFields,
    scopedAssignments,
    permissions,
  } = input;

  const teachers = scopedTeachers(scopeUser, state);
  const linkedTeacher = resolveLinkedTeacher(teachers, teacherAssignmentContext);

  const workingItem = prepareAssignmentForSave(
    {
      ...editingAssignment,
      teacherId: String(linkedTeacher.id ?? teacherAssignmentContext.id ?? ""),
    },
    teachers,
    effectiveSchoolCode,
    state,
    scopeUser,
  );

  const missingRequired = findMissingRequiredAssignmentField(assignmentFields, workingItem);
  if (missingRequired) {
    showToast(`${missingRequired.label} est obligatoire`, "error");
    return { ok: false };
  }

  const conflict = validateAssignmentConflict(
    workingItem,
    scopedAssignments,
    scopedCourses(scopeUser, state),
    scopedClasses(scopeUser, state),
    teachers,
    editingAssignment.id ? String(editingAssignment.id) : undefined,
    state,
    effectiveSchoolCode,
  );
  if (conflict) {
    showToast(conflict, "error");
    return { ok: false };
  }

  const scopedItem = applyEntitySchoolScope(
    "assignments",
    workingItem,
    effectiveSchoolCode,
    state,
  );
  const current = getScopedEntityRows("assignments", scopeUser, state);
  const exists =
    Boolean(scopedItem.id) && current.some((row) => String(row.id) === String(scopedItem.id));

  if (exists && !permissions.canUpdate) {
    showToast("Modification des affectations non autorisée pour votre rôle.", "error");
    return { ok: false };
  }
  if (!exists && !permissions.canCreate) {
    showToast("Création d'affectation non autorisée pour votre rôle.", "error");
    return { ok: false };
  }

  const nextItem = prepareEntityRowForSave(scopedItem, "ASSIGNMENT", exists);
  const mergeResult = mergeEntityIntoState("assignments", scopeUser, state, nextItem);
  if (!mergeResult.applied) {
    showToast("Modification refusée : affectation hors périmètre de l'établissement.", "error");
    return { ok: false };
  }

  const pedagogyPatch = buildPedagogyPatch("assignments", nextItem, mergeResult.rows);
  const targetId = String(nextItem.id ?? "");
  const period = String(nextItem.period ?? "");
  const room = String(nextItem.room ?? "");
  const patch: Partial<BackOfficeState> = {
    assignments: pedagogyPatch.assignments,
    courses: pedagogyPatch.courses,
    teachers: pedagogyPatch.teachers,
  };
  if (patch.assignments) {
    patch.assignments = reapplyAssignmentPeriodRoom(
      patch.assignments as EntityRow[],
      targetId,
      period,
      room,
    ) as BackOfficeState["assignments"];
  }

  patch.auditLog = appendAuditLog(
    state.auditLog,
    makeAuditEntry({
      ...auditActor(scopeUser),
      action: exists ? "assignments.update" : "assignments.create",
      entityType: "assignments",
      entityId: targetId,
      entityLabel: auditEntityLabel("assignments", nextItem) || undefined,
      schoolCode: String(nextItem.schoolCode ?? "") || undefined,
    }),
  );

  return {
    ok: true,
    patch,
    successMessage: exists ? "Affectation modifiée" : "Affectation créée",
    linkedTeacher,
    resetEditingAssignment: emptyEditingAssignment(String(linkedTeacher.id ?? "")),
    refreshTeacherContext: { ...linkedTeacher },
  };
}

export type TeacherAssignmentDeleteInput = {
  assignment: EntityRow;
  teacherAssignmentContext: EntityRow | null;
  permissions: Pick<AssignmentPermissions, "canUpdate" | "canDelete">;
};

export type TeacherAssignmentDeletePlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: "Affectation retirée";
      clearEditingIfId: string | null;
    };

export function buildTeacherAssignmentDeletePlan(
  deps: TeacherAssignmentWorkflowDeps,
  input: TeacherAssignmentDeleteInput,
): TeacherAssignmentDeletePlan {
  const { scopeUser, state, showToast, buildPedagogyPatch } = deps;
  const { assignment, teacherAssignmentContext, permissions } = input;

  const canRemove = permissions.canUpdate || permissions.canDelete;
  if (!assignment.id || !canRemove) {
    showToast("Retrait non autorisé pour votre rôle.", "error");
    return { ok: false };
  }

  const deleteResult = deleteEntityFromState(
    "assignments",
    scopeUser,
    state,
    String(assignment.id),
  );
  if (!deleteResult.applied) {
    showToast("Suppression refusée : affectation hors périmètre ou introuvable.", "error");
    return { ok: false };
  }
  const nextAllRows = deleteResult.rows;

  const pedagogyPatch = buildPedagogyPatch("assignments", assignment, nextAllRows);
  const patch: Partial<BackOfficeState> = {
    // Intentionnel : conserver les lignes post-delete, pas la liste reconstruite par la synchro.
    assignments: nextAllRows as BackOfficeState["assignments"],
    courses: pedagogyPatch.courses,
  };

  if (teacherAssignmentContext) {
    const remaining = listTeacherAssignments(teacherAssignmentContext, nextAllRows);
    const embedded = remaining.map((row) => ({
      className: row.className,
      course: row.subject ?? row.course,
    }));
    patch.teachers = ((state.teachers ?? []) as EntityRow[]).map((teacher) =>
      String(teacher.id) === String(teacherAssignmentContext.id ?? "")
        ? { ...teacher, assignments: embedded }
        : teacher,
    ) as BackOfficeState["teachers"];
  }

  patch.auditLog = appendAuditLog(
    state.auditLog,
    makeAuditEntry({
      ...auditActor(scopeUser),
      action: "assignments.delete",
      entityType: "assignments",
      entityId: String(assignment.id ?? ""),
      entityLabel: auditEntityLabel("assignments", assignment) || undefined,
      schoolCode: String(assignment.schoolCode ?? "") || undefined,
    }),
  );

  return {
    ok: true,
    patch,
    successMessage: "Affectation retirée",
    clearEditingIfId: assignment.id ? String(assignment.id) : null,
  };
}
