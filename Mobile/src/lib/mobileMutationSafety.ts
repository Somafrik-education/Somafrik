import type { AdminEntity } from "../context/AdminDataContext";

/**
 * L0b / L9b — AdminCrud générique : le code d'écran a des branches API pour
 * `courses` et `assignments`, mais ces writes ne font pas partie du contrat
 * RC1 Mobile (graphe de navigation mort). Le flag ci-dessous les retire de
 * la capacité opérationnelle : `canRunGenericAdminCrud` est fail-closed.
 *
 * Toutes les autres entités restent fail-closed. Ne pas réactiver d'autres
 * CRUD génériques.
 */
export const MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 = false;

export const SAFE_ADMIN_CRUD_ENTITIES = new Set<AdminEntity>([
  "courses",
  "assignments",
]);

export type CanonicalAdminRoute =
  | "Classes"
  | "Students"
  | "Teachers"
  | "Users"
  | "Payments"
  | "Announcements"
  | "Messages"
  | "SchoolManagement"
  | "Configuration";

export const CANONICAL_ROUTE_BY_ADMIN_ENTITY: Partial<Record<AdminEntity, CanonicalAdminRoute>> = {
  classes: "Classes",
  students: "Students",
  teachers: "Teachers",
  users: "Users",
  payments: "Payments",
  announcements: "Announcements",
  messages: "Messages",
  schools: "SchoolManagement",
  paymentStatuses: "Configuration",
};

export function canRunGenericAdminCrud(entity: AdminEntity): boolean {
  return MOBILE_GENERIC_ADMIN_CRUD_IN_RC1 && SAFE_ADMIN_CRUD_ENTITIES.has(entity);
}

export function canonicalRouteForAdminEntity(entity: AdminEntity): CanonicalAdminRoute | null {
  return CANONICAL_ROUTE_BY_ADMIN_ENTITY[entity] ?? null;
}

/**
 * La matrice de droits Mobile est lecture seule tant que le contrat RBAC
 * PATCH canonique (roleKey/scope/grants/expectedUpdatedAt) n'est pas branché.
 */
export const MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false;
