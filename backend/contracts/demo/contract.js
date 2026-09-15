"use strict";

/**
 * DEMO-0 — contrats figés (aucune route, aucun environnement, aucune UI).
 * Les lots DEMO-1 à DEMO-5 consomment ces constantes ; ils ne les réinventent pas.
 */

const CONTRACT_ID = "somafrik.demo.v1";

const FLOW = Object.freeze([
  "vitrine_somafrik_app",
  "qualification_demo",
  "anonymous_session_mint",
  "opaque_one_shot_code",
  "demo_somafrik_app",
  "code_exchange",
  "demo_session",
  "strip_code_from_url",
]);

const ENVIRONMENTS = Object.freeze({
  production: Object.freeze({
    appEnv: "production",
    frontendOrigin: "https://somafrik.app",
    apiOrigin: "https://api.somafrik.app",
  }),
  preproduction: Object.freeze({
    appEnv: "preproduction",
    frontendOrigin: "https://preprod.somafrik.app",
  }),
  demo: Object.freeze({
    appEnv: "demo",
    frontendOrigin: "https://demo.somafrik.app",
    apiOrigin: "https://api-demo.somafrik.app",
    originEnvVar: "DEMO_FRONTEND_ORIGIN",
  }),
});

const DEMO_CORS_ORIGINS = Object.freeze([
  ENVIRONMENTS.production.frontendOrigin,
  ENVIRONMENTS.demo.frontendOrigin,
]);

const ROUTES = Object.freeze({
  vitrineQualification: "/demo",
  trialRequest: "/demande-essai",
  mintSession: "/api/public/demo-sessions",
  exchangeSession: "/api/public/demo-sessions/exchange",
  demoEnter: "/session",
});

const HANDSHAKE = Object.freeze({
  queryParam: "code",
  forbiddenQueryParams: Object.freeze(["token", "access_token"]),
  codeKind: "opaque_random",
  jwtInUrl: false,
  minEntropyBits: 128,
  oneShot: true,
  maxTtlSeconds: 120,
  stripFromUrl: true,
  cookieHttpOnly: true,
  cookieSecure: true,
  cookieSameSite: "Lax",
});

const FLAGS = Object.freeze({
  appEnv: "APP_ENV",
  appEnvValue: "demo",
  somafrikAppEnv: "SOMAFRIK_APP_ENV",
  demoMode: "SOMAFRIK_DEMO_MODE",
  demoFrontendOrigin: "DEMO_FRONTEND_ORIGIN",
  viteDemoEnvUrl: "VITE_DEMO_ENV_URL",
  forbiddenReuse: Object.freeze([
    "VITE_SHOW_DEMO_ACCOUNTS",
    "EXPO_PUBLIC_DEMO_MODE",
    "SOMAFRIK_SKIP_DEMO_SEED",
  ]),
});

const CTA = Object.freeze({
  primaryLabel: "Découvrir Somafrik en démo",
  primaryHref: ROUTES.vitrineQualification,
  trialLabel: "Demander 1 mois d'essai gratuit",
  trialHref: ROUTES.trialRequest,
  loginHref: "/connexion",
  exitToTrialLabel:
    "Vous représentez un établissement ? Demandez maintenant votre mois d'essai gratuit.",
  placements: Object.freeze({
    headerDesktop: Object.freeze(["demo", "trial", "login"]),
    headerMobile: Object.freeze(["demo-visible", "trial-in-menu", "login"]),
    hero: Object.freeze(["demo-primary", "trial", "voir-produit"]),
    finalCta: Object.freeze(["demo", "trial"]),
    footer: Object.freeze(["demo-optional"]),
  }),
  heroMaxActions: 3,
});

const WATERMARK = Object.freeze({
  pattern: "SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — DEMO-{id}",
  example: "SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — DEMO-7F32",
  idCharset: "0123456789ABCDEF",
  idLength: 4,
  forbiddenFields: Object.freeze(["name", "email", "phone"]),
  permanent: true,
  repeated: true,
});

const SEO = Object.freeze({
  vitrineDemoIndexable: true,
  demoAppRobots: "noindex, nofollow",
  demoAppXRobotsTag: "noindex, nofollow",
});

const SECURITY_HEADERS = Object.freeze({
  frameAncestors: "'none'",
  xFrameOptions: "DENY",
  cspRequiredOnDemo: true,
});

const SANDBOX = Object.freeze({
  sms: "sandbox",
  email: "sandbox",
  push: "demo-environment",
  payments: "simulation",
  whatsapp: "simulation",
  webhooks: "sandbox-or-disabled",
  accountDeletion: "controlled",
  platformSuperadmin: "inaccessible",
  mutationsAllowed: true,
});

const RESET = Object.freeze({
  npmScript: "demo:reset",
  legacySeedModule: "backend/lib/demoSeedPolicy.js",
  legacyWipeScript: "backend/scripts/wipe-demo-data.js",
  reuseLegacySeed: false,
  skipLegacySeedInProduction: true,
  datasetDeterministic: true,
  idempotent: true,
  kpisFromCanonicalData: true,
});

const ANALYTICS_EVENTS = Object.freeze([
  "demo_cta_clicked",
  "demo_qualification_started",
  "demo_profile_selected",
  "demo_session_created",
  "demo_entered",
  "demo_trial_request_clicked",
]);

const ANALYTICS_ALLOWED_PROPS = Object.freeze([
  "profile",
  "discovery_role",
  "country",
]);

const ANALYTICS_FORBIDDEN_PROPS = Object.freeze([
  "name",
  "email",
  "phone",
  "organization_name",
  "school_name",
]);

const LOTS = Object.freeze([
  "DEMO-0",
  "DEMO-1",
  "DEMO-2",
  "DEMO-3",
  "DEMO-4",
  "DEMO-5",
]);

const GATES = Object.freeze([
  "demo-not-preprod-copy",
  "demo-trial-separation",
  "opaque-code-not-jwt",
  "jwt-never-in-url",
  "cors-demo-not-on-production",
  "app-env-demo-own-contract",
  "legacy-seed-never-reused",
  "dedicated-demo-database",
  "no-shared-secrets-with-prod",
  "sandbox-externalities",
  "watermark-no-pii",
  "flag-secure-android",
  "ios-screen-share-honest",
  "demo-app-noindex",
  "csp-frame-ancestors-none",
  "vite-show-demo-accounts-not-reused",
  "qualification-no-required-phone-email",
  "cta-hero-rehierarchize-not-fourth",
  "demo-reset-idempotent",
  "web-mobile-same-backend",
]);

const MERGE_GATES = Object.freeze([
  "independent-cto-github-diff",
  "branch-up-to-date",
  "controlled-scope",
  "lint-typecheck-build",
  "secrets-scan",
  "targeted-red-to-green",
  "no-real-data",
  "no-prod-preprod-connection",
  "tenant-db-secrets-isolation",
  "strict-cors",
  "sandbox-externalities",
  "anti-capture-per-platform",
  "responsive-360-390-1024-1440",
  "tunnel-accessibility",
  "demo-app-noindex",
  "reset-tested",
]);

module.exports = {
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
};
