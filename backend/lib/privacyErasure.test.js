"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FallbackRepository } = require("../db/fallbackRepository");
const {
  createErasureRequest,
  executeErasureRequest,
  executeSelfErasure,
} = require("./privacyErasure");

test("demande publique sans identifiant → 400", async () => {
  const repo = new FallbackRepository();
  await assert.rejects(
    () => createErasureRequest(repo, { schoolCode: "CD-2026-0001" }),
    (error) => error.statusCode === 400,
  );
});

test("workflow traçable : pending puis anonymisation + révocation sessions", async () => {
  const repo = new FallbackRepository();
  const seedData = require("../data");
  const account = seedData.userAccounts.find((row) => row.id === "USER-ADMIN1");
  const snapshot = { ...account, history: [...(account.history ?? [])] };
  try {
    await repo.createSession({
      sessionId: "sess-1",
      refreshTokenHash: "abc",
      userId: "USER-ADMIN1",
      schoolCode: "CD-2026-0001",
      role: "Admin School",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const created = await createErasureRequest(repo, {
      schoolCode: "CD-2026-0001",
      identifier: "admin",
      email: "admin@example.com",
    });
    assert.equal(created.status, "pending");
    assert.match(created.requestCode, /^PRV-/);

    const schoolAdmin = {
      sub: "USER-ADMIN1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      roleKeys: ["SCHOOL_ADMIN"],
    };
    const executed = await executeErasureRequest(repo, created.id, schoolAdmin);
    assert.equal(executed.request.status, "processed");
    assert.equal(executed.schoolRecordsRetained, true);
    const session = await repo.findSessionByCode("sess-1");
    assert.ok(session.revoked_at);
  } finally {
    Object.assign(account, snapshot);
  }
});

test("exécution d'une demande publique cible l'identifiant, pas l'acteur", async () => {
  const repo = new FallbackRepository();
  const seedData = require("../data");
  const actor = seedData.userAccounts.find((row) => row.id === "USER-ADMIN1");
  const target = seedData.userAccounts.find((row) => String(row.identifier) === "secretaire");
  assert.ok(actor && target);
  const actorSnap = { ...actor, history: [...(actor.history ?? [])] };
  const targetSnap = { ...target, history: [...(target.history ?? [])] };
  try {
    await repo.createSession({
      sessionId: "sess-actor",
      refreshTokenHash: "actor",
      userId: actor.id,
      schoolCode: "CD-2026-0001",
      role: "Admin School",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repo.createSession({
      sessionId: "sess-target",
      refreshTokenHash: "target",
      userId: target.id,
      schoolCode: "CD-2026-0001",
      role: "Secrétaire",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const created = await createErasureRequest(repo, {
      schoolCode: "CD-2026-0001",
      identifier: "secretaire",
    });
    const executed = await executeErasureRequest(repo, created.id, {
      sub: actor.id,
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      roleKeys: ["SCHOOL_ADMIN"],
    });
    assert.equal(executed.request.status, "processed");
    const actorSession = await repo.findSessionByCode("sess-actor");
    const targetSession = await repo.findSessionByCode("sess-target");
    assert.equal(actorSession.revoked_at, null);
    assert.ok(targetSession.revoked_at);
    assert.equal(actor.status, actorSnap.status);
    assert.equal(target.status, "Supprimé");
    const { canUserAccountLogin } = require("./userAccountRules");
    assert.equal(canUserAccountLogin(target), false);
  } finally {
    Object.assign(actor, actorSnap);
    Object.assign(target, targetSnap);
  }
});

test("admin d'un autre établissement ne peut pas exécuter l'effacement", async () => {
  const repo = new FallbackRepository();
  const created = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  });
  await assert.rejects(
    () =>
      executeErasureRequest(repo, created.id, {
        sub: "USER-ADMIN-BI",
        role: "Admin School",
        schoolCode: "BI-2026-0002",
        roleKeys: ["SCHOOL_ADMIN"],
      }),
    (error) => error.statusCode === 403,
  );
});

test("principal sans schoolCode concret ne peut pas exécuter", async () => {
  const repo = new FallbackRepository();
  const created = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  });
  await assert.rejects(
    () =>
      executeErasureRequest(repo, created.id, {
        sub: "USER-FLOATING",
        role: "Admin School",
        schoolCode: "*",
        roleKeys: ["SCHOOL_ADMIN"],
      }),
    (error) => error.statusCode === 403,
  );
});

test("Superadmin ne peut pas exécuter un effacement établissement", async () => {
  const repo = new FallbackRepository();
  const created = await createErasureRequest(repo, {
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  });
  await assert.rejects(
    () =>
      executeErasureRequest(repo, created.id, {
        sub: "super",
        role: "Super Administrateur Somafrik",
        roleKeys: ["SUPER_ADMIN"],
        schoolCode: "*",
      }),
    (error) => error.statusCode === 403,
  );
});

test("exécution par request_code (pas seulement UUID)", async () => {
  const repo = new FallbackRepository();
  const seedData = require("../data");
  const account = seedData.userAccounts.find((row) => row.id === "USER-ADMIN1");
  const snapshot = { ...account, history: [...(account.history ?? [])] };
  try {
    const created = await createErasureRequest(repo, {
      schoolCode: "CD-2026-0001",
      identifier: "admin",
    });
    const executed = await executeErasureRequest(repo, created.requestCode, {
      sub: "USER-ADMIN1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      roleKeys: ["SCHOOL_ADMIN"],
    });
    assert.equal(executed.request.status, "processed");
    assert.equal(account.status, "Supprimé");
  } finally {
    Object.assign(account, snapshot);
  }
});

test("getPrivacyRequest PostgreSQL compare l'UUID en texte", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../db/postgresRepository.js"), "utf8");
  assert.match(src, /id::text = \$1 OR request_code = \$1/);
  assert.equal(src.includes("WHERE id = $1 OR request_code = $1"), false);
});

test("self-execute anonymise le compte authentifié", async () => {
  const repo = new FallbackRepository();
  const seedData = require("../data");
  const account = seedData.userAccounts.find((row) => row.id === "USER-ADMIN1");
  const snapshot = { ...account, history: [...(account.history ?? [])] };
  try {
    const principal = {
      sub: "USER-ADMIN1",
      identifier: "admin",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
    };
    const result = await executeSelfErasure(repo, principal);
    assert.equal(result.request.status, "processed");
    assert.equal(account.status, "Supprimé");
  } finally {
    Object.assign(account, snapshot);
  }
});
