"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCK_DURATION_MS,
  attachMemoryLoginLockoutStore,
  configureLoginLockoutStore,
  getLoginAttemptKey,
  parseLoginAttemptKey,
  assertLoginNotLocked,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
  getLoginLockout,
  isLoginLockoutDisabled,
  isE2eLoginLockoutEndpointEnabled,
  assertLoginLockoutProductionGuards,
  PLATFORM_SCHOOL_SCOPE,
} = require("./loginLockout");
const { createLoginLockoutMemoryStore } = require("../db/loginLockoutMemoryStore");
const { collectProductionSecretViolations } = require("./productionSecrets");

test.beforeEach(() => {
  attachMemoryLoginLockoutStore();
});

test("clé normalisée : email / téléphone / user_code, plateforme = *", () => {
  assert.equal(getLoginAttemptKey("cd-2026-0001", "Admin@School.CD"), "CD-2026-0001:admin@school.cd");
  assert.equal(getLoginAttemptKey("", "  SuperAdmin  "), "*:superadmin");
  assert.equal(getLoginAttemptKey("*", "ENS-0001"), "*:ens-0001");
  assert.deepEqual(parseLoginAttemptKey("CD-2026-0001:+243 820 000 001"), {
    schoolScope: "CD-2026-0001",
    identifierNormalized: "+243 820 000 001",
  });
  assert.equal(PLATFORM_SCHOOL_SCOPE, "*");
});

test("première erreur, compteur, seuil et lock actif", async () => {
  const key = getLoginAttemptKey("CD-2026-0001", "admin");
  await recordFailedLoginAttempt(key);
  let row = await getLoginLockout(key);
  assert.equal(row.failedAttempts, 1);
  assert.equal(row.lockedUntil, null);

  for (let i = 0; i < 3; i += 1) await recordFailedLoginAttempt(key);
  row = await getLoginLockout(key);
  assert.equal(row.failedAttempts, 4);
  assert.equal(row.lockedUntil, null);

  await recordFailedLoginAttempt(key);
  row = await getLoginLockout(key);
  assert.equal(row.failedAttempts, MAX_FAILED_LOGIN_ATTEMPTS);
  assert.ok(row.lockedUntil > Date.now());
  assert.ok(row.lockedUntil <= Date.now() + LOGIN_LOCK_DURATION_MS + 50);

  await assert.rejects(() => assertLoginNotLocked(key), (error) => error.message === "LOCKED");
});

test("expiration lazy : locked_until passé autorise une nouvelle tentative", async () => {
  let now = 1_000;
  const store = createLoginLockoutMemoryStore({
    maxFailedAttempts: 5,
    lockDurationMs: 100,
    now: () => now,
  });
  configureLoginLockoutStore(store);
  const key = getLoginAttemptKey("CD-B", "exp");
  for (let i = 0; i < 5; i += 1) await recordFailedLoginAttempt(key);
  await assert.rejects(() => assertLoginNotLocked(key), (error) => error.message === "LOCKED");
  now = 1_000 + 101;
  await assertLoginNotLocked(key);
  assert.equal(await getLoginLockout(key), null);
});

test("succès → clear", async () => {
  const key = getLoginAttemptKey("CD-2026-0001", "admin");
  await recordFailedLoginAttempt(key);
  await clearFailedLoginAttempts(key);
  assert.equal(await getLoginLockout(key), null);
  await assertLoginNotLocked(key);
});

test("tenant isolation : même identifiant, établissements distincts", async () => {
  const keyA = getLoginAttemptKey("SCHOOL-A", "0612345678");
  const keyB = getLoginAttemptKey("SCHOOL-B", "0612345678");
  for (let i = 0; i < 5; i += 1) await recordFailedLoginAttempt(keyA);
  await assert.rejects(() => assertLoginNotLocked(keyA), (error) => error.message === "LOCKED");
  await assertLoginNotLocked(keyB);
});

test("compte plateforme school_scope=*", async () => {
  const key = getLoginAttemptKey("", "superadmin@somafrik.app");
  assert.equal(key.startsWith("*:"), true);
  for (let i = 0; i < 5; i += 1) await recordFailedLoginAttempt(key);
  await assert.rejects(() => assertLoginNotLocked(key), (error) => error.message === "LOCKED");
  await assertLoginNotLocked(getLoginAttemptKey("CD-2026-0001", "superadmin@somafrik.app"));
});

test("E2E endpoint interdit hors flag / en production", () => {
  assert.equal(isE2eLoginLockoutEndpointEnabled({ SOMAFRIK_E2E: "true", NODE_ENV: "test" }), true);
  assert.equal(isE2eLoginLockoutEndpointEnabled({ SOMAFRIK_E2E: "true", NODE_ENV: "production" }), false);
  assert.equal(isE2eLoginLockoutEndpointEnabled({ SOMAFRIK_E2E: "false", NODE_ENV: "test" }), false);
  assert.equal(isE2eLoginLockoutEndpointEnabled({ NODE_ENV: "test" }), false);
});

test("disable lockout interdit en production", () => {
  assert.doesNotThrow(() =>
    assertLoginLockoutProductionGuards({ NODE_ENV: "test", SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true" }),
  );
  assert.throws(
    () => assertLoginLockoutProductionGuards({ NODE_ENV: "production", SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true" }),
    /interdit en production/,
  );
  assert.throws(
    () => assertLoginLockoutProductionGuards({ NODE_ENV: "production", SOMAFRIK_E2E: "true" }),
    /interdit en production/,
  );
  const violations = collectProductionSecretViolations({
    NODE_ENV: "production",
    JWT_SECRET: "a".repeat(32),
    POSTGRES_PASSWORD: "strong-production-password-32",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
  });
  assert.ok(violations.some((row) => row.includes("SOMAFRIK_DISABLE_LOGIN_LOCKOUT")));
});

test("isLoginLockoutDisabled ne dépend plus de NODE_ENV=test", () => {
  assert.equal(isLoginLockoutDisabled({ NODE_ENV: "test" }), false);
  assert.equal(isLoginLockoutDisabled({ SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true" }), true);
  assert.equal(isLoginLockoutDisabled({ SOMAFRIK_E2E: "true" }), true);
});
