#!/usr/bin/env node
"use strict";

/**
 * RC1 G1 — matrice E2E métier isolée.
 *
 *   npm run verify:rc1-e2e
 *
 * Exécute les parcours qui n'exigent pas Docker / préprod.
 * Les chaînes HTTP UI→PostgreSQL restent BLOCKED si DATABASE_URL absent.
 * Écrit docs/release/evidence/rc1-e2e-results.json
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/release/evidence/rc1-e2e-results.json");

const CASES = [
  {
    id: "E2E-AUTH",
    parcours: "login / refresh / logout",
    cmd: ["npm", "run", "verify:auth-sessions"],
    mode: "http-memory",
  },
  {
    id: "E2E-USERS",
    parcours: "création enseignant + affectation (mémoire)",
    cmd: ["npm", "run", "verify:e2e-0006"],
    mode: "memory",
  },
  {
    id: "E2E-INV-732",
    parcours: "teacher_assignments ↔ school_courses.teacher_id",
    cmd: ["node", "--test", "backend/lib/teacherAssignmentsRepository.test.js"],
    mode: "memory",
  },
  {
    id: "E2E-HEAD-TEACHER",
    parcours: "professeur principal / RBAC affectation PP",
    cmd: ["node", "--test", "backend/lib/classHeadTeachers.rbac.test.js", "backend/lib/classHeadTeachersManagement.test.js"],
    mode: "memory",
  },
  {
    id: "E2E-SETUP",
    parcours: "setup première connexion (guidé backend)",
    cmd: [
      "node",
      "--test",
      "--test-reporter",
      "spec",
      "backend/lib/schoolSetupGuided.red.test.js",
      "backend/lib/schoolSetupGuided.regression.test.js",
    ],
    mode: "contract",
  },
  {
    id: "E2E-RBAC-COM",
    parcours: "communication in-app / isolation tenant clients",
    cmd: ["node", "backend/lib/clientsSecurity.test.js"],
    mode: "memory",
  },
  {
    id: "E2E-LEGACY",
    parcours: "aucune écriture legacy staff/élèves",
    cmd: [
      "node",
      "--test",
      "backend/lib/legacyPedagogyStaffStateWrite.test.js",
      "backend/lib/legacyStudentsStateWrite.test.js",
    ],
    mode: "contract",
  },
  {
    id: "E2E-PLATFORM-DENY",
    parcours: "RBAC plateforme interdite aux données établissement",
    cmd: ["npm", "run", "verify:platform-personal-data-deny"],
    mode: "http-memory",
  },
  {
    id: "E2E-DATES",
    parcours: "dates visibles JJ-MM-AAAA",
    cmd: ["node", "scripts/rc1/run-date-contract.js"],
    mode: "contract",
  },
  {
    id: "E2E-COM-C1",
    parcours: "communication in-app essentielle (gate C1)",
    cmd: ["npm", "run", "verify:communications-e2e"],
    mode: "contract",
  },
];

const PG_BLOCKED = [
  { id: "E2E-SCHOOL", parcours: "création / config établissement HTTP→PG", reason: "verify:e2e-0014 / onboarding exigent backend + PostgreSQL" },
  { id: "E2E-CLASS", parcours: "classes HTTP→PG", reason: "verify:e2e-0004 exige POST /api/classes sur stack PG" },
  { id: "E2E-ENROLL", parcours: "inscription élève via classe uniquement", reason: "verify:e2e-0005 exige API PG" },
  { id: "E2E-PRESENCE", parcours: "présences Présent/Absent/Retard/Justifié", reason: "verify:presences-roster.pg + UI non joués" },
  { id: "E2E-GRADES", parcours: "notes / évaluations HTTP→PG", reason: "verify:e2e-0008 / 0028 exigent API" },
  { id: "E2E-BULLETIN", parcours: "bulletins", reason: "verify:report-card-s1-e2e exige DATABASE_URL" },
  { id: "E2E-FINANCE", parcours: "frais / paiement / impayé", reason: "verify:e2e-0001 / 0009 / 0011 exigent API PG" },
  { id: "E2E-COM-PG", parcours: "communications HTTP PostgreSQL", reason: "HTTP dual-identity PG non rejoué" },
  { id: "E2E-PARENT", parcours: "workflow parent / élève", reason: "verify:e2e-0012 exige API" },
  { id: "E2E-RBAC-LIVE", parcours: "RBAC cross-school / cross-country live dual-identity", reason: "HTTP dual-identity PG non rejoué" },
];

function runCase(item) {
  const started = Date.now();
  const result = spawnSync(item.cmd[0], item.cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SOMAFRIK_E2E: process.env.SOMAFRIK_E2E ?? "true" },
    maxBuffer: 8 * 1024 * 1024,
  });
  const tail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim().split("\n").slice(-24).join("\n");
  return {
    id: item.id,
    parcours: item.parcours,
    mode: item.mode,
    command: item.cmd.join(" "),
    status: result.status === 0 ? "PASS" : "FAIL",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - started,
    evidence: tail.slice(0, 4000),
  };
}

function main() {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const item of CASES) {
    console.log(`\n=== ${item.id} ===`);
    const row = runCase(item);
    results.push(row);
    console.log(`${row.status} ${row.id} (${row.durationMs}ms, exit ${row.exitCode})`);
  }

  const blocked = PG_BLOCKED.map((item) => ({
    ...item,
    status: "BLOCKED",
    mode: "postgres",
  }));

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
      executed: results.length,
      pass: results.filter((r) => r.status === "PASS").length,
      fail: results.filter((r) => r.status === "FAIL").length,
      blocked: blocked.length,
    },
    results,
    blocked,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  console.log(`PASS ${summary.counts.pass} / FAIL ${summary.counts.fail} / BLOCKED ${summary.counts.blocked}`);
  process.exit(summary.counts.fail ? 1 : 0);
}

main();
