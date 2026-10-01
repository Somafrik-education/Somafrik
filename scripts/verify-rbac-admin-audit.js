#!/usr/bin/env node
"use strict";

/**
 * Vérifie la classification AUDIT RBAC Administration :
 * - tests ROUGES métier : doivent échouer (preuve de l'écart)
 * - tests VERTS sécurité : doivent passer
 *
 * Exit 0 seulement si la classification est respectée.
 * Ne « verdit » jamais un test rouge.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_DIR = path.join(ROOT, "docs/audits/evidence");
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, "rbac-admin-audit-results.json");

function run(label, command, args, { expectFail = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  const ok = result.status === 0;
  const classified = expectFail ? !ok : ok;
  return {
    label,
    command: [command, ...args].join(" "),
    expectFail,
    exitCode: result.status,
    ok,
    classified,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function summarizeNodeTest(output) {
  const names = [];
  for (const line of output.split("\n")) {
    const fail = line.match(/^#\s+fail\s+\d+/);
    const pass = line.match(/^#\s+pass\s+\d+/);
    const testName = line.match(/^(not )?ok \d+ - (.+)$/);
    if (testName) names.push({ ok: !testName[1], name: testName[2] });
    void fail;
    void pass;
  }
  const failCount = (output.match(/^not ok /gm) || []).length;
  const passCount = (output.match(/^ok /gm) || []).length;
  return { failCount, passCount, names };
}

const suites = [
  run("backend-red", "node", ["--test", "backend/lib/rbacAdminAudit.red.test.js"], { expectFail: true }),
  run("backend-green", "node", ["--test", "backend/lib/rbacAdminAudit.green.test.js"], { expectFail: false }),
  run("web-red", "npm", ["--prefix", "web", "run", "test:rbac-admin-audit-red"], { expectFail: true }),
  run(
    "web-green",
    "npm",
    [
      "--prefix",
      "web",
      "run",
      "test",
      "--",
      "src/pages/PermissionsPage.audit.green.test.tsx",
      "src/lib/permissions.rbacAdmin.audit.green.test.ts",
      "src/pages/PermissionsPage.test.tsx",
      "src/lib/rbacLocks.test.ts",
    ],
    { expectFail: false },
  ),
  run(
    "backend-existing-unimpacted",
    "node",
    ["--test", "backend/lib/functionalRbac.test.js", "backend/lib/rbacMandatoryPermissions.test.js"],
    { expectFail: false },
  ),
];

const report = {
  generatedAt: new Date().toISOString(),
  mandate: "AUDIT + RED tests — aucune correction fonctionnelle",
  suites: suites.map((suite) => ({
    label: suite.label,
    command: suite.command,
    expectFail: suite.expectFail,
    exitCode: suite.exitCode,
    classified: suite.classified,
    nodeTap: suite.label.startsWith("backend") ? summarizeNodeTest(`${suite.stdout}\n${suite.stderr}`) : undefined,
    tail: `${suite.stdout}\n${suite.stderr}`.trim().split("\n").slice(-40),
  })),
};

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(EVIDENCE_FILE, `${JSON.stringify(report, null, 2)}\n`);

console.log("=== AUDIT RBAC Administration — classification RED / GREEN ===\n");
for (const suite of suites) {
  const mark = suite.classified ? "OK" : "KO";
  const expected = suite.expectFail ? "RED attendu" : "GREEN attendu";
  console.log(`[${mark}] ${suite.label} (exit ${suite.exitCode}) — ${expected}`);
  if (!suite.classified) {
    console.log(suite.stdout);
    console.log(suite.stderr);
  }
}
console.log(`\nPreuve écrite : ${path.relative(ROOT, EVIDENCE_FILE)}`);

if (suites.some((suite) => !suite.classified)) {
  console.error("\nClassification incorrecte : un test rouge est devenu vert, ou un test vert a régressé.");
  process.exit(1);
}

console.log("\nClassification conforme : RED métier échouent, GREEN sécurité et tests existants passent.");
process.exit(0);
