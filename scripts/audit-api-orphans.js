"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "backend", "server.js");
const RBAC = path.join(ROOT, "backend", "services", "rbacService.js");
const CLIENT_ROOTS = [path.join(ROOT, "web", "src"), path.join(ROOT, "Mobile", "src")];
const INTERNAL_ROOTS = [path.join(ROOT, "scripts"), path.join(ROOT, "backend")];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function normalizeRoute(route) {
  const staticPath = String(route).split("${", 1)[0].split("?", 1)[0];
  const normalized = staticPath
    .replace(/:[A-Za-z0-9_]+/g, ":param")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
  return normalized.replace(/^\/api(?=\/|$)/, "") || "/";
}

function extractServerRoutes(source) {
  const routes = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = re.exec(source))) {
    routes.push({ method: match[1].toUpperCase(), path: match[2], normalized: normalizeRoute(match[2]) });
  }
  return routes;
}

function extractRbacRoutes(source) {
  const routes = [];
  const re = /["'`](GET|POST|PUT|PATCH|DELETE)\s+([^"'`]+)["'`]\s*:/g;
  let match;
  while ((match = re.exec(source))) {
    routes.push({ method: match[1], path: match[2], normalized: normalizeRoute(match[2]) });
  }
  return routes;
}

function extractHttpRefs(file, source) {
  const refs = [];
  const re = /\b(get|post|put|patch|delete)\s*(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  let match;
  while ((match = re.exec(source))) {
    const raw = match[2];
    if (!raw.startsWith("/")) continue;
    refs.push({ method: match[1].toUpperCase(), path: raw, normalized: normalizeRoute(raw), file: path.relative(ROOT, file) });
  }
  return refs;
}

function key(route) {
  return `${route.method} ${route.normalized}`;
}

function groupRefs(refs) {
  const map = new Map();
  for (const ref of refs) {
    const list = map.get(key(ref)) ?? [];
    list.push(ref.file);
    map.set(key(ref), list);
  }
  return map;
}

const serverRoutes = extractServerRoutes(read(SERVER));
const rbacRoutes = extractRbacRoutes(read(RBAC));
const clientRefs = CLIENT_ROOTS.flatMap((root) =>
  walk(root).flatMap((file) => extractHttpRefs(file, read(file))),
);
const internalRefs = INTERNAL_ROOTS.flatMap((root) =>
  walk(root)
    .filter((file) => file !== SERVER && file !== RBAC && path.basename(file) !== "audit-api-orphans.js")
    .flatMap((file) => extractHttpRefs(file, read(file))),
);

const serverMap = new Map(serverRoutes.map((route) => [key(route), route]));
const rbacMap = new Map(rbacRoutes.map((route) => [key(route), route]));
const clientsByKey = groupRefs(clientRefs);
const internalByKey = groupRefs(internalRefs);

const allKeys = [...new Set([
  ...serverMap.keys(),
  ...rbacMap.keys(),
  ...clientsByKey.keys(),
  ...internalByKey.keys(),
])].sort();

const rows = allKeys.map((routeKey) => {
  const server = serverMap.get(routeKey);
  const rbac = rbacMap.get(routeKey);
  const clients = [...new Set(clientsByKey.get(routeKey) ?? [])].sort();
  const internalRefsForRoute = [...new Set(internalByKey.get(routeKey) ?? [])].sort();
  let classification = "ACTIVE";
  if (server && !clients.length && internalRefsForRoute.length) classification = "INTERNAL_ONLY";
  else if (server && !clients.length && !rbac) classification = "ORPHAN_CANDIDATE";
  else if (server && !clients.length && rbac) classification = "SERVER_RBAC_NO_CLIENT";
  else if (!server && rbac && !clients.length && !internalRefsForRoute.length) classification = "RBAC_ONLY";
  else if (!server && (clients.length || internalRefsForRoute.length)) classification = "CALLER_ONLY";
  else if (server && clients.length && !rbac) classification = "ACTIVE_NO_RBAC_KEY";
  return { route: routeKey, classification, server: Boolean(server), rbac: Boolean(rbac), clients, internalRefs: internalRefsForRoute };
});

const summary = rows.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] ?? 0) + 1;
  return acc;
}, {});

const result = {
  generatedAt: new Date().toISOString(),
  summary,
  rows,
  caveats: [
    "Scanner statique: les routes construites intégralement de façon dynamique peuvent nécessiter une revue manuelle.",
    "Le préfixe de transport /api est normalisé: /api/backoffice/users et /backoffice/users représentent la même route applicative.",
    "Les query strings et suffixes `${...}` sont ramenés au path statique du handler.",
    "Les références scripts/backend sont séparées des consommateurs Web/Mobile afin d'identifier les routes tests/ops/internal.",
    "ORPHAN_CANDIDATE signifie absence de référence statique détectée, pas autorisation automatique de suppression.",
  ],
};

const output = process.argv[2];
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
