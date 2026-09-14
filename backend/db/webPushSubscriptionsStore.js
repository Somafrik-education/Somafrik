"use strict";

const { uuidOrNull } = require("../lib/principalIdentity");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function createWebPushSubscriptionsStore(repo) {
  const one = (sql, params) => repo.one(sql, params);
  const all = (sql, params) => repo.all(sql, params);

  return {
    async resolveSchoolId(schoolCode) {
      const normalized = asTrimmed(schoolCode).toUpperCase();
      if (!normalized || normalized === "*") return null;
      const row = await one(`SELECT id FROM schools WHERE school_code = $1`, [normalized]);
      return uuidOrNull(row?.id);
    },

    async upsertSubscription({ userId, schoolId, endpoint, p256dh, auth, userAgent, backendEnvironment }) {
      return one(
        `INSERT INTO web_push_subscriptions (
           user_id, school_id, endpoint, p256dh, auth, user_agent, backend_environment, revoked_at, last_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NOW())
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           school_id = EXCLUDED.school_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           backend_environment = EXCLUDED.backend_environment,
           revoked_at = NULL,
           updated_at = NOW(),
           last_seen_at = NOW()
         RETURNING id, user_id, school_id, backend_environment, revoked_at, created_at, updated_at, last_seen_at`,
        [userId, schoolId, endpoint, p256dh, auth, userAgent, backendEnvironment],
      );
    },

    async revokeCurrent({ userId, endpoint }) {
      return one(
        `UPDATE web_push_subscriptions
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE user_id = $1 AND endpoint = $2 AND revoked_at IS NULL
         RETURNING id, user_id, revoked_at`,
        [userId, endpoint],
      );
    },

    async revokeByEndpoint(endpoint) {
      return one(
        `UPDATE web_push_subscriptions
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE endpoint = $1 AND revoked_at IS NULL
         RETURNING id, user_id, revoked_at`,
        [endpoint],
      );
    },

    async listActiveForUser({ userId, schoolId, backendEnvironment }) {
      const scopedUserId = uuidOrNull(userId);
      const scopedSchoolId = uuidOrNull(schoolId);
      const env = asTrimmed(backendEnvironment);
      if (!scopedUserId || !scopedSchoolId || !env) return [];
      return all(
        `SELECT id, user_id, school_id, endpoint, p256dh, auth, user_agent, backend_environment, last_seen_at
         FROM web_push_subscriptions
         WHERE user_id = $1
           AND school_id = $2
           AND backend_environment = $3
           AND revoked_at IS NULL
         ORDER BY last_seen_at DESC, created_at DESC`,
        [scopedUserId, scopedSchoolId, env],
      );
    },

    async getByEndpoint(endpoint) {
      return one(
        `SELECT id, user_id, school_id, endpoint, p256dh, auth, backend_environment, revoked_at
         FROM web_push_subscriptions
         WHERE endpoint = $1`,
        [endpoint],
      );
    },
  };
}

function createMemoryWebPushSubscriptionsStore() {
  const rows = [];
  const schoolIds = new Map();
  return {
    _rows: rows,
    async resolveSchoolId(schoolCode) {
      const normalized = asTrimmed(schoolCode).toUpperCase();
      if (!normalized || normalized === "*") return null;
      if (!schoolIds.has(normalized)) schoolIds.set(normalized, require("node:crypto").randomUUID());
      return schoolIds.get(normalized);
    },
    async upsertSubscription({ userId, schoolId, endpoint, p256dh, auth, userAgent, backendEnvironment }) {
      const existing = rows.find((row) => row.endpoint === endpoint);
      const saved = {
        id: existing?.id || require("node:crypto").randomUUID(),
        user_id: userId,
        school_id: schoolId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent ?? null,
        backend_environment: backendEnvironment,
        revoked_at: null,
        last_seen_at: new Date().toISOString(),
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, saved);
      else rows.push(saved);
      return {
        id: saved.id,
        user_id: saved.user_id,
        school_id: saved.school_id,
        backend_environment: saved.backend_environment,
        revoked_at: saved.revoked_at,
        created_at: saved.created_at,
        updated_at: saved.updated_at,
        last_seen_at: saved.last_seen_at,
      };
    },
    async revokeCurrent({ userId, endpoint }) {
      const row = rows.find((item) => item.user_id === userId && item.endpoint === endpoint && !item.revoked_at);
      if (!row) return null;
      row.revoked_at = new Date().toISOString();
      row.updated_at = row.revoked_at;
      return { id: row.id, user_id: row.user_id, revoked_at: row.revoked_at };
    },
    async revokeByEndpoint(endpoint) {
      const row = rows.find((item) => item.endpoint === endpoint && !item.revoked_at);
      if (!row) return null;
      row.revoked_at = new Date().toISOString();
      return { id: row.id, user_id: row.user_id, revoked_at: row.revoked_at };
    },
    async listActiveForUser({ userId, schoolId, backendEnvironment }) {
      const scopedUserId = uuidOrNull(userId);
      const scopedSchoolId = uuidOrNull(schoolId);
      const env = asTrimmed(backendEnvironment);
      if (!scopedUserId || !scopedSchoolId || !env) return [];
      return rows
        .filter(
          (item) =>
            String(item.user_id) === String(scopedUserId) &&
            String(item.school_id) === String(scopedSchoolId) &&
            item.backend_environment === env &&
            !item.revoked_at,
        )
        .map((item) => ({ ...item }));
    },
    async getByEndpoint(endpoint) {
      const row = rows.find((item) => item.endpoint === endpoint);
      return row ? { ...row } : null;
    },
  };
}

module.exports = {
  createWebPushSubscriptionsStore,
  createMemoryWebPushSubscriptionsStore,
};
