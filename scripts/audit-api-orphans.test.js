"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const script = path.join(__dirname, "audit-api-orphans.js");
const output = execFileSync(process.execPath, [script], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const audit = JSON.parse(output);
const byRoute = new Map(audit.rows.map((row) => [row.route, row]));

function expectClassification(route, classification) {
  const row = byRoute.get(route);
  assert(row, `Route absente du scanner: ${route}`);
  assert.strictEqual(row.classification, classification, `${route} doit être ${classification}`);
}

function expectClient(route, client) {
  const row = byRoute.get(route);
  assert(row, `Route absente du scanner: ${route}`);
  assert(row.clients.includes(client), `${route} doit référencer ${client}`);
}

expectClassification("GET /", "INFRASTRUCTURE_ROUTE");
expectClassification("GET /web", "INFRASTRUCTURE_ROUTE");
expectClassification("POST /auth/refresh", "AUTH_SESSION_ROUTE");
expectClassification("POST /backoffice/e2e/clear-login-lockout", "TEST_ONLY_ROUTE");
expectClassification("GET /debug/notes-authz-trace", "DEBUG_ONLY_ROUTE");
expectClassification("GET /mvp/readiness", "LEGACY_REVIEW_CANDIDATE");
expectClassification("GET /mvp/snapshot", "LEGACY_REVIEW_CANDIDATE");
expectClassification("GET /mvp/dashboard", "LEGACY_REVIEW_CANDIDATE");

const pdfRoute = byRoute.get("GET /students/:param/report.pdf");
assert(pdfRoute, "Route PDF étudiant absente du scanner");
assert(
  pdfRoute.clients.includes("Mobile/src/services/api.ts"),
  "Le téléchargement PDF Mobile doit être détecté comme consommateur direct",
);
assert.notStrictEqual(
  pdfRoute.classification,
  "ORPHAN_CANDIDATE",
  "Le bulletin PDF Mobile ne doit jamais redevenir un faux orphelin",
);

expectClient(
  "GET /backoffice/establishments/:param/subscription",
  "web/src/lib/establishmentsApi.ts",
);
expectClient("GET /backoffice/subscription-access", "web/src/lib/establishmentsApi.ts");

for (const row of audit.rows) {
  assert(!row.route.includes("${"), `Route mal normalisée avec interpolation: ${row.route}`);
}

console.log("audit-api-orphans.test.js OK");
