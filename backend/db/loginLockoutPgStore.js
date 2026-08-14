"use strict";

function createLoginLockoutPgStore(repo, { maxFailedAttempts, lockDurationMs } = {}) {
  const one = (...args) => repo.one(...args);
  const query = (...args) => repo.query(...args);

  async function getLoginLockout(identity) {
    const row = await one(
      `SELECT id, school_id, school_scope, identifier_normalized, failed_attempts,
              first_failed_at, last_failed_at, locked_until, created_at, updated_at
       FROM login_lockouts
       WHERE school_scope = $1 AND identifier_normalized = $2`,
      [identity.schoolScope, identity.identifierNormalized],
    );
    return mapRow(row);
  }

  async function recordLoginFailure(identity) {
    const row = await one(
      `INSERT INTO login_lockouts (
         school_id,
         school_scope,
         identifier_normalized,
         failed_attempts,
         first_failed_at,
         last_failed_at,
         locked_until
       ) VALUES (
         $1, $2, $3, 1, NOW(), NOW(),
         CASE WHEN 1 >= $4 THEN NOW() + ($5 * INTERVAL '1 millisecond') ELSE NULL END
       )
       ON CONFLICT (school_scope, identifier_normalized)
       DO UPDATE SET
         failed_attempts = CASE
           WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until > NOW()
             THEN login_lockouts.failed_attempts
           WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until <= NOW()
             THEN 1
           ELSE login_lockouts.failed_attempts + 1
         END,
         first_failed_at = CASE
           WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until > NOW()
             THEN login_lockouts.first_failed_at
           WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until <= NOW()
             THEN NOW()
           WHEN login_lockouts.first_failed_at IS NULL
             THEN NOW()
           ELSE login_lockouts.first_failed_at
         END,
         last_failed_at = NOW(),
         locked_until = CASE
           WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until > NOW()
             THEN login_lockouts.locked_until
           WHEN (
             CASE
               WHEN login_lockouts.locked_until IS NOT NULL AND login_lockouts.locked_until <= NOW() THEN 1
               ELSE login_lockouts.failed_attempts + 1
             END
           ) >= $4 THEN NOW() + ($5 * INTERVAL '1 millisecond')
           ELSE NULL
         END,
         school_id = COALESCE(EXCLUDED.school_id, login_lockouts.school_id),
         updated_at = NOW()
       RETURNING id, school_id, school_scope, identifier_normalized, failed_attempts,
                 first_failed_at, last_failed_at, locked_until, created_at, updated_at`,
      [
        identity.schoolId ?? null,
        identity.schoolScope,
        identity.identifierNormalized,
        maxFailedAttempts,
        lockDurationMs,
      ],
    );
    return mapRow(row);
  }

  async function clearLoginLockout(identity) {
    await query(
      `DELETE FROM login_lockouts
       WHERE school_scope = $1 AND identifier_normalized = $2`,
      [identity.schoolScope, identity.identifierNormalized],
    );
  }

  async function assertLoginAllowed(identity) {
    await query(
      `DELETE FROM login_lockouts
       WHERE school_scope = $1
         AND identifier_normalized = $2
         AND locked_until IS NOT NULL
         AND locked_until <= NOW()`,
      [identity.schoolScope, identity.identifierNormalized],
    );
    const row = await one(
      `SELECT locked_until
       FROM login_lockouts
       WHERE school_scope = $1 AND identifier_normalized = $2`,
      [identity.schoolScope, identity.identifierNormalized],
    );
    if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const error = new Error("LOCKED");
      error.code = "LOGIN_LOCKED";
      throw error;
    }
  }

  async function clearAllLoginLockouts() {
    await query(`DELETE FROM login_lockouts`);
  }

  return {
    engine: "postgresql",
    getLoginLockout,
    recordLoginFailure,
    clearLoginLockout,
    assertLoginAllowed,
    clearAllLoginLockouts,
  };
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id ?? null,
    schoolScope: row.school_scope,
    identifierNormalized: row.identifier_normalized,
    failedAttempts: Number(row.failed_attempts) || 0,
    firstFailedAt: row.first_failed_at ? new Date(row.first_failed_at).getTime() : null,
    lastFailedAt: row.last_failed_at ? new Date(row.last_failed_at).getTime() : null,
    lockedUntil: row.locked_until ? new Date(row.locked_until).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
  };
}

module.exports = { createLoginLockoutPgStore };
