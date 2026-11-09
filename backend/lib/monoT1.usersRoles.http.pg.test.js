"use strict";

/**
 * MONO-T1 / B — utilisateurs et rôles (serveur réel, base jetable, démo seed).
 *
 * Liste des comptes (portée établissement / plateforme), attribution et
 * révocation de rôles : autorisé, anonyme, permission insuffisante,
 * interétablissement, entrée invalide, limites Superadmin, auto-révocation,
 * absence d'écriture en cas de refus. Termine par SEC-RBAC-REVOKE-01 : un rôle
 * révoqué via HTTP n'est pas réattribué par les chemins de boot.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PostgresRepository } = require("../db/postgresRepository");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
const ids = {};

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_users_it", port: 19962 });
  const byEmail = async (email) => (await server.one("SELECT id FROM users WHERE email = $1", [email])).id;
  ids.secretary = await byEmail("secretaire@somafrik.app");
  ids.cdAdmin = await byEmail("admin@unikin.somafrik");
  ids.biAdmin = await byEmail("admin@bujumbura.somafrik");
});

after(async () => {
  if (server) await server.stop();
});

const rolesOf = (userId) =>
  server.snapshot(
    `SELECT role_key, status, school_id FROM user_roles WHERE user_id = $1 ORDER BY role_key, status, created_at`,
    [userId],
  );
const activeRoles = async (userId) =>
  (
    await server.pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL ORDER BY role_key`,
      [userId],
    )
  ).rows.map((row) => row.role_key);

const grant = async (account, userId, body) =>
  server.request("POST", `/api/backoffice/users/${userId}/roles/grant`, { token: account && (await server.login(account)), body });
const revoke = async (account, userId, body) =>
  server.request("POST", `/api/backoffice/users/${userId}/roles/revoke`, { token: account && (await server.login(account)), body });

test("liste des comptes : établissement borné, plateforme globale, enseignant et anonyme refusés", { skip }, async () => {
  const cd = await server.request("GET", "/api/backoffice/users", { token: await server.login("cdAdmin") });
  assertStatus(cd, 200, "admin CD");
  const bi = await server.request("GET", "/api/backoffice/users", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "admin BI");
  const cdIds = new Set(cd.data.map((user) => user.id));
  const biIds = new Set(bi.data.map((user) => user.id));
  assert.ok(cdIds.has(ids.secretary) && !cdIds.has(ids.biAdmin), "CD voit ses comptes, pas ceux de BI");
  assert.ok(biIds.has(ids.biAdmin) && !biIds.has(ids.secretary), "BI ne voit aucun compte de CD");
  const superadmin = await server.request("GET", "/api/backoffice/users", { token: await server.login("superAdmin") });
  assertStatus(superadmin, 200, "superadmin");
  const visible = new Set(superadmin.data.map((user) => user.id));
  // Portée plateforme limitée aux comptes administrateurs : le personnel des
  // établissements reste hors de vue (données personnelles établissement).
  assert.ok(visible.has(ids.cdAdmin) && visible.has(ids.biAdmin), "superadmin : administrateurs des deux établissements");
  assert.ok(!visible.has(ids.secretary), "superadmin : personnel établissement non exposé");
  assert.ok(
    superadmin.data.every((user) => (user.roleKeys ?? []).some((key) => ["SCHOOL_ADMIN", "COUNTRY_ADMIN", "SUPER_ADMIN"].includes(key))),
    "superadmin : uniquement des comptes administrateurs",
  );
  assertStatus(await server.request("GET", "/api/backoffice/users", { token: await server.login("cdTeacher") }), 403, "enseignant");
  assertStatus(await server.request("GET", "/api/backoffice/users"), 401, "anonyme");
  assert.doesNotMatch(cd.text, /password_hash|pin_hash|passwordHash/, "aucun hachage exposé");
});

test("attribution : autorisée, doublon refusé (409), permissions effectives immédiates", { skip }, async () => {
  const granted = await grant("cdAdmin", ids.secretary, { role: "Comptable" });
  assertStatus(granted, 200, "attribution Comptable");
  assert.deepEqual(await activeRoles(ids.secretary), ["ACCOUNTANT", "SECRETARY"]);
  const duplicate = await grant("cdAdmin", ids.secretary, { role: "Comptable" });
  assertStatus(duplicate, 409, "doublon");
  assert.equal(duplicate.data.code, "ROLE_ALREADY_GRANTED");
  assert.deepEqual(await activeRoles(ids.secretary), ["ACCOUNTANT", "SECRETARY"], "aucune ligne en double");
});

test("attribution refusée : interétablissement, enseignant, anonyme, rôle inconnu/vide, rôle plateforme — sans écriture", { skip }, async () => {
  const before = await rolesOf(ids.secretary);
  const biBefore = await rolesOf(ids.biAdmin);
  const cases = [
    ["admin BI → compte CD", "biAdmin", ids.secretary, { role: "Surveillant" }, 403, "TENANT_MISMATCH"],
    ["admin CD → compte BI", "cdAdmin", ids.biAdmin, { role: "Comptable" }, 403, "TENANT_MISMATCH"],
    ["enseignant", "cdTeacher", ids.secretary, { role: "Surveillant" }, 403, "PERMISSION_DENIED"],
    ["parent", "cdParent", ids.secretary, { role: "Surveillant" }, 403, "PERMISSION_DENIED"],
    ["anonyme", null, ids.secretary, { role: "Surveillant" }, 401, undefined],
    ["rôle inconnu", "cdAdmin", ids.secretary, { role: "Rôle inexistant" }, 400, "ROLE_UNKNOWN"],
    ["rôle vide", "cdAdmin", ids.secretary, {}, 400, "ROLE_UNKNOWN"],
    ["rôle Superadmin", "cdAdmin", ids.secretary, { role: "Super Administrateur Somafrik" }, 403, "PLATFORM_ROLE_FORBIDDEN"],
  ];
  for (const [label, account, userId, body, status, code] of cases) {
    const response = await grant(account, userId, body);
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await rolesOf(ids.secretary), before, "aucune écriture sur le compte CD");
  assert.equal(await rolesOf(ids.biAdmin), biBefore, "aucune écriture sur le compte BI");
});

test("révocation : interétablissement et auto-révocation refusées ; révocation autorisée puis rejeu 404", { skip }, async () => {
  const before = await rolesOf(ids.secretary);
  const cross = await revoke("biAdmin", ids.secretary, { role: "Comptable" });
  assertStatus(cross, 403, "révocation BI → CD");
  assert.equal(cross.data.code, "TENANT_MISMATCH");
  const self = await revoke("cdAdmin", ids.cdAdmin, { role: "Admin School" });
  assertStatus(self, 403, "auto-révocation");
  assert.equal(self.data.code, "AUTO_GRANT_FORBIDDEN");
  assert.equal(await rolesOf(ids.secretary), before, "aucune écriture après refus");

  assertStatus(await revoke("cdAdmin", ids.secretary, { role: "Comptable" }), 200, "révocation autorisée");
  assert.deepEqual(await activeRoles(ids.secretary), ["SECRETARY"]);
  const again = await revoke("cdAdmin", ids.secretary, { role: "Comptable" });
  assertStatus(again, 404, "rejeu");
  assert.equal(again.data.code, "ROLE_NOT_GRANTED");
});

test("rôles attribuables : catalogue établissement, jamais de rôle plateforme", { skip }, async () => {
  const response = await server.request("GET", "/api/backoffice/users/assignable-roles", { token: await server.login("cdAdmin") });
  assertStatus(response, 200, "rôles attribuables");
  const keys = (response.data.roles ?? []).map((role) => role.roleKey);
  assert.ok(keys.length > 0);
  assert.ok(!keys.includes("SUPER_ADMIN") && !keys.includes("COUNTRY_ADMIN"), "aucun rôle plateforme");
});

test("SEC-RBAC-REVOKE-01 : un rôle révoqué via HTTP n'est pas réattribué par les chemins de boot", { skip }, async () => {
  // ACCOUNTANT a été révoqué via HTTP au test précédent. Serveur arrêté : aucune
  // concurrence avec la DDL de boot rejouée ici (cf. MONO-T0-CLOSE).
  await server.stopServer();
  const adapter = {
    all: async (sql, params) => (await server.pool.query(sql, params)).rows,
    query: (sql, params) => server.pool.query(sql, params),
  };
  await PostgresRepository.prototype.ensureUserRolesCanonicalSchema.call(adapter);
  await PostgresRepository.prototype.ensureSeededUserRoles.call(adapter);
  const rows = await server.pool.query(
    `SELECT status FROM user_roles WHERE user_id = $1 AND role_key = 'ACCOUNTANT' ORDER BY created_at`,
    [ids.secretary],
  );
  assert.deepEqual(rows.rows.map((row) => row.status), ["revoked"], "ACCOUNTANT reste révoqué, aucune ligne active recréée");
  assert.deepEqual(await activeRoles(ids.secretary), ["SECRETARY"]);
});
