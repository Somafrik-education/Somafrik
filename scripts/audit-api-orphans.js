"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "backend", "server.js");
const RBAC = path.join(ROOT, "backend", "services", "rbacService.js");
const CLIENT_ROOTS = [path.join(ROOT, "web", "src"), path.join(ROOT, "Mobile", "src")];

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
  return String(route)
    .replace(/\$\{[^}]+\}/g, ":param")
    .replace(/:[A-Za-z0-9_]+/g, ":param")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "") || "/";
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

function extractClientRefs(file, source) {
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

const serverRoutes = extractServerRoutes(read(SERVER));
const rbacRoutes = extractRbacRoutes(read(RBAC));
const clientRefs = CLIENT_ROOTS.flatMap((root) =>
  walk(root).flatMap((file) => extractClientRefs(file, read(file))),
);

const serverMap = new Map(serverRoutes.map((route) => [key(route), route]));
const rbacMap = new Map(rbacRoutes.map((route) => [key(route), route]));
const clientsByKey = new Map();
for (const ref of clientRefs) {
  const list = clientsByKey.get(key(ref)) ?? [];
  list.push(ref.file);
  clientsByKey.set(key(ref), list);
}

const allKeys = [...new Set([...serverMap.keys(), ...rbacMap.keys(), ...clientsByKey.keys()])].sort();
const rows = allKeys.map((routeKey) => {
  const server = serverMap.get(routeKey);
  const rbac = rbacMap.get(routeKey);
  const clients = [...new Set(clientsByKey.get(routeKey) ?? [])].sort();
  let classification = "ACTIVE";
  if (server && !clients.length && !rbac) classification = "ORPHAN";
  else if (server && !clients.length && rbac) classification = "SERVER_RBAC_NO_CLIENT";
  else if (!server && rbac && !clients.length) classification = "RBAC_ONLY";
  else if (!server && clients.length) classification = "CLIENT_ONLY";
  else if (server && clients.length && !rbac) classification = "ACTIVE_NO_RBAC_KEY";
  return {
    route: routeKey,
    classification,
    server: Boolean(server),
    rbac: Boolean(rbac),
    clients,
  };
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
    "Une route sans client peut être volontairement publique, ops, E2E ou intégration externe: ORPHAN est un candidat, pas une suppression automatique.",
  ],
};

const output = process.argv[2];
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
