"use strict";

const { BusinessError } = require("../services/authService");
const { uuidOrNull } = require("./principalIdentity");

const N1_PLATFORM = "android";
const RELEASE_PROFILES = new Set(["development", "preview", "preproduction", "production"]);
const SELF_TEST_ALLOWED_PROFILES = new Set(["development", "preview"]);
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

function parseReleaseProfile(value) {
  const profile = asTrimmed(value).toLowerCase();
  if (!RELEASE_PROFILES.has(profile)) {
    throw new BusinessError(400, "Profil de release inconnu.");
  }
  return profile;
}

/**
 * Autorité exclusive : SOMAFRIK_PUSH_RELEASE_PROFILE.
 * Un body.releaseProfile client n'est jamais lu ici.
 */
function resolveServerPushReleaseProfile(env = process.env) {
  const raw = asTrimmed(env.SOMAFRIK_PUSH_RELEASE_PROFILE).toLowerCase();
  const nodeEnv = asTrimmed(env.NODE_ENV).toLowerCase();
  if (RELEASE_PROFILES.has(raw)) return raw;
  if (raw) {
    throw new BusinessError(500, "SOMAFRIK_PUSH_RELEASE_PROFILE invalide.");
  }
  if (nodeEnv === "test") return "preview";
  if (nodeEnv === "development") return "development";
  throw new BusinessError(500, "SOMAFRIK_PUSH_RELEASE_PROFILE obligatoire hors développement/test.");
}

function assertPushReleaseProfileConfigured(env = process.env) {
  resolveServerPushReleaseProfile(env);
}

function serverReleaseProfileFromBody(body = {}, env = process.env) {
  const serverProfile = resolveServerPushReleaseProfile(env);
  const client = asTrimmed(body.releaseProfile).toLowerCase();
  if (client && client !== serverProfile) {
    throw new BusinessError(400, "Profil de release client rejeté.");
  }
  return serverProfile;
}

function assertPushSelfTestAllowed(env = process.env) {
  const profile = resolveServerPushReleaseProfile(env);
  if (!SELF_TEST_ALLOWED_PROFILES.has(profile)) {
    throw new BusinessError(403, "Auto-test push interdit dans cet environnement.");
  }
  return profile;
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
    releaseProfile: row.release_profile,
    revokedAt: row.revoked_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

async function upsertFromSession(store, principal, body = {}, env = process.env) {
  rejectClientIdentity(body);
  const userId = sessionUserId(principal);
  const expoPushToken = parseExpoPushToken(body.expoPushToken ?? body.token);
  const platform = parsePlatform(body.platform);
  const releaseProfile = serverReleaseProfileFromBody(body, env);
  const schoolId = await store.resolveSchoolId(principal.schoolCode);
  const row = await store.upsertDevice({
    userId,
    schoolId,
    expoPushToken,
    platform,
    releaseProfile,
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
  const releaseProfile = assertPushSelfTestAllowed(env);
  serverReleaseProfileFromBody(body, env);
  const userId = sessionUserId(principal);
  const devices = await store.listActiveForUser({ userId, releaseProfile });
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
  RELEASE_PROFILES,
  SELF_TEST_ALLOWED_PROFILES,
  upsertFromSession,
  revokeCurrentFromSession,
  sendSelfTest,
  parseExpoPushToken,
  parseReleaseProfile,
  resolveServerPushReleaseProfile,
  assertPushReleaseProfileConfigured,
  assertPushSelfTestAllowed,
  serverReleaseProfileFromBody,
};
