/**
 * PARITE-WEB-MOBILE-RECOVERY-01 / LOT 7 — chargements limités aux droits effectifs.
 *
 * L'hydratation de session (AdminDataContext) lançait pour tous les rôles des lectures
 * staff / plateforme. Pour un Élève (et un Parent), elles finissent toutes en 403 et un seul
 * refus faisait échouer tout le lot `refreshBackOfficeState` (Promise.all), y compris notes,
 * présences et élèves pourtant autorisés.
 *
 * Périmètre volontairement limité aux rôles Élève / Parent : les autres rôles gardent
 * exactement leur comportement (un Enseignant lit ses affectations sans le droit
 * « Affectations », par exemple). Aucun droit n'est élargi : on s'abstient d'appeler.
 */
import { canReadEntity } from "../domain/security/permissions";

export type HydratedResource =
  | "users"
  | "teachers"
  | "courses"
  | "assignments"
  | "schools"
  | "countries"
  | "subscriptions";

const FAMILY_ROLES = new Set(["student", "parent_student"]);

export function isFamilyRole(role?: string | null): boolean {
  return FAMILY_ROLES.has(String(role ?? ""));
}

/** true = la lecture peut partir ; false = elle serait refusée pour ce rôle, on ne l'émet pas. */
export function shouldHydrateResource(session: unknown, resource: HydratedResource): boolean {
  const role = (session as { role?: string } | null | undefined)?.role;
  if (!isFamilyRole(role)) return true;
  return canReadEntity(session, resource);
}
