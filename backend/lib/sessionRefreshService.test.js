"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TokenService } = require("../services/tokenService");
const { rotateRefreshSession } = require("./sessionRefreshService");
const { FallbackRepository } = require("../db/fallbackRepository");

function tokens() {
  return new TokenService({
    secret: "p1-auth-session-test-secret-with-enough-length",
    accessTokenTtlSeconds: 60,
    refreshTokenTtlSeconds: 3600,
  });
}

async function seededSession(repo, service) {
  const refresh = service.createRefreshToken({
    sub: "user-1",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  });
  await repo.createSession({
    sessionId: refresh.sessionId,
    refreshTokenHash: service.hashToken(refresh.token),
    userId: "user-1",
    schoolCode: "CD-2026-0001",
    role: "Admin School",
    expiresAt: refresh.expiresAt,
  });
  return refresh;
}

test("rotation émet un nouveau refresh et refuse l'ancien après grâce", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  const rotated = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: first.token,
  });
  assert.equal(rotated.rotated, true);
  assert.notEqual(rotated.refreshToken, first.token);

  await assert.rejects(
    () =>
      rotateRefreshSession({
        repository: repo,
        tokenService: service,
        refreshToken: first.token,
        now: Date.now() + 20_000,
      }),
    (error) => error.statusCode === 401 && error.code === "REFRESH_REUSE_DETECTED",
  );

  const session = await repo.findSessionByCode(first.sessionId);
  assert.ok(session.revoked_at, "réutilisation révoque la famille");
});

test("logout puis refresh → 401 sans reuse-all si déjà révoqué", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  await repo.revokeSession(first.sessionId, "logout");
  await assert.rejects(
    () => rotateRefreshSession({ repository: repo, tokenService: service, refreshToken: first.token }),
    (error) => error.statusCode === 401 && error.code === "SESSION_REVOKED",
  );
});

test("refresh concurrent dans la fenêtre de grâce renvoie le jeton courant, jamais l'ancien", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  const rotated = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: first.token,
  });
  const raced = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: first.token,
    now: Date.now() + 1_000,
  });
  assert.equal(raced.rotated, false);
  assert.equal(raced.refreshToken, rotated.refreshToken);
  assert.notEqual(raced.refreshToken, first.token);

  const followUp = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: raced.refreshToken,
  });
  assert.equal(followUp.rotated, true);
  assert.notEqual(followUp.refreshToken, rotated.refreshToken);
});

test("grâce sans jeton courant reconstitutable ne redonne pas l'ancien refresh", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: first.token,
  });
  const session = await repo.findSessionByCode(first.sessionId);
  session.refresh_token_grace = "v1.corrupt";
  await assert.rejects(
    () =>
      rotateRefreshSession({
        repository: repo,
        tokenService: service,
        refreshToken: first.token,
        now: Date.now() + 1_000,
      }),
    (error) => error.statusCode === 401 && error.code === "SESSION_REVOKED",
  );
});
