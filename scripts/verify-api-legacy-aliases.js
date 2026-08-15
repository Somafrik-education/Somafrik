"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(ROOT, "backend", "server.js"), "utf8");
const rbac = fs.readFileSync(path.join(ROOT, "backend", "services", "rbacService.js"), "utf8");

const removedRoutes = [
  ["get", "/api/users"],
  ["get", "/api/schools"],
  ["get", "/api/school"],
  ["get", "/api/announcements"],
];

const protectedRoutes = [
  ["get", "/api/schools/:code"],
  ["post", "/api/login"],
  ["post", "/api/identify"],
  ["get", "/api/backoffice/users"],
  ["get", "/api/backoffice/establishments"],
  ["get", "/api/backoffice/announcements"],
];

function marker(method, route) {
  return `app.${method}("${route}"`;
}

for (const [method, route] of removedRoutes) {
  if (server.includes(marker(method, route))) {
    throw new Error(`Alias legacy réintroduit: ${method.toUpperCase()} ${route}`);
  }
}

if (/^\s*"GET \/api\/users":/m.test(rbac)) {
  throw new Error("Clé RBAC legacy GET /api/users réintroduite");
}

for (const route of ["/api/users", "/api/schools", "/api/school", "/api/announcements"]) {
  if (server.includes(`      "${route}",\n`)) {
    throw new Error(`Catalogue racine réexpose l'alias legacy ${route}`);
  }
}

for (const [method, route] of protectedRoutes) {
  if (!server.includes(marker(method, route))) {
    throw new Error(`Route active protégée absente: ${method.toUpperCase()} ${route}`);
  }
}

console.log("OK verify-api-legacy-aliases — 4 alias absents, routes Mobile/canoniques protégées");
