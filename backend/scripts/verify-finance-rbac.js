"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  assert.match(authority, /LIVE_RBAC_EMPTY_ROLE = "SANS_AFFECTATION"/);
  assert.match(authority, /legacy.*fail-closed-live-rbac/s);
  assert.doesNotMatch(authority, /principal\?\.permissions/);
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
  assert.match(permissionSource, /req\.principal = \{ \.\.\.req\.principal, permissions: live\.permissions \}/);
  assert.match(permissionSource, /rbacService\.canAccess\(req\.principal, routeKey\)/);

  console.log("verify-finance-rbac: source guards live PostgreSQL authority OK");
}

function main() {
  sourceGuards();
  runNode(
    ["--test", "backend/lib/financeLiveRbac.test.js", "backend/lib/liveRbacPrincipalAuthority.test.js"],
    "tests RBAC Finance ont échoué",
  );
  console.log("verify-finance-rbac: UNIT GO — HTTP PostgreSQL stale-JWT reste requis avant GO CTO");
}

main();
