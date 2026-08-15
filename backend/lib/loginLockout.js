"use strict";

/**
 * LOT 6 — Lockout de connexion.
 *
 * SoT = store configuré (PostgreSQL en runtime PG, mémoire uniquement pour le
 * moteur fallback / tests unitaires). Aucun cache autoritaire : un lockout PG
 * ne peut jamais être contourné par une Map locale.
 *
 * Clé : school_scope (code établissement UPPER, ou '*' plateforme)
 *     + identifier_normalized (trim + lower — email, téléphone, user_code, identifiant enseignant).
 *
 * Politique inchangée : 5 échecs → verrouillage 15 minutes.
 * Échec concurrent : INSERT … ON CONFLICT DO UPDATE (compteur atomique).
 * Succès : DELETE de la ligne.
 * Expiration : reset lazy à la prochaine tentative (pas de cron).
 */

const { createLoginLockoutMemoryStore } = require("../db/loginLockoutMemoryStore");
const { createLoginLockoutPgStore } = require("../db/loginLockoutPgStore");

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;
const PLATFORM_SCHOOL_SCOPE = "*";

let store = createLoginLockoutMemoryStore({
  maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
  lockDurationMs: LOGIN_LOCK_DURATION_MS,
});

function configureLoginLockoutStore(nextStore) {
  if (!nextStore || typeof nextStore.recordLoginFailure !== "function") {
    throw new Error("Store de lockout invalide.");
  }
  store = nextStore;
  return store;
}

function attachPostgresLoginLockoutStore(repo) {
  return configureLoginLockoutStore(
    createLoginLockoutPgStore(repo, {
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: LOGIN_LOCK_DURATION_MS,
    }),
  );
}

function attachMemoryLoginLockoutStore() {
  return configureLoginLockoutStore(
    createLoginLockoutMemoryStore({
      maxFailedAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
      lockDurationMs: LOGIN_LOCK_DURATION_MS,
    }),
  );
}

function isLoginLockoutDisabled(env = process.env) {
  return env.SOMAFRIK_DISABLE_LOGIN_LOCKOUT === "true" || env.SOMAFRIK_E2E === "true";
}

function isE2eLoginLockoutEndpointEnabled(env = process.env) {
  return env.SOMAFRIK_E2E === "true" && env.NODE_ENV !== "production";
}

function assertLoginLockoutProductionGuards(env = process.env) {
  if (env.NODE_ENV !== "production") return;
  if (env.SOMAFRIK_DISABLE_LOGIN_LOCKOUT === "true") {
    throw new Error("SOMAFRIK_DISABLE_LOGIN_LOCKOUT est interdit en production.");
  }
  if (env.SOMAFRIK_E2E === "true") {
    throw new Error("SOMAFRIK_E2E=true est interdit en production.");
  }
}

function normalizeSchoolScope(schoolCode) {
  const raw = String(schoolCode ?? "").trim().toUpperCase();
  if (!raw || raw === "*") return PLATFORM_SCHOOL_SCOPE;
  return raw;
}

function normalizeIdentifier(identifier) {
  return String(identifier ?? "").trim().toLowerCase();
}

function getLoginAttemptKey(schoolCode, identifier) {
  return `${normalizeSchoolScope(schoolCode)}:${normalizeIdentifier(identifier)}`;
}

function parseLoginAttemptKey(key) {
  const raw = String(key ?? "");
  const idx = raw.indexOf(":");
  const schoolPart = idx === -1 ? "" : raw.slice(0, idx);
  const identifier = idx === -1 ? raw : raw.slice(idx + 1);
  return {
    schoolScope: normalizeSchoolScope(schoolPart),
    identifierNormalized: normalizeIdentifier(identifier),
  };
}

function identityFromKey(key, schoolId = null) {
  return { ...parseLoginAttemptKey(key), schoolId };
}

async function assertLoginNotLocked(key) {
  if (isLoginLockoutDisabled()) return;
  await store.assertLoginAllowed(identityFromKey(key));
}

async function recordFailedLoginAttempt(key, schoolId = null) {
  if (isLoginLockoutDisabled()) return null;
  return store.recordLoginFailure(identityFromKey(key, schoolId));
}

async function clearFailedLoginAttempts(key) {
  await store.clearLoginLockout(identityFromKey(key));
}

async function clearAllFailedLoginAttempts() {
  await store.clearAllLoginLockouts();
}

async function getLoginLockout(key) {
  return store.getLoginLockout(identityFromKey(key));
}

module.exports = {
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOGIN_LOCK_DURATION_MS,
  PLATFORM_SCHOOL_SCOPE,
  configureLoginLockoutStore,
  attachPostgresLoginLockoutStore,
  attachMemoryLoginLockoutStore,
  isLoginLockoutDisabled,
  isE2eLoginLockoutEndpointEnabled,
  assertLoginLockoutProductionGuards,
  normalizeSchoolScope,
  normalizeIdentifier,
  getLoginAttemptKey,
  parseLoginAttemptKey,
  assertLoginNotLocked,
  recordFailedLoginAttempt,
  clearFailedLoginAttempts,
  clearAllFailedLoginAttempts,
  getLoginLockout,
};
