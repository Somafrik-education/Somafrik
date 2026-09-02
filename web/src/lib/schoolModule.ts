import type { AuditEntry } from "./audit";
import type { BackOfficeState, School, UserAccount } from "../types";
import { getCountryCodeFromScope, normalize } from "./format";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";

/** Types d'établissement Somafrik (liste contrôlée ETB-F01). */
export const SCHOOL_TYPES = [
  "École primaire",
  "Collège",
  "Lycée",
  "Université",
  "Institut",
  "Centre de formation",
] as const;

export const SCHOOL_STATUSES = [
  "Brouillon",
  "En attente",
  "Actif",
  "Suspendu",
  "Désactivé",
  "Supprimé",
] as const;

/**
 * Compatibilité d'appel uniquement.
 * Le navigateur ne génère plus de code établissement : PostgreSQL est l'unique
 * propriétaire de `login_code` via `somafrik_prepare_school_login_code()`.
 */
export function generateSchoolCode(_countryCode: string, _schools: School[]): string {
  void _countryCode;
  void _schools;
  return "";
}

export function isSchoolDeleted(school: School): boolean {
  return (
    normalize(school.status) === "supprime" ||
    normalize(school.status) === "deleted" ||
    Boolean(school.deletedAt)
  );
}

export function filterActiveSchools(schools: School[]): School[] {
  return schools.filter((school) => !isSchoolDeleted(school));
}

export function validateSchoolForm(
  school: School,
  schools: School[],
  options: { isNew: boolean },
): string | null {
  const name = String(school.name ?? "").trim();
  if (name.length < 2) return "Le nom de l'établissement doit contenir au moins 2 caractères.";
  if (!String(school.type ?? "").trim()) return "Le type d'établissement est obligatoire.";
  if (!String(school.country ?? "").trim()) return "Le pays est obligatoire.";
  if (!String(school.city ?? "").trim()) return "La ville est obligatoire.";
  if (!String(school.phone ?? "").trim()) return "Le téléphone est obligatoire.";
  const email = String(school.email ?? "").trim();
  if (!email) return "L'email est obligatoire.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Format email invalide.";
  if (!String(school.principalName ?? "").trim()) return "Le responsable principal est obligatoire.";

  const code = String(school.code ?? "").trim().toUpperCase();
  if (!options.isNew && !code) return "Le code établissement est obligatoire.";
  if (code) {
    const duplicateCode = options.isNew
      ? schools.some((item) => normalize(item.code) === normalize(code))
      : schools.some(
          (item) => normalize(item.code) === normalize(code) && item.code !== school.code,
        );
    if (duplicateCode) return "Ce code établissement existe déjà.";
  }

  return null;
}

export const DUPLICATE_STRONG = "DUPLICATE_STRONG";
export const DUPLICATE_CONTACT = "DUPLICATE_CONTACT";
export const CROSS_COUNTRY_CONTACT_MATCH = "CROSS_COUNTRY_CONTACT_MATCH";

export type SchoolDuplicateLevel =
  | typeof DUPLICATE_STRONG
  | typeof DUPLICATE_CONTACT
  | typeof CROSS_COUNTRY_CONTACT_MATCH;

export interface SchoolDuplicateMatch {
  school: School;
  level: SchoolDuplicateLevel;
  reasons: string[];
}

const GENERIC_EMAILS = new Set([
  "contact@somafrik.app",
  "info@somafrik.app",
  "hello@somafrik.app",
  "admin@somafrik.app",
]);

const GENERIC_PHONES = new Set(["9090909", "0000000", "1111111", "1234567", "0123456789"]);

function schoolIdentityKeys(school: { code?: string; publicId?: string; loginCode?: string }): string[] {
  return [school.code, school.publicId, school.loginCode]
    .map((value) => normalize(value))
    .filter(Boolean);
}

function schoolCountryIso(school: { country?: string; countryCode?: string }): string {
  return getCountryCodeFromScope(school.countryCode) || getCountryCodeFromScope(school.country);
}

function phoneDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isGenericSchoolEmail(email?: string): boolean {
  const value = normalize(email);
  if (!value) return true;
  if (GENERIC_EMAILS.has(value)) return true;
  return /^(contact|info|hello|admin)@somafrik\./.test(value);
}

export function isGenericSchoolPhone(phone?: string): boolean {
  const digits = phoneDigits(phone);
  if (!digits) return true;
  if (GENERIC_PHONES.has(digits)) return true;
  return digits.length <= 7 && /^(\d)\1+$/.test(digits);
}

/**
 * Classification pays-aware.
 * Ancien algorithme dangereux : email OR phone OR (name AND city), sans country_id.
 */
export function classifySchoolDuplicates(school: School, schools: School[]): SchoolDuplicateMatch[] {
  const name = normalize(school.name);
  const city = normalize(school.city);
  const email = normalize(school.email);
  const phone = phoneDigits(school.phone);
  const identity = new Set(schoolIdentityKeys(school));
  const country = schoolCountryIso(school);
  const genericEmail = isGenericSchoolEmail(school.email);
  const genericPhone = isGenericSchoolPhone(school.phone);

  const matches: SchoolDuplicateMatch[] = [];
  for (const item of schools) {
    if (identity.size && schoolIdentityKeys(item).some((key) => identity.has(key))) continue;
    const itemCountry = schoolCountryIso(item);
    const sameCountry = Boolean(country && itemCountry && country === itemCountry);
    const sameNameCity = Boolean(name && city && normalize(item.name) === name && normalize(item.city) === city);
    const sameEmail = Boolean(email && normalize(item.email) === email);
    const samePhone = Boolean(phone && phoneDigits(item.phone) === phone);
    const contactEmail = sameEmail && !genericEmail && !isGenericSchoolEmail(item.email);
    const contactPhone = samePhone && !genericPhone && !isGenericSchoolPhone(item.phone);

    if (sameCountry && sameNameCity) {
      matches.push({
        school: item,
        level: DUPLICATE_STRONG,
        reasons: ["Même nom et ville dans ce pays"],
      });
      continue;
    }
    if (sameCountry && (contactEmail || contactPhone)) {
      const reasons = [
        contactEmail ? "Même email dans ce pays" : "",
        contactPhone ? "Même téléphone dans ce pays" : "",
      ].filter(Boolean);
      matches.push({ school: item, level: DUPLICATE_CONTACT, reasons });
      continue;
    }
    if (!sameCountry && (contactEmail || contactPhone)) {
      const reasons = [
        contactEmail ? "Même email dans un autre pays" : "",
        contactPhone ? "Même téléphone dans un autre pays" : "",
      ].filter(Boolean);
      matches.push({ school: item, level: CROSS_COUNTRY_CONTACT_MATCH, reasons });
    }
  }
  return matches;
}

/** Doublons bloquants : même pays uniquement. Le contact cross-country n'est pas un doublon métier. */
export function findPotentialDuplicates(school: School, schools: School[]): SchoolDuplicateMatch[] {
  return classifySchoolDuplicates(school, schools).filter(
    (match) => match.level === DUPLICATE_STRONG || match.level === DUPLICATE_CONTACT,
  );
}

export function countSchoolStudents(state: BackOfficeState, schoolCode: string): number {
  const code = normalize(schoolCode);
  const school = (state.schools as Array<School & { studentCount?: number }>).find(
    (row) => normalize(row.code) === code || normalize(row.publicId) === code,
  );
  if (school && Number.isFinite(Number(school.studentCount))) {
    return Math.max(0, Math.trunc(Number(school.studentCount)));
  }

  return (state.students as { schoolCode?: string; status?: string }[]).filter((row) => {
    if (normalize(String(row.schoolCode ?? "")) !== code) return false;
    const status = normalize(row.status);
    return !["inactive", "inactif", "archived", "archive", "archivé", "deleted", "supprime", "supprimé"].includes(status);
  }).length;
}

export function findSchoolAdmin(state: BackOfficeState, schoolCode: string): UserAccount | undefined {
  const code = normalize(schoolCode);
  return state.users.find(
    (user) =>
      normalize(user.schoolCode) === code &&
      (user.role === SCHOOL_ADMIN_ROLE || normalize(user.role) === "admin school"),
  );
}

export function schoolAuditHistory(auditLog: BackOfficeState["auditLog"], schoolCode: string): AuditEntry[] {
  const code = normalize(schoolCode);
  const rows = Array.isArray(auditLog) ? (auditLog as AuditEntry[]) : [];
  return rows.filter(
    (entry) =>
      entry.entityType === "school" &&
      (normalize(entry.entityId ?? "") === code || normalize(entry.schoolCode ?? "") === code),
  );
}

export function formatSchoolDate(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
