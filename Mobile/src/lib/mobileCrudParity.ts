/**
 * P0 — parité CRUD Mobile ↔ contrat RBAC backend.
 *
 * Les boutons d'écriture s'alignent sur `canMutateEntity` (mêmes features que le Web).
 * Les mutations partent vers les APIs PostgreSQL existantes. Aucun no-op local.
 * GRANT/REVOKE de la matrice reste hors Mobile (`MOBILE_ROLE_PERMISSION_MUTATION_ENABLED`).
 */
import { canMutateEntity, canReadEntity, type SecurityAction } from "../domain/security/permissions";

export const CANONICAL_CRUD_ENTITIES = [
  "classes",
  "users",
  "students",
  "teachers",
  "payments",
  "assignments",
  "announcements",
] as const;

export type CanonicalCrudEntity = (typeof CANONICAL_CRUD_ENTITIES)[number];

export type EntityCrudAccess = {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export function canGrantUserRole(session: any): boolean {
  return canMutateEntity(session, "users", "UPDATE");
}

/** Identité enseignant = Utilisateurs CREATE + GRANT rôle (Utilisateurs UPDATE). Pas POST /teachers. */
export function canCreateTeacherIdentity(session: any): boolean {
  return canMutateEntity(session, "users", "CREATE") && canGrantUserRole(session);
}

export function resolveEntityCrudAccess(session: any, entity: CanonicalCrudEntity): EntityCrudAccess {
  return {
    canRead: canReadEntity(session, entity),
    canCreate: canMutateEntity(session, entity, "CREATE"),
    canUpdate: canMutateEntity(session, entity, "UPDATE"),
    canDelete: canMutateEntity(session, entity, "DELETE"),
  };
}

export function mutationActionLabel(action: Exclude<SecurityAction, "READ" | "SUSPEND">): string {
  if (action === "CREATE") return "Créer";
  if (action === "UPDATE") return "Modifier";
  return "Supprimer";
}
