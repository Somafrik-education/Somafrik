/**
 * P0 — parité CRUD Mobile ↔ contrat RBAC backend.
 *
 * Les boutons d'écriture s'alignent sur `canMutateEntity` (mêmes features que le Web).
 * Les mutations partent vers les APIs PostgreSQL existantes. Aucun no-op local.
 * L’attribution et le retrait des droits de la matrice restent hors Mobile
 * (`MOBILE_ROLE_PERMISSION_MUTATION_ENABLED`).
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

/** Annulation canonique = POST /payments/:id/cancel, gated on Paiements:UPDATE (pas CREATE seul). */
export function canCancelSchoolPayment(session: any): boolean {
  return canMutateEntity(session, "payments", "UPDATE");
}

/** POST /api/payments — F6 : Paiements:CREATE | Paiements:UPDATE. Distinct de l'annulation. */
export function canRecordSchoolPayment(session: any): boolean {
  return canMutateEntity(session, "payments", "CREATE") || canMutateEntity(session, "payments", "UPDATE");
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
