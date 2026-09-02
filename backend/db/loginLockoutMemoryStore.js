"use strict";

const { randomUUID } = require("node:crypto");

function createLoginLockoutMemoryStore({
  maxFailedAttempts,
  lockDurationMs,
  now = () => Date.now(),
} = {}) {
  const rows = new Map();

  function keyOf(identity) {
    return `${identity.schoolScope}:${identity.identifierNormalized}`;
  }

  function snapshot(row) {
    if (!row) return null;
    return { ...row };
  }

  function getLoginLockout(identity) {
    return snapshot(rows.get(keyOf(identity)) ?? null);
  }

  function recordLoginFailure(identity) {
    const key = keyOf(identity);
    const current = rows.get(key);
    const ts = now();
    if (current?.lockedUntil && current.lockedUntil > ts) {
      return snapshot(current);
    }

    const expired = Boolean(current?.lockedUntil && current.lockedUntil <= ts);
    const failedAttempts = expired || !current ? 1 : current.failedAttempts + 1;
    const firstFailedAt = expired || !current ? ts : current.firstFailedAt;
    const lockedUntil =
      failedAttempts >= maxFailedAttempts ? ts + lockDurationMs : null;
    const next = {
      id: current && !expired ? current.id : randomUUID(),
      schoolId: identity.schoolId ?? current?.schoolId ?? null,
      schoolScope: identity.schoolScope,
      identifierNormalized: identity.identifierNormalized,
      failedAttempts,
      firstFailedAt,
      lastFailedAt: ts,
      lockedUntil,
      createdAt: current && !expired ? current.createdAt : ts,
      updatedAt: ts,
    };
    rows.set(key, next);
    return snapshot(next);
  }

  function clearLoginLockout(identity) {
    rows.delete(keyOf(identity));
  }

  function assertLoginAllowed(identity) {
    const current = rows.get(keyOf(identity));
    if (!current?.lockedUntil) return;
    if (current.lockedUntil <= now()) {
      rows.delete(keyOf(identity));
      return;
    }
    const error = new Error("LOCKED");
    error.code = "LOGIN_LOCKED";
    throw error;
  }

  function clearAllLoginLockouts() {
    rows.clear();
  }

  return {
    engine: "memory",
    getLoginLockout: async (identity) => getLoginLockout(identity),
    recordLoginFailure: async (identity) => recordLoginFailure(identity),
    clearLoginLockout: async (identity) => clearLoginLockout(identity),
    assertLoginAllowed: async (identity) => assertLoginAllowed(identity),
    clearAllLoginLockouts: async () => clearAllLoginLockouts(),
  };
}

module.exports = { createLoginLockoutMemoryStore };
