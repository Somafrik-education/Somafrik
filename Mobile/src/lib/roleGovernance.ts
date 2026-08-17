import { CRUD_PERMISSION_MODULES } from "./constants";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE } from "./orgHierarchy";

export const COUNTRY_SCOPE_MODULES = new Set(["Pays", "Établissements", "Abonnements", "Utilisateurs", "Référentiels pédagogiques"]);

export function getSuperadminMatrixModules(role: string): string[] {
  return CRUD_PERMISSION_MODULES.filter((module) => {
    if (role === COUNTRY_ADMIN_ROLE) return COUNTRY_SCOPE_MODULES.has(module);
    if (role === SCHOOL_ADMIN_ROLE) return !COUNTRY_SCOPE_MODULES.has(module);
    return true;
  });
}
