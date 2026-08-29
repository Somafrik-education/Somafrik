"use strict";

const { uuidOrNull } = require("../lib/principalIdentity");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function createMobilePushDevicesStore(repo) {
  const one = (sql, params) => repo.one(sql, params);
  const all = (sql, params) => repo.all(sql, params);
  const query = (sql, params) => repo.query(sql, params);

  return {
    async resolveSchoolId(schoolCode) {
      const normalized = asTrimmed(schoolCode).toUpperCase();
      if (!normalized || normalized === "*") return null;
      const row = await one(`SELECT id FROM schools WHERE school_code = $1`, [normalized]);
      return uuidOrNull(row?.id);
    },

    async upsertDevice({ userId, schoolId, expoPushToken, platform, releaseProfile }) {
      return one(
        `INSERT INTO mobile_push_devices (
           user_id, school_id, expo_push_token, platform, release_profile, revoked_at, last_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, NULL, NOW())
         ON CONFLICT (expo_push_token) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           school_id = EXCLUDED.school_id,
           platform = EXCLUDED.platform,
           release_profile = EXCLUDED.release_profile,
           revoked_at = NULL,
           updated_at = NOW(),
           last_seen_at = NOW()
         RETURNING id, user_id, school_id, platform, release_profile, revoked_at, created_at, updated_at, last_seen_at`,
        [userId, schoolId, expoPushToken, platform, releaseProfile],
      );
    },

    async revokeCurrent({ userId, expoPushToken }) {
      const row = await one(
        `UPDATE mobile_push_devices
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE user_id = $1 AND expo_push_token = $2 AND revoked_at IS NULL
         RETURNING id, user_id, revoked_at`,
        [userId, expoPushToken],
      );
      return row;
    },

    async revokeByToken(expoPushToken) {
      const row = await one(
        `UPDATE mobile_push_devices
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE expo_push_token = $1 AND revoked_at IS NULL
         RETURNING id, user_id, revoked_at`,
        [expoPushToken],
      );
      return row;
    },

    async listActiveForUser({ userId, releaseProfile }) {
      return all(
        `SELECT id, user_id, school_id, expo_push_token, platform, release_profile, last_seen_at
         FROM mobile_push_devices
         WHERE user_id = $1
           AND release_profile = $2
           AND revoked_at IS NULL
         ORDER BY last_seen_at DESC, created_at DESC`,
        [userId, releaseProfile],
      );
    },

    async getByToken(expoPushToken) {
      return one(
        `SELECT id, user_id, school_id, expo_push_token, platform, release_profile, revoked_at
         FROM mobile_push_devices
         WHERE expo_push_token = $1`,
        [expoPushToken],
      );
    },
  };
}

function createMemoryMobilePushDevicesStore() {
  const rows = [];
  return {
    async resolveSchoolId() {
      return null;
    },
    async upsertDevice({ userId, schoolId, expoPushToken, platform, releaseProfile }) {
      const existing = rows.find((row) => row.expo_push_token === expoPushToken);
      const saved = {
        id: existing?.id || require("node:crypto").randomUUID(),
        user_id: userId,
        school_id: schoolId,
        expo_push_token: expoPushToken,
        platform,
        release_profile: releaseProfile,
        revoked_at: null,
        last_seen_at: new Date().toISOString(),
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (existing) Object.assign(existing, saved);
      else rows.push(saved);
      return { ...saved };
    },
    async revokeCurrent({ userId, expoPushToken }) {
      const row = rows.find((item) => item.user_id === userId && item.expo_push_token === expoPushToken && !item.revoked_at);
      if (!row) return null;
      row.revoked_at = new Date().toISOString();
      row.updated_at = row.revoked_at;
      return { ...row };
    },
    async revokeByToken(expoPushToken) {
      const row = rows.find((item) => item.expo_push_token === expoPushToken && !item.revoked_at);
      if (!row) return null;
      row.revoked_at = new Date().toISOString();
      return { ...row };
    },
    async listActiveForUser({ userId, releaseProfile }) {
      return rows.filter(
        (item) => item.user_id === userId && item.release_profile === releaseProfile && !item.revoked_at,
      );
    },
    async getByToken(expoPushToken) {
      return rows.find((item) => item.expo_push_token === expoPushToken) || null;
    },
  };
}

module.exports = {
  createMobilePushDevicesStore,
  createMemoryMobilePushDevicesStore,
};
