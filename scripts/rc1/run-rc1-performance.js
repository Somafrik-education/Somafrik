#!/usr/bin/env node
"use strict";

/**
 * RC1 G1 — harness de performance Node, isolé, sans dépendance k6.
 *
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api npm run verify:rc1-performance
 *
 * Profils : smoke | nominal | spike | endurance
 * Jamais de charge sur somafrik.app / api.somafrik.app.
 * Si l'API n'est pas joignable : SKIP (exit 2) + evidence.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "docs/release/evidence/rc1-performance-results.json");

const FORBIDDEN_HOSTS = ["somafrik.app", "api.somafrik.app"];
const DEFAULT_BASE = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";

const ENDPOINTS = [
  { id: "health", method: "GET", path: "/health", auth: false },
  { id: "login", method: "POST", path: "/login", auth: false, body: { username: "__rc1_missing__", password: "nope" } },
];

const PROFILES = {
  smoke: { concurrency: 1, requests: 8, name: "smoke" },
  nominal: { concurrency: 4, requests: 40, name: "charge nominale" },
  spike: { concurrency: 12, requests: 48, name: "pic court" },
  endurance: { concurrency: 2, requests: 60, name: "endurance courte" },
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function assertIsolated(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`SOMAFRIK_API_URL invalide: ${baseUrl}`);
  }
  if (FORBIDDEN_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
    throw new Error(`Refus: charge interdite sur l'hôte production ${host}`);
  }
}

async function requestOnce(baseUrl, endpoint) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${endpoint.path}`, {
      method: endpoint.method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });
    const text = await res.text();
    return {
      ok: res.status < 500,
      status: res.status,
      ms: Date.now() - started,
      bytes: Buffer.byteLength(text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runProfile(baseUrl, endpoint, profile) {
  const samples = [];
  let next = 0;
  async function worker() {
    while (next < profile.requests) {
      const i = next;
      next += 1;
      samples[i] = await requestOnce(baseUrl, endpoint);
    }
  }
  await Promise.all(Array.from({ length: profile.concurrency }, () => worker()));
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.ok);
  const totalMs = times.reduce((a, b) => a + b, 0);
  return {
    endpoint: endpoint.id,
    profile: profile.name,
    requests: samples.length,
    errors: errors.length,
    errorRate: samples.length ? errors.length / samples.length : 1,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    throughputRps: totalMs ? Number(((samples.length * 1000) / (totalMs / profile.concurrency)).toFixed(2)) : 0,
    avgBytes: samples.length ? Math.round(samples.reduce((a, s) => a + s.bytes, 0) / samples.length) : 0,
  };
}

async function probe(baseUrl) {
  const health = await requestOnce(baseUrl, ENDPOINTS[0]);
  return health.status > 0;
}

function startMemoryBackend() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/dev-memory.js"], {
      cwd: path.join(ROOT, "backend"),
      env: {
        ...process.env,
        PORT: process.env.PORT || "5000",
        SOMAFRIK_DB_REQUIRED: "false",
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) {
        child.kill("SIGTERM");
        reject(new Error("backend mémoire: timeout 20s"));
      }
    }, 20000);
    function onData(buf) {
      const text = String(buf);
      if (/listening|5000|started|ready/i.test(text) || text.length > 0) {
        // Probe in a moment; memory server may log late.
      }
    }
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(`backend mémoire exit ${code}`));
      }
    });
    setTimeout(async () => {
      const up = await probe(DEFAULT_BASE);
      if (up) {
        ready = true;
        clearTimeout(timer);
        resolve(child);
      }
    }, 1500);
  });
}

async function main() {
  const baseUrl = DEFAULT_BASE;
  assertIsolated(baseUrl);

  let child = null;
  let reachable = await probe(baseUrl);
  if (!reachable && !process.env.SOMAFRIK_API_URL) {
    try {
      child = await startMemoryBackend();
      reachable = await probe(baseUrl);
    } catch (error) {
      reachable = false;
      console.warn(error instanceof Error ? error.message : error);
    }
  }

  if (!reachable) {
    const skip = {
      startedAt: new Date().toISOString(),
      status: "SKIP",
      reason: "API isolée injoignable (pas de Docker / DATABASE_URL / backend mémoire).",
      baseUrl,
      productionLoad: false,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(skip, null, 2)}\n`);
    console.log("RC1 performance SKIP — API isolée absente.");
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const measurements = [];
  for (const endpoint of ENDPOINTS) {
    for (const key of ["smoke", "nominal", "spike", "endurance"]) {
      measurements.push(await runProfile(baseUrl, endpoint, PROFILES[key]));
    }
  }

  const thresholds = {
    errorRateNominalMax: 0.01,
    p95ReadMs: 1000,
    p95WriteMs: 1500,
  };

  const nominal = measurements.filter((m) => m.profile === "charge nominale");
  const findings = [];
  for (const row of nominal) {
    if (row.errorRate > thresholds.errorRateNominalMax) {
      findings.push({
        id: `PERF-ERR-${row.endpoint}`,
        severity: "P2",
        detail: `${row.endpoint} errorRate nominale ${(row.errorRate * 100).toFixed(1)}%`,
      });
    }
    if ((row.p95 ?? 99999) > (row.endpoint === "login" ? thresholds.p95WriteMs : thresholds.p95ReadMs)) {
      findings.push({
        id: `PERF-P95-${row.endpoint}`,
        severity: "P2",
        detail: `${row.endpoint} p95 ${row.p95}ms`,
      });
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    status: findings.length ? "HOLD" : "PASS",
    baseUrl,
    backend: child ? "memory-ephemeral" : "provided",
    productionLoad: false,
    thresholds,
    measurements,
    findings,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, findings: findings.length }, null, 2));
  if (child) child.kill("SIGTERM");
  process.exit(findings.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
