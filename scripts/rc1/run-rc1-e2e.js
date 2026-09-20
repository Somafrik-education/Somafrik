#!/usr/bin/env node
"use strict";

/**
 * RC1 G1 — matrice E2E métier rejouable sans Docker.
 *
 *   npm run verify:rc1-e2e
 *
 * Les parcours HTTP UI→PostgreSQL restent SKIP si le backend isolé
 * (docker:up:core / DATABASE_URL) est absent. Aucune charge production.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/release/evidence/rc1-e2e-results.json");

const JOURNEYS = [
  {
    id: "E2E-AUTH",
    domain: "auth",
    kind: "contract",
    cmd: ["npm", "run", "verify:auth-sessions"],
  },
  {
    id: "E2E-USERS-ASSIGN",
    domain: "teachers",
    kind: "memory",
    cmd: ["npm", "run", "verify:e2e-0006"],
  },
  {
    id: "E2E-ASSIGN-732",
    domain: "teachers",
    kind: "contract",
    cmd: ["node", "--test", "backend/lib/teacherAssignmentsRepository.test.js"],
  },
  {
    id: "E2E-SETUP",
    domain: "setup",
    kind: "contract",
    cmd: ["npm", "run", "verify:school-setup-guided-green"],
  },
  {
    id: "E2E-DATES",
    domain: "dates",
    kind: "contract",
    cmd: ["node", "scripts/rc1/run-date-contract.js"],
  },
  {
    id: "E2E-COM-CONTRACT",
    domain: "communication",
    kind: "contract",
    cmd: ["npm", "run", "verify:communications-e2e"],
  },
  {
    id: "E2E-RBAC-S14",
    domain: "rbac",
    kind: "contract",
    cmd: ["npm", "run", "verify:rbac-s1-4"],
  },
  {
    id: "E2E-PLATFORM-DENY",
    domain: "rbac",
    kind: "contract",
    cmd: ["npm", "run", "verify:platform-personal-data-deny"],
  },
];

const DOCKER_REQUIRED = [
  { id: "E2E-SCHOOL", script: "verify:e2e-0014", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-CLASS", script: "verify:e2e-0004", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-ENROLL", script: "verify:e2e-0005", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-PRESENCE", script: "verify:e2e-0013", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-GRADES", script: "verify:e2e-0008", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-FINANCE", script: "verify:e2e-0001", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-PARENT", script: "verify:e2e-0012", reason: "HTTP + seed Docker/PG" },
  { id: "E2E-YEAR", script: "verify:academic-year-tenant", reason: "PostgreSQL tenant gate" },
];

function runGate(gate) {
  const started = Date.now();
  const result = spawnSync(gate.cmd[0], gate.cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SOMAFRIK_E2E: process.env.SOMAFRIK_E2E ?? "true" },
    maxBuffer: 8 * 1024 * 1024,
  });
  const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split("\n").slice(-16).join("\n");
  return {
    id: gate.id,
    domain: gate.domain,
    kind: gate.kind,
    command: gate.cmd.join(" "),
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    evidence: tail.slice(0, 3000),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const gate of JOURNEYS) {
    console.log(`\n=== ${gate.id} ===`);
    const row = runGate(gate);
    results.push(row);
    console.log(`${row.status} ${row.id} (${row.durationMs}ms)`);
  }

  const skipped = DOCKER_REQUIRED.map((row) => ({
    id: row.id,
    status: "SKIP",
    reason: row.reason,
    command: `npm run ${row.script}`,
  }));

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseline: require("node:child_process").execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    environment: {
      docker: false,
      databaseUrl: Boolean(String(process.env.DATABASE_URL ?? "").trim()),
      node: process.version,
    },
    counts: {
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      skip: skipped.length,
    },
    results,
    skipped,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  console.log(`PASS ${summary.counts.pass} / FAIL ${summary.counts.fail} / SKIP ${summary.counts.skip}`);
  process.exit(summary.counts.fail ? 1 : 0);
}

main();
