"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_ACCESS_TTL_SECONDS,
  MAX_PRODUCTION_ACCESS_TTL_SECONDS,
  resolveAccessTokenTtlSeconds,
  collectAccessTtlProductionViolations,
} = require("./authTokenPolicy");
const { collectProductionSecretViolations } = require("./productionSecrets");

test("TTL access par défaut 15 min", () => {
  assert.equal(DEFAULT_ACCESS_TTL_SECONDS, 900);
  assert.equal(resolveAccessTokenTtlSeconds({}), 900);
  assert.equal(resolveAccessTokenTtlSeconds({ JWT_ACCESS_TTL_SECONDS: "600" }), 600);
});

test("production refuse un TTL access > 15 min", () => {
  assert.equal(MAX_PRODUCTION_ACCESS_TTL_SECONDS, 900);
  assert.throws(
    () => resolveAccessTokenTtlSeconds({ NODE_ENV: "production", JWT_ACCESS_TTL_SECONDS: "3600" }),
    /trop élevé/,
  );
  const violations = collectAccessTtlProductionViolations({
    NODE_ENV: "production",
    JWT_ACCESS_TTL_SECONDS: "28800",
  });
  assert.ok(violations.some((row) => row.includes("JWT_ACCESS_TTL_SECONDS")));
});

test("collectProductionSecretViolations inclut le TTL access", () => {
  const violations = collectProductionSecretViolations({
    NODE_ENV: "production",
    JWT_SECRET: "a".repeat(32),
    POSTGRES_PASSWORD: "strong-production-password-32",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    JWT_ACCESS_TTL_SECONDS: "28800",
  });
  assert.ok(violations.some((row) => row.includes("JWT_ACCESS_TTL_SECONDS")));
});
