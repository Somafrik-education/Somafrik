"use strict";

const { BusinessError } = require("../services/authService");
const { resolveAppEnv } = require("./corsConfig");
const { uuidOrNull } = require("./principalIdentity");

const N1_PLATFORM = "android";
const BACKEND_ENVIRONMENTS = new Set(["development", "preproduction", "production"]);
const APP_PROFILES = new Set(["development", "preview", "preproduction", "production"]);
const APP_PROFILES_BY_BACKEND = Object.freeze({
  development: Object.freeze(["development"]),
  preproduction: Object.freeze(["preview", "preproduction"]),
  production: Object.freeze(["production"]),
});
const PUSH_SELFTEST_PERMISSION = "Push:TEST";
const EXPO_PUSH_TOKEN_RE = /^(Expo(nent)?PushToken)\[.+]$/;
const TEST_CONFIRM = "TEST_SOMAFRIK_PUSH";
const TEST_TITLE = "Test Somafrik";
const TEST_BODY = "Les notifications push Somafrik fonctionnent correctement.";
const TEST_DESTINATION = "Home";

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function rejectClientIdentity(body = {}) {
  if (body.userId != null || body.user_id != null || body.schoolId != null || body.school_id != null) {
    throw new BusinessError(400, "Identité user/school interdite depuis le client.");
  }
}

function parseExpoPushToken(value) {
  const token = asTrimmed(value);
  if (!EXPO_PUSH_TOKEN_RE.test(token) || token.length > 200) {
    throw new BusinessError(400, "Jeton Expo Push invalide.");
  }
  return token;
}

function isTruthyFlag(value) {
  return ["1", "true", "yes", "on"].includes(asTrimmed(value).toLowerCase());
}

/**
 * Frontière serveur canonique : APP_ENV (development | preproduction | production).
 * Un profil Mobile n'est jamais une autorité d'environnement.
 */
function resolvePushBackendEnvironment(env = process.env) {
  const appEnv = asTrimmed(resolveAppEnv(env)).toLowerCase();
  if (BACKEND_ENVIRONMENTS.has(appEnv)) return appEnv;
  throw new BusinessError(500, "APP_ENV push invalide.");
}

function parseAppProfile(body = {}) {
  const raw = asTrimmed(body.appProfile ?? body.app_profile).toLowerCase();
  if (!raw) return null;
  if (!APP_PROFILES.has(raw)) {
    throw new BusinessError(400, "Profil application inconnu.");
  }
  return raw;
}

function defaultAppProfileForBackend(backendEnvironment) {
  return backendEnvironment;
}

function assertAppProfileAllowed(backendEnvironment, appProfile) {
  const allowed = APP_PROFILES_BY_BACKEND[backendEnvironment] || [];
  if (!allowed.includes(appProfile)) {
    throw new BusinessError(400, "Profil application incompatible avec l'environnement serveur.");
  }
}

function resolveStoredPushScope(body = {}, env = process.env) {
  const backendEnvironment = resolvePushBackendEnvironment(env);
  const clientProfile = parseAppProfile(body);
  const appProfile = clientProfile || defaultAppProfileForBackend(backendEnvironment);
  assertAppProfileAllowed(backendEnvironment, appProfile);
  return { backendEnvironment, appProfile };
}

function assertPushSelfTestAllowed(env = process.env) {
  const backendEnvironment = resolvePushBackendEnvironment(env);
  if (backendEnvironment === "production") {
    throw new BusinessError(403, "Auto-test push interdit en production.");
  }
  if (backendEnvironment === "preproduction" && !isTruthyFlag(env.SOMAFRIK_PUSH_SELFTEST_ENABLED)) {
    throw new BusinessError(403, "Auto-test push désactivé dans cet environnement.");
  }
  return backendEnvironment;
}

function hasPushSelfTestPermission(principal = {}) {
  const perms = new Set(principal.permissions || []);
  if (perms.has(PUSH_SELFTEST_PERMISSION) || perms.has("ALL_PRIVILEGES")) return true;
  const keys = (principal.roleKeys || []).map((key) => String(key || "").toUpperCase());
  return keys.includes("SUPER_ADMIN");
}

function assertPushSelfTestActor(principal, env = process.env) {
  const backendEnvironment = resolvePushBackendEnvironment(env);
  if (backendEnvironment === "development") return principal;
  if (!hasPushSelfTestPermission(principal)) {
    throw new BusinessError(403, "Permission push-test requise.");
  }
  return principal;
}

function skipPushSelfTestPermissionCheck(env = process.env) {
  return resolvePushBackendEnvironment(env) === "development";
}

function parsePlatform(value) {
  const platform = asTrimmed(value).toLowerCase();
  if (platform !== N1_PLATFORM) {
    throw new BusinessError(400, "PUSH-N1 : Android uniquement.");
  }
  return platform;
}

function sessionUserId(principal) {
  const userId = uuidOrNull(principal?.sub);
  if (!userId) {
    throw new BusinessError(401, "Session utilisateur invalide.");
  }
  return userId;
}

function publicDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    backendEnvironment: row.backend_environment,
    appProfile: row.app_profile,
    revokedAt: row.revoked_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

async function upsertFromSession(store, principal, body = {}, env = process.env) {
  rejectClientIdentity(body);
  const userId = sessionUserId(principal);
  const expoPushToken = parseExpoPushToken(body.expoPushToken ?? body.token);
  const platform = parsePlatform(body.platform);
  const { backendEnvironment, appProfile } = resolveStoredPushScope(body, env);
  const schoolId = await store.resolveSchoolId(principal.schoolCode);
  const row = await store.upsertDevice({
    userId,
    schoolId,
    expoPushToken,
    platform,
    backendEnvironment,
    appProfile,
  });
  return publicDevice(row);
}

async function revokeCurrentFromSession(store, principal, body = {}) {
  rejectClientIdentity(body);
  const userId = sessionUserId(principal);
  const expoPushToken = parseExpoPushToken(body.expoPushToken ?? body.token);
  const owned = await store.getByToken(expoPushToken);
  if (owned && String(owned.user_id) !== String(userId)) {
    throw new BusinessError(403, "Impossible de révoquer le jeton d'un autre compte.");
  }
  const row = await store.revokeCurrent({ userId, expoPushToken });
  return { revoked: Boolean(row?.id), id: row?.id ?? null };
}

async function sendSelfTest(store, principal, body, pushClient, env = process.env) {
  rejectClientIdentity(body);
  if (body?.expoPushToken != null || body?.token != null || body?.to != null) {
    throw new BusinessError(400, "Ciblage par jeton client interdit.");
  }
  if (asTrimmed(body?.confirm) !== TEST_CONFIRM) {
    throw new BusinessError(400, "Confirmation de test push requise.");
  }
  const backendEnvironment = assertPushSelfTestAllowed(env);
  assertPushSelfTestActor(principal, env);
  const userId = sessionUserId(principal);
  const devices = await store.listActiveForUser({ userId, backendEnvironment });
  if (!devices.length) {
    throw new BusinessError(404, "Aucun appareil push actif pour cette session.");
  }
  const result = await pushClient.sendToTokens(
    devices.map((row) => row.expo_push_token),
    {
      title: TEST_TITLE,
      body: TEST_BODY,
      data: { somafrikDestination: TEST_DESTINATION },
      channelId: "somafrik-default",
    },
  );
  return {
    sent: result.sent,
    tickets: result.ticketCount,
    revoked: result.revoked,
  };
}

module.exports = {
  TEST_CONFIRM,
  TEST_TITLE,
  TEST_BODY,
  TEST_DESTINATION,
  BACKEND_ENVIRONMENTS,
  APP_PROFILES,
  APP_PROFILES_BY_BACKEND,
  PUSH_SELFTEST_PERMISSION,
  upsertFromSession,
  revokeCurrentFromSession,
  sendSelfTest,
  parseExpoPushToken,
  parseAppProfile,
  resolvePushBackendEnvironment,
  resolveStoredPushScope,
  assertPushSelfTestAllowed,
  assertPushSelfTestActor,
  hasPushSelfTestPermission,
  skipPushSelfTestPermissionCheck,
};
