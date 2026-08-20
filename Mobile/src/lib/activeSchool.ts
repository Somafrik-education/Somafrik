let storedSchoolCode = "";

export const ALL_SCHOOLS_CODE = "*";

export function isAllSchoolsSelection(code?: string | null): boolean {
  return !code || code === ALL_SCHOOLS_CODE;
}

export function userRequiresSchoolSelection(user: {
  schoolCode?: string;
  role?: string;
} | null): boolean {
  if (!user) return false;
  if (user.role === "super_admin" || user.role === "country_admin") return true;
  return !user.schoolCode || user.schoolCode === ALL_SCHOOLS_CODE;
}

export function readStoredSchoolCode(): string {
  return storedSchoolCode;
}

export function writeStoredSchoolCode(code: string): void {
  storedSchoolCode = code;
}

export function clearStoredSchoolCode(): void {
  storedSchoolCode = "";
}

export function pickInitialSchoolCode(
  user: { schoolCode?: string; role?: string } | null,
  availableCodes: string[],
): string {
  const stored = readStoredSchoolCode();
  if (user?.schoolCode && user.schoolCode !== ALL_SCHOOLS_CODE && user.role !== "super_admin" && user.role !== "country_admin") {
    return user.schoolCode;
  }
  if (stored && availableCodes.some((code) => code.toUpperCase() === stored.toUpperCase())) {
    return stored;
  }
  return availableCodes[0] ?? "";
}

export function withSchoolScope<T extends { schoolCode?: string }>(
  user: T | null,
  schoolCode: string,
): T | null {
  if (!user) return null;
  if (!userRequiresSchoolSelection(user)) return user;
  if (!schoolCode) return user;
  if (isAllSchoolsSelection(schoolCode)) {
    return { ...user, schoolCode: ALL_SCHOOLS_CODE };
  }
  return { ...user, schoolCode };
}

export function resolveTargetSchoolCodes(activeSchoolCode: string, availableSchoolCodes: string[]): string[] {
  if (isAllSchoolsSelection(activeSchoolCode)) {
    return availableSchoolCodes;
  }
  return activeSchoolCode ? [activeSchoolCode] : [];
}

/** Identité affichée / active du sélecteur : toujours school.code (code public V2). */
export function schoolSelectorChoice(school: { code: string; name: string }): { code: string; label: string } {
  return {
    code: school.code,
    label: `${school.name} (${school.code})`,
  };
}
