"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { TEST_CONFIRM } = require("./mobilePushDevicesService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PUSH_N1_IT_DATABASE ?? "somafrik_push_n1_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PUSH_N1_HTTP_PORT ?? 19891);
const EXPO_MOCK_PORT = Number(process.env.SOMAFRIK_PUSH_N1_EXPO_PORT ?? 19892);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const USER_A = "a9000000-0000-4000-8000-000000000001";
const USER_B = "a9000000-0000-4000-8000-000000000002";
const TOKEN_A = "ExponentPushToken[somafrik-user-a]";
const TOKEN_DUP = "ExponentPushToken[somafrik-shared-device]";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function request(pathname, { method = "GET", token, body, port = HTTP_PORT } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

async function waitForHealth(child, stderrRef, port = HTTP_PORT) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
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
}

function mintAccess(tokens, payload) {
  return tokens.createAccessToken({ mustChangePassword: false, ...payload });
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Push CI', 'CI', '+225', 'XOF') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'SCH-PUSH-A', 'École Push A', 'active')`,
    [country.rows[0].id],
  );
  const school = (await pool.query(`SELECT id FROM schools WHERE school_code = 'SCH-PUSH-A'`)).rows[0];
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $3, 'PUSH-A', 'User', 'A', 'push-a@test.local', 'Enseignant', 'active', FALSE),
       ($2, $3, 'PUSH-B', 'User', 'B', 'push-b@test.local', 'Enseignant', 'active', FALSE)`,
    [USER_A, USER_B, school.id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $3, 'TEACHER', 'active'), ($2, $3, 'TEACHER', 'active')`,
    [USER_A, USER_B, school.id],
  );
  return { schoolId: school.id };
}

function startExpoMock() {
  const state = { sends: [], receipts: [] };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      if (/getReceipts|\/receipts/i.test(String(req.url))) {
        state.receipts.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: {} }));
        return;
      }
      state.sends.push(body);
      const messages = Array.isArray(body) ? body : [];
      const tickets = messages.map((item) => {
        if (String(item.to).includes("dead")) {
          return { status: "error", details: { error: "DeviceNotRegistered" } };
        }
        return { status: "ok", id: randomUUID() };
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: tickets }));
    });
  });
  return new Promise((resolve) => {
    server.listen(EXPO_MOCK_PORT, "127.0.0.1", () => resolve({ server, state }));
  });
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour mobilePushDevices.http.pg.test.js");
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const mock = await startExpoMock();
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;
  const stderrRef = { value: "" };

  try {
    await repo.init();
    const fixtures = await seed(pool);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
        SOMAFRIK_PUSH_RELEASE_PROFILE: "preview",
        SOMAFRIK_PUSH_SELFTEST_RATE_MAX: "5",
        EXPO_PUSH_SEND_URL: `http://127.0.0.1:${EXPO_MOCK_PORT}/send`,
        EXPO_PUSH_RECEIPTS_URL: `http://127.0.0.1:${EXPO_MOCK_PORT}/getReceipts`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    const tokenA = mintAccess(tokens, {
      sub: USER_A,
      schoolCode: "SCH-PUSH-A",
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      permissions: [],
    });
    const tokenB = mintAccess(tokens, {
      sub: USER_B,
      schoolCode: "SCH-PUSH-A",
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      permissions: [],
    });

    const unauth = await request("/mobile/push-devices", {
      method: "POST",
      body: { expoPushToken: TOKEN_A, platform: "android", releaseProfile: "preview" },
    });
    assert.equal(unauth.status, 401, "authentification obligatoire");

    const unauthTest = await request("/mobile/push-devices/test", {
      method: "POST",
      body: { confirm: TEST_CONFIRM, releaseProfile: "preview" },
    });
    assert.equal(unauthTest.status, 401, "test push authentifié");

    const clientId = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: {
        expoPushToken: TOKEN_A,
        platform: "android",
        releaseProfile: "preview",
        userId: USER_B,
      },
    });
    assert.equal(clientId.status, 400, "userId client rejeté");

    const ios = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: TOKEN_A, platform: "ios", releaseProfile: "preview" },
    });
    assert.equal(ios.status, 400, "iOS hors N1");

    const forged = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: TOKEN_A, platform: "android", releaseProfile: "production" },
    });
    assert.equal(forged.status, 400, "releaseProfile client ne fait pas autorité");

    const created = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: TOKEN_A, platform: "android", releaseProfile: "preview" },
    });
    assert.equal(created.status, 200);
    assert.equal(created.data.platform, "android");
    assert.ok(!JSON.stringify(created.data).includes("ExponentPushToken"), "token absent de la réponse");

    const again = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: TOKEN_A, platform: "android", releaseProfile: "preview" },
    });
    assert.equal(again.status, 200);
    assert.equal(again.data.id, created.data.id, "upsert idempotent");

    const stored = await pool.query(`SELECT user_id, school_id, release_profile FROM mobile_push_devices WHERE id = $1`, [
      created.data.id,
    ]);
    assert.equal(String(stored.rows[0].user_id), USER_A);
    assert.equal(String(stored.rows[0].school_id), String(fixtures.schoolId));
    assert.equal(stored.rows[0].release_profile, "preview");

    await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: TOKEN_DUP, platform: "android", releaseProfile: "preview" },
    });
    const stolen = await request("/mobile/push-devices", {
      method: "POST",
      token: tokenB,
      body: { expoPushToken: TOKEN_DUP, platform: "android", releaseProfile: "preview" },
    });
    assert.equal(stolen.status, 200);
    const dup = await pool.query(`SELECT user_id FROM mobile_push_devices WHERE expo_push_token = $1`, [TOKEN_DUP]);
    assert.equal(String(dup.rows[0].user_id), USER_B, "token unique réassigné au compte courant");

    const crossRevoke = await request("/mobile/push-devices/current", {
      method: "DELETE",
      token: tokenB,
      body: { expoPushToken: TOKEN_A },
    });
    assert.equal(crossRevoke.status, 403, "impossible de révoquer le jeton d'un autre compte");

    const isolation = await request("/mobile/push-devices/test", {
      method: "POST",
      token: tokenA,
      body: { confirm: TEST_CONFIRM, releaseProfile: "production" },
    });
    assert.equal(isolation.status, 400, "releaseProfile client rejeté sur le self-test");

    const activeA = await pool.query(
      `SELECT expo_push_token, user_id, release_profile, revoked_at FROM mobile_push_devices WHERE user_id = $1 ORDER BY created_at`,
      [USER_A],
    );
    assert.deepEqual(
      activeA.rows.filter((row) => !row.revoked_at).map((row) => row.expo_push_token),
      [TOKEN_A],
      JSON.stringify(activeA.rows),
    );

    const testSend = await request("/mobile/push-devices/test", {
      method: "POST",
      token: tokenA,
      body: { confirm: TEST_CONFIRM, releaseProfile: "preview" },
    });
    assert.equal(testSend.status, 200, JSON.stringify(testSend.data));
    assert.equal(testSend.data.sent, 1, JSON.stringify({ data: testSend.data, expo: mock.state.sends }));
    assert.equal(mock.state.sends.length, 1);
    assert.equal(mock.state.sends[0][0].title, "Test Somafrik");
    assert.equal(mock.state.sends[0][0].body, "Les notifications push Somafrik fonctionnent correctement.");
    assert.equal(mock.state.sends[0][0].data.somafrikDestination, "Home");
    assert.ok(!JSON.stringify(mock.state.sends[0]).includes("montant"));
    assert.ok(!JSON.stringify(mock.state.sends[0]).includes("note"));
    assert.ok(!JSON.stringify(mock.state.sends[0]).includes("jwt"));
    assert.equal(mock.state.receipts.length, 0, "aucun getReceipts immédiat");
    const pendingReceipts = await pool.query(
      `SELECT receipt_id, status FROM mobile_push_receipts WHERE status = 'pending'`,
    );
    assert.ok(pendingReceipts.rowCount >= 1, "ticket OK persiste receipt ID");

    const deadToken = "ExponentPushToken[dead-device]";
    await request("/mobile/push-devices", {
      method: "POST",
      token: tokenA,
      body: { expoPushToken: deadToken, platform: "android", releaseProfile: "preview" },
    });
    const deadSend = await request("/mobile/push-devices/test", {
      method: "POST",
      token: tokenA,
      body: { confirm: TEST_CONFIRM, releaseProfile: "preview" },
    });
    assert.equal(deadSend.status, 200);
    assert.ok(deadSend.data.revoked.length >= 1, "DeviceNotRegistered révoque");
    const deadRow = await pool.query(`SELECT revoked_at FROM mobile_push_devices WHERE expo_push_token = $1`, [deadToken]);
    assert.ok(deadRow.rows[0].revoked_at, "token mort révoqué");

    const revoked = await request("/mobile/push-devices/current", {
      method: "DELETE",
      token: tokenA,
      body: { expoPushToken: TOKEN_A },
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.data.revoked, true);

    const rawTarget = await request("/mobile/push-devices/test", {
      method: "POST",
      token: tokenA,
      body: { confirm: TEST_CONFIRM, releaseProfile: "preview", expoPushToken: TOKEN_DUP },
    });
    assert.equal(rawTarget.status, 400, "pas de ciblage par raw token client");

    let saw429 = false;
    for (let i = 0; i < 12; i += 1) {
      const hit = await request("/mobile/push-devices/test", {
        method: "POST",
        token: tokenA,
        body: { confirm: TEST_CONFIRM },
      });
      if (hit.status === 429) {
        saw429 = true;
        const sendsAtLimit = mock.state.sends.length;
        const again = await request("/mobile/push-devices/test", {
          method: "POST",
          token: tokenA,
          body: { confirm: TEST_CONFIRM },
        });
        assert.equal(again.status, 429);
        assert.equal(mock.state.sends.length, sendsAtLimit, "rate limit : aucun appel Expo");
        break;
      }
    }
    assert.equal(saw429, true, "rate limit bloque l'abus");

    async function assertSelfTestForbidden(profile) {
      const forbiddenPort = HTTP_PORT + (profile === "production" ? 2 : 3);
      const forbiddenChild = spawn(process.execPath, ["backend/server.js"], {
        cwd: ROOT,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: String(forbiddenPort),
          DATABASE_URL: isolatedUrl,
          JWT_SECRET,
          SOMAFRIK_DB_REQUIRED: "true",
          SOMAFRIK_SKIP_DEMO_SEED: "true",
          SOMAFRIK_API_ONLY: "true",
          SOMAFRIK_PUSH_RELEASE_PROFILE: profile,
          EXPO_PUSH_SEND_URL: `http://127.0.0.1:${EXPO_MOCK_PORT}/send`,
          EXPO_PUSH_RECEIPTS_URL: `http://127.0.0.1:${EXPO_MOCK_PORT}/getReceipts`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const forbiddenErr = { value: "" };
      forbiddenChild.stderr.on("data", (chunk) => {
        forbiddenErr.value += String(chunk);
      });
      forbiddenChild.stdout.on("data", () => {});
      try {
        await waitForHealth(forbiddenChild, forbiddenErr, forbiddenPort);
        const expoBefore = mock.state.sends.length;
        const blocked = await request("/mobile/push-devices/test", {
          method: "POST",
          token: tokenA,
          body: { confirm: TEST_CONFIRM },
          port: forbiddenPort,
        });
        assert.equal(blocked.status, 403, `${profile} interdit le self-test`);
        assert.equal(mock.state.sends.length, expoBefore, `${profile} : aucun appel Expo`);
      } finally {
        await stopChild(forbiddenChild);
      }
    }

    await assertSelfTestForbidden("production");
    await assertSelfTestForbidden("preproduction");

    console.log("mobilePushDevices.http.pg.test.js GO — PUSH-N1");
  } catch (error) {
    console.error(stderrRef?.value || "");
    throw error;
  } finally {
    await stopChild(child);
    mock.server.close();
    await pool.end();
    await repo.close?.();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
