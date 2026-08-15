"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT, "backend", "server.js");
const RBAC_PATH = path.join(ROOT, "backend", "services", "rbacService.js");

const REMOVED_ROUTES = [
  ["get", "/api/users"],
  ["get", "/api/schools"],
  ["get", "/api/school"],
  ["get", "/api/announcements"],
];

const PROTECTED_ROUTES = [
  ["get", "/api/schools/:code"],
  ["post", "/api/login"],
  ["post", "/api/identify"],
  ["get", "/api/backoffice/users"],
  ["get", "/api/backoffice/establishments"],
  ["get", "/api/backoffice/announcements"],
];

function fail(message) {
  throw new Error(`[api-orphan-cleanup-wave2] ${message}`);
}

function routeMarker(method, route) {
  return `app.${method}("${route}"`;
}

function findCallEnd(source, start) {
  const open = source.indexOf("(", start);
  if (open < 0) fail(`parenthèse ouvrante introuvable après index ${start}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        while (source[end] === " " || source[end] === "\t") end += 1;
        if (source[end] !== ";") fail(`point-virgule introuvable à la fin de l'appel index ${start}`);
        end += 1;
        if (source[end] === "\r") end += 1;
        if (source[end] === "\n") end += 1;
        return end;
      }
    }
  }
  fail(`fin d'appel introuvable après index ${start}`);
}

function countOccurrences(source, needle) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function removeRoute(source, method, route) {
  const marker = routeMarker(method, route);
  const count = countOccurrences(source, marker);
  if (count !== 1) fail(`${marker} attendu exactement 1 fois, trouvé ${count}`);
  const start = source.indexOf(marker);
  const end = findCallEnd(source, start);
  return source.slice(0, start) + source.slice(end);
}

function removeEndpointListing(source, route) {
  const line = `      "${route}",\n`;
  const count = countOccurrences(source, line);
  if (count !== 1) fail(`entrée catalogue ${route} attendue exactement 1 fois, trouvée ${count}`);
  return source.replace(line, "");
}

function removeUsersRbacKey(source) {
  const pattern = /^\s*"GET \/api\/users": \[[^\n]*\],\r?\n/m;
  const matches = source.match(new RegExp(pattern.source, "gm")) ?? [];
  if (matches.length !== 1) fail(`clé RBAC GET /api/users attendue exactement 1 fois, trouvée ${matches.length}`);
  return source.replace(pattern, "");
}

function verifyRemoved(server, rbac) {
  for (const [method, route] of REMOVED_ROUTES) {
    if (server.includes(routeMarker(method, route))) fail(`alias encore présent: ${method.toUpperCase()} ${route}`);
  }
  if (/^\s*"GET \/api\/users":/m.test(rbac)) fail("clé RBAC legacy GET /api/users encore présente");
  for (const route of ["/api/users", "/api/schools", "/api/school", "/api/announcements"]) {
    if (server.includes(`      "${route}",\n`)) fail(`catalogue racine expose encore ${route}`);
  }
}

function verifyProtected(server) {
  for (const [method, route] of PROTECTED_ROUTES) {
    if (!server.includes(routeMarker(method, route))) {
      fail(`route protégée absente: ${method.toUpperCase()} ${route}`);
    }
  }
}

function apply() {
  let server = fs.readFileSync(SERVER_PATH, "utf8");
  let rbac = fs.readFileSync(RBAC_PATH, "utf8");

  verifyProtected(server);
  for (const [method, route] of REMOVED_ROUTES) server = removeRoute(server, method, route);
  for (const route of ["/api/users", "/api/schools", "/api/school", "/api/announcements"]) {
    server = removeEndpointListing(server, route);
  }
  rbac = removeUsersRbacKey(rbac);

  verifyRemoved(server, rbac);
  verifyProtected(server);
  fs.writeFileSync(SERVER_PATH, server);
  fs.writeFileSync(RBAC_PATH, rbac);
}

function check() {
  const server = fs.readFileSync(SERVER_PATH, "utf8");
  const rbac = fs.readFileSync(RBAC_PATH, "utf8");
  verifyRemoved(server, rbac);
  verifyProtected(server);
  console.log("OK api-orphan-cleanup-wave2 — 4 alias legacy absents, routes Mobile/canoniques protégées");
}

if (process.argv.includes("--apply")) apply();
else check();
