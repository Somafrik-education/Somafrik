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

  const requirePermissionAt = server.indexOf("function requirePermission(routeKey)");
  assert.ok(requirePermissionAt >= 0, "requirePermission absent");
  const permissionSource = server.slice(requirePermissionAt, requirePermissionAt + 1300);
  assert.match(permissionSource, /repository\.resolveEffectivePermissions\(req\.principal\)/);
  assert.match(permissionSource, /req\.principal = \{ \.\.\.req\.principal, permissions: live\.permissions \}/);
  assert.match(permissionSource, /rbacService\.canAccess\(req\.principal, routeKey\)/);

  console.log("verify-finance-rbac: source guards stage 1 OK");
}

function main() {
  sourceGuards();
  runNode(["--test", "backend/lib/financeLiveRbac.test.js"], "tests RBAC Finance ont échoué");
  console.log("verify-finance-rbac: STAGE-1 GO — F6 global reste NO-GO jusqu'aux tests stale-JWT/tenant");
}

main();
