#!/usr/bin/env node
"use strict";

/**
 * RC1 G1 — exécute un catalogue de gates fonctionnelles / sécurité
 * qui ne nécessitent pas Docker ni une DATABASE_URL de préprod.
 *
 *   npm run verify:rc1-gates
 *
 * Écrit docs/release/evidence/rc1-functional-results.json
 * Continue après chaque échec pour livrer une matrice complète.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/release/evidence/rc1-functional-results.json");

const GATES = [
  { id: "SEC-DISCLOSURE", domain: "security", cmd: ["npm", "run", "verify:security-disclosure"] },
  { id: "JWT-HEADER", domain: "security", cmd: ["npm", "run", "verify:jwt-header"] },
  { id: "DB-CONFIG", domain: "security", cmd: ["npm", "run", "verify:db-config"] },
  { id: "MOBILE-SECURITY", domain: "security", cmd: ["npm", "run", "verify:mobile-security"] },
  { id: "ANDROID-RELEASE", domain: "security", cmd: ["npm", "run", "verify:android-release-readiness"] },
  { id: "RBAC-S1-4", domain: "functional", cmd: ["npm", "run", "verify:rbac-s1-4"] },
  { id: "RBAC-ADMIN-01", domain: "functional", cmd: ["npm", "run", "verify:rbac-admin-01"] },
  { id: "NOTES-SYNC", domain: "functional", cmd: ["npm", "run", "verify:notes-sync"] },
  { id: "LOT0-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot0-parity"] },
  { id: "LOT1-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot1-parity"] },
  { id: "LOT2-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot2-parity"] },
  { id: "LOT3-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot3-parity"] },
  { id: "LOT4-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot4-parity"] },
  { id: "LOT5-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot5-parity"] },
  { id: "LOT6-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot6-parity"] },
  { id: "LOT7-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot7-parity"] },
  { id: "LOT8-PARITY", domain: "functional", cmd: ["npm", "run", "test:lot8-parity"] },
  { id: "HELP-V1A", domain: "functional", cmd: ["npm", "run", "verify:help-v1a-catalogue"] },
  { id: "BRANDING", domain: "functional", cmd: ["npm", "run", "verify:branding-master"] },
  { id: "PERSONAL-DATA-DENY", domain: "security", cmd: ["npm", "run", "verify:platform-personal-data-deny"] },
  { id: "AUTH-SESSIONS", domain: "security", cmd: ["npm", "run", "verify:auth-sessions"] },
  { id: "SECRETS", domain: "security", cmd: ["npm", "run", "verify:secrets"] },
  { id: "SANITIZE", domain: "security", cmd: ["npm", "run", "verify:sanitize-user-responses"] },
  { id: "AUDIT-CI", domain: "security", cmd: ["npm", "run", "audit:ci"] },
];

function runGate(gate) {
  const started = Date.now();
  const result = spawnSync(gate.cmd[0], gate.cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SOMAFRIK_E2E: process.env.SOMAFRIK_E2E ?? "true" },
    maxBuffer: 8 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const status = result.status === 0 ? "PASS" : "FAIL";
  const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split("\n").slice(-20).join("\n");
  return {
    id: gate.id,
    domain: gate.domain,
    command: gate.cmd.join(" "),
    status,
    exitCode: result.status ?? 1,
    durationMs,
    evidence: tail.slice(0, 4000),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const gate of GATES) {
    console.log(`\n=== ${gate.id} ===`);
    const row = runGate(gate);
    results.push(row);
    console.log(`${row.status} ${row.id} (${row.durationMs}ms, exit ${row.exitCode})`);
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseline: process.env.RC1_BASELINE || require("node:child_process").execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    environment: {
      docker: false,
      databaseUrl: Boolean(String(process.env.DATABASE_URL ?? "").trim()),
      node: process.version,
    },
    counts: {
      total: results.length,
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
    },
    results,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  console.log(`PASS ${summary.counts.pass} / FAIL ${summary.counts.fail} / TOTAL ${summary.counts.total}`);
  process.exit(summary.counts.fail ? 1 : 0);
}

main();
