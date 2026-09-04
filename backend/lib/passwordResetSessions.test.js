"use strict";

const { test } = require("node:test");
const { strict: assert } = require("node:assert");
const { FallbackRepository } = require("../db/fallbackRepository");

test("reset password : révocation de toutes les sessions du compte", async () => {
  const repo = new FallbackRepository();
  await repo.createSession({
    sessionId: "sess-reset-1",
    refreshTokenHash: "h-reset",
    userId: "USER-TEACHER-RESET",
    schoolCode: "CD-2026-0001",
    role: "Enseignant",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const before = await repo.findActiveAccessSession("sess-reset-1");
  assert.ok(before);
  const revoked = await repo.revokeAllSessionsForUser("USER-TEACHER-RESET", "password_reset");
  assert.equal(revoked, 1);
  const after = await repo.findActiveAccessSession("sess-reset-1");
  assert.equal(after, null);
});
