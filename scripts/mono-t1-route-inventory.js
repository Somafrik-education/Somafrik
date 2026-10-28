#!/usr/bin/env node
"use strict";

/**
 * MONO-T1 — inventaire des routes HTTP réellement enregistrées par backend/server.js.
 *
 *   node scripts/mono-t1-route-inventory.js [--check]
 *
 * 1. Démarre backend/server.js avec un préchargement qui relève chaque route
 *    déclarée sur Express (méthode, chemin, fichier et ligne, chaîne de
 *    middlewares). La base est une URL loopback injoignable (port 1) : le
 *    démarrage échoue après l'enregistrement des routes ; aucune base n'est
 *    contactée, aucun port n'est ouvert.
 * 2. Enrichit chaque route : permissions exigées (routePermissions), rôles
 *    autorisés par la matrice par défaut (seed), indices statiques du
 *    gestionnaire (périmètre établissement, validation, appels dépôt,
 *    statuts d'erreur), famille fonctionnelle, niveau de risque.
 * 3. Relève les tests existants qui appellent réellement le chemin HTTP.
 * 4. Écrit docs/project/MONO-T1-ROUTES.json et docs/project/MONO-T1-ROUTES.md.
 *
 * --check : échoue si le CONTRAT des routes (méthode, chemin, authentification,
 * middlewares, permissions) diffère de l'inventaire versionné, sans rien écrire.
 *
 * Les indices statiques sont des heuristiques signalées comme telles ; les
 * comportements effectifs sont vérifiés par les tests HTTP de caractérisation.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const PRELOAD = path.join(__dirname, "mono-t1-route-inventory.preload.js");
const OUT_JSON = path.join(ROOT, "docs/project/MONO-T1-ROUTES.json");
const OUT_MD = path.join(ROOT, "docs/project/MONO-T1-ROUTES.md");
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// 1. Relevé runtime
// ---------------------------------------------------------------------------

function captureRoutes() {
  const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mono-t1-routes-")), "routes.json");
  const result = spawnSync(process.execPath, ["-r", PRELOAD, "backend/server.js"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      SOMAFRIK_API_ONLY: "true",
      // Loopback, port 1 : injoignable par construction. Aucune base réelle.
      DATABASE_URL: "postgresql://inventory:none@127.0.0.1:1/somafrik_inventory_unreachable",
      JWT_SECRET: "mono-t1-inventory-only-secret-not-used-0000",
      MONO_T1_ROUTE_DUMP: dump,
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (!fs.existsSync(dump)) {
    throw new Error(`Relevé des routes absent.\n${result.stdout}\n${result.stderr}`);
  }
  const routes = JSON.parse(fs.readFileSync(dump, "utf8"));
  if (routes.length < 100) throw new Error(`Relevé incomplet : ${routes.length} route(s).`);
  return routes;
}

// ---------------------------------------------------------------------------
// 2. Enrichissement
// ---------------------------------------------------------------------------

const sources = new Map();
function sourceLines(file) {
  if (!sources.has(file)) sources.set(file, fs.readFileSync(path.join(ROOT, file), "utf8").split("\n"));
  return sources.get(file);
}

/** Texte d'une route : de sa ligne d'enregistrement jusqu'à la suivante (même fichier), borné. */
function routeBlocks(routes) {
  const byFile = new Map();
  for (const route of routes) {
    if (!byFile.has(route.file)) byFile.set(route.file, []);
    byFile.get(route.file).push(route);
  }
  for (const [file, list] of byFile) {
    const lines = sourceLines(file);
    const starts = [...new Set(list.map((route) => route.line))].sort((a, b) => a - b);
    for (const route of list) {
      const next = starts.find((line) => line > route.line) ?? lines.length + 1;
      const end = Math.min(next - 1, route.line + 400);
      route.block = lines.slice(route.line - 1, end).join("\n");
    }
  }
}

const { routePermissions, RbacService } = require("../backend/services/rbacService");
const seedData = require("../backend/data");
const { enforceBusinessRolePermissions } = require("../backend/lib/rolePermissionsResolution");

const CANONICAL_ROLES = [
  ["SUPER_ADMIN", "Super Administrateur Somafrik", "*"],
  ["COUNTRY_ADMIN", "Admin Pays", "*"],
  ["SCHOOL_ADMIN", "Admin School", "CD-2026-0001"],
  ["PROVISEUR", "Proviseur", "CD-2026-0001"],
  ["PREFET_ETUDES", "Préfet des études", "CD-2026-0001"],
  ["SECRETARY", "Secrétaire", "CD-2026-0001"],
  ["ACCOUNTANT", "Comptable", "CD-2026-0001"],
  ["SUPERVISOR", "Surveillant", "CD-2026-0001"],
  ["TEACHER", "Enseignant", "CD-2026-0001"],
  ["PARENT", "Parent", "CD-2026-0001"],
  ["STUDENT", "Élève / Étudiant", "CD-2026-0001"],
];

function defaultAllowedRoles(routeKey) {
  const rbac = new RbacService();
  const allowed = [];
  for (const [key, label, schoolCode] of CANONICAL_ROLES) {
    const permissions = enforceBusinessRolePermissions(label, seedData.rolePermissions[label] ?? []);
    const principal = { role: label, roles: [label], roleKeys: [key], schoolCode, permissions };
    if (rbac.canAccess(principal, routeKey)) allowed.push(key);
  }
  return allowed;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function analyse(route) {
  const header = route.block.slice(0, route.block.search(/asyncHandler\(|route\(async|\(req, res|\(_req, res|async \(req/) + 1 || 400);
  const permissionKeys = unique([...header.matchAll(/requirePermission\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]));
  const features = unique([...header.matchAll(/requireSchoolSubscriptionFeature\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]));
  const middlewares = route.handlerNames.slice(0, -1);
  const authenticated = middlewares.includes("requireAuth") || middlewares.includes("internalAuth");

  const requiredPermissions = unique(permissionKeys.flatMap((key) => routePermissions[key] ?? []));
  const unknownPermissionKeys = permissionKeys.filter((key) => !Array.isArray(routePermissions[key]));
  const allowedRoles = permissionKeys.length
    ? unique(permissionKeys.flatMap((key) => defaultAllowedRoles(key)))
    : null;

  const body = route.block;
  const tenantSignals = unique(
    [
      /principal\.schoolCode|principal\?\.schoolCode/.test(body) && "principal.schoolCode",
      /schoolId|school_id/.test(body) && "schoolId",
      /assert\w*(School|Tenant)\w*\(/.test(body) && "assert*School/Tenant",
      /ScopeError|SCHOOL_SCOPE|tenant/i.test(body) && "scope/tenant",
      /internalAuth/.test(middlewares.join()) && "resolveSchoolId (actor)",
    ].filter(Boolean),
  );
  const validationSignals = unique(
    [
      /BusinessError\(\s*400|status\(\s*400|statusCode\s*=\s*400/.test(body) && "400",
      /BusinessError\(\s*422|status\(\s*422/.test(body) && "422",
      /\bvalidate\w*\(|\bassert\w*(Payload|Input|Body)\w*\(|\bparse\w*(Payload|Input|Body)\w*\(/.test(body) && "validate/assert/parse",
    ].filter(Boolean),
  );
  const handlerAuthz = unique(
    [
      ...[...body.matchAll(/\b(assert\w*(?:Access|Readable|Writable|Allowed|Permission)\w*|can[A-Z]\w+|is(?:SuperAdmin|Platform|CountryAdmin)\w*Principal)\(/g)].map((m) => m[1]),
      /BusinessError\(\s*403/.test(body) ? "403 explicite" : null,
    ].filter(Boolean),
  );
  const repositoryCalls = unique([...body.matchAll(/\brepository\.(\w+)\(/g)].map((m) => m[1]));
  const errorStatuses = unique(
    [...body.matchAll(/(?:BusinessError\(\s*|status\(\s*|statusCode\s*=\s*)(4\d\d|5\d\d)/g)].map((m) => m[1]),
  );
  return {
    authenticated,
    middlewares,
    permissionKeys,
    unknownPermissionKeys,
    requiredPermissions,
    allowedRoles,
    subscriptionFeatures: features,
    tenantSignals,
    validationSignals,
    handlerAuthz,
    repositoryCalls,
    errorStatuses,
  };
}

const FAMILIES = [
  ["A. Authentification et sessions", /^\/api\/(auth|backoffice\/login|backoffice\/e2e|login|me\b|session|identify|privacy\/erasure-requests\/self)/],
  ["B. Utilisateurs et rôles", /^\/api\/(users|backoffice\/users|backoffice\/rbac|rbac|roles|backoffice\/role-permissions|backoffice\/establishment-roles|establishment-roles|clients\/users|accounts|backoffice\/contacts|backoffice\/relations)/],
  ["C. Élèves et inscriptions", /^\/api\/(students|enrollments|class-students|classes\/[^/]+\/students|student-|guardians|parents|backoffice\/students)/],
  ["D. Notes et présences", /^\/api\/(notes|grades|evaluations|evaluation-types|exams|v2\/exams|attendance|presences|absences|report-card|bulletins|backoffice\/report-cards|teacher-assignments|assignments)/],
  ["E. Finance", /^\/api\/(finance|payments|fees|fee-|invoices|obligations|backoffice\/finance|cash|unpaid|receipts)/],
  ["F. Communication", /^\/api\/(communications?|messages|announcements|platform-announcements|notifications|mobile\/push|push|backoffice\/(announcements|platform-announcements|internal-notifications|messages|conversations|communications|notifications))/],
  ["G. Pédagogie, planning et référentiels", /^\/api\/(classes|courses|course-schedules?|course-schedule-replacements|teachers|subjects|v2\/(subjects|academic-years|school-setup|documents|reports)|academic-|school-rooms|school-settings|school-documents|education-reference|backoffice\/(education-|planning-exams|education-reference|bulletin-design|import|state)|mobile-sync)/],
  ["H. Plateforme, établissements et abonnements", /^\/api\/(backoffice\/(establishments|establishment-documents|countries|subscription|subscriptions|trial-requests|platform-compliance|dashboard-chart-config)|public\/trial-requests|schools|audit|data-export|dashboard|mvp)/],
];

function family(routePath) {
  for (const [name, pattern] of FAMILIES) if (pattern.test(routePath)) return name;
  return "Autres";
}

const PUBLIC_BY_DESIGN = new Set([
  "GET /",
  "GET /api/health",
  "POST /api/auth/refresh",
  "GET /api/schools/:code",
  "GET /api/schools/:code/logo",
  "POST /api/public/report-cards/verify",
  "GET /^\\/verify\\/rc(\\/.*)?$/",
]);

// Non authentifiées mais conditionnées par l'environnement (vérifié par test HTTP).
const CONDITIONAL_PUBLIC = new Map([
  [
    "POST /api/backoffice/e2e/clear-login-lockout",
    "404 sauf SOMAFRIK_E2E=true hors production ; le démarrage refuse SOMAFRIK_E2E=true en production",
  ],
]);

function risk(route, info) {
  const write = ["POST", "PUT", "PATCH", "DELETE"].includes(route.method);
  const key = `${route.method} ${route.path}`;
  const criticalFamily = /^[A-F]\./.test(route.family);
  if (CONDITIONAL_PUBLIC.has(key)) {
    return { level: "MOYEN", reason: `non authentifiée, conditionnelle : ${CONDITIONAL_PUBLIC.get(key)}` };
  }
  if (!info.authenticated && !PUBLIC_BY_DESIGN.has(key) && !info.middlewares.includes("rateLimitMiddleware")) {
    return { level: "CRITIQUE", reason: "aucune authentification déclarée sur la route" };
  }
  if (info.authenticated && info.permissionKeys.length === 0 && !info.middlewares.includes("internalAuth")) {
    return {
      level: write ? "ÉLEVÉ" : "MOYEN",
      reason: info.handlerAuthz.length
        ? `authentifiée sans requirePermission ; contrôle dans le gestionnaire (${info.handlerAuthz.join(", ")})`
        : "authentifiée sans requirePermission ni contrôle détecté (périmètre du compte lui-même attendu)",
    };
  }
  if (info.unknownPermissionKeys.length) {
    return { level: "ÉLEVÉ", reason: `clé de permission absente de routePermissions (${info.unknownPermissionKeys.join(", ")}) : refus pour tous` };
  }
  if (write && criticalFamily) return { level: "ÉLEVÉ", reason: "écriture sur un domaine critique" };
  if (criticalFamily) return { level: "MOYEN", reason: "lecture de données d'un domaine critique" };
  return { level: write ? "MOYEN" : "FAIBLE", reason: write ? "écriture hors domaines critiques" : "lecture hors domaines critiques" };
}

// ---------------------------------------------------------------------------
// 3. Correspondance avec les tests existants
// ---------------------------------------------------------------------------

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function loadTestCorpus() {
  const files = [
    ...walk(path.join(ROOT, "backend"), (file) => /\.test\.(js|mjs|ts)$/.test(file)),
    ...walk(path.join(ROOT, "backend/scripts"), (file) => /verify-[\w-]+\.js$/.test(file)),
    ...walk(path.join(ROOT, "scripts"), (file) => /\.test\.(js|ts)$/.test(file)),
  ];
  return unique(files).map((file) => {
    const text = fs.readFileSync(file, "utf8");
    return {
      file: path.relative(ROOT, file),
      text,
      // Fichier qui préfixe lui-même /api (helper request("/x") → /api/x).
      apiPrefixHelper: /\/api\$\{|\/api`\s*\+|["'`]\/api["'`]\s*\+/.test(text),
      http: /fetch\(|supertest|http\.request|request\(|httpJson\(|api\(/.test(text),
    };
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeMatcher(routePath, withoutApiPrefix) {
  const target = withoutApiPrefix ? routePath.replace(/^\/api/, "") : routePath;
  if (!target || target === "/") return null;
  const pattern = target
    .split(/(:[A-Za-z_]\w*)/)
    .map((part) => (part.startsWith(":") ? "(?:\\$\\{[^}]+\\}|[^/'\"`?\\s]+)" : escapeRegExp(part)))
    .join("");
  // Chaîne littérale qui commence par le chemin et se termine (fin, query ou fermeture).
  return new RegExp(`["'\`]${pattern}(?:["'\`?]|\\$\\{)`);
}

function existingTests(route, corpus) {
  if (route.pathIsRegExp) return { all: [], http: [], monoT1: [] };
  const full = routeMatcher(route.path, false);
  const short = route.path.startsWith("/api/") ? routeMatcher(route.path, true) : null;
  const hits = [];
  for (const test of corpus) {
    if ((full && full.test(test.text)) || (short && test.apiPrefixHelper && short.test(test.text))) {
      hits.push(test);
    }
  }
  const isMonoT1 = (test) => /\/monoT1\.[^/]+\.test\.js$/.test(test.file);
  const before = hits.filter((test) => !isMonoT1(test));
  return {
    all: before.map((test) => test.file),
    http: before.filter((test) => test.http).map((test) => test.file),
    monoT1: hits.filter(isMonoT1).map((test) => test.file),
  };
}

// ---------------------------------------------------------------------------
// 4. Rendu
// ---------------------------------------------------------------------------

function render(rows) {
  const families = unique(rows.map((row) => row.family));
  const levels = ["CRITIQUE", "ÉLEVÉ", "MOYEN", "FAIBLE"];
  const md = [];
  md.push("# MONO-T1 — inventaire des routes HTTP (généré)");
  md.push("");
  md.push("Généré par `node scripts/mono-t1-route-inventory.js` ; le contrat des routes est vérifié en CI par `--check`. Ne pas éditer à la main.");
  md.push("");
  md.push(`Routes réellement enregistrées : **${rows.length}** (relevé runtime d'Express, pas une recherche textuelle).`);
  md.push("");
  md.push("Tous les routes authentifiées (hors expression régulière) sont aussi couvertes par les balayages A de `backend/lib/monoT1.authSessions.http.pg.test.js` (anonyme, en-tête invalide, signature étrangère, jeton expiré, session inconnue ⇒ 401 sans donnée) ; la matrice RBAC observée (`backend/lib/monoT1.rbacMatrix.http.pg.test.js`, référence `docs/project/MONO-T1-RBAC-MATRIX.json`) couvre chaque route sous `requirePermission` pour six comptes établissement ; la colonne « Tests MONO-T1 » ne liste que les tests ciblés qui appellent le chemin.");
  md.push("");
  md.push("Limites : `allowedRoles` = matrice de rôles **par défaut** (seed), la matrice PostgreSQL est éditable ; les colonnes tenant / validation / dépôt / erreurs sont des **indices statiques** du gestionnaire. Les comportements effectifs sont vérifiés par les tests HTTP de caractérisation (`docs/project/MONO-T1-CHARACTERIZATION.md`).");
  md.push("");
  md.push("## Synthèse par famille et niveau de risque");
  md.push("");
  md.push(`| Famille | Routes | ${levels.join(" | ")} | Tests existants (HTTP / toute mention) | Tests MONO-T1 ciblés |`);
  md.push(`|---|---|${levels.map(() => "---").join("|")}|---|---|`);
  for (const name of families) {
    const list = rows.filter((row) => row.family === name);
    const counts = levels.map((level) => list.filter((row) => row.risk.level === level).length);
    md.push(
      `| ${name} | ${list.length} | ${counts.join(" | ")} | ${list.filter((row) => row.existingHttpTests.length).length} / ${list.filter((row) => row.existingTests.length).length} | ${list.filter((row) => row.monoT1Tests.length).length} |`,
    );
  }
  md.push("");
  md.push("## Routes sans authentification déclarée");
  md.push("");
  md.push("| Route | Middlewares | Statut |");
  md.push("|---|---|---|");
  for (const row of rows.filter((item) => !item.authenticated)) {
    const key = `${row.method} ${row.path}`;
    md.push(
      `| \`${key}\` | ${row.middlewares.join(", ") || "—"} | ${PUBLIC_BY_DESIGN.has(key) ? "public par conception" : CONDITIONAL_PUBLIC.has(key) ? `conditionnelle : ${CONDITIONAL_PUBLIC.get(key)}` : row.risk.level === "CRITIQUE" ? "**à examiner**" : "limitation de débit"} |`,
    );
  }
  md.push("");
  md.push("## Inventaire détaillé");
  for (const name of families) {
    md.push("");
    md.push(`### ${name}`);
    md.push("");
    md.push("| Route | Source | Auth | Permission(s) | Contrôle dans le gestionnaire | Rôles autorisés (défaut) | Tenant (indices) | Validation (indices) | Dépôt PG | Erreurs | Risque | Tests HTTP existants | Tests MONO-T1 |");
    md.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const row of rows.filter((item) => item.family === name)) {
      md.push(
        [
          `\`${row.method} ${row.path}\``,
          `${row.file}:${row.line}`,
          row.authenticated ? "oui" : "**non**",
          row.permissionKeys.length ? row.permissionKeys.map((key) => `\`${key}\``).join("<br>") : "—",
          row.handlerAuthz.slice(0, 3).join(", ") || "—",
          row.allowedRoles ? row.allowedRoles.join(", ") || "aucun" : "—",
          row.tenantSignals.join(", ") || "—",
          row.validationSignals.join(", ") || "—",
          row.repositoryCalls.slice(0, 4).join(", ") + (row.repositoryCalls.length > 4 ? ` (+${row.repositoryCalls.length - 4})` : "") || "—",
          row.errorStatuses.join(", ") || "—",
          `${row.risk.level}`,
          row.existingHttpTests.length ? `${row.existingHttpTests.length}` : "**0**",
          row.monoT1Tests.length ? row.monoT1Tests.map((file) => path.basename(file).replace(/^monoT1\.|\.http\.pg\.test\.js$/g, "")).join(", ") : "—",
        ].join(" | ").replace(/^/, "| ") + " |",
      );
    }
  }
  md.push("");
  return md.join("\n");
}

function main() {
  const captured = captureRoutes();
  routeBlocks(captured);
  const corpus = loadTestCorpus();
  const rows = captured
    .map((route) => {
      const info = analyse(route);
      const row = {
        method: route.method,
        path: route.path,
        pathIsRegExp: route.pathIsRegExp,
        file: route.file,
        line: route.line,
        family: family(route.path),
        ...info,
      };
      row.risk = risk(row, info);
      const found = existingTests(route, corpus);
      row.existingTests = found.all;
      row.existingHttpTests = found.http;
      row.monoT1Tests = found.monoT1;
      return row;
    })
    .sort((a, b) => a.family.localeCompare(b.family) || a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const json = `${JSON.stringify({ generatedBy: "scripts/mono-t1-route-inventory.js", total: rows.length, routes: rows }, null, 2)}\n`;
  const md = render(rows);
  if (CHECK) {
    // Seul le CONTRAT des routes est vérifié (méthode, chemin, authentification,
    // middlewares, permissions) : un décalage de lignes ou un nouveau test ne
    // doit pas faire échouer la CI d'une PR sans rapport. Les lignes et la
    // correspondance des tests se rafraîchissent en régénérant l'inventaire.
    const contract = (list) =>
      list
        .map((row) => JSON.stringify([row.method, row.path, row.authenticated, row.middlewares, row.permissionKeys]))
        .sort();
    if (!fs.existsSync(OUT_JSON)) {
      console.error("✖ Inventaire MONO-T1 absent : node scripts/mono-t1-route-inventory.js");
      process.exit(1);
    }
    const committed = contract(JSON.parse(fs.readFileSync(OUT_JSON, "utf8")).routes);
    const current = contract(rows);
    const added = current.filter((entry) => !committed.includes(entry));
    const removed = committed.filter((entry) => !current.includes(entry));
    if (added.length || removed.length) {
      console.error("✖ Contrat des routes modifié depuis l'inventaire MONO-T1 :");
      for (const entry of added) console.error(`  + ${entry}`);
      for (const entry of removed) console.error(`  - ${entry}`);
      console.error("Régénérer : node scripts/mono-t1-route-inventory.js (puis relire le diff et la matrice RBAC).");
      process.exit(1);
    }
    console.log(`✔ Contrat des routes MONO-T1 inchangé (${rows.length} routes).`);
    return;
  }
  fs.writeFileSync(OUT_JSON, json);
  fs.writeFileSync(OUT_MD, md);
  const levels = {};
  for (const row of rows) levels[row.risk.level] = (levels[row.risk.level] ?? 0) + 1;
  console.log(
    `Inventaire MONO-T1 : ${rows.length} routes ; risques ${JSON.stringify(levels)} ; sans test HTTP existant : ${rows.filter((row) => !row.existingHttpTests.length).length}.`,
  );
}

main();
