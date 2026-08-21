import { getCountryCodeFromScope, normalize } from "./format";

export const SUPER_ADMIN_ROLE = "Super Administrateur Somafrik";
export const LEGACY_SUPER_ADMIN_ROLE = "Super Administrateur OKAFRIK";
export const COUNTRY_ADMIN_ROLE = "Admin Pays";
export const SCHOOL_ADMIN_ROLE = "Admin School";

export const PENDING_VALIDATION_STATUS = "En attente de validation";
export const VALIDATED_STATUS = "Validé";

export function isPendingValidationStatus(status?: string): boolean {
  const value = normalize(status);
  return value === "en attente de validation" || value === "en attente";
}

export function isSchoolAwaitingSuperadminValidation(school?: {
  validationStatus?: string;
  validationRequestedBy?: string;
}): boolean {
  if (!school) return false;
  const status = school.validationStatus;
  if (status === VALIDATED_STATUS || status === "Rejeté") return false;
  if (isPendingValidationStatus(status)) return true;
  return Boolean(school.validationRequestedBy);
}

export function normalizePlatformRole(role?: string): string {
  if (!role || role === LEGACY_SUPER_ADMIN_ROLE) return SUPER_ADMIN_ROLE;
  return role;
}

export function isSuperAdminRole(role?: string): boolean {
  const normalized = normalize(normalizePlatformRole(role));
  return normalized === normalize(SUPER_ADMIN_ROLE) || normalized === normalize(LEGACY_SUPER_ADMIN_ROLE);
}

export const SUPERADMIN_MANAGED_ROLES = [COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE] as const;

export function sessionRoleToPlatformRole(sessionRole?: string): string {
  if (sessionRole === "super_admin") return SUPER_ADMIN_ROLE;
  if (sessionRole === "country_admin") return COUNTRY_ADMIN_ROLE;
  if (sessionRole === "school_admin") return SCHOOL_ADMIN_ROLE;
  if (sessionRole === "principal") return "Directeur";
  if (sessionRole === "proviseur") return "Proviseur";
  if (sessionRole === "prefet") return "Préfet des études";
  if (sessionRole === "secretary") return "Secrétaire";
  if (sessionRole === "accountant") return "Comptable";
  if (sessionRole === "adjoint") return "Directeur adjoint";
  if (sessionRole === "supervisor") return "Surveillant";
  if (sessionRole === "teacher") return "Enseignant";
  if (sessionRole === "parent_student") return "Parent";
  if (sessionRole === "student") return "Élève / Étudiant";
  return sessionRole ?? "";
}

export function scopedCountriesForUser(
  user: { role?: string; countryScope?: string } | null,
  countries: { name: string; code: string }[],
) {
  if (!user) return [];
  const role = normalizePlatformRole(user.role);
  if (role === SUPER_ADMIN_ROLE || user.role === "super_admin") return countries;
  if (user.role === COUNTRY_ADMIN_ROLE || user.role === "country_admin") {
    return countries.filter(
      (country) =>
        normalize(country.name) === normalize(user.countryScope) ||
        normalize(country.code) === normalize(user.countryScope) ||
        getCountryCodeFromScope(user.countryScope) === country.code,
    );
  }
  return countries.filter(
    (country) =>
      normalize(country.code) === getCountryCodeFromScope(user.countryScope) ||
      normalize(country.name) === normalize(user.countryScope),
  );
}
