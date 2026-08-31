"use strict";

/**
 * Gate lot D finale — revalidation Planning + Présences + Sync L1
 * après #435 / #436 / #437 / #439. Evidence/test-only.
 * Échoue sur fuite cross-tenant, mutation étrangère, leftover JWT,
 * fail-closed manquant, audit leftover, scope élève élargi, ou succès masquant une erreur.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const findings = read("backend/lib/dRevalidation.findings.md");
  const httpExtra = read("backend/lib/dRevalidation.http.pg.test.js");
  const planning = read("backend/lib/planningTenant.http.pg.test.js");
  const presence = read("backend/lib/presenceTenant.http.pg.test.js");
  const sync = read("backend/lib/mobileSyncTenant.http.pg.test.js");

  assert.match(findings, /Lot D revalidation finale/);
  assert.match(findings, /PR-audit/);
  assert.match(findings, /PR-scope/);
  assert.match(findings, /SY-09/);
  assert.doesNotMatch(findings, /assouplir pour verdir/i);

  assert.match(planning, /PL-02/);
  assert.match(planning, /PL-08/);
  assert.match(presence, /PR-04/);
  assert.match(presence, /PR-05/);
  assert.match(presence, /PR-11/);
  assert.match(presence, /PR-audit/);
  assert.match(presence, /PR-scope-teacher/);
  assert.match(presence, /PR-scope-parent/);
  assert.match(sync, /SY-08/);
  assert.match(httpExtra, /PR-audit/);
  assert.match(httpExtra, /PR-scope/);
  assert.match(httpExtra, /SY-09/);
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/dRevalidation.guard.test.js"],
    "garde-fou lot D a échoué",
  );
  run(process.execPath, ["backend/scripts/verify-planning-tenant.js"], "revalidation Planning GP-014 a échoué");
  run(process.execPath, ["backend/scripts/verify-presence-tenant.js"], "revalidation Présences GP-015 a échoué");
  run(process.execPath, ["backend/scripts/verify-sync-l1-tenant.js"], "revalidation Sync L1 GP-020 a échoué");

  if (!String(process.env.DATABASE_URL ?? "").trim()) {
    console.log("verify-d-revalidation: SKIP HTTP extras PostgreSQL (DATABASE_URL absent)");
    console.log("OK verify-d-revalidation (source + unit + gates domaine sans extras PG)");
    return;
  }

  run(
    process.execPath,
    ["backend/lib/dRevalidation.http.pg.test.js"],
    "sondes HTTP PR-audit / PR-scope / SY-02/09/10 ont échoué",
  );
  console.log("OK verify-d-revalidation — Planning / Présences / Sync L1 + extras #439");
}

main();
