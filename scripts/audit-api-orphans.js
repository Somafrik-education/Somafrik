"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER = path.join(ROOT, "backend", "server.js");
const RBAC = path.join(ROOT, "backend", "services", "rbacService.js");
const CLIENT_ROOTS = [path.join(ROOT, "web", "src"), path.join(ROOT, "Mobile", "src")];
const INTERNAL_ROOTS = [path.join(ROOT, "scripts"), path.join(ROOT, "backend")];

const SPECIAL_ROUTE_CLASSIFICATIONS = new Map([
  ["GET /", "INFRASTRUCTURE_ROUTE"],
  ["GET /web", "INFRASTRUCTURE_ROUTE"],
  ["POST /auth/refresh", "AUTH_SESSION_ROUTE"],
  ["POST /backoffice/e2e/clear-login-lockout", "TEST_ONLY_ROUTE"],
  ["GET /debug/notes-authz-trace", "DEBUG_ONLY_ROUTE"],
]);

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

function findQuotedArgumentEnd(source, quoteIndex, quote) {
  let escaped = false;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) return index;
  }
  return -1;
}

function findInterpolationEnd(source, startIndex) {
  let depth = 1;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'" || char === '"') {
      const end = findQuotedArgumentEnd(source, index, char);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (char === "`") {
      const end = findTemplateLiteralEnd(source, index);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findTemplateLiteralEnd(source, tickIndex) {
  let escaped = false;
  for (let index = tickIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "`") return index;
    if (char === "$" && source[index + 1] === "{") {
      const end = findInterpolationEnd(source, index + 2);
      if (end < 0) return -1;
      index = end;
    }
  }
  return -1;
}

function findLiteralEnd(source, quoteIndex, quote) {
  return quote === "`"
    ? findTemplateLiteralEnd(source, quoteIndex)
    : findQuotedArgumentEnd(source, quoteIndex, quote);
}

function isQueryOnlyInterpolation(expression) {
  const trimmed = String(expression).trim();
  return (
    /["'`]\?/.test(trimmed) ||
    /^(?:query|queryString|search|searchParams|qs)$/i.test(trimmed)
  );
}

function normalizeTemplateRoute(route) {
  const source = String(route);
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "$" && source[index + 1] === "{") {
      const end = findInterpolationEnd(source, index + 2);
      if (end < 0) {
        result += ":param";
        break;
      }
      const expression = source.slice(index + 2, end);
      // Une interpolation de query string optionnelle ne constitue pas un segment
      // de route. Les autres interpolations sont normalisées en paramètre dynamique.
      result += isQueryOnlyInterpolation(expression) ? "" : ":param";
      index = end;
      continue;
    }
    result += source[index];
  }
  return result;
}

function normalizeRoute(route) {
  const withTemplateParams = normalizeTemplateRoute(route);
  const staticPath = withTemplateParams.split("?", 1)[0];
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

function extractPermissionRefs(file, source) {
  const refs = [];
  const re = /requirePermission\(\s*["'`](GET|POST|PUT|PATCH|DELETE)\s+([^"'`]+)["'`]\s*\)/g;
  let match;
  while ((match = re.exec(source))) {
    refs.push({
      method: match[1],
      path: match[2],
      normalized: normalizeRoute(match[2]),
      file: path.relative(ROOT, file),
    });
  }
  return refs;
}

function extractHttpRefs(file, source) {
  const refs = [];
  // Le segment générique peut lui-même contenir des génériques (ex. Record<string, unknown>),
  // donc on accepte tout jusqu'à la parenthèse d'appel plutôt que de s'arrêter au premier >.
  const re = /\b(get|post|put|patch|delete)\s*(?:<[^\n(]+>)?\s*\(\s*(["'`])/gi;
  let match;
  while ((match = re.exec(source))) {
    const quote = match[2];
    const quoteIndex = re.lastIndex - 1;
    const end = findLiteralEnd(source, quoteIndex, quote);
    if (end < 0) continue;
    const raw = source.slice(quoteIndex + 1, end);
    if (raw.startsWith("/")) {
      refs.push({
        method: match[1].toUpperCase(),
        path: raw,
        normalized: normalizeRoute(raw),
        file: path.relative(ROOT, file),
      });
    }
    re.lastIndex = end + 1;
  }
  return refs;
}

function extractWrappedRequestRefs(file, source) {
  const refs = [];
  // Mobile/src/services/api.ts utilise `request(...)` autour de httpRequest ;
  // certains modules historiques utilisent aussi `apiRequest(...)`.
  const re = /\b(?:apiRequest|request)\s*(?:<[^\n(]+>)?\s*\(\s*(["'`])/g;
  let match;
  while ((match = re.exec(source))) {
    const quote = match[1];
    const quoteIndex = re.lastIndex - 1;
    const end = findLiteralEnd(source, quoteIndex, quote);
    if (end < 0) continue;
    const raw = source.slice(quoteIndex + 1, end);
    if (!raw.startsWith("/")) continue;

    // Les wrappers utilisent GET par défaut et déclarent les autres méthodes
    // dans l'objet options qui suit le premier argument.
    const tail = source.slice(end + 1, Math.min(source.length, end + 700));
    const close = tail.indexOf(");");
    const callTail = close >= 0 ? tail.slice(0, close) : tail;
    const methodMatch = callTail.match(/\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i);
    const method = (methodMatch?.[1] ?? "GET").toUpperCase();
    refs.push({ method, path: raw, normalized: normalizeRoute(raw), file: path.relative(ROOT, file) });
    re.lastIndex = end + 1;
  }
  return refs;
}

function extractDirectBaseUrlRefs(file, source) {
  const refs = [];
  // Certains adaptateurs natifs (ex. FileSystem.downloadAsync) construisent une URL
  // directement depuis getApiBaseUrl()/API_BASE_URL au lieu de passer par request(...).
  // Ces références restent de vrais consommateurs GET et ne doivent pas devenir des faux orphelins.
  const re = /`\$\{\s*(?:getApiBaseUrl\(\)|resolveApiBaseUrl\(\)|API_BASE_URL)\s*\}(\/[^`]*)`/g;
  let match;
  while ((match = re.exec(source))) {
    const raw = match[1];
    refs.push({ method: "GET", path: raw, normalized: normalizeRoute(raw), file: path.relative(ROOT, file) });
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

function classifySpecialServerRoute(routeKey) {
  const exact = SPECIAL_ROUTE_CLASSIFICATIONS.get(routeKey);
  if (exact) return exact;
  if (/^(GET|POST|PUT|PATCH|DELETE) \/mvp\//.test(routeKey)) return "LEGACY_REVIEW_CANDIDATE";
  return null;
}

const serverSource = read(SERVER);
const serverRoutes = extractServerRoutes(serverSource);
const rbacRoutes = extractRbacRoutes(read(RBAC));
const permissionRefs = extractPermissionRefs(SERVER, serverSource);
const clientRefs = CLIENT_ROOTS.flatMap((root) =>
  walk(root).flatMap((file) => {
    const source = read(file);
    return [
      ...extractHttpRefs(file, source),
      ...extractWrappedRequestRefs(file, source),
      ...extractDirectBaseUrlRefs(file, source),
    ];
  }),
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
const permissionRefsByKey = groupRefs(permissionRefs);

const allKeys = [...new Set([
  ...serverMap.keys(),
  ...rbacMap.keys(),
  ...clientsByKey.keys(),
  ...internalByKey.keys(),
  ...permissionRefsByKey.keys(),
])].sort();

const rows = allKeys.map((routeKey) => {
  const server = serverMap.get(routeKey);
  const rbac = rbacMap.get(routeKey);
  const clients = [...new Set(clientsByKey.get(routeKey) ?? [])].sort();
  const internalRefsForRoute = [...new Set(internalByKey.get(routeKey) ?? [])].sort();
  const permissionRefsForRoute = [...new Set(permissionRefsByKey.get(routeKey) ?? [])].sort();
  let classification = "ACTIVE";
  const specialServerClassification = server ? classifySpecialServerRoute(routeKey) : null;
  if (specialServerClassification) classification = specialServerClassification;
  else if (!server && rbac && permissionRefsForRoute.length) classification = "RBAC_PERMISSION_KEY";
  else if (server && !clients.length && internalRefsForRoute.length) classification = "INTERNAL_ONLY";
  else if (server && !clients.length && !rbac) classification = "ORPHAN_CANDIDATE";
  else if (server && !clients.length && rbac) classification = "SERVER_RBAC_NO_CLIENT";
  else if (!server && rbac && !clients.length && !internalRefsForRoute.length) classification = "RBAC_ONLY";
  else if (!server && (clients.length || internalRefsForRoute.length)) classification = "CALLER_ONLY";
  else if (server && clients.length && !rbac) classification = "ACTIVE_NO_RBAC_KEY";
  return {
    route: routeKey,
    classification,
    server: Boolean(server),
    rbac: Boolean(rbac),
    clients,
    internalRefs: internalRefsForRoute,
    permissionRefs: permissionRefsForRoute,
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
    "Le préfixe de transport /api est normalisé: /api/backoffice/users et /backoffice/users représentent la même route applicative.",
    "Les template strings sont parsées avec leurs interpolations imbriquées ; les segments dynamiques deviennent :param et les suffixes de query variables usuels sont retirés du path.",
    "Les appels TypeScript avec génériques imbriqués (ex. api.get<Record<string, unknown>>(...)) sont détectés.",
    "Les wrappers Mobile request(...) / apiRequest(...) sont détectés, avec GET par défaut et lecture de l'option method.",
    "Les URL GET construites directement depuis getApiBaseUrl()/resolveApiBaseUrl()/API_BASE_URL sont détectées pour les adaptateurs natifs de téléchargement.",
    "Les références scripts/backend sont séparées des consommateurs Web/Mobile afin d'identifier les routes tests/ops/internal.",
    "Les clés RBAC appelées explicitement par requirePermission(...) sont classées RBAC_PERMISSION_KEY même si leur libellé n'est pas un handler Express exact.",
    "INFRASTRUCTURE_ROUTE, AUTH_SESSION_ROUTE, TEST_ONLY_ROUTE et DEBUG_ONLY_ROUTE ne sont pas des candidats de suppression automatique.",
    "LEGACY_REVIEW_CANDIDATE signale un endpoint legacy sans consommateur statique détecté qui exige une revue CTO dédiée avant suppression.",
    "ORPHAN_CANDIDATE signifie absence de référence statique détectée, pas autorisation automatique de suppression.",
  ],
};

const output = process.argv[2];
if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
