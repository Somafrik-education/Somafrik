"use strict";

/**
 * F6 — Gate RBAC live PostgreSQL Finance.
 * F1–F5 inchangés. F7 non ouvert.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { FINANCE_RBAC_ROUTE_MATRIX } = require("../lib/financeRbacRouteMatrix");
const { routePermissions } = require("../services/rbacService");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const finance = read("backend/lib/financeManagement.js");
  const authority = read("backend/lib/liveRbacPrincipalAuthority.js");
  const factory = read("backend/db/repositoryFactory.js");
  const server = read("backend/server.js");
  const httpTest = read("backend/lib/financeLiveRbac.http.pg.test.js");
  const webModal = read("web/src/components/payments/QuickPaymentModal.tsx");
  const mobileControls = read("Mobile/src/components/PaymentMutationControls.tsx");

  for (const helper of [
    "canManageFeeGrids",
    "canManagePaymentMethods",
    "canAdjustStudentFee",
    "canManagePaymentStatuses",
    "canForceReminder",
  ]) {
    const start = finance.indexOf(`function ${helper}`);
    assert.ok(start >= 0, `${helper} absent`);
    const end = finance.indexOf("\n}\n", start);
    const source = finance.slice(start, end + 3);
    assert.doesNotMatch(source, /principal\?\.role|Admin School|Comptable|Secrétaire|Directeur|Super Administrateur/);
  }

  assert.match(authority, /listActiveUserRoleKeysForSchool/);
  assert.match(authority, /resolveCanonicalUserIdForSchool/);
  assert.match(authority, /LIVE_RBAC_EMPTY_ROLE = "SANS_AFFECTATION"/);
  assert.match(authority, /legacy.*fail-closed-live-rbac/s);
  assert.doesNotMatch(authority, /principal\?\.permissions/);
  assert.match(authority, /session établissement sans primitive/);
  assert.match(factory, /function attachLiveRbacIfPostgres/);
  assert.match(factory, /attachLiveRbacAuthority\(repository\)/);
  assert.match(factory, /return assertRepositoryContract\(new FallbackRepository\(\), "memory"\)/);
  assert.doesNotMatch(
    factory.slice(factory.indexOf("function createFallbackRepository"), factory.indexOf("async function initializeRepository")),
    /attachLiveRbacAuthority/,
  );

  const requirePermissionAt = server.indexOf("function requirePermission(routeKey)");
  assert.ok(requirePermissionAt >= 0, "requirePermission absent");
  const permissionSource = server.slice(requirePermissionAt, requirePermissionAt + 1300);
  assert.match(permissionSource, /repository\.resolveEffectivePermissions\(req\.principal\)/);
  assert.match(permissionSource, /permissions: Array\.isArray\(live\?\.permissions\) \? live\.permissions : \[\]/);
  assert.match(permissionSource, /rbacService\.canAccess\(req\.principal, routeKey\)/);

  const feeGridPostAt = server.indexOf('app.post("/api/finance/fee-grids"');
  assert.ok(feeGridPostAt >= 0);
  const feeGridPost = server.slice(feeGridPostAt, feeGridPostAt + 280);
  assert.match(feeGridPost, /requirePermission\("POST \/api\/finance\/fee-grids"\)/);
  assert.doesNotMatch(feeGridPost, /requirePermission\("POST \/api\/payments"\)/);

  const cancelAt = server.indexOf('app.post("/api/payments/:paymentId/cancel"');
  assert.ok(cancelAt >= 0);
  const cancel = server.slice(cancelAt, cancelAt + 280);
  assert.match(cancel, /requirePermission\("POST \/api\/payments\/:paymentId\/cancel"\)/);

  for (const row of FINANCE_RBAC_ROUTE_MATRIX) {
    if (!row.routeKey) continue;
    assert.ok(routePermissions[row.routeKey], `route key absente du rbacService: ${row.routeKey}`);
    const escaped = row.routeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(server, new RegExp(`requirePermission\\("${escaped}"\\)`), `server.js n'utilise pas ${row.routeKey}`);
  }

  assert.match(httpTest, /staleClaims/);
  assert.match(httpTest, /setRolePaymentsGrant/);
  assert.match(httpTest, /aucune mutation DB après revoke/);
  assert.match(httpTest, /scénario 3 zéro rôle/);
  assert.match(httpTest, /scénario 5 lecture A/);
  assert.match(httpTest, /payment-student-options/);
  assert.match(httpTest, /\/students/);
  assert.doesNotMatch(webModal, /role === "Admin School"/);
  assert.doesNotMatch(webModal, /role === "Comptable"/);
  assert.doesNotMatch(mobileControls, /role === "Admin School"/);
  assert.doesNotMatch(mobileControls, /role === "Comptable"/);

  console.log("verify-finance-rbac: source guards live PostgreSQL authority OK");
}

function main() {
  sourceGuards();
  runNode(
    ["--test", "backend/lib/financeLiveRbac.test.js", "backend/lib/liveRbacPrincipalAuthority.test.js"],
    "tests RBAC Finance unitaires ont échoué",
  );
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour les preuves HTTP PostgreSQL F6");
  runNode(["backend/lib/financeLiveRbac.http.pg.test.js"], "preuves HTTP PostgreSQL stale-JWT ont échoué");
  console.log("verify-finance-rbac: GO — HTTP PostgreSQL stale-JWT inclus");
}

main();
