"use strict";

const { BusinessError } = require("../services/authService");
const { uuidOrNull } = require("./principalIdentity");
const { resolvePushBackendEnvironment } = require("./mobilePushDevicesService");

const ENDPOINT_MAX = 2048;
const KEY_RE = /^[A-Za-z0-9_-]{16,256}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function rejectClientIdentity(body = {}) {
  if (body.userId != null || body.user_id != null || body.schoolId != null || body.school_id != null) {
    throw new BusinessError(400, "Identité user/school interdite depuis le client.");
  }
}

function sessionUserId(principal) {
  const userId = uuidOrNull(principal?.sub);
  if (!userId) {
    throw new BusinessError(401, "Session utilisateur invalide.");
  }
  return userId;
}

async function sessionSchoolId(store, principal) {
  const schoolId = uuidOrNull(await store.resolveSchoolId(principal?.schoolCode));
  if (!schoolId) {
    throw new BusinessError(400, "École de session requise.");
  }
  return schoolId;
}

function parseEndpoint(value) {
  const endpoint = asTrimmed(value);
  if (endpoint.length < 20 || endpoint.length > ENDPOINT_MAX) {
    throw new BusinessError(400, "Abonnement Web Push invalide.");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BusinessError(400, "Abonnement Web Push invalide.");
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new BusinessError(400, "Abonnement Web Push invalide.");
  }
  return endpoint;
}

function parseKey(value, label) {
  const key = asTrimmed(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (!KEY_RE.test(key)) {
    throw new BusinessError(400, `Clé Web Push ${label} invalide.`);
  }
  return key;
}

function parseUserAgent(value) {
  const raw = asTrimmed(value);
  if (!raw) return null;
  return raw.slice(0, 240);
}

function publicSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    backendEnvironment: row.backend_environment,
    revokedAt: row.revoked_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

function readVapidConfig(env = process.env) {
  const publicKey = asTrimmed(env.VAPID_PUBLIC_KEY);
  const privateKey = asTrimmed(env.VAPID_PRIVATE_KEY);
  const subject = asTrimmed(env.VAPID_SUBJECT) || "mailto:contact@somafrik.app";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

function publicPushConfig(env = process.env) {
  const vapid = readVapidConfig(env);
  return {
    enabled: Boolean(vapid),
    vapidPublicKey: vapid ? vapid.publicKey : null,
  };
}

async function upsertFromSession(store, principal, body = {}, env = process.env) {
  rejectClientIdentity(body);
  const userId = sessionUserId(principal);
  const schoolId = await sessionSchoolId(store, principal);
  const backendEnvironment = resolvePushBackendEnvironment(env);
  const keys = body.keys && typeof body.keys === "object" ? body.keys : {};
  const row = await store.upsertSubscription({
    userId,
    schoolId,
    endpoint: parseEndpoint(body.endpoint),
    p256dh: parseKey(keys.p256dh, "p256dh"),
    auth: parseKey(keys.auth, "auth"),
    userAgent: parseUserAgent(body.userAgent ?? body.user_agent),
    backendEnvironment,
  });
  return publicSubscription(row);
}

async function revokeCurrentFromSession(store, principal, body = {}) {
  rejectClientIdentity(body);
  const userId = sessionUserId(principal);
  const endpoint = parseEndpoint(body.endpoint);
  const owned = await store.getByEndpoint(endpoint);
  if (owned && String(owned.user_id) !== String(userId)) {
    throw new BusinessError(403, "Impossible de révoquer l'abonnement d'un autre compte.");
  }
  const row = await store.revokeCurrent({ userId, endpoint });
  return { revoked: Boolean(row?.id), id: row?.id ?? null };
}

module.exports = {
  upsertFromSession,
  revokeCurrentFromSession,
  publicPushConfig,
  readVapidConfig,
  parseEndpoint,
  parseKey,
  rejectClientIdentity,
};
