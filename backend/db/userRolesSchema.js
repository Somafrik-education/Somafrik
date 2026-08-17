"use strict";

const fs = require("node:fs");
const path = require("node:path");

const USER_ROLES_SCHEMA_SQL = [
  fs.readFileSync(path.join(__dirname, "migrations/20260820_user_roles_canonical.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260821_permanent_student_identifiers.sql"), "utf8"),
  fs.readFileSync(path.join(__dirname, "migrations/20260822_school_login_code.sql"), "utf8"),
  // Schéma + triggers uniquement. Le backfill legacy est opt-in :
  // migrations/20260824_student_canonical_identifier_backfill.sql
  fs.readFileSync(path.join(__dirname, "migrations/20260823_student_canonical_identifier.sql"), "utf8"),
].join("\n");

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

const INVENTORY_UNKNOWN_USERS_ROLE_SQL = `
SELECT u.id::text AS user_id, u.user_code, u.role
FROM users u
WHERE u.role IS NOT NULL
  AND btrim(u.role) <> ''
  AND upper(btrim(u.role)) NOT IN (${KNOWN_ROLE_KEYS_SQL})
  AND upper(btrim(u.role)) NOT IN (${KNOWN_ROLE_LABELS_SQL})
ORDER BY u.user_code
LIMIT 50
`;

const INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL = `
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
  AND upper(btrim(elem)) NOT IN (${KNOWN_ROLE_KEYS_SQL})
  AND upper(btrim(elem)) NOT IN (${KNOWN_ROLE_LABELS_SQL})
ORDER BY u.user_code
LIMIT 50
`;

const BACKFILL_FROM_USERS_ROLE_SQL = `
INSERT INTO user_roles (user_id, school_id, role_key, granted_at, status)
SELECT
  u.id,
  u.school_id,
  CASE upper(btrim(u.role))
    WHEN 'SUPER ADMINISTRATEUR SOMAFRIK' THEN 'SUPER_ADMIN'
    WHEN 'SUPER ADMINISTRATEUR OKAFRIK' THEN 'SUPER_ADMIN'
    WHEN 'ADMIN PAYS' THEN 'COUNTRY_ADMIN'
    WHEN 'ADMIN SCHOOL' THEN 'SCHOOL_ADMIN'
    WHEN 'PROVISEUR' THEN 'PROVISEUR'
    WHEN 'DIRECTEUR' THEN 'PRINCIPAL'
    WHEN 'PRÉFET DES ÉTUDES' THEN 'PREFET_ETUDES'
    WHEN 'PREFET DES ETUDES' THEN 'PREFET_ETUDES'
    WHEN 'ENSEIGNANT' THEN 'TEACHER'
    WHEN 'SECRÉTAIRE' THEN 'SECRETARY'
    WHEN 'SECRETAIRE' THEN 'SECRETARY'
    WHEN 'COMPTABLE' THEN 'ACCOUNTANT'
    WHEN 'PARENT' THEN 'PARENT'
    WHEN 'ÉLÈVE / ÉTUDIANT' THEN 'STUDENT'
    WHEN 'ELEVE / ETUDIANT' THEN 'STUDENT'
    WHEN 'SURVEILLANT' THEN 'SUPERVISOR'
    ELSE upper(btrim(u.role))
  END,
  COALESCE(u.created_at, NOW()),
  'active'
FROM users u
WHERE u.role IS NOT NULL AND btrim(u.role) <> ''
ON CONFLICT DO NOTHING
`;

const BACKFILL_FROM_SECONDARY_ROLES_SQL = `
INSERT INTO user_roles (user_id, school_id, role_key, granted_at, status)
SELECT
  u.id,
  u.school_id,
  CASE upper(btrim(elem))
    WHEN 'SUPER ADMINISTRATEUR SOMAFRIK' THEN 'SUPER_ADMIN'
    WHEN 'SUPER ADMINISTRATEUR OKAFRIK' THEN 'SUPER_ADMIN'
    WHEN 'ADMIN PAYS' THEN 'COUNTRY_ADMIN'
    WHEN 'ADMIN SCHOOL' THEN 'SCHOOL_ADMIN'
    WHEN 'PROVISEUR' THEN 'PROVISEUR'
    WHEN 'DIRECTEUR' THEN 'PRINCIPAL'
    WHEN 'PRÉFET DES ÉTUDES' THEN 'PREFET_ETUDES'
    WHEN 'PREFET DES ETUDES' THEN 'PREFET_ETUDES'
    WHEN 'ENSEIGNANT' THEN 'TEACHER'
    WHEN 'SECRÉTAIRE' THEN 'SECRETARY'
    WHEN 'SECRETAIRE' THEN 'SECRETARY'
    WHEN 'COMPTABLE' THEN 'ACCOUNTANT'
    WHEN 'PARENT' THEN 'PARENT'
    WHEN 'ÉLÈVE / ÉTUDIANT' THEN 'STUDENT'
    WHEN 'ELEVE / ETUDIANT' THEN 'STUDENT'
    WHEN 'SURVEILLANT' THEN 'SUPERVISOR'
    ELSE upper(btrim(elem))
  END,
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
ON CONFLICT DO NOTHING
`;

module.exports = {
  USER_ROLES_SCHEMA_SQL,
  USER_ROLES_MIGRATION_AMBIGUOUS,
  INVENTORY_UNKNOWN_USERS_ROLE_SQL,
  INVENTORY_UNKNOWN_SECONDARY_ROLES_SQL,
  BACKFILL_FROM_USERS_ROLE_SQL,
  BACKFILL_FROM_SECONDARY_ROLES_SQL,
};
