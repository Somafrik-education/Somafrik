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

test("rotateSessionRefresh refuse un hash qui n'est plus courant (CAS)", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  const rotated = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: first.token,
  });
  const lost = await repo.rotateSessionRefresh({
    sessionId: first.sessionId,
    newHash: "attacker-hash",
    previousHash: service.hashToken(first.token),
    expiresAt: new Date(Date.now() + 60_000),
    refreshTokenGrace: "v1.forged",
    expectedCurrentHash: service.hashToken(first.token),
  });
  assert.equal(lost, false);
  const session = await repo.findSessionByCode(first.sessionId);
  assert.equal(session.refresh_token_hash, service.hashToken(rotated.refreshToken));
  assert.notEqual(session.refresh_token_hash, "attacker-hash");
});

test("deux workers voient le même hash : un seul rotate, l'autre reçoit le jeton courant", async () => {
  const repo = new FallbackRepository();
  const service = tokens();
  const first = await seededSession(repo, service);
  const originalRotate = repo.rotateSessionRefresh.bind(repo);
  let entered = 0;
  let releaseBoth;
  const bothEntered = new Promise((resolve) => {
    releaseBoth = resolve;
  });
  repo.rotateSessionRefresh = async (args) => {
    entered += 1;
    if (entered === 2) releaseBoth();
    await bothEntered;
    return originalRotate(args);
  };

  const [a, b] = await Promise.all([
    rotateRefreshSession({ repository: repo, tokenService: service, refreshToken: first.token }),
    rotateRefreshSession({ repository: repo, tokenService: service, refreshToken: first.token }),
  ]);

  assert.equal(a.refreshToken, b.refreshToken, "les deux clients doivent converger sur le jeton courant");
  assert.notEqual(a.refreshToken, first.token);
  assert.equal(Number(a.rotated) + Number(b.rotated), 1, "un seul worker doit gagner le CAS");

  const followUp = await rotateRefreshSession({
    repository: repo,
    tokenService: service,
    refreshToken: a.refreshToken,
  });
  assert.equal(followUp.rotated, true);
  assert.notEqual(followUp.refreshToken, a.refreshToken);
});

test("rotateSessionRefresh PostgreSQL compare-and-swap sur le hash présenté", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.match(src, /AND refresh_token_hash = \$6/);
  assert.match(src, /expectedCurrentHash/);
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
