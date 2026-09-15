"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTRACT_ID,
  FLOW,
  ENVIRONMENTS,
  DEMO_CORS_ORIGINS,
  ROUTES,
  HANDSHAKE,
  FLAGS,
  CTA,
  WATERMARK,
  SEO,
  SECURITY_HEADERS,
  SANDBOX,
  RESET,
  ANALYTICS_EVENTS,
  ANALYTICS_ALLOWED_PROPS,
  ANALYTICS_FORBIDDEN_PROPS,
  LOTS,
  GATES,
  MERGE_GATES,
} = require("./contract");

test("contrat Demo v1 : flux vitrine → qualification → code opaque → demo.app", () => {
  assert.equal(CONTRACT_ID, "somafrik.demo.v1");
  assert.deepEqual(FLOW, [
    "vitrine_somafrik_app",
    "qualification_demo",
    "anonymous_session_mint",
    "opaque_one_shot_code",
    "demo_somafrik_app",
    "code_exchange",
    "demo_session",
    "strip_code_from_url",
  ]);
});

test("trois frontières PROD / PREPROD / DEMO sans mélange d'origines", () => {
  assert.equal(ENVIRONMENTS.production.appEnv, "production");
  assert.equal(ENVIRONMENTS.production.frontendOrigin, "https://somafrik.app");
  assert.equal(ENVIRONMENTS.production.apiOrigin, "https://api.somafrik.app");
  assert.equal(ENVIRONMENTS.preproduction.appEnv, "preproduction");
  assert.equal(ENVIRONMENTS.preproduction.frontendOrigin, "https://preprod.somafrik.app");
  assert.equal(ENVIRONMENTS.demo.appEnv, "demo");
  assert.equal(ENVIRONMENTS.demo.frontendOrigin, "https://demo.somafrik.app");
  assert.equal(ENVIRONMENTS.demo.apiOrigin, "https://api-demo.somafrik.app");
  assert.equal(ENVIRONMENTS.demo.originEnvVar, "DEMO_FRONTEND_ORIGIN");

  assert.deepEqual(DEMO_CORS_ORIGINS, [
    "https://somafrik.app",
    "https://demo.somafrik.app",
  ]);
  assert.ok(!DEMO_CORS_ORIGINS.includes("https://preprod.somafrik.app"));
  assert.ok(!DEMO_CORS_ORIGINS.includes("https://api.somafrik.app"));
});

test("routes : /demo n'est pas /demande-essai", () => {
  assert.equal(ROUTES.vitrineQualification, "/demo");
  assert.equal(ROUTES.trialRequest, "/demande-essai");
  assert.equal(ROUTES.mintSession, "/api/public/demo-sessions");
  assert.equal(ROUTES.exchangeSession, "/api/public/demo-sessions/exchange");
  assert.notEqual(ROUTES.vitrineQualification, ROUTES.trialRequest);
});

test("handshake : code opaque, jamais un JWT dans l'URL", () => {
  assert.equal(HANDSHAKE.queryParam, "code");
  assert.equal(HANDSHAKE.jwtInUrl, false);
  assert.equal(HANDSHAKE.codeKind, "opaque_random");
  assert.equal(HANDSHAKE.oneShot, true);
  assert.equal(HANDSHAKE.stripFromUrl, true);
  assert.ok(HANDSHAKE.minEntropyBits >= 128);
  assert.ok(HANDSHAKE.maxTtlSeconds <= 120);
  assert.ok(HANDSHAKE.forbiddenQueryParams.includes("token"));
  assert.ok(HANDSHAKE.forbiddenQueryParams.includes("access_token"));
  assert.ok(!HANDSHAKE.forbiddenQueryParams.includes("code"));
});

test("drapeaux explicites, sans réutiliser les comptes techniques locaux", () => {
  assert.equal(FLAGS.appEnvValue, "demo");
  assert.equal(FLAGS.viteDemoEnvUrl, "VITE_DEMO_ENV_URL");
  assert.equal(FLAGS.demoMode, "SOMAFRIK_DEMO_MODE");
  assert.ok(FLAGS.forbiddenReuse.includes("VITE_SHOW_DEMO_ACCOUNTS"));
  assert.ok(FLAGS.forbiddenReuse.includes("EXPO_PUBLIC_DEMO_MODE"));
  assert.ok(!FLAGS.forbiddenReuse.includes("VITE_DEMO_ENV_URL"));
});

test("CTA : Découvrir Somafrik en démo, Hero sans 4e action", () => {
  assert.equal(CTA.primaryLabel, "Découvrir Somafrik en démo");
  assert.equal(CTA.primaryHref, "/demo");
  assert.equal(CTA.trialLabel, "Demander 1 mois d'essai gratuit");
  assert.equal(CTA.trialHref, "/demande-essai");
  assert.equal(CTA.heroMaxActions, 3);
  assert.deepEqual(CTA.placements.hero, ["demo-primary", "trial", "voir-produit"]);
  assert.ok(CTA.exitToTrialLabel.includes("/demande-essai") === false);
  assert.match(CTA.exitToTrialLabel, /essai gratuit/i);
});

test("watermark sans PII, SEO Demo noindex, CSP frame-ancestors none", () => {
  assert.equal(
    WATERMARK.example,
    "SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — DEMO-7F32",
  );
  assert.equal(WATERMARK.idLength, 4);
  assert.ok(WATERMARK.forbiddenFields.includes("name"));
  assert.ok(WATERMARK.forbiddenFields.includes("email"));
  assert.ok(WATERMARK.forbiddenFields.includes("phone"));
  assert.equal(SEO.vitrineDemoIndexable, true);
  assert.equal(SEO.demoAppRobots, "noindex, nofollow");
  assert.equal(SEO.demoAppXRobotsTag, "noindex, nofollow");
  assert.equal(SECURITY_HEADERS.frameAncestors, "'none'");
  assert.equal(SECURITY_HEADERS.xFrameOptions, "DENY");
});

test("sandbox des externalités et reset dédié, pas le seed legacy", () => {
  assert.equal(SANDBOX.sms, "sandbox");
  assert.equal(SANDBOX.email, "sandbox");
  assert.equal(SANDBOX.payments, "simulation");
  assert.equal(SANDBOX.whatsapp, "simulation");
  assert.equal(SANDBOX.platformSuperadmin, "inaccessible");
  assert.equal(SANDBOX.mutationsAllowed, true);
  assert.equal(RESET.npmScript, "demo:reset");
  assert.equal(RESET.reuseLegacySeed, false);
  assert.equal(RESET.skipLegacySeedInProduction, true);
  assert.equal(RESET.idempotent, true);
  assert.equal(RESET.kpisFromCanonicalData, true);
});

test("analytics tunnel sans PII scolaire", () => {
  assert.deepEqual(ANALYTICS_EVENTS, [
    "demo_cta_clicked",
    "demo_qualification_started",
    "demo_profile_selected",
    "demo_session_created",
    "demo_entered",
    "demo_trial_request_clicked",
  ]);
  assert.ok(ANALYTICS_ALLOWED_PROPS.includes("country"));
  assert.ok(ANALYTICS_FORBIDDEN_PROPS.includes("email"));
  assert.ok(ANALYTICS_FORBIDDEN_PROPS.includes("school_name"));
  for (const prop of ANALYTICS_ALLOWED_PROPS) {
    assert.ok(!ANALYTICS_FORBIDDEN_PROPS.includes(prop), prop);
  }
});

test("lots DEMO-0 à DEMO-5 et gates déclarées", () => {
  assert.deepEqual(LOTS, ["DEMO-0", "DEMO-1", "DEMO-2", "DEMO-3", "DEMO-4", "DEMO-5"]);
  for (const gate of [
    "demo-not-preprod-copy",
    "demo-trial-separation",
    "opaque-code-not-jwt",
    "jwt-never-in-url",
    "cors-demo-not-on-production",
    "legacy-seed-never-reused",
    "watermark-no-pii",
    "demo-app-noindex",
    "vite-show-demo-accounts-not-reused",
    "qualification-no-required-phone-email",
    "cta-hero-rehierarchize-not-fourth",
  ]) {
    assert.ok(GATES.includes(gate), gate);
  }
  assert.ok(MERGE_GATES.includes("independent-cto-github-diff"));
  assert.ok(MERGE_GATES.includes("no-prod-preprod-connection"));
});
