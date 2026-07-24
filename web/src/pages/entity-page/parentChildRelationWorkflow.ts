/**
 * D2.8d3 — Workflow Relations parent-enfant.
 *
 * Plans métier purs / quasi purs pour le mode bundle parent ↔ élèves et le
 * chemin relation unitaire. Aucun hook ni contexte React.
 *
 * Hors lot : Paiements, Contacts & Comptes, Affectations, JSX modales.
 */
import type { AuditEntry } from "../../lib/audit";
import { appendAuditLog, auditActor, makeAuditEntry } from "../../lib/audit";
import { getScopedEntityRows } from "../../lib/entityModules";
import { normalize } from "../../lib/format";
import {
  enforceSinglePrincipalParent,
  formatContactPersonName,
  getParentLinkedStudentIds,
  prepareRelationForSave,
  RELATION_PARENT_CHILD,
  removeParentChildBundle,
  resolveParentContactId,
  syncParentChildRelations,
  validateParentChildBundle,
  validateRelation,
} from "../../lib/relations";
import type { BackOfficeState, SessionUser } from "../../types";

export type EntityRow = Record<string, unknown>;

export type ToastFn = (
  message: string,
  tone?: "info" | "success" | "error" | "warning",
) => void;

export type ParentChildRelationWorkflowDeps = {
  scopeUser: SessionUser | null;
  state: BackOfficeState;
  showToast: ToastFn;
  /** Injecté — typiquement `() => newEntityId("RELATIONS")`. */
  createRelationId: () => string;
};

export function defaultNewRelationDraft(isParentChildMode: boolean): EntityRow {
  return {
    relationType: isParentChildMode ? RELATION_PARENT_CHILD : "Parent → Élève",
    status: "Actif",
    isPrincipal: "Oui",
    toStudentIds: [],
  };
}

export function resolveSelectedParentStudentIds(editing: EntityRow | null): string[] {
  if (!editing || !Array.isArray(editing.toStudentIds)) return [];
  return (editing.toStudentIds as string[]).map(String).filter(Boolean);
}

export function filterAvailableParentStudentOptions(
  options: { value: string; label: string }[],
  selectedIds: string[],
): { value: string; label: string }[] {
  return options.filter((option) => !selectedIds.includes(option.value));
}

export function resolveSelectedParentStudentLabels(
  selectedIds: string[],
  options: { value: string; label: string }[],
): { id: string; label: string }[] {
  return selectedIds.map((studentId) => {
    const option = options.find((item) => item.value === studentId);
    return { id: studentId, label: option?.label ?? studentId };
  });
}

export function applyParentContactChange(
  editing: EntityRow,
  fromContactId: string,
  relations: EntityRow[],
): EntityRow {
  const linked = getParentLinkedStudentIds(relations, fromContactId);
  return {
    ...editing,
    fromContactId,
    toStudentIds:
      linked.length > 0
        ? linked
        : Array.isArray(editing.toStudentIds)
          ? editing.toStudentIds
          : [],
  };
}

export function addParentChildStudentId(editing: EntityRow, studentId: string): EntityRow {
  const selected = resolveSelectedParentStudentIds(editing);
  if (!studentId || selected.includes(studentId)) return editing;
  return { ...editing, toStudentIds: [...selected, studentId] };
}

export function removeParentChildStudentId(editing: EntityRow, studentId: string): EntityRow {
  return {
    ...editing,
    toStudentIds: resolveSelectedParentStudentIds(editing).filter((id) => id !== studentId),
  };
}

export type ParentChildBundleSubmitPlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: "Parent lié à ses élèves" | "Parent et élèves mis à jour";
    };

export function buildParentChildBundleSubmitPlan(
  deps: ParentChildRelationWorkflowDeps,
  input: {
    editing: EntityRow;
    permissions: { canCreate: boolean; canUpdate: boolean };
  },
): ParentChildBundleSubmitPlan {
  const { scopeUser, state, showToast, createRelationId } = deps;
  const { editing, permissions } = input;

  const canonicalFromContactId = resolveParentContactId(state, String(editing.fromContactId ?? ""));
  const normalizedEditing: EntityRow = {
    ...editing,
    fromContactId: canonicalFromContactId || String(editing.fromContactId ?? "").trim(),
  };

  const bundleError = validateParentChildBundle(normalizedEditing);
  if (bundleError) {
    showToast(bundleError, "error");
    return { ok: false };
  }

  const fromContactId = String(normalizedEditing.fromContactId ?? "").trim();
  const currentScoped = getScopedEntityRows("relations", scopeUser, state);
  const existedBefore = currentScoped.some(
    (row) =>
      normalize(String(row.relationType ?? "")) === normalize(RELATION_PARENT_CHILD) &&
      String(row.fromContactId ?? "").trim() === fromContactId,
  );

  if (existedBefore && !permissions.canUpdate) {
    showToast("Modification non autorisée pour votre rôle.", "error");
    return { ok: false };
  }
  if (!existedBefore && !permissions.canCreate) {
    showToast("Création non autorisée pour votre rôle.", "error");
    return { ok: false };
  }

  const allRelations = (state.relations ?? []) as unknown as EntityRow[];
  const nextRelations = syncParentChildRelations(
    normalizedEditing,
    allRelations,
    state,
    createRelationId,
  );

  const parentAccount = ((state.users ?? []) as unknown as EntityRow[]).find(
    (row) =>
      String(row.contactId ?? "").trim() === fromContactId ||
      String(row.id ?? "").trim() === fromContactId,
  );
  const label = parentAccount
    ? formatContactPersonName(parentAccount)
    : String(normalizedEditing.fromContactName ?? editing.fromContactName ?? fromContactId);

  return {
    ok: true,
    patch: {
      relations: nextRelations as unknown as BackOfficeState["relations"],
      auditLog: appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: `relation.${existedBefore ? "update" : "create"}`,
          entityType: "relation",
          entityId: fromContactId,
          entityLabel: label || undefined,
          schoolCode: String(editing.schoolCode ?? parentAccount?.schoolCode ?? "") || undefined,
          details: `${(editing.toStudentIds as string[] | undefined)?.length ?? 0} élève(s) lié(s)`,
        }),
      ),
    },
    successMessage: existedBefore ? "Parent et élèves mis à jour" : "Parent lié à ses élèves",
  };
}

export type ParentChildBundleDeletePlan = {
  patch: Partial<BackOfficeState>;
  successMessage: "Liaisons parent-enfant supprimées";
};

/**
 * Construit le patch de suppression du bundle parent ↔ élèves.
 *
 * Précondition (hors module) : l’appelant DOIT avoir déjà appliqué
 * confirm + contrôles permissions/scope (EntityPage aujourd’hui).
 * Ce plan ne revalide ni le scope ni `canDelete` — ne pas l’appeler
 * depuis une autre UI sans ces gates.
 */
export function buildParentChildBundleDeletePlan(
  deps: Pick<ParentChildRelationWorkflowDeps, "scopeUser" | "state">,
  input: { row: EntityRow },
): ParentChildBundleDeletePlan {
  const { scopeUser, state } = deps;
  const fromContactId = String(input.row.fromContactId ?? "").trim();
  const nextRelations = removeParentChildBundle(
    (state.relations ?? []) as unknown as EntityRow[],
    fromContactId,
  );
  return {
    patch: {
      relations: nextRelations as unknown as BackOfficeState["relations"],
      auditLog: appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: "relation.delete",
          entityType: "relation",
          entityId: fromContactId,
          entityLabel: String(input.row.fromContactName ?? "") || undefined,
          schoolCode: String(input.row.schoolCode ?? "") || undefined,
        }),
      ),
    },
    successMessage: "Liaisons parent-enfant supprimées",
  };
}

export type RelationPreSubmitPlan =
  | { ok: false }
  | { ok: true; workingItem: EntityRow };

export function buildRelationPreSubmitPlan(
  deps: Pick<ParentChildRelationWorkflowDeps, "state" | "scopeUser" | "showToast">,
  input: {
    workingItem: EntityRow;
    editingId?: string;
    /** Branche historique : force le type parent-enfant. */
    forceParentChildType?: boolean;
  },
): RelationPreSubmitPlan {
  const { state, scopeUser, showToast } = deps;
  let workingItem = input.workingItem;
  if (input.forceParentChildType) {
    workingItem = { ...workingItem, relationType: RELATION_PARENT_CHILD };
  }
  workingItem = prepareRelationForSave(workingItem, state);
  const relationError = validateRelation(
    workingItem,
    getScopedEntityRows("relations", scopeUser, state),
    input.editingId,
  );
  if (relationError) {
    showToast(relationError, "error");
    return { ok: false };
  }
  return { ok: true, workingItem };
}

export type RelationPostMergePlan = {
  relations: EntityRow[];
  auditEntry: AuditEntry;
};

export function buildRelationPostMergePlan(
  deps: Pick<ParentChildRelationWorkflowDeps, "scopeUser">,
  input: {
    nextRelation: EntityRow;
    nextAllRows: EntityRow[];
    baseRelations: EntityRow[];
    exists: boolean;
  },
): RelationPostMergePlan {
  const { scopeUser } = deps;
  const { nextRelation, baseRelations, exists } = input;
  const relations = enforceSinglePrincipalParent(baseRelations, nextRelation);
  const label =
    `${String(nextRelation.relationType ?? "")} · ${String(nextRelation.fromContactName ?? "")}`.trim();
  return {
    relations,
    auditEntry: makeAuditEntry({
      ...auditActor(scopeUser),
      action: `relation.${exists ? "update" : "create"}`,
      entityType: "relation",
      entityId: String(nextRelation.id ?? ""),
      entityLabel: label || undefined,
      schoolCode: String(nextRelation.schoolCode ?? "") || undefined,
    }),
  };
}

export function buildRelationDeleteAuditEntry(
  scopeUser: SessionUser | null,
  row: EntityRow,
): AuditEntry {
  return makeAuditEntry({
    ...auditActor(scopeUser),
    action: "relation.delete",
    entityType: "relation",
    entityId: String(row.id ?? ""),
    entityLabel: String(row.relationType ?? "") || undefined,
    schoolCode: String(row.schoolCode ?? "") || undefined,
  });
}
