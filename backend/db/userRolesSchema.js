"use strict";

const fs = require("node:fs");
const path = require("node:path");

const USER_ROLES_PRELOCK_SCHEMA_SQL = [
  fs.readFileSync(path.join(__dirname, "migrations/20260820_user_roles_canonical.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260821_permanent_student_identifiers.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260822_school_login_code.sql"), "utf8"),
  // Schéma + triggers uniquement. Le backfill legacy est opt-in :
  // migrations/20260824_student_canonical_identifier_backfill.sql
  fs.readFileSync(path.join(__dirname, "migrations/20260823_student_canonical_identifier.sql"), "utf8"),
  // Compteur login_code établissement : (country_id, year) global.
  // Backfill rewrite opt-in : 20260825_school_login_code_seq_backfill.sql (jamais au boot).
  fs.readFileSync(path.join(__dirname, "migrations/20260825_school_login_code_country_year.sql"), "utf8"),
  // Les suffixes d'unicité du short_code restent internes ; les initiales publiques
  // conservent le segment métier tout en permettant un override sémantique contrôlé.
  fs.readFileSync(path.join(__dirname, "migrations/20260902_school_login_code_public_initials.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260906_business_profile_exclusivity.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260907_student_user_id.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260908_student_role_lock.sql"), "utf8"),
].join("\n");

const STUDENT_ROLE_LOCK_TRIGGER_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260909_student_role_lock_trigger.sql"),
  "utf8",
);

const USER_ROLES_SCHEMA_SQL = [USER_ROLES_PRELOCK_SCHEMA_SQL, STUDENT_ROLE_LOCK_TRIGGER_SQL].join("\n");

const USER_ROLES_MIGRATION_AMBIGUOUS = "USER_ROLES_MIGRATION_AMBIGUOUS";

const KNOWN_ROLE_KEYS_SQL = `
  'SUPER_ADMIN', 'COUNTRY_ADMIN', 'SCHOOL_ADMIN', 'PROVISEUR', 'PRINCIPAL',
  'PREFET_ETUDES', 'TEACHER', 'SECRETARY', 'ACCOUNTANT', 'PARENT', 'STUDENT', 'SUPERVISOR'
`;

const KNOWN_ROLE_LABELS_SQL = `
  'SUPER ADMINISTRATEUR SOMAFRIK', 'SUPER ADMINISTRATEUR OKAFRIK',
  'ADMIN PAYS', 'ADMIN SCHOOL', 'PROVISEUR', 'DIRECTEUR',
  'PRÉFET DES ÉTUDES', 'PREFET DES ETUDES',
  'ENSEIGNANT', 'SECRÉTAIRE', 'SECRETAIRE', 'COMPTABLE',
  'PARENT', 'ÉLÈVE / ÉTUDIANT', 'ELEVE / ETUDIANT', 'SURVEILLANT'
`;

/**
 * Équivalent SQL de normalizeRoleCode() :
 * trim, lowercase, NFD, suppression des diacritiques, non alphanumériques → `_`, trim `_`.
 * Indépendant de l'extension unaccent.
 */
const NORMALIZE_ROLE_CODE_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION somafrik_normalize_role_code(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN src IS NULL OR btrim(src) = '' THEN ''
    ELSE regexp_replace(
      regexp_replace(
        regexp_replace(
          normalize(lower(btrim(src)), NFD),
          '[' || chr(768) || '-' || chr(879) || ']',
          '',
          'g'
        ),
        '[^a-z0-9]+',
        '_',
        'g'
      ),
      '^_+|_+$',
      '',
      'g'
    )
  END;
$$;
`;

function staticLabelMapSql(legacyExpr) {
  const value = `upper(btrim(${legacyExpr}))`;
  return `
    WHEN ${value} = 'SUPER ADMINISTRATEUR SOMAFRIK' THEN 'SUPER_ADMIN'
    WHEN ${value} = 'SUPER ADMINISTRATEUR OKAFRIK' THEN 'SUPER_ADMIN'
    WHEN ${value} = 'ADMIN PAYS' THEN 'COUNTRY_ADMIN'
    WHEN ${value} = 'ADMIN SCHOOL' THEN 'SCHOOL_ADMIN'
    WHEN ${value} = 'PROVISEUR' THEN 'PROVISEUR'
    WHEN ${value} = 'DIRECTEUR' THEN 'PRINCIPAL'
    WHEN ${value} = 'PRÉFET DES ÉTUDES' THEN 'PREFET_ETUDES'
    WHEN ${value} = 'PREFET DES ETUDES' THEN 'PREFET_ETUDES'
    WHEN ${value} = 'ENSEIGNANT' THEN 'TEACHER'
    WHEN ${value} = 'SECRÉTAIRE' THEN 'SECRETARY'
    WHEN ${value} = 'SECRETAIRE' THEN 'SECRETARY'
    WHEN ${value} = 'COMPTABLE' THEN 'ACCOUNTANT'
    WHEN ${value} = 'PARENT' THEN 'PARENT'
    WHEN ${value} = 'ÉLÈVE / ÉTUDIANT' THEN 'STUDENT'
    WHEN ${value} = 'ELEVE / ETUDIANT' THEN 'STUDENT'
    WHEN ${value} = 'SURVEILLANT' THEN 'SUPERVISOR'
`;
}

function isStaticKnownRoleSql(expr) {
  return `(
    upper(btrim(${expr})) IN (${KNOWN_ROLE_KEYS_SQL})
    OR upper(btrim(${expr})) IN (${KNOWN_ROLE_LABELS_SQL})
  )`;
}

function catalogUniqueMatchSql(legacyExpr, schoolIdExpr = "u.school_id") {
  return `(
    ${schoolIdExpr} IS NOT NULL
    AND (
      SELECT COUNT(*)::int
      FROM establishment_roles er
      WHERE lower(btrim(er.status)) = 'active'
        AND lower(btrim(er.scope)) = 'school'
        AND (
          somafrik_normalize_role_code(er.role_code) = somafrik_normalize_role_code(${legacyExpr})
          OR somafrik_normalize_role_code(er.role_name) = somafrik_normalize_role_code(${legacyExpr})
        )
    ) = 1
  )`;
}

function catalogRoleCodeSql(legacyExpr, schoolIdExpr = "u.school_id") {
  return `(
    CASE
      WHEN ${schoolIdExpr} IS NULL THEN NULL
      ELSE (
        SELECT MIN(er.role_code)
        FROM establishment_roles er
        WHERE lower(btrim(er.status)) = 'active'
          AND lower(btrim(er.scope)) = 'school'
          AND (
            somafrik_normalize_role_code(er.role_code) = somafrik_normalize_role_code(${legacyExpr})
            OR somafrik_normalize_role_code(er.role_name) = somafrik_normalize_role_code(${legacyExpr})
          )
      )
    END
  )`;
}

function mapLegacyRoleKeySql(legacyExpr, catalogAvailable) {
  const catalogElse = catalogAvailable ? catalogRoleCodeSql(legacyExpr) : "NULL";
  return `CASE
    WHEN upper(btrim(${legacyExpr})) IN (${KNOWN_ROLE_KEYS_SQL}) THEN upper(btrim(${legacyExpr}))
    ${staticLabelMapSql(legacyExpr)}
    ELSE ${catalogElse}
  END`;
}

function inventoryUnknownUsersRoleSql(catalogAvailable) {
  const catalogOk = catalogAvailable ? `AND NOT ${catalogUniqueMatchSql("u.role")}` : "";
  return `
SELECT u.id::text AS user_id, u.user_code, u.role
FROM users u
WHERE u.role IS NOT NULL
  AND btrim(u.role) <> ''
  AND NOT ${isStaticKnownRoleSql("u.role")}
  ${catalogOk}
ORDER BY u.user_code
LIMIT 50
`;
}

function inventoryUnknownSecondaryRolesSql(catalogAvailable) {
  const catalogOk = catalogAvailable ? `AND NOT ${catalogUniqueMatchSql("elem")}` : "";
  return `
SELECT u.id::text AS user_id, u.user_code, elem AS secondary_role
FROM users u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(COALESCE(u.profile_payload, '{}'::jsonb)->'secondaryRoles') = 'array'
      THEN u.profile_payload->'secondaryRoles'
    ELSE '[]'::jsonb
  END
) AS elem
WHERE btrim(elem) <> ''
  AND NOT ${isStaticKnownRoleSql("elem")}
  ${catalogOk}
ORDER BY u.user_code
LIMIT 50
`;
}

function linkedActiveStudentExistsSql(userIdExpr) {
  return `EXISTS (
    SELECT 1
    FROM students st
    WHERE NULLIF(to_jsonb(st)->>'user_id', '') = (${userIdExpr})::text
      AND COALESCE(NULLIF(to_jsonb(st)->>'status', ''), 'active')
        NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  )`;
}

function backfillFromUsersRoleSql(catalogAvailable) {
  const mappedRole = mapLegacyRoleKeySql("u.role", catalogAvailable);
  return `
INSERT INTO user_roles (user_id, school_id, role_key, granted_at, status)
SELECT
  u.id,
  u.school_id,
  ${mappedRole},
  COALESCE(u.created_at, NOW()),
  'active'
FROM users u
WHERE u.role IS NOT NULL AND btrim(u.role) <> ''
  AND (
    (${mappedRole}) = 'STUDENT'
    OR NOT ${linkedActiveStudentExistsSql("u.id")}
  )
ON CONFLICT DO NOTHING
`;
}

function backfillFromSecondaryRolesSql(catalogAvailable) {
  const mappedRole = mapLegacyRoleKeySql("elem", catalogAvailable);
  return `
INSERT INTO user_roles (user_id, school_id, role_key, granted_at, status)
SELECT
  u.id,
  u.school_id,
  ${mappedRole},
  COALESCE(u.created_at, NOW()),
  'active'
FROM users u
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(COALESCE(u.profile_payload, '{}'::jsonb)->'secondaryRoles') = 'array'
      THEN u.profile_payload->'secondaryRoles'
    ELSE '[]'::jsonb
  END
) AS elem
WHERE btrim(elem) <> ''
  AND (
    (${mappedRole}) = 'STUDENT'
    OR NOT ${linkedActiveStudentExistsSql("u.id")}
  )
ON CONFLICT DO NOTHING
`;
}

const INVENTORY_UNKNOWN_USERS_ROLE_SQL = inventoryUnknownUsersRoleSql(false);
const INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL = inventoryUnknownSecondaryRolesSql(false);
const BACKFILL_FROM_USERS_ROLE_SQL = backfillFromUsersRoleSql(false);
const BACKFILL_FROM_SECONDARY_ROLES_SQL = backfillFromSecondaryRolesSql(false);

module.exports = {
  USER_ROLES_PRELOCK_SCHEMA_SQL,
  STUDENT_ROLE_LOCK_TRIGGER_SQL,
  USER_ROLES_SCHEMA_SQL,
  USER_ROLES_MIGRATION_AMBIGUOUS,
  KNOWN_ROLE_KEYS_SQL,
  KNOWN_ROLE_LABELS_SQL,
  NORMALIZE_ROLE_CODE_FUNCTION_SQL,
  INVENTORY_UNKNOWN_USERS_ROLE_SQL,
  INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL,
  BACKFILL_FROM_USERS_ROLE_SQL,
  BACKFILL_FROM_SECONDARY_ROLES_SQL,
  isStaticKnownRoleSql,
  catalogUniqueMatchSql,
  catalogRoleCodeSql,
  inventoryUnknownUsersRoleSql,
  inventoryUnknownSecondaryRolesSql,
  linkedActiveStudentExistsSql,
  backfillFromUsersRoleSql,
  backfillFromSecondaryRolesSql,
};
