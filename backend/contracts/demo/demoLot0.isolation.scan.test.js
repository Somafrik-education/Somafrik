"use strict";

/**
 * Scans d'isolation permanents. Ces tests ne s'inversent pas :
 * même après DEMO-2/3, PROD et le seed legacy restent séparés de la Démo publique.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveAllowedOrigins,
  PRODUCTION_FRONTEND_ORIGIN,
  PREPRODUCTION_FRONTEND_ORIGIN,
} = require("../../lib/corsConfig");
const {
  shouldSeedDemoData,
  assertProductionSecurityConfiguration,
} = require("../../lib/demoSeedPolicy");
const { ENVIRONMENTS, HANDSHAKE, FLAGS, ROUTES, CTA } = require("./contract");

const ROOT = path.resolve(__dirname, "../../..");

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("production et préproduction n'autorisent jamais l'origine Demo", () => {
  const prod = resolveAllowedOrigins({
    APP_ENV: "production",
    NODE_ENV: "production",
  });
  const preprod = resolveAllowedOrigins({
    APP_ENV: "preproduction",
    NODE_ENV: "production",
  });
  assert.deepEqual(prod, [PRODUCTION_FRONTEND_ORIGIN]);
  assert.deepEqual(preprod, [PREPRODUCTION_FRONTEND_ORIGIN]);
  assert.ok(!prod.includes(ENVIRONMENTS.demo.frontendOrigin));
  assert.ok(!preprod.includes(ENVIRONMENTS.demo.frontendOrigin));
  assert.ok(!prod.includes(ENVIRONMENTS.demo.apiOrigin));
});

test("compose et env production n'ajoutent pas demo.somafrik.app au CORS PROD", () => {
  const prodCompose = read("docker-compose.production.yml");
  const prodEnv = read(".env.production.example");
  assert.match(prodCompose, /APP_ENV: \$\{APP_ENV:-production\}/);
  assert.match(prodCompose, /SOMAFRIK_SKIP_DEMO_SEED: "true"/);
  assert.doesNotMatch(prodCompose, /demo\.somafrik\.app/);
  assert.match(prodEnv, /APP_ENV=production/);
  assert.match(prodEnv, /SOMAFRIK_SKIP_DEMO_SEED=true/);
  assert.doesNotMatch(prodEnv, /DEMO_FRONTEND_ORIGIN=https:\/\/somafrik\.app/);
  assert.doesNotMatch(prodEnv, /https:\/\/demo\.somafrik\.app/);
});

test("le seed historique reste coupé en NODE_ENV=production, y compris pour un futur APP_ENV=demo", () => {
  assert.equal(
    shouldSeedDemoData({ NODE_ENV: "production", APP_ENV: "demo" }),
    false,
  );
  assert.equal(
    shouldSeedDemoData({
      NODE_ENV: "production",
      APP_ENV: "demo",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    }),
    false,
  );
  assert.throws(
    () =>
      assertProductionSecurityConfiguration({
        NODE_ENV: "production",
        APP_ENV: "demo",
      }),
    /SOMAFRIK_SKIP_DEMO_SEED=true/,
  );
});

test("JWT dans l'URL reste interdit ; le handshake Demo n'utilise pas token", () => {
  const server = read("backend/server.js");
  assert.match(server, /function rejectJwtInQueryString/);
  assert.match(server, /query\.token != null \|\| query\.access_token != null/);
  assert.equal(HANDSHAKE.queryParam, "code");
  assert.ok(HANDSHAKE.forbiddenQueryParams.includes("token"));
  const verifyJwt = read("backend/scripts/verify-jwt-header.js");
  assert.match(verifyJwt, /JWT dans query string/);
});

test("/demande-essai reste le parcours essai 30 jours, distinct de /demo", () => {
  const app = read("web/src/App.tsx");
  const marketing = read("web/src/data/marketingContent.ts");
  const trialPage = read("web/src/pages/TrialRequestPage.tsx");
  assert.match(app, /path="\/demande-essai"/);
  const routes = app.slice(app.indexOf("<Routes>"));
  const trialIdx = routes.indexOf("/demande-essai");
  const protectedIdx = routes.indexOf("<ProtectedRoute>");
  assert.ok(trialIdx > -1);
  assert.ok(trialIdx < protectedIdx);
  assert.match(marketing, new RegExp(`href: "${ROUTES.trialRequest}"`));
  assert.match(marketing, new RegExp(CTA.trialLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(trialPage, /\/api\/public\/trial-requests/);
  assert.doesNotMatch(trialPage, /\/api\/public\/demo-sessions/);
});

test("VITE_SHOW_DEMO_ACCOUNTS n'est pas le drapeau de l'environnement public Démo", () => {
  const flags = read("web/src/lib/featureFlags.ts");
  assert.match(flags, /VITE_SHOW_DEMO_ACCOUNTS/);
  assert.doesNotMatch(flags, /VITE_DEMO_ENV_URL/);
  assert.ok(FLAGS.forbiddenReuse.includes("VITE_SHOW_DEMO_ACCOUNTS"));
  const login = read("web/src/pages/LoginPage.tsx");
  assert.match(login, /DEMO_ACCOUNT_GROUPS|demoAccounts/);
});

test("wipe-demo-data / reset-demo-data ne sont pas le reset commercial Demo", () => {
  const wipe = read("backend/scripts/wipe-demo-data.js");
  const pkg = JSON.parse(read("package.json"));
  assert.match(wipe, /wipe-demo-data/);
  assert.equal(pkg.scripts["demo:reset"], undefined);
  assert.notEqual(path.basename("backend/scripts/wipe-demo-data.js"), "demo:reset");
});
