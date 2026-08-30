"use strict";

/**
 * ID-CANONICAL-01 — règles d'inventaire des identités legacy.
 * Lot A : mode rapport (les hits ne bloquent pas).
 * Lot D : --strict échoue sur tout hit hors allowlist.
 */

const REQUIRED_ENTITIES = [
  "Country",
  "School",
  "User",
  "Teacher",
  "Student",
  "Class",
  "Subject",
  "AcademicYear",
  "Term",
  "Assignment",
  "Evaluation",
  "Grade",
  "Attendance",
  "Payment",
  "Invoice/Fee",
  "CourseSchedule",
  "Room",
  "Announcement",
  "Message",
];

/** Allowlist minuscule : documentation historique, audits, migrations SQL immuables, ce chantier. */
const ALLOWLIST_PREFIXES = [
  "docs/audits/",
  "docs/project/",
  "docs/recommandations-addendum-2026-06-13.md",
  "docs/user-guides/KNOWN-ISSUES.md",
  "docs/mobile/E2E-RUNTIME-QA.md",
  "docs/ux/design-system/CONTRAT-",
  "scripts/id-canonical/",
  "scripts/verify-id-canonical.js",
  "backend/db/migrations/20260819_teacher_legacy_code.sql",
  "backend/db/migrations/20260903_drop_legacy_teacher_code.sql",
  "backend/db/migrations/20260821_permanent_student_identifiers.sql",
  "backend/db/migrations/20260822_school_login_code.sql",
  "backend/db/migrations/20260823_student_canonical_identifier.sql",
  "backend/db/migrations/20260824_student_canonical_identifier_backfill.sql",
  "backend/db/migrations/20260825_school_login_code",
];

const FORBIDDEN_RUNTIME_ALLOWLIST_ROOTS = ["backend/", "web/", "Mobile/", "apps/", "packages/"];
const HISTORICAL_SQL_ALLOWLIST_RE = /^backend\/db\/migrations\/20\d{6}_[A-Za-z0-9._-]+$/;

function isHistoricalSqlMigrationAllowlistEntry(prefix) {
  return HISTORICAL_SQL_ALLOWLIST_RE.test(String(prefix ?? "").replaceAll("\\", "/"));
}

function isForbiddenRuntimeAllowlistEntry(prefix) {
  const normalized = String(prefix ?? "").replaceAll("\\", "/");
  if (isHistoricalSqlMigrationAllowlistEntry(normalized)) {
    return false;
  }
  return FORBIDDEN_RUNTIME_ALLOWLIST_ROOTS.some((root) => {
    const name = root.slice(0, -1);
    return normalized === name || normalized === root || normalized.startsWith(root);
  });
}

const SCAN_ROOTS = [
  "backend",
  "web",
  "Mobile",
  "apps",
  "packages",
  "scripts",
  "tests",
  "BackOffice",
  ".github",
];

const SCAN_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".sql",
  ".json",
  ".yml",
  ".yaml",
  ".md",
]);

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".expo",
  "android",
  "ios",
]);

const RULES = [
  {
    id: "LEGACY_SCHOOL_CODE_FORMAT",
    severity: "runtime",
    description: "Format établissement interdit CC-YYYY-NNNN (ex. CD-2026-0001)",
    re: /\b[A-Za-z]{2}-20\d{2}-\d{4}\b/gi,
  },
  {
    id: "LEGACY_SHORT_TEACHER_LOGIN",
    severity: "runtime",
    description: "Login enseignant court ENS-#### (ex. ENS-0001)",
    re: /\bENS-\d{4}\b/gi,
  },
  {
    id: "LEGACY_COMPOSITE_TEACHER_CODE",
    severity: "runtime",
    description: "Code enseignant composite legacy CC-YYYY-NNNN-ENS-####",
    re: /\b[A-Za-z]{2}-20\d{2}-\d{4}-ENS-\d+\b/gi,
  },
  {
    id: "LEGACY_TEACHER_CODE_COLUMN",
    severity: "schema",
    description: "Colonne / champ legacy_teacher_code",
    re: /\blegacy_teacher_code\b/g,
  },
  {
    id: "LEGACY_SHORT_TEACHER_HELPER",
    severity: "helper",
    description: "Helper de compatibilité isLegacyShortTeacherCode / LEGACY_SHORT_TEACHER_CODE_RE",
    re: /\b(isLegacyShortTeacherCode|LEGACY_SHORT_TEACHER_CODE_RE|extractTeacherLoginId)\b/g,
  },
  {
    id: "TEACHER_SUFFIX_SQL",
    severity: "helper",
    description: "Matching SQL par suffixe ENS-#### / right(teacher_code)",
    re: /right\(\s*\w+\.(teacher_code|user_code)\s*,|sqlTeacher(PublicCode|Identity)Equals/g,
  },
  {
    id: "TEACHER_SUFFIX_JS",
    severity: "helper",
    description: "Matching JS par suffixe / endsWith('-ENS-…')",
    re: /endsWith\(\s*[`'"]-\$\{|teacherPublicCodesMatch\b/g,
  },
  {
    id: "MULTI_ALIAS_TEACHER_LOOKUP",
    severity: "lookup",
    description: "Lookup enseignant multi-alias teacher_code OR legacy_teacher_code",
    re: /teacher_code\s*=[\s\S]{0,80}legacy_teacher_code|legacy_teacher_code\s*=[\s\S]{0,80}teacher_code/g,
  },
  {
    id: "MATERIALIZE_BACKOFFICE_IDENTITY",
    severity: "fallback",
    description: "Matérialisation BackOffice utilisée comme fallback d'identité",
    re: /\bmaterializeBackOffice(Teacher|Assignment|Student)\b/g,
  },
  {
    id: "COLLECT_TEACHER_LOOKUP_KEYS",
    severity: "fallback",
    description: "collectTeacherLookupKeysForPrincipal — multi-clés + projection BO",
    re: /\bcollectTeacherLookupKeysForPrincipal\b/g,
  },
  {
    id: "SCHOOL_MULTI_KEY_LOOKUP",
    severity: "lookup",
    description: "Lookup établissement multi-clés (loginCode OR publicId OR code OR school_code)",
    re: /\bschoolLookupKeys\b|\bmatchesSchoolLookup\b|\blegacySchoolCode\b/g,
  },
  {
    id: "LEGACY_JSON_ID_LOOKUP",
    severity: "lookup",
    description: "Lookup identité via legacy_json_id (UUID OR code BO)",
    re: /\blegacy_json_id\b/g,
  },
];

function isAllowlisted(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  return ALLOWLIST_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix));
}

module.exports = {
  REQUIRED_ENTITIES,
  ALLOWLIST_PREFIXES,
  FORBIDDEN_RUNTIME_ALLOWLIST_ROOTS,
  HISTORICAL_SQL_ALLOWLIST_RE,
  SCAN_ROOTS,
  SCAN_EXTENSIONS,
  IGNORE_DIR_NAMES,
  RULES,
  isAllowlisted,
  isHistoricalSqlMigrationAllowlistEntry,
  isForbiddenRuntimeAllowlistEntry,
};
