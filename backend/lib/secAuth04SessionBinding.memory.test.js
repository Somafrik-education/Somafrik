"use strict";

/**
 * SEC-AUTH-04 — liaison JWT ↔ session ↔ utilisateur, dépôt mémoire (HTTP réel).
 *
 * Jeu de démonstration en mémoire uniquement (aucune base, aucune donnée réelle).
 * Complète le banc PostgreSQL : enseignant et parent (Web et Mobile), et même
 * contrôle C-03 / F3 sur le dépôt mémoire.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");
const { TokenService } = require("../services/tokenService");
const { superadminLoginPassword } = require("./superadminSeedSecret");

const BACKEND_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.SOMAFRIK_SEC_AUTH_04_MEMORY_PORT ?? 19945);
const BASE = `http://127.0.0.1:${PORT}/api`;
// Secret propre au banc, généré à l'exécution.
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const tokens = new TokenService({ secret: JWT_SECRET });

const ACCOUNTS = {
  superadmin: ["/backoffice/login", () => ({ identifier: "superadmin", password: superadminLoginPassword() })],
  countryAdmin: ["/backoffice/login", () => ({ identifier: "admin-rdc", password: "1234" })],
  schoolAdmin: ["/backoffice/login", () => ({ schoolCode: "CD-2026-0001", identifier: "admin", password: "1234" })],
  teacherWeb: ["/backoffice/login", () => ({ schoolCode: "CD-2026-0001", identifier: "ENS-0001", password: "1234" })],
  teacher: ["/login", () => ({ role: "teacher", schoolCode: "CD-2026-0001", identifier: "ENS-0001", pin: "1234" })],
  parentWeb: ["/backoffice/login", () => ({ schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", password: "1234" })],
  parent: ["/login", () => ({ role: "parent_student", schoolCode: "CD-2026-0001", identifier: "+243 820 000 001", password: "1234" })],
};

let child = null;

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token != null ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

const probe = (token) => request("/auth/effective-permissions", { token });
const claims = (token) => JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));

async function login(key) {
  const [loginPath, payload] = ACCOUNTS[key];
  const response = await request(loginPath, { method: "POST", body: payload() });
  assert.equal(response.status, 200, `connexion ${key} : reçu ${response.status}`);
  assert.ok(claims(response.data.accessToken).sessionId, `connexion ${key} : sessionId émis`);
  return response.data;
}

test.before(async () => {
  child = spawn(process.execPath, ["scripts/dev-memory.js"], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      JWT_SECRET,
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_API_ONLY: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode != null) throw new Error(`backend mémoire arrêté (${child.exitCode})\n${stderr}`);
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`backend mémoire indisponible\n${stderr}`);
});

test.after(async () => {
  if (child && child.exitCode == null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

test("AUTH4-15 / AUTH4-16 / AUTH4-11 à 14 (mémoire) — connexions valides acceptées pour chaque type de compte", async () => {
  for (const key of Object.keys(ACCOUNTS)) {
    const session = await login(key);
    assert.equal((await probe(session.accessToken)).status, 200, `${key} : jeton lié accepté`);
  }
});

test("AUTH4-01 / 02 / 22 (mémoire) — jeton sans sessionId, vide ou mal formé refusé pour chaque type de compte", async () => {
  for (const key of Object.keys(ACCOUNTS)) {
    const { sessionId: _drop, ...legacy } = claims((await login(key)).accessToken);
    for (const variant of [legacy, { ...legacy, sessionId: "" }, { ...legacy, sessionId: "abc" }]) {
      const response = await probe(tokens.sign({ ...variant }, 600));
      assert.equal(response.status, 401, `${key} : reçu ${response.status}`);
      assert.equal(response.data?.code, "SESSION_REQUIRED");
    }
  }
});

test("AUTH4-03 / 06 (mémoire) — session inexistante ou d'un autre utilisateur refusée", async () => {
  const teacher = claims((await login("teacher")).accessToken);
  const parent = await login("parent");
  const admin = await login("schoolAdmin");
  const unknown = await probe(tokens.createAccessToken({ ...teacher, sessionId: crypto.randomUUID() }));
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data?.code, "SESSION_REVOKED");
  // Jeton de l'enseignant portant la session du parent, puis de l'administrateur.
  for (const victim of [parent, admin]) {
    const swapped = await probe(tokens.createAccessToken({ ...teacher, sessionId: claims(victim.accessToken).sessionId }));
    assert.equal(swapped.status, 401);
    assert.equal(swapped.data?.code, "SESSION_SUBJECT_MISMATCH");
    assert.equal((await probe(victim.accessToken)).status, 200, "la session d'autrui reste active");
  }
});

test("AUTH4-17 / 18 / 19 (mémoire) — logout et revoke-all : jetons et refresh refusés", async () => {
  const parent = await login("parent");
  assert.equal((await request("/auth/logout", { method: "POST", token: parent.accessToken })).status, 200);
  assert.equal((await probe(parent.accessToken)).status, 401);
  assert.equal((await request("/auth/refresh", { method: "POST", body: { refreshToken: parent.refreshToken } })).status, 401);

  const t1 = await login("teacher");
  const t2 = await login("teacherWeb");
  assert.equal((await request("/auth/revoke-all", { method: "POST", token: t1.accessToken })).status, 200);
  for (const session of [t1, t2]) {
    assert.equal((await probe(session.accessToken)).status, 401);
    assert.equal((await request("/auth/refresh", { method: "POST", body: { refreshToken: session.refreshToken } })).status, 401);
  }
});

test("AUTH4-23 (mémoire) — demande d'effacement : jeton non lié traité comme anonyme", async () => {
  const parent = await login("parent");
  const { sessionId: _drop, ...legacy } = claims(parent.accessToken);
  const sessionless = await request("/privacy/erasure-requests", {
    method: "POST",
    token: tokens.sign({ ...legacy }, 600),
    body: {},
  });
  assert.equal(sessionless.status, 400, "sans session : demande anonyme incomplète");
  const bound = await request("/privacy/erasure-requests", { method: "POST", token: parent.accessToken, body: {} });
  assert.equal(bound.status, 201, "jeton lié : demande attribuée");
});
