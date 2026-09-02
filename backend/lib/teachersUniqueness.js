"use strict";

/**
 * Unicité atomique Teachers (établissement + compte utilisateur).
 * Index partiel + inventaire fail-safe avant création.
 *
 * Politique legacy : jamais de suppression silencieuse des doublons.
 * En présence de collisions, le boot/migration échoue avec un diagnostic précis.
 */

const TEACHERS_SCHOOL_USER_UNIQUE_INDEX = "teachers_school_user_unique";
const TEACHERS_DOMAIN_CONSTRAINTS_CODE = "TEACHERS_SCHOOL_USER_DUPLICATES";
const TEACHERS_DOMAIN_INDEX_MISSING_CODE = "TEACHERS_SCHOOL_USER_INDEX_MISSING";

/** Compte les groupes (school_id, user_id) en doublon (user_id non null). */
const COUNT_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, user_id
    FROM teachers
    WHERE user_id IS NOT NULL
    GROUP BY school_id, user_id
    HAVING COUNT(*) > 1
  ) d
`;

/**
 * Inventaire read-only des groupes en doublon.
 * Champs exposés : school_code, user_id (UUID), teacher_codes, duplicate_count.
 * Interdit : emails, téléphones, noms, mots de passe, hashes.
 */
const LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL = `
  SELECT
    s.school_code,
    t.user_id::text AS user_id,
    COUNT(*)::int AS duplicate_count,
    array_agg(t.teacher_code ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC) AS teacher_codes
  FROM teachers t
  JOIN schools s ON s.id = t.school_id
  WHERE t.user_id IS NOT NULL
  GROUP BY s.school_code, t.user_id
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, t.user_id::text
  LIMIT 20
`;

const CREATE_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}
  ON teachers (school_id, user_id)
  WHERE user_id IS NOT NULL
`;

const CHECK_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL = `
  SELECT 1 AS present
  FROM pg_indexes
  WHERE schemaname = ANY (current_schemas(false))
    AND indexname = $1
  LIMIT 1
`;

/**
 * @param {Array<{
 *   school_code?: string,
 *   user_id?: string,
 *   duplicate_count?: number,
 *   teacher_codes?: string[] | string,
 * }>} groups
 * @param {number} duplicateGroups
 * @returns {string}
 */
function formatTeachersSchoolUserDuplicateDiagnostic(groups = [], duplicateGroups = 0) {
  const samples = (Array.isArray(groups) ? groups : [])
    .slice(0, 10)
    .map((row) => {
      const codes = Array.isArray(row.teacher_codes)
        ? row.teacher_codes.join(",")
        : String(row.teacher_codes ?? "");
      return `${row.school_code}/user=${row.user_id}×${row.duplicate_count}[${codes}]`;
    })
    .join("; ");
  return (
    `Teachers : ${duplicateGroups} groupe(s) en doublon (school_id, user_id). ` +
    `Résolution explicite requise avant création de l'index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX}. ` +
    `Aucune suppression automatique n'est effectuée. ` +
    (samples ? `Exemples: ${samples}` : "Aucun détail disponible.")
  );
}

/**
 * @param {string} [detail]
 * @returns {string}
 */
function formatTeachersSchoolUserIndexMissingDiagnostic(detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  return (
    `Teachers : index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX} absent après tentative de création.` +
    ` Les contraintes domaine ne sont pas satisfaites — démarrage refusé.${suffix}`
  );
}

/**
 * Erreur domaine boot Teachers — message opérable, sans secrets.
 * @param {string} message
 * @param {{ code?: string, inventory?: object }} [meta]
 * @returns {Error & { code: string, inventory?: object }}
 */
function createTeachersDomainConstraintsError(message, meta = {}) {
  const error = new Error(message);
  error.name = "TeachersDomainConstraintsError";
  error.code = meta.code || TEACHERS_DOMAIN_CONSTRAINTS_CODE;
  if (meta.inventory) {
    error.inventory = meta.inventory;
  }
  return error;
}

/**
 * Inventaire strictement read-only des doublons (school_id, user_id).
 * Aucune écriture, aucune sélection de canon, aucune fusion.
 *
 * @param {{ one: Function, all: Function }} db
 * @returns {Promise<{
 *   duplicateGroups: number,
 *   groups: Array<object>,
 *   diagnostic: string,
 * }>}
 */
async function inventoryTeachersSchoolUserDuplicates(db) {
  const before = await db.one(COUNT_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL);
  const duplicateGroups = Number(before?.duplicate_groups ?? 0);
  const groups =
    duplicateGroups > 0 ? await db.all(LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL) : [];
  return {
    duplicateGroups,
    groups: Array.isArray(groups) ? groups : [],
    diagnostic: formatTeachersSchoolUserDuplicateDiagnostic(groups, duplicateGroups),
  };
}

/**
 * Applique les contraintes Teachers au boot.
 * Ordre : inventaire read-only → fail-fast si doublons → CREATE INDEX → re-vérification.
 *
 * @param {{ one: Function, all: Function, query: Function }} db
 * @param {{ info?: Function, error?: Function, warn?: Function }} [logger]
 */
async function ensureTeachersDomainConstraints(db, logger = console) {
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;

  const inventory = await inventoryTeachersSchoolUserDuplicates(db);
  logInfo(
    `[teachers-domain] inventaire read-only (school_id, user_id) : ` +
      `${inventory.duplicateGroups} groupe(s) en doublon` +
      (inventory.groups.length
        ? ` ; échantillon=${inventory.groups.length}`
        : " ; aucun doublon"),
  );

  if (inventory.duplicateGroups > 0) {
    logError(`[teachers-domain] ${inventory.diagnostic}`);
    throw createTeachersDomainConstraintsError(inventory.diagnostic, {
      code: TEACHERS_DOMAIN_CONSTRAINTS_CODE,
      inventory: {
        duplicateGroups: inventory.duplicateGroups,
        sampleCount: inventory.groups.length,
      },
    });
  }

  try {
    await db.query(CREATE_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL);
  } catch (error) {
    if (isTeachersSchoolUserUniquenessViolation(error)) {
      const groups = await db.all(LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL);
      const duplicateGroups = Array.isArray(groups) ? groups.length : 0;
      const diagnostic = formatTeachersSchoolUserDuplicateDiagnostic(groups, duplicateGroups);
      logError(`[teachers-domain] échec CREATE INDEX : ${diagnostic}`);
      throw createTeachersDomainConstraintsError(diagnostic, {
        code: TEACHERS_DOMAIN_CONSTRAINTS_CODE,
        inventory: { duplicateGroups, sampleCount: duplicateGroups },
      });
    }
    throw error;
  }

  const after = await inventoryTeachersSchoolUserDuplicates(db);
  if (after.duplicateGroups > 0) {
    logError(`[teachers-domain] doublons persistants après CREATE INDEX : ${after.diagnostic}`);
    throw createTeachersDomainConstraintsError(after.diagnostic, {
      code: TEACHERS_DOMAIN_CONSTRAINTS_CODE,
      inventory: {
        duplicateGroups: after.duplicateGroups,
        sampleCount: after.groups.length,
      },
    });
  }

  const indexRow = await db.one(CHECK_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL, [
    TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  ]);
  if (!indexRow?.present) {
    const diagnostic = formatTeachersSchoolUserIndexMissingDiagnostic();
    logError(`[teachers-domain] ${diagnostic}`);
    throw createTeachersDomainConstraintsError(diagnostic, {
      code: TEACHERS_DOMAIN_INDEX_MISSING_CODE,
    });
  }

  logInfo(
    `[teachers-domain] contraintes satisfaites (index ${TEACHERS_SCHOOL_USER_UNIQUE_INDEX} présent, 0 doublon)`,
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTeachersSchoolUserUniquenessViolation(error) {
  if (!error || String(error.code) !== "23505") {
    return false;
  }
  const constraint = String(error.constraint ?? "");
  const detail = String(error.detail ?? "");
  const message = String(error.message ?? "");
  return (
    constraint === TEACHERS_SCHOOL_USER_UNIQUE_INDEX ||
    detail.includes(TEACHERS_SCHOOL_USER_UNIQUE_INDEX) ||
    message.includes(TEACHERS_SCHOOL_USER_UNIQUE_INDEX) ||
    /Key \(school_id, user_id\)/i.test(detail)
  );
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTeachersDomainConstraintsError(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  return (
    code === TEACHERS_DOMAIN_CONSTRAINTS_CODE ||
    code === TEACHERS_DOMAIN_INDEX_MISSING_CODE ||
    error.name === "TeachersDomainConstraintsError"
  );
}

module.exports = {
  TEACHERS_SCHOOL_USER_UNIQUE_INDEX,
  TEACHERS_DOMAIN_CONSTRAINTS_CODE,
  TEACHERS_DOMAIN_INDEX_MISSING_CODE,
  COUNT_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL,
  LIST_TEACHERS_SCHOOL_USER_DUPLICATE_GROUPS_SQL,
  CREATE_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL,
  CHECK_TEACHERS_SCHOOL_USER_UNIQUE_INDEX_SQL,
  formatTeachersSchoolUserDuplicateDiagnostic,
  formatTeachersSchoolUserIndexMissingDiagnostic,
  createTeachersDomainConstraintsError,
  inventoryTeachersSchoolUserDuplicates,
  ensureTeachersDomainConstraints,
  isTeachersSchoolUserUniquenessViolation,
  isTeachersDomainConstraintsError,
};
