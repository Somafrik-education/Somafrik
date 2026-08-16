import type { AuditEntry } from "./audit";
import type { BackOfficeState, School, UserAccount } from "../types";
import { normalize } from "./format";
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

/** Doublons potentiels (ETB-S04). */
export function findPotentialDuplicates(school: School, schools: School[]): School[] {
  const name = normalize(school.name);
  const city = normalize(school.city);
  const email = normalize(school.email);
  const phone = normalize(school.phone);
  const code = normalize(school.code);

  return schools.filter((item) => {
    if (code && normalize(item.code) === code) return false;
    if (email && normalize(item.email) === email) return true;
    if (phone && normalize(item.phone) === phone) return true;
    if (name && city && normalize(item.name) === name && normalize(item.city) === city) return true;
    return false;
  });
}

export function countSchoolStudents(state: BackOfficeState, schoolCode: string): number {
  const code = normalize(schoolCode);
  return (state.students as { schoolCode?: string; status?: string }[]).filter((row) => {
    if (normalize(String(row.schoolCode ?? "")) !== code) return false;
    const status = normalize(row.status);
    return !["inactif", "archive", "archivé"].includes(status);
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
