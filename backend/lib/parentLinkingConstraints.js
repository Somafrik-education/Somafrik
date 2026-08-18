"use strict";

/**
 * Contraintes canoniques liaison parent :
 * - contacts : un contact actif par (school_id, user_id)
 * - contact_relations : une relation active par (school_id, contact_id, student_id)
 *
 * Politique legacy : jamais de suppression silencieuse. Boot/migration fail-fast
 * avec inventaire si des doublons historiques existent.
 */

const CONTACTS_SCHOOL_USER_UNIQUE_INDEX = "uq_contacts_school_user_active";
const CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX = "uq_contact_relations_active";
const CONTACT_RELATIONS_LEGACY_UNIQUE = "contact_relations_school_id_contact_id_student_id_key";

const CONTACTS_SCHOOL_USER_DUPLICATES_CODE = "CONTACTS_SCHOOL_USER_DUPLICATES";
const CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE = "CONTACT_RELATIONS_ACTIVE_DUPLICATES";
const PARENT_LINKING_INDEX_MISSING_CODE = "PARENT_LINKING_INDEX_MISSING";

const COUNT_CONTACTS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, user_id
    FROM contacts
    WHERE user_id IS NOT NULL AND status = 'active'
    GROUP BY school_id, user_id
    HAVING COUNT(*) > 1
  ) d
`;

const LIST_CONTACTS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    c.user_id::text AS user_id,
    COUNT(*)::int AS duplicate_count,
    array_agg(c.id::text ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC NULLS LAST, c.id DESC) AS contact_ids
  FROM contacts c
  JOIN schools s ON s.id = c.school_id
  WHERE c.user_id IS NOT NULL AND c.status = 'active'
  GROUP BY s.school_code, c.user_id
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, c.user_id::text
  LIMIT 20
`;

const COUNT_CONTACT_RELATIONS_ACTIVE_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, contact_id, student_id
    FROM contact_relations
    WHERE status = 'active'
    GROUP BY school_id, contact_id, student_id
    HAVING COUNT(*) > 1
  ) d
`;

const LIST_CONTACT_RELATIONS_ACTIVE_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    r.contact_id::text AS contact_id,
    r.student_id::text AS student_id,
    COUNT(*)::int AS duplicate_count,
    array_agg(r.id::text ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC NULLS LAST, r.id DESC) AS relation_ids
  FROM contact_relations r
  JOIN schools s ON s.id = r.school_id
  WHERE r.status = 'active'
  GROUP BY s.school_code, r.contact_id, r.student_id
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, r.contact_id::text
  LIMIT 20
`;

const CREATE_CONTACTS_SCHOOL_USER_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${CONTACTS_SCHOOL_USER_UNIQUE_INDEX}
  ON contacts (school_id, user_id)
  WHERE user_id IS NOT NULL AND status = 'active'
`;

const CREATE_CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX}
  ON contact_relations (school_id, contact_id, student_id)
  WHERE status = 'active'
`;

const CHECK_INDEX_SQL = `
  SELECT 1 AS present
  FROM pg_indexes
  WHERE schemaname = ANY (current_schemas(false))
    AND indexname = $1
  LIMIT 1
`;

function formatContactsSchoolUserDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => `${row.school_code}/user=${row.user_id}×${row.duplicate_count}`)
    .join("; ");
  return (
    `Contacts : ${duplicateGroups} groupe(s) en doublon (school_id, user_id) actifs. ` +
    `Résolution explicite requise avant création de l'index ${CONTACTS_SCHOOL_USER_UNIQUE_INDEX}. ` +
    `Aucune suppression automatique n'est effectuée. ` +
    (samples ? `Exemples: ${samples}` : "Aucun détail disponible.")
  );
}

function formatContactRelationsActiveDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => `${row.school_code}/contact=${row.contact_id}/student=${row.student_id}×${row.duplicate_count}`)
    .join("; ");
  return (
    `Relations parent-enfant : ${duplicateGroups} groupe(s) actifs en doublon ` +
    `(school_id, contact_id, student_id). Résolution explicite requise avant ` +
    `l'index ${CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX}. Aucune suppression automatique. ` +
    (samples ? `Exemples: ${samples}` : "Aucun détail disponible.")
  );
}

function createParentLinkingConstraintsError(message, meta = {}) {
  const error = new Error(message);
  error.name = "ParentLinkingConstraintsError";
  error.code = meta.code || CONTACTS_SCHOOL_USER_DUPLICATES_CODE;
  if (meta.inventory) error.inventory = meta.inventory;
  return error;
}

async function inventoryContactsSchoolUserDuplicates(db) {
  const before = await db.one(COUNT_CONTACTS_SCHOOL_USER_DUPLICATE_GROUPS_SQL);
  const duplicateGroups = Number(before?.duplicate_groups ?? 0);
  const groups = duplicateGroups > 0 ? await db.all(LIST_CONTACTS_SCHOOL_USER_DUPLICATE_GROUPS_SQL) : [];
  return {
    duplicateGroups,
    groups: Array.isArray(groups) ? groups : [],
    diagnostic: formatContactsSchoolUserDuplicateDiagnostic(groups, duplicateGroups),
  };
}

async function inventoryContactRelationsActiveDuplicates(db) {
  const before = await db.one(COUNT_CONTACT_RELATIONS_ACTIVE_DUPLICATE_GROUPS_SQL);
  const duplicateGroups = Number(before?.duplicate_groups ?? 0);
  const groups = duplicateGroups > 0 ? await db.all(LIST_CONTACT_RELATIONS_ACTIVE_DUPLICATE_GROUPS_SQL) : [];
  return {
    duplicateGroups,
    groups: Array.isArray(groups) ? groups : [],
    diagnostic: formatContactRelationsActiveDuplicateDiagnostic(groups, duplicateGroups),
  };
}

async function dropLegacyContactRelationsUnique(db) {
  await db.query(
    `ALTER TABLE contact_relations DROP CONSTRAINT IF EXISTS ${CONTACT_RELATIONS_LEGACY_UNIQUE}`,
  );
}

async function assertIndexPresent(db, indexName) {
  const row = await db.one(CHECK_INDEX_SQL, [indexName]);
  if (!row) {
    throw createParentLinkingConstraintsError(
      `Index ${indexName} absent après tentative de création. Démarrage refusé.`,
      { code: PARENT_LINKING_INDEX_MISSING_CODE },
    );
  }
}

/**
 * Inventaire fail-safe puis index uniques (contacts user_id actif, relations actives).
 */
async function ensureParentLinkingConstraints(db, logger = console) {
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;

  const contactsInventory = await inventoryContactsSchoolUserDuplicates(db);
  logInfo(
    `[parent-linking] inventaire contacts (school_id, user_id) actifs : ` +
      `${contactsInventory.duplicateGroups} groupe(s) en doublon`,
  );
  if (contactsInventory.duplicateGroups > 0) {
    logError(contactsInventory.diagnostic);
    throw createParentLinkingConstraintsError(contactsInventory.diagnostic, {
      code: CONTACTS_SCHOOL_USER_DUPLICATES_CODE,
      inventory: contactsInventory,
    });
  }

  const relationsInventory = await inventoryContactRelationsActiveDuplicates(db);
  logInfo(
    `[parent-linking] inventaire relations actives : ` +
      `${relationsInventory.duplicateGroups} groupe(s) en doublon`,
  );
  if (relationsInventory.duplicateGroups > 0) {
    logError(relationsInventory.diagnostic);
    throw createParentLinkingConstraintsError(relationsInventory.diagnostic, {
      code: CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE,
      inventory: relationsInventory,
    });
  }

  await dropLegacyContactRelationsUnique(db);
  await db.query(CREATE_CONTACTS_SCHOOL_USER_UNIQUE_INDEX_SQL);
  await db.query(CREATE_CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX_SQL);
  await assertIndexPresent(db, CONTACTS_SCHOOL_USER_UNIQUE_INDEX);
  await assertIndexPresent(db, CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX);
}

function isContactsSchoolUserUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  return constraint.includes(CONTACTS_SCHOOL_USER_UNIQUE_INDEX) || constraint.includes("contacts");
}

function isContactRelationsActiveUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") return false;
  const constraint = String(error.constraint ?? "");
  return (
    constraint.includes(CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX) ||
    constraint.includes("contact_relations")
  );
}

module.exports = {
  CONTACTS_SCHOOL_USER_UNIQUE_INDEX,
  CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX,
  CONTACTS_SCHOOL_USER_DUPLICATES_CODE,
  CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE,
  PARENT_LINKING_INDEX_MISSING_CODE,
  CREATE_CONTACTS_SCHOOL_USER_UNIQUE_INDEX_SQL,
  CREATE_CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX_SQL,
  formatContactsSchoolUserDuplicateDiagnostic,
  formatContactRelationsActiveDuplicateDiagnostic,
  inventoryContactsSchoolUserDuplicates,
  inventoryContactRelationsActiveDuplicates,
  ensureParentLinkingConstraints,
  isContactsSchoolUserUniquenessViolation,
  isContactRelationsActiveUniquenessViolation,
};
