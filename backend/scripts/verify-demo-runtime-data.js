const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const path = require("node:path");
const {
  createDemoGatewayApp,
} = require("../demoGateway");

function deriveCiJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) {
    return process.env.JWT_SECRET;
  }
  return crypto
    .createHash("sha256")
    .update(`demo-runtime:${process.env.GITHUB_SHA || process.pid}:${Date.now()}`)
    .digest("hex");
}

async function waitFor(url, { attempts = 80, delayMs = 250 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError || new Error(`Service indisponible: ${url}`);
}

function arrayCount(payload, candidateKeys = []) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return -1;
  for (const key of candidateKeys) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  return -1;
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  return { response, payload };
}

async function main() {
  const innerPort = Number(process.env.DEMO_INNER_PORT || 5101);
  const publicPort = Number(process.env.PORT || 5100);
  const demoFrontendOrigin = String(process.env.DEMO_FRONTEND_ORIGIN || "https://demo.somafrik.app");
  const demoEntryOrigin = String(process.env.DEMO_ENTRY_ORIGIN || "https://somafrik.app");

  assert.ok(process.env.DATABASE_URL, "DATABASE_URL requis");
  assert.ok(process.env.DEMO_INTERNAL_SEED_PIN, "DEMO_INTERNAL_SEED_PIN requis");
  assert.ok(process.env.DEMO_IDENTIFIER, "DEMO_IDENTIFIER requis");

  const runtimeEnv = {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "demo",
    SOMAFRIK_ENV: "demo",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    JWT_SECRET: deriveCiJwtSecret(),
    PORT: String(innerPort),
    SOMAFRIK_API_ONLY: "true",
  };

  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: runtimeEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    process.stderr.write(chunk);
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));

  const gatewayEnv = {
    ...process.env,
    NODE_ENV: "production",
    APP_ENV: "demo",
    SOMAFRIK_ENV: "demo",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    JWT_SECRET: runtimeEnv.JWT_SECRET,
    PORT: String(publicPort),
    DEMO_INNER_PORT: String(innerPort),
  };

  let gatewayServer = null;
  try {
    await waitFor(`http://127.0.0.1:${innerPort}/api/health`);

    const gatewayApp = createDemoGatewayApp({ env: gatewayEnv });
    gatewayServer = gatewayApp.listen(publicPort, "127.0.0.1");
    await once(gatewayServer, "listening");

    const gatewayBase = `http://127.0.0.1:${publicPort}`;
    const create = await fetchJson(`${gatewayBase}/api/public/demo-sessions`, {
      method: "POST",
      headers: {
        Origin: demoEntryOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: "direction",
        discoveryRole: "decider",
        countryIso: "CD",
        organizationName: "CI Somafrik Démo",
      }),
    });
    assert.equal(create.response.status, 201, `ticket create failed: ${JSON.stringify(create.payload)}`);
    const redirect = new URL(create.payload.redirectUrl);
    const code = redirect.searchParams.get("code");
    assert.ok(code, "ticket code absent");

    const exchange = await fetchJson(`${gatewayBase}/api/demo/exchange`, {
      method: "POST",
      headers: {
        Origin: demoFrontendOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    assert.equal(exchange.response.status, 200, `ticket exchange failed: ${JSON.stringify(exchange.payload)}`);
    const token = exchange.payload?.accessToken;
    assert.ok(token, "accessToken absent après exchange");
    assert.equal(exchange.payload?.refreshToken, undefined, "refresh token ne doit pas sortir de la passerelle");
    assert.ok(exchange.payload?.user?.schoolCode, "schoolCode session absent");

    const authHeaders = {
      Origin: demoFrontendOrigin,
      Authorization: `Bearer ${token}`,
    };

    const permissions = await fetchJson(`${gatewayBase}/api/auth/effective-permissions`, {
      headers: authHeaders,
    });
    assert.equal(
      permissions.response.status,
      200,
      `effective-permissions failed: ${JSON.stringify(permissions.payload)}`,
    );
    assert.ok(
      Array.isArray(permissions.payload?.permissions) && permissions.payload.permissions.length > 0,
      `permissions effectives vides: ${JSON.stringify(permissions.payload)}`,
    );

    const probes = [
      ["classes", "/api/classes", []],
      ["students", "/api/students", ["students"]],
      ["teachers", "/api/teachers", ["teachers"]],
      ["payments", "/api/payments", ["payments"]],
    ];

    const counts = {};
    for (const [label, endpoint, keys] of probes) {
      const result = await fetchJson(`${gatewayBase}${endpoint}`, { headers: authHeaders });
      assert.equal(
        result.response.status,
        200,
        `${label} failed (${result.response.status}): ${JSON.stringify(result.payload)}`,
      );
      const count = arrayCount(result.payload, keys);
      assert.ok(count > 0, `${label} vide ou payload inattendu: ${JSON.stringify(result.payload)}`);
      counts[label] = count;
    }

    console.log(
      `verify-demo-runtime-data: OK ${JSON.stringify({
        schoolCode: exchange.payload.user.schoolCode,
        permissions: permissions.payload.permissions.length,
        ...counts,
      })}`,
    );
  } finally {
    if (gatewayServer) {
      await new Promise((resolve) => gatewayServer.close(resolve));
    }
    if (!child.killed) child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit").catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (!child.killed) child.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
