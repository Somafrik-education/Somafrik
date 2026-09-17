"use strict";

const { toRoleKey } = require("./userRoleLifecycle");

const PUBLIC_DEMO_LOGIN_CODE = "CD-IN-26-001";
const ALLOWED_PUBLIC_DEMO_ROLE_KEYS = new Set([
  "SCHOOL_ADMIN",
  "PROVISEUR",
  "PRINCIPAL",
  "PREFET_ETUDES",
  "ACCOUNTANT",
  "SECRETARY",
  "SUPERVISOR",
  "TEACHER",
  "PARENT",
  "STUDENT",
]);

function asRef(value) {
  return String(value ?? "").trim();
}

function normalizeLoginCode(value) {
  return asRef(value).toUpperCase();
}

function normalizeDemoRoleKey(value) {
  const roleKey = toRoleKey(value);
  if (!roleKey || !ALLOWED_PUBLIC_DEMO_ROLE_KEYS.has(roleKey)) {
    return "";
  }
  return roleKey;
}

async function loadPublicDemoSchool(client, loginCode = PUBLIC_DEMO_LOGIN_CODE) {
  const code = normalizeLoginCode(loginCode);
  if (!code) throw new Error("PUBLIC_DEMO_ROLE_REPAIR_LOGIN_CODE_REQUIRED");
  const result = await client.query(
    `SELECT id, school_code, login_code
     FROM schools
     WHERE UPPER(COALESCE(login_code, '')) = $1
       AND COALESCE(status, 'active') = 'active'`,
    [code],
  );
  if (result.rowCount !== 1) {
    throw new Error(`PUBLIC_DEMO_ROLE_REPAIR_SCHOOL_NOT_UNIQUE:${result.rowCount}`);
  }
  return result.rows[0];
}

async function loadPublicDemoUsers(client, schoolId) {
  const result = await client.query(
    `SELECT id, user_code, role
     FROM users
     WHERE school_id = $1
       AND COALESCE(status, 'active') = 'active'
       AND NULLIF(BTRIM(COALESCE(role, '')), '') IS NOT NULL
     ORDER BY id`,
    [schoolId],
  );
  return result.rows;
}

async function hasLinkedStudentProfile(client, userId, schoolId) {
  const result = await client.query(
    `SELECT 1
     FROM students
     WHERE user_id = $1
       AND school_id = $2
       AND COALESCE(status, 'active') = 'active'
     LIMIT 1`,
    [userId, schoolId],
  );
  return result.rowCount > 0;
}

async function ensureActiveCanonicalRole(client, { userId, schoolId, roleKey }) {
  const result = await client.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, granted_by, granted_at, status)
     SELECT $1, $2, $3, NULL, NOW(), 'active'
     WHERE NOT EXISTS (
       SELECT 1
       FROM user_roles
       WHERE user_id = $1
         AND school_id = $2
         AND role_key = $3
         AND status = 'active'
         AND revoked_at IS NULL
     )
     RETURNING id`,
    [userId, schoolId, roleKey],
  );
  return result.rowCount > 0;
}

async function roleProof(client, schoolId) {
  const result = await client.query(
    `SELECT role_key, COUNT(*)::int AS count
     FROM user_roles
     WHERE school_id = $1
       AND status = 'active'
       AND revoked_at IS NULL
     GROUP BY role_key
     ORDER BY role_key`,
    [schoolId],
  );
  const counts = Object.fromEntries(
    result.rows.map((row) => [String(row.role_key), Number(row.count ?? 0)]),
  );
  return {
    counts,
    schoolAdmins: Number(counts.SCHOOL_ADMIN ?? 0),
    teachers: Number(counts.TEACHER ?? 0),
  };
}

/**
 * Répare uniquement les memberships canoniques de l'école Démo publique.
 * La source de migration est `users.role` persisté en PostgreSQL, jamais le JWT.
 * Aucun rôle plateforme n'est accepté et aucun autre établissement n'est touché.
 *
 * Ce backfill est idempotent : il n'insère qu'une ligne active manquante.
 */
async function repairPublicDemoCanonicalRoles(
  client,
  { loginCode = PUBLIC_DEMO_LOGIN_CODE } = {},
) {
  if (!client || typeof client.query !== "function") {
    throw new Error("PUBLIC_DEMO_ROLE_REPAIR_CLIENT_REQUIRED");
  }

  const school = await loadPublicDemoSchool(client, loginCode);
  const schoolId = asRef(school.id);
  if (!schoolId) throw new Error("PUBLIC_DEMO_ROLE_REPAIR_SCHOOL_ID_REQUIRED");

  const users = await loadPublicDemoUsers(client, schoolId);
  let inserted = 0;
  let considered = 0;

  for (const user of users) {
    const roleKey = normalizeDemoRoleKey(user.role);
    if (!roleKey) {
      throw new Error(
        `PUBLIC_DEMO_ROLE_REPAIR_ROLE_FORBIDDEN:${asRef(user.user_code) || asRef(user.id)}:${asRef(user.role)}`,
      );
    }

    const linkedStudent = await hasLinkedStudentProfile(client, user.id, schoolId);
    if (linkedStudent && roleKey !== "STUDENT") {
      throw new Error(
        `PUBLIC_DEMO_ROLE_REPAIR_STUDENT_ROLE_CONFLICT:${asRef(user.user_code) || asRef(user.id)}:${roleKey}`,
      );
    }

    considered += 1;
    if (await ensureActiveCanonicalRole(client, { userId: user.id, schoolId, roleKey })) {
      inserted += 1;
    }
  }

  const proof = await roleProof(client, schoolId);
  if (proof.schoolAdmins < 1) {
    throw new Error("PUBLIC_DEMO_ROLE_REPAIR_SCHOOL_ADMIN_MISSING");
  }
  if (proof.teachers < 1) {
    throw new Error("PUBLIC_DEMO_ROLE_REPAIR_TEACHER_MISSING");
  }

  return {
    schoolId,
    schoolCode: asRef(school.school_code),
    loginCode: normalizeLoginCode(school.login_code),
    users: considered,
    inserted,
    ...proof,
  };
}

module.exports = {
  PUBLIC_DEMO_LOGIN_CODE,
  ALLOWED_PUBLIC_DEMO_ROLE_KEYS,
  normalizeDemoRoleKey,
  repairPublicDemoCanonicalRoles,
};
