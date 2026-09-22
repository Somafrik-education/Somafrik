import { getEffectivePermissionsForSession } from "../domain/security/permissions";

function normalizeToken(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const READ = ["Examens:READ", "Valider examens", "Organiser examens", "Gérer cours", "COUNTRY_PRIVILEGES", "ALL_PRIVILEGES"];
const CREATE = ["Organiser examens", "Valider examens", "Examens:CREATE", "Examens:UPDATE", "ALL_PRIVILEGES"];
const UPDATE = ["Organiser examens", "Valider examens", "Examens:UPDATE", "ALL_PRIVILEGES"];
const VALIDATE = ["Valider examens", "Examens:UPDATE", "ALL_PRIVILEGES"];
const ARCHIVE = ["Organiser examens", "Valider examens", "Examens:UPDATE", "Examens:DELETE", "ALL_PRIVILEGES"];

function hasAny(session: unknown, allowed: string[]) {
  const live = getEffectivePermissionsForSession(session).map(normalizeToken);
  if (live.includes(normalizeToken("ALL_PRIVILEGES"))) return true;
  return allowed.some((token) => live.includes(normalizeToken(token)));
}

export function canReadExams(session: unknown) {
  return hasAny(session, READ);
}

export function canCreateExams(session: unknown) {
  return hasAny(session, CREATE);
}

export function canUpdateExams(session: unknown) {
  return hasAny(session, UPDATE);
}

export function canValidateExams(session: unknown) {
  return hasAny(session, VALIDATE);
}

export function canArchiveExams(session: unknown) {
  return hasAny(session, ARCHIVE);
}

export const EXAM_RBAC_MATRIX = { READ, CREATE, UPDATE, VALIDATE, ARCHIVE };
