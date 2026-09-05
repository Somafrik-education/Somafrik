"use strict";

/**
 * P1 #503 — rétention configurable. Ce qui n'est pas purgé automatiquement
 * est documenté (audit, dossier scolaire/comptable, sauvegardes hébergeur).
 */

function readDays(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function resolveRetentionPolicy(env = process.env) {
  return Object.freeze({
    sessionsAfterExpiryDays: readDays(env.SOMAFRIK_RETENTION_SESSIONS_DAYS, 7),
    pushDevicesInactiveDays: readDays(env.SOMAFRIK_RETENTION_PUSH_DAYS, 90),
    pushReceiptsDays: readDays(env.SOMAFRIK_RETENTION_PUSH_RECEIPTS_DAYS, 2),
    privacyRequestsDays: readDays(env.SOMAFRIK_RETENTION_PRIVACY_REQUESTS_DAYS, 730),
    // Non purgés par le job applicatif (exceptions légales / hors contrôle).
    auditLogsDays: null,
    schoolRecordsDays: null,
    financeRecordsDays: null,
    backupsDays: null,
    attachmentsWithParentDays: null,
  });
}

function cutoffDate(now, days) {
  if (days == null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function purgeRetention(repository, { now = new Date(), env = process.env } = {}) {
  const policy = resolveRetentionPolicy(env);
  if (typeof repository.purgeRetention !== "function") {
    return { ...policy, sessionsDeleted: 0, pushDevicesRevoked: 0, pushReceiptsDeleted: 0, skipped: true };
  }
  const result = await repository.purgeRetention({
    now,
    sessionsCutoff: cutoffDate(now, policy.sessionsAfterExpiryDays),
    pushDevicesCutoff: cutoffDate(now, policy.pushDevicesInactiveDays),
    pushReceiptsCutoff: cutoffDate(now, policy.pushReceiptsDays),
  });
  return { ...policy, ...result, skipped: false };
}

module.exports = {
  resolveRetentionPolicy,
  cutoffDate,
  purgeRetention,
};
