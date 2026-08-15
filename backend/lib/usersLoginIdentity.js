"use strict";

/**
 * Unicité identité de connexion users (email / téléphone).
 * Index partiels + inventaire fail-safe avant création (bases legacy).
 */

const USERS_SCHOOL_EMAIL_INDEX = "uq_users_school_email";
const USERS_SCHOOL_PHONE_INDEX = "uq_users_school_phone";
const USERS_PLATFORM_EMAIL_INDEX = "uq_users_platform_email";
const USERS_PLATFORM_PHONE_INDEX = "uq_users_platform_phone";
const USERS_LOGIN_IDENTITY_DUPLICATES_CODE = "USERS_LOGIN_IDENTITY_DUPLICATES";

/** Comptes exclus de l'unicité identité (aligné inventaire + index + validation applicative). */
function activeIdentityStatusSql(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `COALESCE(${prefix}status, 'active') NOT IN ('deleted', 'archived')`;
}

/** @deprecated Préférer activeIdentityStatusSql(alias) — réservé aux requêtes mono-table users sans alias. */
const ACTIVE_USER_IDENTITY_STATUS_SQL = activeIdentityStatusSql();

const DROP_USERS_LOGIN_IDENTITY_INDEXES_SQL = [
  `DROP INDEX IF EXISTS ${USERS_SCHOOL_EMAIL_INDEX}`,
  `DROP INDEX IF EXISTS ${USERS_SCHOOL_PHONE_INDEX}`,
  `DROP INDEX IF EXISTS ${USERS_PLATFORM_EMAIL_INDEX}`,
  `DROP INDEX IF EXISTS ${USERS_PLATFORM_PHONE_INDEX}`,
];

const COUNT_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, lower(trim(email)) AS email_key
    FROM users
    WHERE school_id IS NOT NULL
      AND email IS NOT NULL
      AND trim(email) <> ''
      AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
    GROUP BY school_id, lower(trim(email))
    HAVING COUNT(*) > 1
  ) d
`;

const COUNT_SCHOOL_PHONE_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT school_id, lower(trim(phone)) AS phone_key
    FROM users
    WHERE school_id IS NOT NULL
      AND phone IS NOT NULL
      AND trim(phone) <> ''
      AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
    GROUP BY school_id, lower(trim(phone))
    HAVING COUNT(*) > 1
  ) d
`;

const COUNT_PLATFORM_EMAIL_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT lower(trim(email)) AS email_key
    FROM users
    WHERE school_id IS NULL
      AND email IS NOT NULL
      AND trim(email) <> ''
      AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
    GROUP BY lower(trim(email))
    HAVING COUNT(*) > 1
  ) d
`;

const COUNT_PLATFORM_PHONE_DUPLICATE_GROUPS_SQL = `
  SELECT COUNT(*)::int AS duplicate_groups
  FROM (
    SELECT lower(trim(phone)) AS phone_key
    FROM users
    WHERE school_id IS NULL
      AND phone IS NOT NULL
      AND trim(phone) <> ''
      AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
    GROUP BY lower(trim(phone))
    HAVING COUNT(*) > 1
  ) d
`;

const LIST_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL = `
  SELECT s.school_code, lower(trim(u.email)) AS email_key, COUNT(*)::int AS duplicate_count,
         array_agg(u.user_code ORDER BY u.updated_at DESC NULLS LAST, u.id DESC) AS user_codes
  FROM users u
  JOIN schools s ON s.id = u.school_id
  WHERE u.school_id IS NOT NULL
    AND u.email IS NOT NULL
    AND trim(u.email) <> ''
    AND ${activeIdentityStatusSql("u")}
  GROUP BY s.school_code, lower(trim(u.email))
  HAVING COUNT(*) > 1
  ORDER BY s.school_code, email_key
  LIMIT 10
`;

const CREATE_USERS_SCHOOL_EMAIL_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${USERS_SCHOOL_EMAIL_INDEX}
  ON users (school_id, lower(trim(email)))
  WHERE school_id IS NOT NULL
    AND email IS NOT NULL
    AND trim(email) <> ''
    AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
`;

const CREATE_USERS_SCHOOL_PHONE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${USERS_SCHOOL_PHONE_INDEX}
  ON users (school_id, lower(trim(phone)))
  WHERE school_id IS NOT NULL
    AND phone IS NOT NULL
    AND trim(phone) <> ''
    AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
`;

const CREATE_USERS_PLATFORM_EMAIL_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${USERS_PLATFORM_EMAIL_INDEX}
  ON users (lower(trim(email)))
  WHERE school_id IS NULL
    AND email IS NOT NULL
    AND trim(email) <> ''
    AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
`;

const CREATE_USERS_PLATFORM_PHONE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ${USERS_PLATFORM_PHONE_INDEX}
  ON users (lower(trim(phone)))
  WHERE school_id IS NULL
    AND phone IS NOT NULL
    AND trim(phone) <> ''
    AND ${ACTIVE_USER_IDENTITY_STATUS_SQL}
`;

function formatUsersLoginIdentityDuplicateDiagnostic(samples = [], totalGroups = 0) {
  const details = (Array.isArray(samples) ? samples : [])
    .slice(0, 5)
    .map((row) => {
      const codes = Array.isArray(row.user_codes) ? row.user_codes.join(",") : String(row.user_codes ?? "");
      return `${row.school_code ?? "platform"}/${row.email_key ?? row.phone_key}×${row.duplicate_count}[${codes}]`;
    })
    .join("; ");
  return (
    `Users : ${totalGroups} groupe(s) en doublon (identité de connexion email/téléphone). ` +
    `Résolution explicite requise avant création des index d'unicité. ` +
    `Aucune suppression automatique n'est effectuée.` +
    (details ? ` Exemples: ${details}` : "")
  );
}

function createUsersLoginIdentityConstraintsError(message, meta = {}) {
  const error = new Error(message);
  error.name = "UsersLoginIdentityConstraintsError";
  error.code = meta.code || USERS_LOGIN_IDENTITY_DUPLICATES_CODE;
  if (meta.inventory) {
    error.inventory = meta.inventory;
  }
  return error;
}

function isUsersLoginIdentityUniquenessViolation(error) {
  const code = String(error?.code ?? "");
  if (code === "23505") {
    const constraint = String(error?.constraint ?? "");
    return (
      constraint.includes(USERS_SCHOOL_EMAIL_INDEX) ||
      constraint.includes(USERS_SCHOOL_PHONE_INDEX) ||
      constraint.includes(USERS_PLATFORM_EMAIL_INDEX) ||
      constraint.includes(USERS_PLATFORM_PHONE_INDEX)
    );
  }
  return false;
}

async function inventoryUsersLoginIdentityDuplicates(db) {
  const [schoolEmail, schoolPhone, platformEmail, platformPhone] = await Promise.all([
    db.one(COUNT_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL),
    db.one(COUNT_SCHOOL_PHONE_DUPLICATE_GROUPS_SQL),
    db.one(COUNT_PLATFORM_EMAIL_DUPLICATE_GROUPS_SQL),
    db.one(COUNT_PLATFORM_PHONE_DUPLICATE_GROUPS_SQL),
  ]);

  const duplicateGroups =
    Number(schoolEmail?.duplicate_groups ?? 0) +
    Number(schoolPhone?.duplicate_groups ?? 0) +
    Number(platformEmail?.duplicate_groups ?? 0) +
    Number(platformPhone?.duplicate_groups ?? 0);

  const samples =
    duplicateGroups > 0 ? await db.all(LIST_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL) : [];

  return {
    duplicateGroups,
    samples,
    diagnostic: formatUsersLoginIdentityDuplicateDiagnostic(samples, duplicateGroups),
  };
}

async function ensureUsersLoginIdentityConstraints(db, logger = console) {
  const logInfo = typeof logger.info === "function" ? logger.info.bind(logger) : console.log;
  const logError = typeof logger.error === "function" ? logger.error.bind(logger) : console.error;

  const inventory = await inventoryUsersLoginIdentityDuplicates(db);
  logInfo(
    `[users-identity] inventaire read-only (email/téléphone) : ${inventory.duplicateGroups} groupe(s) en doublon`,
  );

  if (inventory.duplicateGroups > 0) {
    logError(`[users-identity] ${inventory.diagnostic}`);
    throw createUsersLoginIdentityConstraintsError(inventory.diagnostic, {
      code: USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
      inventory: {
        duplicateGroups: inventory.duplicateGroups,
        sampleCount: inventory.samples.length,
      },
    });
  }

  for (const sql of DROP_USERS_LOGIN_IDENTITY_INDEXES_SQL) {
    await db.query(sql);
  }

  for (const sql of [
    CREATE_USERS_SCHOOL_EMAIL_INDEX_SQL,
    CREATE_USERS_SCHOOL_PHONE_INDEX_SQL,
    CREATE_USERS_PLATFORM_EMAIL_INDEX_SQL,
    CREATE_USERS_PLATFORM_PHONE_INDEX_SQL,
  ]) {
    await db.query(sql);
  }
}

async function lookupActiveUserByEmail(tx, { schoolId, email, excludeUserId }) {
  const emailKey = String(email ?? "").trim().toLowerCase();
  if (!emailKey) return null;
  const params = [];
  const excludeClause = excludeUserId ? `AND u.id::text <> $${params.push(excludeUserId)}` : "";
  if (schoolId) {
    const schoolParam = `$${params.push(schoolId)}`;
    const emailParam = `$${params.push(emailKey)}`;
    return tx.one(
      `SELECT u.id::text AS id, u.user_code
       FROM users u
       WHERE u.school_id = ${schoolParam}
         AND lower(trim(u.email)) = ${emailParam}
         AND ${activeIdentityStatusSql("u")}
         ${excludeClause}
       LIMIT 1`,
      params,
    );
  }
  const emailParam = `$${params.push(emailKey)}`;
  return tx.one(
    `SELECT u.id::text AS id, u.user_code
     FROM users u
     WHERE u.school_id IS NULL
       AND lower(trim(u.email)) = ${emailParam}
       AND ${activeIdentityStatusSql("u")}
       ${excludeClause}
     LIMIT 1`,
    params,
  );
}

async function lookupActiveUserByPhone(tx, { schoolId, phone, excludeUserId }) {
  const phoneKey = String(phone ?? "").trim().toLowerCase();
  if (!phoneKey) return null;
  const params = [];
  const excludeClause = excludeUserId ? `AND u.id::text <> $${params.push(excludeUserId)}` : "";
  if (schoolId) {
    const schoolParam = `$${params.push(schoolId)}`;
    const phoneParam = `$${params.push(phoneKey)}`;
    return tx.one(
      `SELECT u.id::text AS id, u.user_code
       FROM users u
       WHERE u.school_id = ${schoolParam}
         AND lower(trim(u.phone)) = ${phoneParam}
         AND ${activeIdentityStatusSql("u")}
         ${excludeClause}
       LIMIT 1`,
      params,
    );
  }
  const phoneParam = `$${params.push(phoneKey)}`;
  return tx.one(
    `SELECT u.id::text AS id, u.user_code
     FROM users u
     WHERE u.school_id IS NULL
       AND lower(trim(u.phone)) = ${phoneParam}
       AND ${activeIdentityStatusSql("u")}
       ${excludeClause}
     LIMIT 1`,
    params,
  );
}

/**
 * Compte actif portant le même email ou téléphone (même établissement, ou plateforme).
 */
async function findActiveUserByLoginIdentity(tx, input) {
  const excludeUserId = String(input.excludeUserId ?? "").trim();
  const schoolId = input.schoolId ?? null;
  const byEmail = await lookupActiveUserByEmail(tx, {
    schoolId,
    email: input.email,
    excludeUserId,
  });
  if (byEmail) return byEmail;
  return lookupActiveUserByPhone(tx, {
    schoolId,
    phone: input.phone,
    excludeUserId,
  });
}

/**
 * Vérifie l'unicité applicative avant INSERT/UPDATE (complète les index PG).
 * @param {{ one: Function }} tx
 * @param {{ schoolId: string | null, email?: string, phone?: string, excludeUserId?: string }} input
 */
async function assertUniqueUserLoginIdentity(tx, input) {
  const email = String(input.email ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const excludeUserId = String(input.excludeUserId ?? "").trim();
  const schoolId = input.schoolId ?? null;
  const platform = !schoolId;

  if (email) {
    const row = await lookupActiveUserByEmail(tx, { schoolId, email, excludeUserId });
    if (row) {
      const error = new Error(
        platform
          ? "Un compte plateforme avec cet email existe déjà."
          : "Un compte avec cet email existe déjà dans cet établissement.",
      );
      error.statusCode = 409;
      error.code = "USER_LOGIN_IDENTITY_DUPLICATE";
      throw error;
    }
  }

  if (phone) {
    const row = await lookupActiveUserByPhone(tx, { schoolId, phone, excludeUserId });
    if (row) {
      const error = new Error(
        platform
          ? "Un compte plateforme avec ce téléphone existe déjà."
          : "Un compte avec ce téléphone existe déjà dans cet établissement.",
      );
      error.statusCode = 409;
      error.code = "USER_LOGIN_IDENTITY_DUPLICATE";
      throw error;
    }
  }
}

module.exports = {
  USERS_LOGIN_IDENTITY_DUPLICATES_CODE,
  activeIdentityStatusSql,
  ACTIVE_USER_IDENTITY_STATUS_SQL,
  ensureUsersLoginIdentityConstraints,
  inventoryUsersLoginIdentityDuplicates,
  findActiveUserByLoginIdentity,
  assertUniqueUserLoginIdentity,
  isUsersLoginIdentityUniquenessViolation,
  formatUsersLoginIdentityDuplicateDiagnostic,
};
