"use strict";

/**
 * MONO-T1 — matrice RBAC observée (référence de caractérisation).
 *
 * Pour chaque route protégée par requirePermission (inventaire runtime) et
 * chaque compte établissement de démonstration, le test enregistre si la
 * porte RBAC refuse (403 PERMISSION_DENIED, ou 403 PARENT_NOTES_READ_ONLY
 * posé avant elle) ou laisse passer. Le résultat est comparé à
 * docs/project/MONO-T1-RBAC-MATRIX.json : l'extraction des routes hors de
 * server.js ne doit modifier aucune cellule.
 *   Régénération volontaire : MONO_T1_UPDATE_RBAC_MATRIX=1 (puis revue du diff).
 *
 * Sécurité des requêtes : les GET sont envoyés pour tous les comptes ; une
 * écriture n'est envoyée QUE si la matrice par défaut ET les permissions
 * effectives du compte la refusent (aucune écriture autorisée déclenchée) ;
 * pour ces cellules, le refus est en plus exigé indépendamment de la référence.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { RbacService } = require("../services/rbacService");
const { startCharacterizationServer, skipWithoutDatabase: skip } = require("./monoT1HttpHarness");
const inventory = require("../../docs/project/MONO-T1-ROUTES.json");

const REFERENCE = path.resolve(__dirname, "../../docs/project/MONO-T1-RBAC-MATRIX.json");
const UPDATE = process.env.MONO_T1_UPDATE_RBAC_MATRIX === "1";
const ACCOUNTS = {
  cdAdmin: "SCHOOL_ADMIN",
  cdProviseur: "PROVISEUR",
  cdPrefet: "PREFET_ETUDES",
  cdSecretary: "SECRETARY",
  cdTeacher: "TEACHER",
  cdParent: "PARENT",
};
const REFUSAL_CODES = new Set(["PERMISSION_DENIED", "PARENT_NOTES_READ_ONLY"]);

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_rbac_matrix_it", port: 19967 });
  // La porte abonnement précède requirePermission sur certaines routes : sans
  // abonnement actif (anomalie MONO-T1-A2), c'est elle qui refuserait.
  await server.applyActiveSubscriptionFixture();
});

after(async () => {
  if (server) await server.stop();
});

function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

test("matrice RBAC : aucune cellule ne change par rapport à la référence ; refus exigé quand défaut ET effectif refusent", { skip }, async () => {
  const rbac = new RbacService();
  const routes = inventory.routes.filter((route) => route.authenticated && route.permissionKeys.length && !route.pathIsRegExp);
  assert.ok(routes.length > 300, `${routes.length} routes sous requirePermission`);

  const live = {};
  for (const account of Object.keys(ACCOUNTS)) {
    const token = await server.login(account);
    const effective = await server.request("GET", "/api/auth/effective-permissions", { token });
    assert.equal(effective.status, 200, `permissions effectives ${account}`);
    live[account] = { token, principal: { ...claimsOf(token), permissions: effective.data.permissions ?? [] } };
  }

  const observed = {};
  const mustRefuse = [];
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    observed[key] = {};
    for (const [account, roleKey] of Object.entries(ACCOUNTS)) {
      const defaultAllows = route.allowedRoles.includes(roleKey);
      const liveAllows = route.permissionKeys.some((permissionKey) => rbac.canAccess(live[account].principal, permissionKey));
      if (route.method !== "GET" && (defaultAllows || liveAllows)) {
        observed[key][account] = "écriture autorisée (non envoyée)";
        continue;
      }
      const response = await server.request(route.method, route.path.replace(/:[A-Za-z_]\w*/g, "MONO-T1-INCONNU"), {
        token: live[account].token,
        body: route.method === "GET" ? undefined : {},
      });
      const refused = response.status === 403 && REFUSAL_CODES.has(response.data?.code);
      observed[key][account] = refused ? "refusé" : "accès";
      if (route.method !== "GET" && !refused) mustRefuse.push(`${account} ${key} → ${response.status}`);
    }
  }

  assert.deepEqual(mustRefuse, [], "écriture refusée par défaut et en effectif mais acceptée par HTTP");

  const document = {
    generatedBy: "backend/lib/monoT1.rbacMatrix.http.pg.test.js (MONO_T1_UPDATE_RBAC_MATRIX=1)",
    accounts: ACCOUNTS,
    legend: {
      refusé: "403 PERMISSION_DENIED (ou PARENT_NOTES_READ_ONLY) : la porte RBAC refuse avant le gestionnaire",
      accès: "porte RBAC franchie (la réponse peut être 2xx, 400, 404… selon le gestionnaire et les paramètres fictifs)",
      "écriture autorisée (non envoyée)": "écriture permise par la matrice par défaut ou effective : jamais déclenchée par le test",
    },
    routes: observed,
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  if (UPDATE) {
    fs.writeFileSync(REFERENCE, serialized);
    return;
  }
  assert.ok(fs.existsSync(REFERENCE), "référence absente : MONO_T1_UPDATE_RBAC_MATRIX=1 pour la créer");
  const reference = JSON.parse(fs.readFileSync(REFERENCE, "utf8")).routes;
  const changes = [];
  for (const key of new Set([...Object.keys(reference), ...Object.keys(observed)])) {
    for (const account of Object.keys(ACCOUNTS)) {
      const expected = reference[key]?.[account];
      const actual = observed[key]?.[account];
      if (expected !== actual) changes.push(`${key} [${account}] : référence « ${expected} » → observé « ${actual} »`);
    }
  }
  assert.deepEqual(changes, [], `${changes.length} cellule(s) de la matrice RBAC modifiée(s)`);
});
