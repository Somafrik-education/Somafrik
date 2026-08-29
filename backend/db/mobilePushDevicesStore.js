"use strict";

const { uuidOrNull } = require("../lib/principalIdentity");

const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function createMobilePushDevicesStore(repo) {
  const one = (sql, params) => repo.one(sql, params);
  const all = (sql, params) => repo.all(sql, params);

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

    async enqueuePushReceipts(items, { delayMs = RECEIPT_DELAY_MS, ttlMs = RECEIPT_TTL_MS, now = Date.now() } = {}) {
      const saved = [];
      const nextCheck = new Date(now + delayMs);
      const expires = new Date(now + ttlMs);
      for (const item of items || []) {
        const receiptId = asTrimmed(item.receiptId || item.receipt_id);
        const expoPushToken = asTrimmed(item.expoPushToken || item.expo_push_token);
        if (!receiptId || !expoPushToken) continue;
        const row = await one(
          `INSERT INTO mobile_push_receipts (
             receipt_id, expo_push_token, device_id, status, attempts, next_check_at, expires_at
           )
           VALUES (
             $1, $2, (SELECT id FROM mobile_push_devices WHERE expo_push_token = $2 LIMIT 1),
             'pending', 0, $3, $4
           )
           ON CONFLICT (receipt_id) DO NOTHING
           RETURNING id, receipt_id, expo_push_token, status, attempts, next_check_at, expires_at`,
          [receiptId, expoPushToken, nextCheck.toISOString(), expires.toISOString()],
        );
        if (row) saved.push(row);
      }
      return saved;
    },

    async listDuePushReceipts({ now = Date.now(), limit = 50 } = {}) {
      return all(
        `SELECT id, receipt_id, expo_push_token, device_id, status, attempts, next_check_at, expires_at, created_at
         FROM mobile_push_receipts
         WHERE status = 'pending' AND next_check_at <= $1
         ORDER BY next_check_at ASC
         LIMIT $2`,
        [new Date(now).toISOString(), limit],
      );
    },

    async markPushReceipt(id, patch = {}) {
      return one(
        `UPDATE mobile_push_receipts
         SET status = COALESCE($2, status),
             attempts = COALESCE($3, attempts),
             next_check_at = COALESCE($4, next_check_at),
             last_error = $5,
             checked_at = COALESCE($6, checked_at),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, receipt_id, status, attempts, last_error`,
        [
          id,
          patch.status ?? null,
          patch.attempts ?? null,
          patch.nextCheckAt ? new Date(patch.nextCheckAt).toISOString() : null,
          patch.lastError ?? null,
          patch.checkedAt ? new Date(patch.checkedAt).toISOString() : null,
        ],
      );
    },
  };
}

function createMemoryMobilePushDevicesStore() {
  const rows = [];
  const receipts = [];
  return {
    _receipts: receipts,
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
    async enqueuePushReceipts(items, { delayMs = RECEIPT_DELAY_MS, ttlMs = RECEIPT_TTL_MS, now = Date.now() } = {}) {
      const saved = [];
      for (const item of items || []) {
        const receiptId = asTrimmed(item.receiptId || item.receipt_id);
        const expoPushToken = asTrimmed(item.expoPushToken || item.expo_push_token);
        if (!receiptId || !expoPushToken) continue;
        if (receipts.some((row) => row.receipt_id === receiptId)) continue;
        const device = rows.find((row) => row.expo_push_token === expoPushToken);
        const row = {
          id: require("node:crypto").randomUUID(),
          receipt_id: receiptId,
          expo_push_token: expoPushToken,
          device_id: device?.id ?? null,
          status: "pending",
          attempts: 0,
          next_check_at: new Date(now + delayMs).toISOString(),
          expires_at: new Date(now + ttlMs).toISOString(),
          last_error: null,
          created_at: new Date(now).toISOString(),
        };
        receipts.push(row);
        saved.push({ ...row });
      }
      return saved;
    },
    async listDuePushReceipts({ now = Date.now(), limit = 50 } = {}) {
      const ts = new Date(now).toISOString();
      return receipts
        .filter((row) => row.status === "pending" && row.next_check_at <= ts)
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },
    async markPushReceipt(id, patch = {}) {
      const row = receipts.find((item) => item.id === id);
      if (!row) return null;
      if (patch.status) row.status = patch.status;
      if (patch.attempts != null) row.attempts = patch.attempts;
      if (patch.nextCheckAt) row.next_check_at = new Date(patch.nextCheckAt).toISOString();
      if (patch.lastError !== undefined) row.last_error = patch.lastError;
      if (patch.checkedAt) row.checked_at = new Date(patch.checkedAt).toISOString();
      return { ...row };
    },
  };
}

module.exports = {
  createMobilePushDevicesStore,
  createMemoryMobilePushDevicesStore,
  RECEIPT_DELAY_MS,
  RECEIPT_TTL_MS,
};
