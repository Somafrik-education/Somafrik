import type { SessionUser } from "../types";
import { normalize } from "./format";
import { shouldDenyWebSchoolDomain } from "./webSchoolDomainDeny";

const STORAGE_KEY = "somafrik.activeSchoolCode";

/** Sélection globale Superadmin / Admin Pays (tous les établissements du périmètre). */
export const ALL_SCHOOLS_CODE = "*";

export function isAllSchoolsSelection(code?: string | null): boolean {
  return !code || code === ALL_SCHOOLS_CODE;
}

/** Compte plateforme sans établissement fixe (Super Admin, Admin Pays). */
export function userRequiresSchoolSelection(user: SessionUser | null): boolean {
  if (!user) return false;
  return !user.schoolCode || user.schoolCode === ALL_SCHOOLS_CODE;
}

export function readStoredSchoolCode(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeStoredSchoolCode(code: string): void {
  try {
    if (code) sessionStorage.setItem(STORAGE_KEY, code);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function pickInitialSchoolCode(
  user: SessionUser | null,
  availableCodes: string[],
): string {
  if (shouldDenyWebSchoolDomain(user)) {
    return "";
  }
  if (user?.schoolCode && user.schoolCode !== ALL_SCHOOLS_CODE) {
    return user.schoolCode;
  }
  const stored = readStoredSchoolCode();
  if (stored && availableCodes.some((code) => normalize(code) === normalize(stored))) {
    return stored;
  }
  return availableCodes[0] ?? "";
}

/** Utilisateur avec périmètre limité à l'établissement actif (données + config). */
export function withSchoolScope(user: SessionUser | null, schoolCode: string): SessionUser | null {
  if (!user) return null;
  if (shouldDenyWebSchoolDomain(user)) return user;
  if (!userRequiresSchoolSelection(user)) return user;
  if (!schoolCode) return user;
  if (isAllSchoolsSelection(schoolCode)) {
    return { ...user, schoolCode: ALL_SCHOOLS_CODE };
  }
  return { ...user, schoolCode };
}

/** Codes établissements cibles pour une action (un seul ou tout le périmètre). */
export function resolveTargetSchoolCodes(
  activeSchoolCode: string,
  availableSchoolCodes: string[],
): string[] {
  if (isAllSchoolsSelection(activeSchoolCode)) {
    return availableSchoolCodes;
  }
  return activeSchoolCode ? [activeSchoolCode] : [];
}
