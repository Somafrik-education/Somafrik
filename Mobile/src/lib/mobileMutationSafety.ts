import type { AdminEntity } from "../context/AdminDataContext";

/**
 * L0b — seules les entités dont AdminCrud utilise explicitement une API
 * canonique de bout en bout restent exécutables dans l'ancien écran générique.
 *
 * Toutes les autres entités sont redirigées vers leur écran canonique ou une
 * vue fail-closed. Cela empêche les mutations locales/no-op de se présenter
 * comme des écritures PostgreSQL.
 */
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
  return SAFE_ADMIN_CRUD_ENTITIES.has(entity);
}

export function canonicalRouteForAdminEntity(entity: AdminEntity): CanonicalAdminRoute | null {
  return CANONICAL_ROUTE_BY_ADMIN_ENTITY[entity] ?? null;
}

/**
 * La matrice de droits Mobile est lecture seule tant que le contrat RBAC
 * PATCH canonique (roleKey/scope/grants/expectedUpdatedAt) n'est pas branché.
 */
export const MOBILE_ROLE_PERMISSION_MUTATION_ENABLED = false;
