/**
 * D2.8c — Noyau CRUD transversal EntityPage.
 *
 * Périmètre strict (validation CTO) :
 * - préparation d’identifiant de ligne
 * - merge / delete scopés génériques
 * - busy + toast succès / échec (persist)
 * - audit générique pour les clés déjà communes
 *
 * Hors lot (EntityPage / D2.8d) :
 * paiements, contacts / promotion, relations parent-enfant,
 * affectations enseignants, synchros pédagogiques,
 * règles spécifiques Élèves / Classes / Enseignants.
 *
 * Aucun hook ni contexte React : dépendances explicites.
 */
import type { BackOfficeState, SessionUser } from "../../types";
import {
  appendAuditLog,
  auditActor,
  makeAuditEntry,
  type AuditEntry,
} from "../../lib/audit";
import {
  applySchoolScopeToItem,
  deleteScopedEntityRow,
  mergeScopedEntityRows,
  type MergeScopedEntityRowsResult,
  type SchoolEntityKey,
} from "../../lib/entityModules";

/** Messages transversaux (parité EntityPage). */
export const ENTITY_SYNC_FAILURE_MESSAGE = "Échec de la synchronisation";
export const ENTITY_OUT_OF_SCOPE_SAVE_MESSAGE =
  "Modification refusée : élément hors périmètre de l'établissement.";
export const ENTITY_OUT_OF_SCOPE_DELETE_MESSAGE =
  "Suppression refusée : élément hors périmètre ou introuvable.";
export const ENTITY_DELETED_MESSAGE = "Élément supprimé";

/**
 * Entités encore auditées via patch client (legacy UI).
 * HOTFIX-RBAC-ADMIN-01 : `classes` / `teachers` / `assignments` sont audités
 * uniquement côté serveur — ne plus les inclure ici (auditLog client → 403).
 */
export const AUDITED_ENTITY_KEYS = new Set<SchoolEntityKey>(["students"]);

export function isAuditedEntityKey(key: SchoolEntityKey): boolean {
  return AUDITED_ENTITY_KEYS.has(key);
}

/** Identifiant de nouvelle ligne (UUID si dispo, sinon timestamp). */
export function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

/** Libellé lisible d'une ligne pour le journal d'audit. */
export function auditEntityLabel(key: SchoolEntityKey, row: Record<string, unknown>): string {
  const str = (value: unknown) => String(value ?? "").trim();
  switch (key) {
    case "classes":
      return str(row.name) || str(row.className);
    case "students":
    case "teachers":
      return `${str(row.name)} ${str(row.firstName)}`.trim();
    case "assignments":
      return [str(row.teacherName), str(row.subject), str(row.className)]
        .filter(Boolean)
        .join(" · ");
    default:
      return str(row.name);
  }
}

/**
 * Prépare l’identifiant d’une ligne à la création.
 * Ne contient aucune règle métier élèves / enseignants / contacts.
 */
export function prepareEntityRowForSave(
  preparedItem: Record<string, unknown>,
  idPrefix: string,
  exists: boolean,
): Record<string, unknown> {
  if (exists) return preparedItem;
  const id = String(preparedItem.id ?? newEntityId(idPrefix));
  return { ...preparedItem, id };
}

/**
 * Applique le scope établissement sur une ligne (délègue à `applySchoolScopeToItem`).
 * Conservé dans le noyau pour un point d’entrée CRUD unique.
 */
export function applyEntitySchoolScope(
  key: SchoolEntityKey,
  item: Record<string, unknown>,
  schoolCode: string | undefined,
  state: BackOfficeState,
): Record<string, unknown> {
  return applySchoolScopeToItem(key, item, schoolCode, state);
}

/** Ajoute ou remplace une ligne dans l’état, limité au périmètre établissement. */
export function mergeEntityIntoState(
  key: SchoolEntityKey,
  user: SessionUser | null,
  state: BackOfficeState,
  nextItem: Record<string, unknown>,
): MergeScopedEntityRowsResult {
  return mergeScopedEntityRows(key, user, state, nextItem);
}

export type DeleteEntityFromStateResult = {
  applied: boolean;
  rows: Record<string, unknown>[];
};

/** Suppression générique scopée (hors workflows classes / relations / enseignants). */
export function deleteEntityFromState(
  key: SchoolEntityKey,
  user: SessionUser | null,
  state: BackOfficeState,
  rowId: string,
): DeleteEntityFromStateResult {
  const previousLength = ((state[key] ?? []) as unknown[]).length;
  const rows = deleteScopedEntityRow(key, user, state, rowId);
  return {
    applied: rows.length !== previousLength,
    rows,
  };
}

export function buildGenericMutationAuditEntry(
  key: SchoolEntityKey,
  scopeUser: SessionUser | null,
  nextItem: Record<string, unknown>,
  exists: boolean,
): AuditEntry {
  return makeAuditEntry({
    ...auditActor(scopeUser),
    action: `${key}.${exists ? "update" : "create"}`,
    entityType: key,
    entityId: String(nextItem.id ?? ""),
    entityLabel: auditEntityLabel(key, nextItem) || undefined,
    schoolCode: String(nextItem.schoolCode ?? "") || undefined,
  });
}

export function buildGenericDeleteAuditEntry(
  key: SchoolEntityKey,
  scopeUser: SessionUser | null,
  row: Record<string, unknown>,
): AuditEntry {
  return makeAuditEntry({
    ...auditActor(scopeUser),
    action: `${key}.delete`,
    entityType: key,
    entityId: String(row.id ?? ""),
    entityLabel: auditEntityLabel(key, row) || undefined,
    schoolCode: String(row.schoolCode ?? "") || undefined,
  });
}

/** Audit create/update uniquement pour les clés déjà communes. */
export function appendGenericMutationAudit(
  auditLog: BackOfficeState["auditLog"],
  key: SchoolEntityKey,
  scopeUser: SessionUser | null,
  nextItem: Record<string, unknown>,
  exists: boolean,
): AuditEntry[] | undefined {
  if (!AUDITED_ENTITY_KEYS.has(key)) return undefined;
  return appendAuditLog(
    auditLog,
    buildGenericMutationAuditEntry(key, scopeUser, nextItem, exists),
  );
}

/** Audit delete uniquement pour les clés déjà communes. */
export function appendGenericDeleteAudit(
  auditLog: BackOfficeState["auditLog"],
  key: SchoolEntityKey,
  scopeUser: SessionUser | null,
  row: Record<string, unknown>,
): AuditEntry[] | undefined {
  if (!AUDITED_ENTITY_KEYS.has(key)) return undefined;
  return appendAuditLog(auditLog, buildGenericDeleteAuditEntry(key, scopeUser, row));
}

export function entityMutationSuccessMessage(moduleLabel: string, exists: boolean): string {
  return exists ? `${moduleLabel} modifié` : `${moduleLabel} créé`;
}

export interface PersistEntityPatchDeps {
  update: (
    patch: Partial<BackOfficeState>,
    options?: { sync?: boolean; partial?: boolean },
  ) => Promise<void>;
  showToast: (message: string, tone?: "info" | "success" | "error" | "warning") => void;
  setBusy: (busy: boolean) => void;
}

/**
 * Persistance partielle + busy + toasts succès / échec.
 * Dépendances injectées (pas de hooks).
 */
export async function persistEntityPatch(
  deps: PersistEntityPatchDeps,
  patch: Partial<BackOfficeState>,
  message: string,
): Promise<void> {
  deps.setBusy(true);
  try {
    await deps.update(patch, { partial: true });
    deps.showToast(message, "success");
  } catch {
    deps.showToast(ENTITY_SYNC_FAILURE_MESSAGE, "error");
    throw new Error("sync failed");
  } finally {
    deps.setBusy(false);
  }
}
