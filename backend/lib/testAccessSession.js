"use strict";

/**
 * SEC-AUTH-04 — émission d'access tokens de test liés à une vraie session.
 *
 * Les bancs HTTP ne forgent plus de jeton sans session : chaque jeton est
 * accompagné d'une ligne `sessions` créée par le dépôt (PostgreSQL ou mémoire),
 * appartenant au sujet du jeton, comme lors d'une connexion réelle.
 * Le refresh token de la session est aléatoire et jamais renvoyé.
 */

const crypto = require("node:crypto");

const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

async function createTestAccessSession({ tokens, repository, payload = {}, ttlMs = DEFAULT_SESSION_TTL_MS }) {
  if (typeof repository?.createSession !== "function") {
    throw new Error("testAccessSession : dépôt sans createSession");
  }
  const sessionId = crypto.randomUUID();
  await repository.createSession({
    sessionId,
    refreshTokenHash: tokens.hashToken(crypto.randomBytes(32).toString("hex")),
    userId: payload.sub,
    schoolCode: payload.schoolCode,
    role: String(payload.role ?? ""),
    expiresAt: new Date(Date.now() + ttlMs),
    ipAddress: "127.0.0.1",
    userAgent: "somafrik-test-session",
  });
  return sessionId;
}

/** Access token signé portant le `sessionId` d'une session réelle du sujet. */
async function mintSessionAccessToken({ tokens, repository, payload = {}, ttlMs }) {
  const sessionId = await createTestAccessSession({ tokens, repository, payload, ttlMs });
  return tokens.createAccessToken({ ...payload, sessionId });
}

/** Fabrique `mint(payload)` asynchrone pour un banc. */
function createSessionTokenMinter({ tokens, repository, defaults = {} }) {
  return (payload = {}) => mintSessionAccessToken({ tokens, repository, payload: { ...defaults, ...payload } });
}

const SESSION_REFUSAL_CODES = new Set([
  "SESSION_REQUIRED",
  "SESSION_REVOKED",
  "SESSION_SUBJECT_MISMATCH",
  "SESSION_SCHOOL_ATTACHMENT_MISSING",
  "SESSION_ACCOUNT_INACTIVE",
]);

/**
 * Refus en amont par le contrôle de session (SEC-AUTH-04 / SEC-TENANT-01) : le
 * jeton n'atteint pas la route. `code` précise le motif attendu ; sans `code`,
 * seul un motif de session est admis (jamais une réponse de la route).
 */
function assertSessionRefused(response, label, code) {
  const assert = require("node:assert/strict");
  assert.equal(response.status, 401, `${label} : refus de session attendu (401), reçu ${response.status}`);
  const actual = response.data?.code;
  if (code) assert.equal(actual, code, `${label} : motif attendu ${code}, reçu ${actual}`);
  else assert.ok(SESSION_REFUSAL_CODES.has(actual), `${label} : motif de session attendu, reçu ${actual}`);
}

module.exports = {
  assertSessionRefused,
  createSessionTokenMinter,
  createTestAccessSession,
  mintSessionAccessToken,
};
