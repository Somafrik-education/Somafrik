"use strict";

/**
 * Unique autorité serveur : principal.sub UUID users.id → teachers.id.
 * Fail-closed. Aucun lookup par code, publicId, BO, suffixe ou nom.
 */

const { isUuid } = require("./principalIdentity");

async function resolveTeacherIdForPrincipal(queryOne, principal, schoolId) {
  const userId = String(principal?.sub ?? "").trim();
  const tenantId = String(schoolId ?? "").trim();
  if (!isUuid(userId) || !isUuid(tenantId)) {
    return null;
  }
  const row = await queryOne(
    `SELECT t.id
     FROM teachers t
     WHERE t.school_id = $1::uuid
       AND t.user_id = $2::uuid
       AND COALESCE(lower(t.status), 'active') = 'active'
     LIMIT 1`,
    [tenantId, userId],
  );
  return row?.id ?? null;
}

module.exports = {
  resolveTeacherIdForPrincipal,
};
