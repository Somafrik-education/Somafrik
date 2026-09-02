"use strict";

/**
 * LOT 6 — parcours Plateforme HTTP (mémoire) : RBAC, isolation, legacy PUT refusé.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "../..");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");
const PORT = 19683;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body, headers } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  let token = result.data.accessToken || result.data.token;
  if (
    (result.data?.user?.mustChangePassword || result.data?.mustChangePassword) &&
    String(password).length >= 8
  ) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    token = changed.data.accessToken || changed.data.token || token;
  }
  return token;
}

async function createUniqueCountry(token) {
  const reserved = new Set(["CD", "CG", "BI"]);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 676; attempt += 1) {
    const index = (Date.now() + attempt) % (26 * 26);
    const code = alphabet[Math.floor(index / 26)] + alphabet[index % 26];
    if (reserved.has(code)) continue;
    const created = await request("/backoffice/countries", {
      method: "POST",
      token,
      body: {
        name: `Pays test ${code}`,
        code,
        phonePrefix: "+000",
        currency: "USD",
      },
    });
    if (created.status === 201) return created;
    if (created.status === 409) {
      reserved.add(code);
      continue;
    }
    assert.fail(`country create unexpected ${created.status}: ${JSON.stringify(created.data)}`);
  }
  assert.fail("unable to create unique country code");
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const superToken = await login("superadmin", "1234");

    const legacyMixed = await request("/backoffice/state", {
      method: "PUT",
      token: superToken,
      body: { countries: [], users: [] },
    });
    assertBackOfficeStateWriteRemoved(legacyMixed);
const subscription = await request("/backoffice/subscriptions", {
      method: "POST",
      token: superToken,
      body: { schoolCode: "CD-2026-0001", plan: "Premium", monthlyPrice: 12, currency: "CDF" },
    });
    assert.equal(subscription.status, 201, JSON.stringify(subscription.data));

    const countryAdminToken = await login("admin-rdc", "1234");
    const inCountryScope = await request("/backoffice/subscriptions", {
      method: "POST",
      token: countryAdminToken,
      body: { schoolCode: "CD-2026-0001", plan: "Standard", monthlyPrice: 8, currency: "CDF" },
    });
    assert.equal(inCountryScope.status, 201, JSON.stringify(inCountryScope.data));

    const crossCountry = await request("/backoffice/subscriptions", {
      method: "POST",
      token: countryAdminToken,
      body: { schoolCode: "BI-2026-0002", plan: "Premium", monthlyPrice: 12, currency: "CDF" },
    });
    assert.equal(crossCountry.status, 403, JSON.stringify(crossCountry.data));

    const created = await createUniqueCountry(superToken);
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const legacyPut = await request("/backoffice/role-permissions", {
      method: "PUT",
      token: superToken,
      body: { "Admin School": ["Voir tableau de bord"] },
    });
    assert.equal(legacyPut.status, 403, JSON.stringify(legacyPut.data));
    assert.equal(legacyPut.data?.code, "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN");
    const roleMap = await request("/backoffice/role-permissions", { token: superToken });
    assert.equal(roleMap.status, 200);

    const access = await request("/backoffice/subscription-access?schoolCode=CD-2026-0001", {
      token: countryAdminToken,
    });
    assert.equal(access.status, 200);

    const crossCountryAccess = await request("/backoffice/subscription-access?schoolCode=BI-2026-0002", {
      token: countryAdminToken,
    });
    assert.equal(crossCountryAccess.status, 403, JSON.stringify(crossCountryAccess.data));

    const payment = await request("/backoffice/subscription-payments", {
      method: "POST",
      token: superToken,
      body: {
        schoolCode: "CD-2026-0001",
        amount: 42,
        currency: "CDF",
        reference: "PAY-VERIFY-1",
      },
    });
    assert.equal(payment.status, 201, JSON.stringify(payment.data));
    assert.equal(payment.data.schoolCode, "CD-2026-0001");

    const countryNotice = await request("/backoffice/notifications", {
      method: "POST",
      token: countryAdminToken,
      body: { title: "Alerte CD", message: "National", type: "Information" },
    });
    assert.equal(countryNotice.status, 201, JSON.stringify(countryNotice.data));
    assert.equal(countryNotice.data.countryCode, "CD");

    const archiveNotice = await request(
      `/backoffice/notifications/${encodeURIComponent(countryNotice.data.id)}`,
      {
        method: "PATCH",
        token: countryAdminToken,
        body: { archived: true },
      },
    );
    assert.equal(archiveNotice.status, 200, JSON.stringify(archiveNotice.data));
    assert.equal(archiveNotice.data.archived, true);

    const countries = await request("/backoffice/countries", { token: superToken });
    assert.equal(countries.status, 200);
    assert.ok(Array.isArray(countries.data));
    assert.ok(countries.data.some((row) => row.code === "CD"));

    const deniedAccess = await request("/backoffice/subscription-access?schoolCode=CD-2026-0001");
    assert.equal(deniedAccess.status, 401);

    const deniedUsersPut = await request("/backoffice/state", {
      method: "PUT",
      token: superToken,
      body: { users: [] },
    });
    assertBackOfficeStateWriteRemoved(deniedUsersPut);
console.log("verify-platform-management.js OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
