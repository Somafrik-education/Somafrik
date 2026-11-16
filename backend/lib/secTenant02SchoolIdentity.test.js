"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertAccessSessionAccount } = require("./accessSessionAccountGuard");
const { loadLiveRoleState } = require("./liveRoleState");
const { collectPrincipalRoleKeys } = require("./functionalRbacService");

const SCHOOL_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const SCHOOL_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USER = "cccccccc-0000-4000-8000-00000000000c";
const SESSION_A = {
  user_status: "active",
  user_school_id: SCHOOL_A,
  user_school_code: "CD-2026-0001",
  user_school_login_code: "CD-IN-26-001",
};
const silent = { warn() {} };

function guardRepository(canonical = null) {
  const revoked = [];
  let canonicalReads = 0;
  return {
    revoked,
    get canonicalReads() {
      return canonicalReads;
    },
    async revokeSession(sessionId, reason) {
      revoked.push({ sessionId, reason });
    },
    async findUserCanonicalSchool() {
      canonicalReads += 1;
      return canonical;
    },
  };
}

const admin = (claims) => ({ sub: USER, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], ...claims });
const guard = (principal, activeSession = SESSION_A, repository = guardRepository()) =>
  assertAccessSessionAccount({ principal, activeSession, repository, sessionId: "sess-1" });
const refused = (error) => error.statusCode === 401;

test("SEC-TENANT-02 — schoolCode et schoolId concordants : accepté, établissement canonique renvoyé", async () => {
  for (const schoolCode of ["CD-2026-0001", "CD-IN-26-001"]) {
    const repository = guardRepository();
    const verified = await guard(admin({ schoolCode, schoolId: SCHOOL_A }), SESSION_A, repository);
    assert.equal(verified.schoolId, SCHOOL_A);
    assert.deepEqual(repository.revoked, []);
  }
  // schoolCode seul (jeton de refresh) ou schoolId seul : chacun vérifié.
  assert.equal((await guard(admin({ schoolCode: "CD-2026-0001" }))).schoolId, SCHOOL_A);
  assert.equal((await guard(admin({ schoolCode: "", schoolId: SCHOOL_A }))).schoolId, SCHOOL_A);
});

test("SEC-TENANT-02 — contradiction schoolCode / schoolId : 401 et session révoquée", async () => {
  for (const claims of [
    { schoolCode: "CD-2026-0002", schoolId: SCHOOL_A },
    { schoolCode: "CD-2026-0001", schoolId: SCHOOL_B },
    { schoolCode: "CD-ZZZ-26-999", schoolId: SCHOOL_A },
    { schoolCode: "CD-2026-0001", schoolId: "dddddddd-0000-4000-8000-00000000000d" },
    { schoolCode: "", schoolId: SCHOOL_B },
  ]) {
    const repository = guardRepository();
    await assert.rejects(() => guard(admin(claims), SESSION_A, repository), refused, JSON.stringify(claims));
    assert.deepEqual(repository.revoked, [{ sessionId: "sess-1", reason: "school_attachment_changed" }]);
  }
});

test("SEC-TENANT-02 — compte sans affectation portant un établissement : vérifié comme un rôle scolaire", async () => {
  const unassigned = (claims) => ({ sub: USER, role: "Sans affectation", roleKeys: [], ...claims });
  assert.equal((await guard(unassigned({ schoolCode: "CD-2026-0001", schoolId: SCHOOL_A }))).schoolId, SCHOOL_A);
  await assert.rejects(() => guard(unassigned({ schoolCode: "CD-2026-0002" })), refused, "ancien établissement");
  await assert.rejects(
    () => guard(unassigned({ schoolCode: "CD-2026-0001" }), { user_status: "active", user_school_id: null }),
    refused,
    "plus aucun établissement",
  );
  // Aucun établissement revendiqué : rien à vérifier.
  assert.equal(await guard(unassigned({ schoolCode: "" })), null);
});

test("SEC-TENANT-02 — comptes plateforme : aucun identifiant d'établissement implicite", async () => {
  const superadmin = { sub: USER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" };
  const pays = { sub: USER, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: "*" };
  const platformSession = { user_status: "active", user_school_id: null };
  for (const principal of [superadmin, pays]) {
    assert.equal(await guard(principal, platformSession), null);
    const repository = guardRepository();
    await assert.rejects(
      () => guard({ ...principal, schoolId: SCHOOL_A }, platformSession, repository),
      (error) => error.statusCode === 401 && error.code === "SESSION_SCHOOL_IDENTITY_MISMATCH",
    );
    assert.deepEqual(repository.revoked, [{ sessionId: "sess-1", reason: "school_identity_mismatch" }]);
  }
});

test("SEC-TENANT-02 — PostgreSQL : aucune requête supplémentaire (projection de session)", async () => {
  const repository = guardRepository({ schoolId: SCHOOL_B, schoolCode: "CD-2026-0002" });
  await guard(admin({ schoolCode: "CD-2026-0001", schoolId: SCHOOL_A }), SESSION_A, repository);
  assert.equal(repository.canonicalReads, 0);
});

test("SEC-TENANT-02 — dépôt mémoire sans identifiant canonique : schoolId accepté seulement avec un code vérifié", async () => {
  const memory = guardRepository({ schoolId: "", schoolCode: "CD-2026-0001", loginCode: "" });
  const noProjection = {};
  assert.ok(await guard(admin({ schoolCode: "CD-2026-0001", schoolId: SCHOOL_A }), noProjection, memory));
  await assert.rejects(() => guard(admin({ schoolCode: "", schoolId: SCHOOL_A }), noProjection, guardRepository({ schoolId: "", schoolCode: "CD-2026-0001" })), refused);
  await assert.rejects(() => guard(admin({ schoolCode: "CD-2026-0002", schoolId: SCHOOL_A }), noProjection, guardRepository({ schoolId: "", schoolCode: "CD-2026-0001" })), refused);
  await assert.rejects(() => guard(admin({ schoolCode: "CD-2026-0001" }), noProjection, guardRepository(null)), refused, "établissement introuvable");
});

function scopedRepo({ global = [], bySchool = {}, history = true } = {}) {
  const calls = [];
  return {
    calls,
    async listActiveUserRoleKeys(id) {
      calls.push(`all:${id}`);
      return global;
    },
    async listActiveUserRoleKeysForSchool(id, schoolId) {
      calls.push(`school:${schoolId}`);
      return bySchool[schoolId] ?? [];
    },
    async userHasRoleHistory() {
      return history;
    },
  };
}

test("SEC-TENANT-02 — rôles : seul l'établissement vérifié compte", async () => {
  const repo = scopedRepo({ global: ["TEACHER", "SCHOOL_ADMIN"], bySchool: { [SCHOOL_A]: ["TEACHER"], [SCHOOL_B]: ["SCHOOL_ADMIN"] } });
  assert.deepEqual(await loadLiveRoleState(repo, USER, { schoolId: SCHOOL_A, logger: silent }), { status: "active", keys: ["TEACHER"] });
  assert.deepEqual(repo.calls, [`school:${SCHOOL_A}`], "aucune lecture non bornée");
  // Rôles uniquement dans un autre établissement : aucun rôle ici.
  const elsewhere = scopedRepo({ bySchool: { [SCHOOL_B]: ["SCHOOL_ADMIN"] }, history: true });
  assert.deepEqual(await loadLiveRoleState(elsewhere, USER, { schoolId: SCHOOL_A, logger: silent }), { status: "revoked", keys: [] });
  // Sans établissement (plateforme) : lecture globale inchangée.
  assert.deepEqual((await loadLiveRoleState(repo, USER, { logger: silent })).keys, ["TEACHER", "SCHOOL_ADMIN"]);
  // Dépôt sans lecture bornée : refus (jamais la lecture globale).
  const unscopedOnly = { listActiveUserRoleKeys: async () => ["SCHOOL_ADMIN"], userHasRoleHistory: async () => true };
  assert.deepEqual(await loadLiveRoleState(unscopedOnly, USER, { schoolId: SCHOOL_A, logger: silent }), { status: "unavailable", keys: [] });
});

test("SEC-TENANT-02 — collectPrincipalRoleKeys borné au schoolId du principal", async () => {
  const repo = scopedRepo({ global: ["TEACHER", "SCHOOL_ADMIN"], bySchool: { [SCHOOL_A]: ["TEACHER"], [SCHOOL_B]: ["SCHOOL_ADMIN"] } });
  const principal = { sub: USER, role: "Admin School", roleKeys: ["SCHOOL_ADMIN", "TEACHER"], schoolCode: "CD-2026-0001", schoolId: SCHOOL_A };
  assert.deepEqual(await collectPrincipalRoleKeys(repo, principal), ["TEACHER"]);
  const platform = { sub: USER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*" };
  const platformRepo = scopedRepo({ global: ["SUPER_ADMIN"] });
  assert.deepEqual(await collectPrincipalRoleKeys(platformRepo, platform), ["SUPER_ADMIN"]);
  assert.deepEqual(platformRepo.calls, [`all:${USER}`]);
});

test("SEC-TENANT-02 — Finance : rôles déjà bornés par le dépôt mandataire, aucune autre lecture", async () => {
  const { resolveLiveEffectivePermissions } = require("./liveRbacPrincipalAuthority");
  if (typeof resolveLiveEffectivePermissions !== "function") return;
  const reads = [];
  const repository = {
    async getSchoolByCode() {
      return { id: SCHOOL_A };
    },
    async listActiveUserRoleKeysForSchool(id, schoolId) {
      reads.push(schoolId);
      return schoolId === SCHOOL_A ? ["ACCOUNTANT"] : ["SCHOOL_ADMIN"];
    },
    async listActiveUserRoleKeys() {
      reads.push("all");
      return ["ACCOUNTANT", "SCHOOL_ADMIN"];
    },
    async userHasRoleHistory() {
      return true;
    },
    async listRoleModulePermissions() {
      return [];
    },
  };
  const principal = { sub: USER, role: "Comptable", schoolCode: "CD-2026-0001", schoolId: SCHOOL_A };
  try {
    await resolveLiveEffectivePermissions(repository, principal);
  } catch {
    /* le catalogue de permissions du faux dépôt est incomplet : seules les lectures de rôles comptent */
  }
  assert.deepEqual(reads, [SCHOOL_A], "une seule lecture, bornée à l'établissement");
});

test("SEC-TENANT-02 — PostgreSQL : l'exception « sans identifiant canonique » est inaccessible", async () => {
  // Projection PostgreSQL : le schoolId du jeton est toujours comparé, même avec un code valide.
  for (const schoolCode of ["CD-2026-0001", "CD-IN-26-001"]) {
    const repository = guardRepository({ schoolId: "", schoolCode: "CD-2026-0001" });
    await assert.rejects(() => guard(admin({ schoolCode, schoolId: SCHOOL_B }), SESSION_A, repository), refused);
    assert.equal(repository.canonicalReads, 0, "projection utilisée, jamais la lecture de repli");
  }
  // Projection sans identifiant (compte sans établissement) : aucun établissement canonique → refus.
  await assert.rejects(
    () =>
      guard(admin({ schoolCode: "CD-2026-0001", schoolId: SCHOOL_A }), {
        user_status: "active",
        user_school_id: null,
        user_school_code: "CD-2026-0001",
      }),
    refused,
  );
});
