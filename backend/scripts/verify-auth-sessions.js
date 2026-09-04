"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19771;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("health timeout");
}

async function login() {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.data.refreshToken);
  assert.ok(result.data.expiresIn <= 900, `expiresIn trop long: ${result.data.expiresIn}`);
  return result.data;
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      JWT_ACCESS_TTL_SECONDS: "900",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const session = await login();
    const refreshed = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
    assert.ok(refreshed.data.accessToken);
    assert.ok(refreshed.data.refreshToken);
    assert.notEqual(refreshed.data.refreshToken, session.refreshToken, "refresh doit tourner");

    const reuse = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    // Fenêtre de grâce 15s : 401 reuse seulement hors grâce. On force un 2e refresh du nouveau jeton.
    const second = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: refreshed.data.refreshToken },
    });
    assert.equal(second.status, 200, JSON.stringify(second.data));

    const logout = await request("/auth/logout", {
      method: "POST",
      token: second.data.accessToken,
    });
    assert.equal(logout.status, 200, JSON.stringify(logout.data));
    const afterLogout = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: second.data.refreshToken },
    });
    assert.equal(afterLogout.status, 401, JSON.stringify(afterLogout.data));

    const again = await login();
    const revokeAll = await request("/auth/revoke-all", { method: "POST", token: again.accessToken });
    assert.equal(revokeAll.status, 200, JSON.stringify(revokeAll.data));
    const afterRevoke = await request("/classes", { token: again.accessToken });
    assert.equal(afterRevoke.status, 401, JSON.stringify(afterRevoke.data));

    const expired = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: "not-a-jwt" },
    });
    assert.equal(expired.status, 401, JSON.stringify(expired.data));
    if (reuse.status === 401) {
      assert.ok(["REFRESH_REUSE_DETECTED", "SESSION_REVOKED"].includes(reuse.data?.code));
    }

    console.log("verify-auth-sessions: OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
