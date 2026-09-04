"use strict";

/**
 * P1 #503 — politique JWT access / refresh.
 * Access token court par défaut (15 min). Production refuse un TTL excessif.
 */

const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const MAX_PRODUCTION_ACCESS_TTL_SECONDS = 15 * 60;
const MAX_NON_PRODUCTION_ACCESS_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_REUSE_GRACE_MS = 15 * 1000;

function isProductionEnv(env = process.env) {
  return String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function readPositiveInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return NaN;
  return Math.floor(value);
}

function resolveAccessTokenTtlSeconds(env = process.env) {
  const value = readPositiveInt(env.JWT_ACCESS_TTL_SECONDS, DEFAULT_ACCESS_TTL_SECONDS);
  if (!Number.isFinite(value)) {
    const error = new Error("JWT_ACCESS_TTL_SECONDS doit être un entier strictement positif.");
    error.code = "JWT_ACCESS_TTL_INVALID";
    throw error;
  }
  const max = isProductionEnv(env)
    ? MAX_PRODUCTION_ACCESS_TTL_SECONDS
    : MAX_NON_PRODUCTION_ACCESS_TTL_SECONDS;
  if (value > max) {
    const error = new Error(
      isProductionEnv(env)
        ? `JWT_ACCESS_TTL_SECONDS trop élevé en production (max ${MAX_PRODUCTION_ACCESS_TTL_SECONDS}s).`
        : `JWT_ACCESS_TTL_SECONDS trop élevé hors production (max ${MAX_NON_PRODUCTION_ACCESS_TTL_SECONDS}s).`,
    );
    error.code = "JWT_ACCESS_TTL_EXCESSIVE";
    throw error;
  }
  return value;
}

function collectAccessTtlProductionViolations(env = process.env) {
  if (!isProductionEnv(env)) return [];
  const raw = env.JWT_ACCESS_TTL_SECONDS;
  if (raw == null || String(raw).trim() === "") return [];
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return ["JWT_ACCESS_TTL_SECONDS doit être un entier strictement positif."];
  }
  if (value > MAX_PRODUCTION_ACCESS_TTL_SECONDS) {
    return [
      `JWT_ACCESS_TTL_SECONDS trop élevé en production (max ${MAX_PRODUCTION_ACCESS_TTL_SECONDS}s, reçu ${Math.floor(value)}).`,
    ];
  }
  return [];
}

function resolveRefreshTokenTtlSeconds(env = process.env) {
  const value = readPositiveInt(env.JWT_REFRESH_TTL_SECONDS, DEFAULT_REFRESH_TTL_SECONDS);
  if (!Number.isFinite(value)) {
    const error = new Error("JWT_REFRESH_TTL_SECONDS doit être un entier strictement positif.");
    error.code = "JWT_REFRESH_TTL_INVALID";
    throw error;
  }
  return value;
}

module.exports = {
  DEFAULT_ACCESS_TTL_SECONDS,
  MAX_PRODUCTION_ACCESS_TTL_SECONDS,
  MAX_NON_PRODUCTION_ACCESS_TTL_SECONDS,
  DEFAULT_REFRESH_TTL_SECONDS,
  REFRESH_REUSE_GRACE_MS,
  isProductionEnv,
  resolveAccessTokenTtlSeconds,
  resolveRefreshTokenTtlSeconds,
  collectAccessTtlProductionViolations,
};
