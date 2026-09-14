"use strict";

/**
 * DEMO-0 RED / gap — ces assertions documentent l'absence actuelle
 * de l'environnement commercial Démo. Les lots suivants les inversent
 * uniquement dans le lot indiqué, jamais en réutilisant le seed legacy.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveAllowedOrigins,
  collectProductionCorsViolations,
  resolveAppEnv,
  resolvePrimaryOrigin,
} = require("../../lib/corsConfig");
const { ROUTES, CTA, FLAGS, RESET, ENVIRONMENTS } = require("./contract");

const ROOT = path.resolve(__dirname, "../../..");

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

test("DEMO-0 : aucune route HTTP / UI / infra Demo n'est ajoutée", () => {
  assert.equal(exists("web/src/pages/DemoPage.tsx"), false);
  assert.equal(exists("web/src/pages/DemoQualificationPage.tsx"), false);
  assert.equal(exists("docker-compose.demo.yml"), false);
  assert.equal(exists(".env.demo.example"), false);
  assert.equal(exists("web/public/robots.txt"), false);
  assert.equal(exists("web/public/sitemap.xml"), false);

  const migrationsDir = path.join(ROOT, "backend/migrations");
  if (fs.existsSync(migrationsDir)) {
    const demoMigrations = fs.readdirSync(migrationsDir).filter((name) =>
      /demo.?session/i.test(name),
    );
    assert.deepEqual(demoMigrations, []);
  }
});

test("DEMO-1 RED : /demo n'est pas encore une route publique vitrine", () => {
  const app = read("web/src/App.tsx");
  const lazy = read("web/src/lazyPages.ts");
  assert.match(app, /path="\/demande-essai"/);
  assert.doesNotMatch(app, /path="\/demo"/);
  assert.doesNotMatch(lazy, /DemoPage|DemoQualificationPage/);
  assert.equal(exists("web/src/pages/DemoPage.tsx"), false);
});

test("DEMO-1 RED : marketingContent n'expose pas encore le CTA Démo", () => {
  const marketing = read("web/src/data/marketingContent.ts");
  assert.match(marketing, /href: "\/demande-essai"/);
  assert.match(marketing, /Demander 1 mois d'essai gratuit/);
  assert.doesNotMatch(marketing, /href: "\/demo"/);
  assert.doesNotMatch(marketing, /Découvrir Somafrik en démo/);
  assert.equal(CTA.primaryHref, ROUTES.vitrineQualification);
});

test("DEMO-1 RED : Hero reste Connexion en CTA principal (pas encore rehiérarchisé)", () => {
  const marketing = read("web/src/data/marketingContent.ts");
  assert.match(marketing, /primaryCta: \{\s*href: "\/connexion"/);
  const hero = read("web/src/components/marketing/HeroSection.tsx");
  assert.match(hero, /marketingHero\.primaryCta/);
  assert.match(hero, /marketingTrial/);
  assert.doesNotMatch(hero, /Découvrir Somafrik en démo|marketingDemo/);
});

test("DEMO-1 RED : VITE_DEMO_ENV_URL n'existe pas encore", () => {
  const flags = read("web/src/lib/featureFlags.ts");
  const viteEnv = read("web/src/vite-env.d.ts");
  assert.match(flags, /VITE_SHOW_DEMO_ACCOUNTS/);
  assert.doesNotMatch(flags, /VITE_DEMO_ENV_URL/);
  assert.doesNotMatch(viteEnv, /VITE_DEMO_ENV_URL/);
  assert.equal(FLAGS.viteDemoEnvUrl, "VITE_DEMO_ENV_URL");
});

test("DEMO-2 RED : APP_ENV=demo n'est pas un contrat CORS runtime", () => {
  const corsSource = read("backend/lib/corsConfig.js");
  assert.match(corsSource, /PRODUCTION_FRONTEND_ORIGIN = "https:\/\/somafrik\.app"/);
  assert.match(corsSource, /PREPRODUCTION_FRONTEND_ORIGIN = "https:\/\/preprod\.somafrik\.app"/);
  assert.doesNotMatch(corsSource, /DEMO_FRONTEND_ORIGIN/);
  assert.doesNotMatch(corsSource, /demo\.somafrik\.app/);
  assert.doesNotMatch(corsSource, /api-demo\.somafrik\.app/);

  assert.equal(resolveAppEnv({ APP_ENV: "demo" }), "demo");
  assert.notEqual(
    resolvePrimaryOrigin({ APP_ENV: "demo", NODE_ENV: "production" }),
    ENVIRONMENTS.demo.frontendOrigin,
  );

  const origins = resolveAllowedOrigins({
    APP_ENV: "demo",
    NODE_ENV: "production",
  });
  assert.ok(!origins.includes(ENVIRONMENTS.demo.frontendOrigin));

  const violations = collectProductionCorsViolations({
    APP_ENV: "demo",
    NODE_ENV: "production",
  });
  assert.ok(
    violations.length > 0,
    "P0 : APP_ENV=demo est aujourd'hui rejeté par le CORS production — DEMO-2 doit créer un contrat dédié, pas l'ajouter à la production",
  );
});

test("DEMO-2 RED : npm run demo:reset n'existe pas encore", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts[RESET.npmScript], undefined);
  assert.ok(pkg.scripts["verify:demo-lot0"]);
});

test("DEMO-2 RED : mint / exchange Demo absents du serveur", () => {
  const server = read("backend/server.js");
  assert.doesNotMatch(server, /\/api\/public\/demo-sessions/);
  assert.match(server, /rejectJwtInQueryString/);
});

test("DEMO-3 RED : pas de watermark, bannière Mode Démo, ni CSP Demo", () => {
  const server = read("backend/server.js");
  const start = server.indexOf("function appSecurityHeaders");
  assert.ok(start >= 0, "appSecurityHeaders manquant");
  const body = server.slice(start, start + 900);
  assert.match(body, /X-Frame-Options/);
  assert.doesNotMatch(body, /Content-Security-Policy/);
  assert.doesNotMatch(body, /frame-ancestors/);
  assert.doesNotMatch(body, /X-Robots-Tag/);

  const webSrc = [
    "web/src/App.tsx",
    "web/src/main.tsx",
    "web/index.html",
  ].map(read).join("\n");
  assert.doesNotMatch(webSrc, /DÉMONSTRATION — DONNÉES FICTIVES/);
  assert.doesNotMatch(webSrc, /Mode Démo/);
});

test("DEMO-4 RED : aucune protection FLAG_SECURE / capture iOS Demo", () => {
  const mobileHits = [];
  const mobileRoot = path.join(ROOT, "Mobile");
  if (fs.existsSync(mobileRoot)) {
    const stack = [mobileRoot];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "android" || entry.name === "ios") {
          continue;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!/\.(ts|tsx|js|kt|java|swift|m)$/.test(entry.name)) continue;
        const source = fs.readFileSync(abs, "utf8");
        if (/FLAG_SECURE|isCaptured|ScreenCapture/.test(source)) {
          mobileHits.push(path.relative(ROOT, abs));
        }
      }
    }
  }
  assert.deepEqual(mobileHits, []);
});
