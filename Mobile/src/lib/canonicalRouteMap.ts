/**
 * LOT UI-DATA — une entité métier, un écran canonique.
 * AdminCrud reste uniquement pour les entités sans écran dédié.
 */
export const CANONICAL_ENTITY_ROUTES = {
  users: "Users",
  teachers: "Teachers",
  students: "Students",
  payments: "Payments",
  announcements: "Announcements",
  classes: "Classes",
} as const;

export const ADMIN_CRUD_ONLY_ENTITIES = [
  "schools",
  "countries",
  "subscriptions",
  "courses",
  "assignments",
  "paymentStatuses",
] as const;

export function canonicalRouteForEntity(entity: string): string | null {
  return CANONICAL_ENTITY_ROUTES[entity as keyof typeof CANONICAL_ENTITY_ROUTES] ?? null;
}
