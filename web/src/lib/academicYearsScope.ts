import type { AcademicYear } from "./academicYearsApi";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";
import { isSchoolScopedRole, sameSchoolId } from "./schoolCanonicalIdentity";

export type AcademicYearScopeSchool = {
  id?: string;
  publicId?: string;
  loginCode?: string;
  code?: string;
};

export type AcademicYearScopeInput = {
  role?: string;
  rows: AcademicYear[] | unknown;
  selectedSchool?: AcademicYearScopeSchool | null;
  sessionSchoolId?: string | null;
};

function asAcademicYears(rows: AcademicYear[] | unknown): AcademicYear[] {
  return (Array.isArray(rows) ? rows : []).filter(
    (row): row is AcademicYear => Boolean(row && typeof row === "object"),
  );
}

function canonicalSchoolId(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Filtre leftover JWT vs login_code — reproduisait « Aucune année configurée ».
 * Conservé uniquement pour les tests de preuve avant/après. Jamais utilisé en prod.
 */
export function legacyScopedAcademicYearsBySchoolCode(
  rows: AcademicYear[] | unknown,
  schoolCode: string,
): AcademicYear[] {
  const list = asAcademicYears(rows);
  const target = String(schoolCode ?? "").trim();
  if (!target) return list;
  return list.filter((year) => !year.schoolCode || year.schoolCode === target);
}

function scopeSchoolAdminAcademicYears(
  rows: AcademicYear[],
  sessionSchoolId?: string | null,
  selectedSchool?: AcademicYearScopeSchool | null,
): AcademicYear[] {
  const schoolId =
    canonicalSchoolId(sessionSchoolId) || canonicalSchoolId(selectedSchool?.id);
  if (!schoolId) {
    // GET /v2/academic-years est déjà borné par membership UUID. Pas de filtre leftover.
    return rows;
  }
  return rows.filter((year) => {
    const yearId = canonicalSchoolId(year.schoolId);
    if (!yearId) return true;
    return sameSchoolId(yearId, schoolId);
  });
}

function scopePlatformAcademicYears(
  rows: AcademicYear[],
  selectedSchool?: AcademicYearScopeSchool | null,
): AcademicYear[] {
  const schoolId = canonicalSchoolId(selectedSchool?.id);
  if (!schoolId) return [];
  return rows.filter((year) => sameSchoolId(year.schoolId, schoolId));
}

/**
 * Scope client Paramètres → années scolaires.
 *
 * Admin établissement : confiance au GET déjà borné par membership UUID.
 * Superadmin / Admin Pays : filtre fail-closed sur schoolId de l'école sélectionnée.
 * Interdit : leftover school_code / configTarget comme autorité.
 */
export function scopeAcademicYearsForConfiguration(input: AcademicYearScopeInput): AcademicYear[] {
  const rows = asAcademicYears(input.rows);
  if (isSchoolScopedRole(input.role)) {
    return scopeSchoolAdminAcademicYears(rows, input.sessionSchoolId, input.selectedSchool);
  }
  if (isSuperAdminRole(input.role) || input.role === COUNTRY_ADMIN_ROLE) {
    return scopePlatformAcademicYears(rows, input.selectedSchool);
  }
  return [];
}
