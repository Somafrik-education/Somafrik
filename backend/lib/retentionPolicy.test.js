"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");
const { resolveRetentionPolicy, purgeRetention } = require("./retentionPolicy");

test("matrice de rétention : sessions/push configurables, audit non auto-purgé", () => {
  const policy = resolveRetentionPolicy({
    SOMAFRIK_RETENTION_SESSIONS_DAYS: "3",
    SOMAFRIK_RETENTION_PUSH_DAYS: "30",
  });
  assert.equal(policy.sessionsAfterExpiryDays, 3);
  assert.equal(policy.pushDevicesInactiveDays, 30);
  assert.equal(policy.auditLogsDays, null);
  assert.equal(policy.schoolRecordsDays, null);
  assert.equal(policy.financeRecordsDays, null);
  assert.equal(policy.backupsDays, null);
});

test("purge sessions expirées/révoquées au-delà du cutoff", async () => {
  const repo = new FallbackRepository();
  const now = new Date("2026-09-04T12:00:00Z");
  await repo.createSession({
    sessionId: "old",
    refreshTokenHash: "h1",
    userId: "u1",
    schoolCode: "CD-2026-0001",
    role: "Admin School",
    expiresAt: new Date("2026-08-01T00:00:00Z"),
  });
  await repo.revokeSession("old", "logout");
  await repo.createSession({
    sessionId: "fresh",
    refreshTokenHash: "h2",
    userId: "u1",
    schoolCode: "CD-2026-0001",
    role: "Admin School",
    expiresAt: new Date("2026-09-10T00:00:00Z"),
  });
  const result = await purgeRetention(repo, { now, env: { SOMAFRIK_RETENTION_SESSIONS_DAYS: "7" } });
  assert.equal(result.sessionsDeleted, 1);
  assert.equal(result.skipped, false);
  assert.equal(await repo.findSessionByCode("old"), null);
  assert.ok(await repo.findSessionByCode("fresh"));
});
