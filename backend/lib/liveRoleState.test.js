"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveRoleState } = require("./liveRoleState");
const { collectPrincipalRoleKeys } = require("./functionalRbacService");

function repoWith({ active, history, failActive = false, failHistory = false }) {
  const calls = [];
  return {
    calls,
    async listActiveUserRoleKeys(id) {
      calls.push(`active:${id}`);
      if (failActive) throw new Error("lecture impossible");
      return active;
    },
    async userHasRoleHistory(id) {
      calls.push(`history:${id}`);
      if (failHistory) throw new Error("lecture impossible");
      return history;
    },
  };
}

test("SEC-AUTH-05 — rôles actifs : relus sans lecture d'historique", async () => {
  const repo = repoWith({ active: ["TEACHER"], history: true });
  assert.deepEqual(await loadLiveRoleState(repo, "u1"), { keys: ["TEACHER"], revoked: false });
  assert.deepEqual(repo.calls, ["active:u1"], "aucune requête supplémentaire sur le chemin courant");
});

test("SEC-AUTH-05 — tous les rôles retirés (historique présent) : aucun rôle", async () => {
  assert.deepEqual(await loadLiveRoleState(repoWith({ active: [], history: true }), "u1"), { keys: [], revoked: true });
});

test("SEC-AUTH-05 — compte legacy sans user_roles : repli de l'appelant conservé", async () => {
  assert.deepEqual(await loadLiveRoleState(repoWith({ active: [], history: false }), "u1"), { keys: null, revoked: false });
  assert.deepEqual(await loadLiveRoleState({ listActiveUserRoleKeys: async () => [] }, "u1"), { keys: null, revoked: false });
  assert.deepEqual(await loadLiveRoleState({}, "u1"), { keys: null, revoked: false });
  assert.deepEqual(await loadLiveRoleState(repoWith({ active: [], history: true }), ""), { keys: null, revoked: false });
});

test("SEC-AUTH-05 — erreur de lecture : comportement antérieur (repli), jamais une élévation", async () => {
  assert.deepEqual(await loadLiveRoleState(repoWith({ active: [], history: true, failActive: true }), "u1"), { keys: null, revoked: false });
  assert.deepEqual(await loadLiveRoleState(repoWith({ active: [], history: true, failHistory: true }), "u1"), { keys: null, revoked: false });
});

test("SEC-AUTH-05 — rôles du principal : retirés → aucun, legacy → revendications, actifs → base", async () => {
  const principal = {
    sub: "u1",
    role: "Super Administrateur Somafrik",
    roleKeys: ["SUPER_ADMIN"],
    permissions: ["ALL_PRIVILEGES"],
  };
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: [], history: true }), principal), [], "tous retirés : aucun rôle");
  assert.deepEqual(await collectPrincipalRoleKeys(repoWith({ active: ["TEACHER"], history: true }), principal), ["TEACHER"], "actifs : seuls les rôles en base");
  assert.ok(
    (await collectPrincipalRoleKeys(repoWith({ active: [], history: false }), principal)).includes("SUPER_ADMIN"),
    "legacy sans user_roles : repli inchangé",
  );
});

test("SEC-AUTH-05 — dépôt mémoire : userHasRoleHistory couvre les rôles actifs et retirés", async () => {
  const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
  const store = createClientsMemoryStore();
  const tables = store._tables;
  tables.userRoles.push({ user_id: "U-RETIRE", role_key: "SCHOOL_ADMIN", status: "revoked", revoked_at: new Date() });
  tables.userRoles.push({ user_id: "U-ACTIF", role_key: "TEACHER", status: "active", revoked_at: null });
  const bound = store.bind ? store.bind() : store;
  assert.equal(await bound.userHasRoleHistory("U-RETIRE"), true);
  assert.equal(await bound.userHasRoleHistory("U-ACTIF"), true);
  assert.equal(await bound.userHasRoleHistory("U-LEGACY"), false);
  assert.equal(await bound.userHasRoleHistory(""), false);
  assert.deepEqual(await bound.listActiveUserRoleKeys("U-RETIRE"), []);
});
