"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");

test("FallbackRepository expose le compteur d'annonces plateforme sans erreur 500", async () => {
  const repository = new FallbackRepository();
  const result = await repository.getPlatformAnnouncementsUnreadCount({ sub: "memory-smoke-user" });

  assert.deepEqual(result, { count: 0 });
});
