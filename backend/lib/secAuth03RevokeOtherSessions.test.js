"use strict";

/**
 * SEC-AUTH-03 — changement de mot de passe : révocation des autres sessions
 * (dépôt mémoire) et câblage de la route `/api/auth/change-password`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FallbackRepository } = require("../db/fallbackRepository");

async function repoWithSessions() {
  const repo = new FallbackRepository();
  const future = new Date(Date.now() + 3600_000);
  for (const [sessionId, userId] of [
    ["s-current", "user-1"],
    ["s-other-web", "user-1"],
    ["s-other-mobile", "user-1"],
    ["s-foreign", "user-2"],
  ]) {
    await repo.createSession({ sessionId, refreshTokenHash: `h-${sessionId}`, userId, schoolCode: "SCH", role: "Admin School", expiresAt: future });
  }
  return repo;
}

test("SEC-AUTH-03 — mémoire : seules les autres sessions de l'utilisateur sont révoquées", async () => {
  const repo = await repoWithSessions();
  const revoked = await repo.revokeOtherSessionsForUser("user-1", "s-current", "password_change");
  assert.equal(revoked, 2);
  assert.ok(await repo.findActiveAccessSession("s-current"), "session courante conservée");
  assert.equal(await repo.findActiveAccessSession("s-other-web"), null);
  assert.equal(await repo.findActiveAccessSession("s-other-mobile"), null);
  assert.ok(await repo.findActiveAccessSession("s-foreign"), "sessions d'un autre utilisateur intactes");
  assert.equal((await repo.findSessionByCode("s-other-web")).revoke_reason, "password_change");
});

test("SEC-AUTH-03 — mémoire : sans session courante, toutes les sessions sont révoquées", async () => {
  const repo = await repoWithSessions();
  assert.equal(await repo.revokeOtherSessionsForUser("user-1", null), 3);
  assert.equal(await repo.findActiveAccessSession("s-current"), null);
  assert.ok(await repo.findActiveAccessSession("s-foreign"));
});

test("SEC-AUTH-03 — route change-password : révocation après mise à jour, session courante conservée", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const start = src.indexOf('app.post("/api/auth/change-password"');
  assert.ok(start > 0);
  const route = src.slice(start, src.indexOf("}));", start));
  const change = route.indexOf("repository.changeUserPassword(");
  const revoke = route.indexOf("revokeOtherSessionsForUser(req.principal.sub, keepSessionId, \"password_change\")");
  assert.ok(change > 0 && revoke > change, "révocation après le changement de mot de passe");
  assert.match(route, /sessionId: req\.principal\.sessionId/, "nouveau jeton lié à la session courante");
  assert.doesNotMatch(route, /console\.(log|info)\([^)]*(accessToken|refreshToken|newPassword)/, "aucun secret journalisé");
});
