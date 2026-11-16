"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveRoleState } = require("./liveRoleState");
const { collectPrincipalRoleKeys } = require("./functionalRbacService");

const silent = { warn() {} };
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const PLATFORM_CLAIMS = {
  sub: USER,
  role: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  roles: ["Super Administrateur Somafrik"],
  permissions: ["ALL_PRIVILEGES"],
};

function repoWith(options = {}) {
  const { activeError, historyError, activeHang, historyHang } = options;
  // Valeurs transmises telles quelles (undefined compris) : pas de défaut implicite.
  const active = "active" in options ? options.active : [];
  const history = "history" in options ? options.history : false;
  const calls = [];
  return {
    calls,
    async listActiveUserRoleKeys(id) {
      calls.push(`active:${id}`);
      if (activeError) throw activeError;
      if (activeHang) return new Promise(() => {});
      return active;
    },
    async userHasRoleHistory(id) {
      calls.push(`history:${id}`);
      if (historyError) throw historyError;
      if (historyHang) return new Promise(() => {});
      return history;
    },
  };
}

const load = (repo, opts = {}) => loadLiveRoleState(repo, USER, { logger: silent, ...opts });
const sqlError = Object.assign(new Error("relation \"user_roles\" does not exist"), { code: "42P01" });

test("SEC-AUTH-05 — rôles actifs : relus sans lecture d'historique", async () => {
  const repo = repoWith({ active: ["TEACHER"], history: true });
  assert.deepEqual(await load(repo), { status: "active", keys: ["TEACHER"] });
  assert.deepEqual(repo.calls, [`active:${USER}`], "aucune requête supplémentaire sur le chemin courant");
});

test("SEC-AUTH-05 — tous les rôles retirés (historique présent) : aucun rôle", async () => {
  assert.deepEqual(await load(repoWith({ active: [], history: true })), { status: "revoked", keys: [] });
});

test("SEC-AUTH-05 — absence réelle d'historique : seul cas de repli legacy", async () => {
  assert.deepEqual(await load(repoWith({ active: [], history: false })), { status: "legacy", keys: null });
});

test("SEC-AUTH-05 — erreur SQL : refus (jamais de repli)", async () => {
  assert.equal((await load(repoWith({ activeError: sqlError }))).status, "unavailable");
  assert.equal((await load(repoWith({ active: [], historyError: sqlError }))).status, "unavailable");
});

test("SEC-AUTH-05 — délai dépassé : refus (jamais de repli)", async () => {
  assert.equal((await load(repoWith({ activeHang: true }), { timeoutMs: 20 })).status, "unavailable");
  assert.equal((await load(repoWith({ active: [], historyHang: true }), { timeoutMs: 20 })).status, "unavailable");
});

test("SEC-AUTH-05 — dépôt indisponible ou incomplet : refus", async () => {
  for (const repo of [null, undefined, {}, { listActiveUserRoleKeys: async () => [] }, { userHasRoleHistory: async () => false }]) {
    assert.deepEqual(await load(repo), { status: "unavailable", keys: [] });
  }
  assert.equal((await loadLiveRoleState(repoWith({ active: ["TEACHER"] }), "", { logger: silent })).status, "unavailable", "identifiant absent");
  // Rôles actifs présents : l'historique n'est pas requis.
  assert.deepEqual(await load({ listActiveUserRoleKeys: async () => ["TEACHER"] }), { status: "active", keys: ["TEACHER"] });
});

test("SEC-AUTH-05 — résultat invalide : refus", async () => {
  for (const active of [null, undefined, "SCHOOL_ADMIN", { 0: "SCHOOL_ADMIN" }, [""], [42], [null]]) {
    assert.equal((await load(repoWith({ active }))).status, "unavailable", JSON.stringify(active));
  }
  for (const history of [null, undefined, 0, 1, "false", "true", {}, []]) {
    assert.equal((await load(repoWith({ active: [], history }))).status, "unavailable", JSON.stringify(history));
  }
});

test("SEC-AUTH-05 — rôles du principal : seuls « active » et « legacy » donnent un rôle", async () => {
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: ["TEACHER"] }), PLATFORM_CLAIMS), ["TEACHER"]);
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: [], history: true }), PLATFORM_CLAIMS), []);
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ activeError: sqlError }), PLATFORM_CLAIMS), [], "erreur SQL");
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: [], historyError: sqlError }), PLATFORM_CLAIMS), [], "erreur historique");
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: "x" }), PLATFORM_CLAIMS), [], "résultat invalide");
  assert.deepEqual(await collectPrincipalRoleKeys({}, PLATFORM_CLAIMS), [], "dépôt indisponible");
  assert.ok((await collectPrincipalRoleKeys(repoWith({ active: [], history: false }), PLATFORM_CLAIMS)).includes("SUPER_ADMIN"), "legacy établi");
  // Sans sujet : évaluation interne d'un jeu de rôles explicite (jamais un jeton, SEC-AUTH-04).
  const explicit = { roleKeys: ["TEACHER"], role: "Enseignant" };
  const noRead = repoWith({ activeError: sqlError });
  assert.deepEqual(await collectPrincipalRoleKeys(noRead, explicit), ["TEACHER"]);
  assert.deepEqual(noRead.calls, [], "aucune lecture user_roles sans sujet");
});

test("SEC-AUTH-05 — dépôts PostgreSQL / mémoire : pas de « aucun historique » par défaut", async () => {
  const { PostgresRepository } = require("../db/postgresRepository");
  const { FallbackRepository } = require("../db/fallbackRepository");
  for (const [label, Ctor] of [["PostgreSQL", PostgresRepository], ["mémoire", FallbackRepository]]) {
    if (typeof Ctor !== "function") continue;
    const repo = Object.create(Ctor.prototype);
    repo.getClientsStore = () => ({ bind: () => ({}) });
    await assert.rejects(repo.userHasRoleHistory(USER), /indisponible/, `${label} : store sans lecture d'historique`);
  }
});

test("SEC-AUTH-05 — dépôt mémoire : userHasRoleHistory couvre les rôles actifs et retirés", async () => {
  const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
  const store = createClientsMemoryStore();
  store._tables.userRoles.push({ user_id: "U-RETIRE", role_key: "SCHOOL_ADMIN", status: "revoked", revoked_at: new Date() });
  store._tables.userRoles.push({ user_id: "U-ACTIF", role_key: "TEACHER", status: "active", revoked_at: null });
  const bound = store.bind ? store.bind() : store;
  assert.equal(await bound.userHasRoleHistory("U-RETIRE"), true);
  assert.equal(await bound.userHasRoleHistory("U-ACTIF"), true);
  assert.equal(await bound.userHasRoleHistory("U-LEGACY"), false);
  assert.equal(await bound.userHasRoleHistory(""), false);
  assert.deepEqual(await bound.listActiveUserRoleKeys("U-RETIRE"), []);
});
