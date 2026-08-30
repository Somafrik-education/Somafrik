/**
 * Filet de sécurité bootstrap runtime (post P0 AUTH DOWN).
 *
 * Prouve le chemin critique préprod :
 *   repository.init()
 *   → getDataset()
 *   → GET /api/schools/:code (lookup public canonique)
 *   → POST /api/identify
 *   → POST /api/backoffice/login
 *
 * Lookup avec code inexistant → 404 (métier), jamais 500.
 * Login avec faux credentials → 401 (métier), jamais 500.
 *
 * Usage :
 *   DATABASE_URL=postgresql://... node backend/scripts/verify-runtime-bootstrap.js
 *   SOMAFRIK_BOOTSTRAP_REQUIRED=true  # échoue si pas de PG (CI)
 *
 * Base saine CTO : 885979ff / PR #69 — avant réintroduction SYNC-03/04.
 */
const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.SOMAFRIK_BOOTSTRAP_PORT || 5057);
const BASE = `http://127.0.0.1:${PORT}`;
const REQUIRED = String(process.env.SOMAFRIK_BOOTSTRAP_REQUIRED ?? "").toLowerCase() === "true";

function request(method, urlPath, body) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = { raw: text };
          }
          resolve({ status: res.statusCode, data, text });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout ${method} ${urlPath}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(child, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (child.exitCode != null) {
      throw new Error(`Serveur arrêté prématurément (code ${child.exitCode})`);
    }
    try {
      const health = await request("GET", "/api/health");
      if (health.status === 200) return health;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Backend non healthy à temps");
}

async function runRepositoryBootstrap() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (REQUIRED) {
      throw new Error("DATABASE_URL obligatoire (SOMAFRIK_BOOTSTRAP_REQUIRED=true)");
    }
    console.log("SKIP repository: DATABASE_URL absent");
    return false;
  }

  const { createPostgresRepository } = require("../db/repositoryFactory");
  const repository = createPostgresRepository(databaseUrl);
  await repository.init();
  assert.ok(repository.ready, "repository.ready");
  const dataset = await repository.getDataset();
  assert.ok(dataset, "getDataset() doit retourner un objet");
  assert.ok(
    Array.isArray(dataset.platformSchools) || dataset.school != null || Array.isArray(dataset.userAccounts),
    "getDataset() doit exposer schools/users",
  );
  assert.notStrictEqual(repository.engine, "memory", "bootstrap exige PostgreSQL, pas mémoire");
  await repository.close?.();
  console.log("OK repository: init + getDataset (postgresql)");
  return true;
}

async function runHttpBootstrap() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (REQUIRED) {
      throw new Error("DATABASE_URL obligatoire pour le bootstrap HTTP");
    }
    console.log("SKIP http: DATABASE_URL absent");
    return;
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "test",
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      JWT_SECRET:
        process.env.JWT_SECRET || "ci-bootstrap-jwt-secret-with-enough-length-32",
      SOMAFRIK_DB_REQUIRED: "true",
      // Aligné préprod : pas de seed démo (dataset peut être vide, mais ne doit pas 500).
      SOMAFRIK_SKIP_DEMO_SEED: process.env.SOMAFRIK_SKIP_DEMO_SEED || "true",
      SOMAFRIK_API_ONLY: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.on("data", () => {});

  try {
    const health = await waitForHealth(child);
    assert.strictEqual(health.status, 200, "GET /api/health");
    assert.strictEqual(health.data?.status, "ok");
    console.log("OK http: GET /api/health → 200");

    const schoolLookup = await request("GET", "/api/schools/BOOTSTRAP-PROBE-NOT-FOUND");
    assert.notStrictEqual(
      schoolLookup.status,
      500,
      "GET /api/schools/:code ne doit jamais être 500 pour un code inconnu",
    );
    assert.strictEqual(
      schoolLookup.status,
      404,
      `GET /api/schools/:code code inconnu → 404, reçu ${schoolLookup.status} ${schoolLookup.text}`,
    );
    console.log("OK http: GET /api/schools/:code → 404 (code inconnu, pas 500)");

    const identifyMissing = await request("POST", "/api/identify", { identifier: "bootstrap-probe" });
    assert.notStrictEqual(identifyMissing.status, 500, "POST /api/identify ne doit jamais être 500");
    assert.ok(
      identifyMissing.status >= 400 && identifyMissing.status < 500,
      `POST /api/identify attendu 4xx métier, reçu ${identifyMissing.status}`,
    );
    console.log(`OK http: POST /api/identify → ${identifyMissing.status} (métier)`);

    const login = await request("POST", "/api/backoffice/login", {
      identifier: "bootstrap-probe-unknown",
      password: "definitely-wrong-password",
      schoolCode: "CD-IN-26-001",
    });
    assert.notStrictEqual(login.status, 500, "POST /api/backoffice/login ne doit jamais être 500");
    assert.strictEqual(
      login.status,
      401,
      `POST /api/backoffice/login faux credentials → 401, reçu ${login.status} ${login.text}`,
    );
    console.log("OK http: POST /api/backoffice/login → 401 (faux credentials, pas 500)");
  } finally {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } else if (stderr && REQUIRED) {
      console.error(stderr.slice(-2000));
    }
  }
}

async function main() {
  const ranRepo = await runRepositoryBootstrap();
  if (ranRepo || REQUIRED) {
    await runHttpBootstrap();
  }
  console.log("OK verify-runtime-bootstrap");
}

main().catch((error) => {
  console.error("FAIL verify-runtime-bootstrap:", error.message || error);
  process.exit(1);
});
