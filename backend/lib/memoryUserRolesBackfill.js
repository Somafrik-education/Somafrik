"use strict";

const { toRoleKey } = require("./userRoleLifecycle");

const ACTIVE_STATUSES = new Set(["actif", "active"]);
const UNAFFECTED = new Set(["", "sans affectation"]);

function asRef(value) {
  return String(value ?? "").trim();
}

function normalizeCode(value) {
  return asRef(value).toUpperCase();
}

function usersFromSeedAccounts(schools, userAccounts = []) {
  const users = [];
  for (const account of userAccounts) {
    const id = asRef(account?.id);
    const schoolId = schoolIdForAccount(schools, account?.schoolCode);
    if (!id || !schoolId) continue;
    users.push({
      id,
      school_id: schoolId,
      user_code: asRef(account.userCode || account.user_code || account.publicId || id),
      first_name: account.firstName ?? account.first_name ?? "",
      last_name: account.lastName ?? account.last_name ?? "",
      email: account.email ?? "",
      phone: account.phone ?? "",
      role: account.role ?? null,
      status: "active",
      ...(account.password ? { password: account.password } : {}),
      ...(account.passwordHash ? { password_hash: account.passwordHash } : {}),
      ...(account.temporaryPassword
        ? { temporary_password: account.temporaryPassword, must_change_password: true }
        : {}),
      profile_payload: {
        identifier: asRef(account.identifier),
      },
    });
  }
  return users;
}

function schoolIdForAccount(schools, schoolCode) {
  const wanted = normalizeCode(schoolCode);
  if (!wanted || wanted === "*") {
    return "";
  }
  const match = (schools ?? []).find((row) => {
    const keys = [
      row?.code,
      row?.schoolCode,
      row?.school_code,
      row?.loginCode,
      row?.login_code,
      row?.publicId,
    ]
      .map(normalizeCode)
      .filter(Boolean);
    return keys.includes(wanted);
  });
  return asRef(match?.id ?? match?.schoolId ?? match?.school_id);
}

function isActiveAccount(user) {
  const status = asRef(user?.status).toLowerCase();
  return !status || ACTIVE_STATUSES.has(status);
}

function roleKeysFromAccount(user) {
  const labels = [user?.role, ...(Array.isArray(user?.secondaryRoles) ? user.secondaryRoles : [])];
  const keys = [];
  for (const label of labels) {
    const trimmed = asRef(label);
    if (!trimmed || UNAFFECTED.has(trimmed.toLowerCase())) {
      continue;
    }
    const key = toRoleKey(trimmed);
    if (key) keys.push(key);
  }
  return [...new Set(keys)];
}

function hasActiveRole(tables, userId, schoolId, roleKey) {
  return (tables.userRoles ?? []).some(
    (row) =>
      String(row.user_id ?? "") === userId &&
      String(row.school_id ?? "") === schoolId &&
      row.role_key === roleKey &&
      row.status === "active" &&
      !row.revoked_at,
  );
}

/**
 * Miroir mémoire du backfill PostgreSQL `user_roles` depuis `users.role`.
 * Uniquement les comptes seed rattachés à un établissement (pas `schoolCode=*`).
 * Ne lit jamais `principal.role` / JWT : le resolver live lit ensuite `user_roles`.
 *
 * @param {{ schools?: object[], userRoles?: object[] }} tables
 * @param {object[]} userAccounts
 * @returns {number} nombre de lignes insérées
 */
function backfillMemoryUserRolesFromSeedAccounts(tables, userAccounts = []) {
  if (!tables || !Array.isArray(tables.userRoles)) {
    return 0;
  }
  let inserted = 0;
  for (const user of userAccounts) {
    if (!isActiveAccount(user)) {
      continue;
    }
    const userId = asRef(user?.id);
    const schoolId = schoolIdForAccount(tables.schools, user?.schoolCode);
    if (!userId || !schoolId) {
      continue;
    }
    for (const roleKey of roleKeysFromAccount(user)) {
      if (hasActiveRole(tables, userId, schoolId, roleKey)) {
        continue;
      }
      tables.userRoles.push({
        id: `seed-role-${userId}-${schoolId}-${roleKey}`,
        user_id: userId,
        school_id: schoolId,
        role_key: roleKey,
        granted_by: null,
        granted_at: new Date(0),
        revoked_at: null,
        revoked_by: null,
        status: "active",
      });
      inserted += 1;
    }
  }
  return inserted;
}

module.exports = {
  backfillMemoryUserRolesFromSeedAccounts,
  schoolIdForAccount,
  usersFromSeedAccounts,
};
