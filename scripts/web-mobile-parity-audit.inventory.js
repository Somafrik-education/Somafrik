"use strict";

/**
 * Inventaire statique Web / Mobile / Backend pour l'audit de parité.
 * Lecture seule — aucune mutation métier.
 *
 *   node scripts/web-mobile-parity-audit.inventory.js
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs/audits/evidence/web-mobile-parity-inventory.json");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function unique(values) {
  return [...new Set(values)].sort();
}

function extractWebRoutes(source) {
  const live = [];
  const redirects = [];
  const pathRe = /path=["']([^"']+)["']/g;
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    const pathMatch = trimmed.match(/path=["']([^"']+)["']/);
    if (!pathMatch) continue;
    const routePath = pathMatch[1];
    if (trimmed.includes("<Navigate")) {
      redirects.push(routePath);
    } else {
      live.push(routePath);
    }
  }
  return { live: unique(live), redirects: unique(redirects) };
}

function extractMobileScreens(source) {
  const registered = [];
  const screenRe = /<Stack\.Screen\s+name=["']([^"']+)["']/g;
  let match;
  while ((match = screenRe.exec(source))) {
    registered.push(match[1]);
  }
  const deadCandidates = ["MenuScreen", "AdminCrudScreen", "SafeAdminCrudScreen", "PermissionsScreen", "PlatformNotificationsScreen"];
  const screensDir = path.join(ROOT, "Mobile/src/screens");
  const files = fs.readdirSync(screensDir).filter((name) => name.endsWith(".tsx"));
  return {
    registeredLive: unique(registered),
    screenFiles: unique(files),
    deadOrOrphanFiles: deadCandidates.filter((name) => files.includes(`${name}.tsx`)),
  };
}

function extractBackendRoutes(serverSource, extraSources) {
  const routes = [];
  const re = /\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
  const files = [{ name: "backend/server.js", source: serverSource }, ...extraSources];
  for (const file of files) {
    let match;
    const localRe = new RegExp(re.source, re.flags);
    while ((match = localRe.exec(file.source))) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file: file.name,
      });
    }
  }
  return routes.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function classifyLegacy(routes) {
  const legacy = [];
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (route.path.includes("/backoffice/state")) {
      legacy.push({ ...route, reason: "BackOffice state 410 Gone" });
    } else if (route.path === "/api/backoffice/role-permissions") {
      legacy.push({ ...route, reason: "Matrice RBAC JSONB — PUT forbidden, GET lecture compat" });
    } else if (route.path.includes("/students/") && route.path.includes("/report")) {
      legacy.push({ ...route, reason: "Bulletin élève legacy" });
    } else if (route.path === "/api/mvp/readiness" || route.path === "/api/mvp/snapshot" || route.path === "/api/mvp/dashboard") {
      legacy.push({ ...route, reason: "MVP dashboard legacy" });
    }
  }
  return legacy;
}

function main() {
  const webApp = read("web/src/App.tsx");
  const mobileNav = read("Mobile/src/navigation/AppNavigator.tsx");
  const server = read("backend/server.js");
  let reportCardHttp = "";
  try {
    reportCardHttp = read("backend/lib/reportCard/reportCardHttp.js");
  } catch {
    reportCardHttp = "";
  }

  const web = extractWebRoutes(webApp);
  const mobile = extractMobileScreens(mobileNav);
  const backendRoutes = extractBackendRoutes(server, reportCardHttp
    ? [{ name: "backend/lib/reportCard/reportCardHttp.js", source: reportCardHttp }]
    : []);
  const legacy = classifyLegacy(backendRoutes);

  const webOnlyExamples = [
    "/etablissement/relations-parent-enfant",
    "/finances/frais",
    "/examens",
    "/planning/salles",
    "/planning/remplacements",
    "/planning/conflits",
    "/administration/permissions",
    "/administration/documents",
    "/administration/conformite",
    "/pays",
    "/etablissements",
    "/referentiels-pedagogiques",
    "/abonnements",
    "/notifications-plateforme",
    "/parametres/documents",
    "/parametres/graphiques",
    "/parametres/securite",
    "/parametres/donnees",
    "/parametres/mon-abonnement",
    "/bulletins/modele",
    "/bulletins/historique",
  ];

  const mobileOnlyExamples = [
    "MobilePayment",
    "OfflineMode",
    "Synchronization",
    "Support",
    "Welcome",
    "RoleSelection",
  ];

  const inventory = {
    generatedAt: new Date().toISOString(),
    audit: "web-mobile-parity-global",
    counts: {
      webLiveRouteTokens: web.live.length,
      webRedirectRouteTokens: web.redirects.length,
      mobileLiveScreens: mobile.registeredLive.length,
      mobileScreenFiles: mobile.screenFiles.length,
      mobileDeadOrOrphanFiles: mobile.deadOrOrphanFiles.length,
      backendRoutes: backendRoutes.length,
      legacyCandidates: legacy.length,
      webOnlyRouteExamples: webOnlyExamples.length,
      mobileOnlyScreenExamples: mobileOnlyExamples.length,
    },
    web,
    mobile,
    backendRoutes,
    legacyCandidates: legacy,
    webOnlyRouteExamples: webOnlyExamples,
    mobileOnlyScreenExamples: mobileOnlyExamples,
    notes: [
      "Les path tokens extraits de App.tsx sont relatifs (certains sont des enfants de layouts).",
      "Les écrans Mobile morts (AdminCrud, Menu, Permissions, PlatformNotifications) existent en fichiers mais ne sont pas tous dans le graphe live.",
      "Mobile = Expo/React Native uniquement. Le Web responsive n'est pas Mobile.",
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(inventory, null, 2)}\n`);
  process.stdout.write(`Wrote ${path.relative(ROOT, OUT)}\n`);
  process.stdout.write(JSON.stringify(inventory.counts, null, 2) + "\n");
  return inventory;
}

if (require.main === module) {
  main();
}

module.exports = { main };
