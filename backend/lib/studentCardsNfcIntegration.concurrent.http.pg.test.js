"use strict";

/**
 * Deux fixtures NFC lancées ensemble ne partagent plus le port 19889.
 * Chacune ne devient prête que si son propre processus écoute, et un jeton
 * de l'une est une session inconnue pour l'autre (SESSION_REVOKED).
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createIntegrationFixture, listenPortOwnedBy } = require("./studentCardsNfcIntegration.fixture");

test("lancement concurrent : ports distincts, santé du processus fils, jeton croisé refusé", async () => {
  const [first, second] = await Promise.all([createIntegrationFixture(), createIntegrationFixture()]);
  try {
    assert.notEqual(first.port, second.port);
    assert.equal(listenPortOwnedBy(first.pid, first.port), true);
    assert.equal(listenPortOwnedBy(second.pid, second.port), true);
    assert.equal(listenPortOwnedBy(first.pid, second.port), false);
    assert.equal(listenPortOwnedBy(second.pid, first.port), false);

    const own = await first.request("/auth/effective-permissions");
    assert.equal(own.status, 200, JSON.stringify(own.data));
    const otherOwn = await second.request("/auth/effective-permissions");
    assert.equal(otherOwn.status, 200, JSON.stringify(otherOwn.data));

    const crossed = await fetch(`http://127.0.0.1:${second.port}/api/auth/effective-permissions`, {
      headers: { Authorization: `Bearer ${first.schools[0].token}` },
    });
    const crossedBody = await crossed.json();
    assert.equal(crossed.status, 401);
    assert.equal(crossedBody.code, "SESSION_REVOKED");
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
