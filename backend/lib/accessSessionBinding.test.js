"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  normalizeAccessSessionId,
  resolveBoundAccessSession,
  sessionBelongsToSubject,
} = require("./accessSessionBinding");

const SID = crypto.randomUUID();
const USER = crypto.randomUUID();

function repoWith(session) {
  const calls = [];
  return {
    calls,
    async findActiveAccessSession(id) {
      calls.push(id);
      return session && session.session_code === id ? session : null;
    },
    async revokeSession(id) {
      calls.push(`revoke:${id}`);
    },
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, code);
    return true;
  });
}

test("SEC-AUTH-04 — sessionId : seul le format UUID émis par le serveur est accepté", () => {
  assert.equal(normalizeAccessSessionId(SID), SID);
  assert.equal(normalizeAccessSessionId(` ${SID} `), SID);
  for (const value of [undefined, null, "", "   ", "abc", `${SID}x`, "../" + SID, 42, {}, [SID]]) {
    assert.equal(normalizeAccessSessionId(value), null, String(value));
  }
});

test("SEC-AUTH-04 — C-03 : aucun accès sans session, quel que soit le rôle", async () => {
  for (const principal of [
    { sub: USER, role: "Admin School" },
    { sub: USER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" },
    { sub: USER, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: "*" },
    { sub: USER, sessionId: "" },
  ]) {
    const repository = repoWith({ session_code: SID, user_id: USER });
    await rejectsWith(resolveBoundAccessSession({ principal, repository }), "SESSION_REQUIRED");
    assert.deepEqual(repository.calls, [], "aucune lecture de session sans sessionId valide");
  }
});

test("SEC-AUTH-04 — dépôt sans lecture de session : refus (fail-closed)", async () => {
  await rejectsWith(
    resolveBoundAccessSession({ principal: { sub: USER, sessionId: SID }, repository: {} }),
    "SESSION_STORE_UNAVAILABLE",
  );
});

test("SEC-AUTH-04 — session inexistante, révoquée ou expirée : refus", async () => {
  await rejectsWith(
    resolveBoundAccessSession({ principal: { sub: USER, sessionId: SID }, repository: repoWith(null) }),
    "SESSION_REVOKED",
  );
});

test("SEC-AUTH-04 — F3 : la session doit appartenir au sujet du jeton, sans révoquer la session d'autrui", async () => {
  const other = crypto.randomUUID();
  const repository = repoWith({ session_code: SID, user_id: other, user_code: "USR-0001" });
  await rejectsWith(resolveBoundAccessSession({ principal: { sub: USER, sessionId: SID }, repository }), "SESSION_SUBJECT_MISMATCH");
  assert.deepEqual(repository.calls, [SID], "aucune révocation de la session d'un autre utilisateur");

  const ownerRepo = repoWith({ session_code: SID, user_id: USER.toUpperCase() });
  const { activeSession } = await resolveBoundAccessSession({ principal: { sub: USER, sessionId: SID }, repository: ownerRepo });
  assert.equal(activeSession.session_code, SID);
});

test("SEC-AUTH-04 — F3 : identifiants comparés sans confusion", () => {
  const session = { user_id: USER, user_code: "USR-2026-0001" };
  assert.equal(sessionBelongsToSubject({ sub: USER }, session), true, "users.id");
  assert.equal(sessionBelongsToSubject({ sub: "USR-2026-0001" }, session), true, "user_code (même résolution que createSession)");
  for (const sub of ["", "USR-2026-0002", "usr-2026-0001", crypto.randomUUID(), " ", null]) {
    assert.equal(sessionBelongsToSubject({ sub }, session), false, String(sub));
  }
  assert.equal(sessionBelongsToSubject({ sub: USER }, { user_id: null }), false, "session sans propriétaire");
  assert.equal(sessionBelongsToSubject({ sub: "USER-T1" }, { user_id: "USER-T1" }), true, "mémoire : sub enregistré tel quel");
  assert.equal(sessionBelongsToSubject({ sub: "user-t1" }, { user_id: "USER-T1" }), false, "mémoire : casse respectée hors UUID");
  assert.equal(
    sessionBelongsToSubject({ publicId: "USER-T1", identifier: "USER-T1" }, { user_id: "USER-T1" }),
    false,
    "publicId / identifiant de connexion jamais utilisés",
  );
});
