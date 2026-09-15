const assert = require("node:assert/strict");
const { once } = require("node:events");
const {
  collectProductionCorsViolations,
  resolveAllowedOrigins,
} = require("../lib/corsConfig");
const {
  assertDemoRuntimeEnvironment,
  buildDemoRedirectUrl,
  createDemoTicketStore,
  isBlockedDemoGatewayPath,
  resolveDemoInternalSeedPin,
  validateDemoQualification,
} = require("../lib/demoGatewayPolicy");
const {
  assertDemoResetSafety,
  hardenBackOfficeCredentials,
  scrubCredentialFields,
} = require("../lib/demoResetSafety");
const { createDemoGatewayApp } = require("../demoGateway");

const env = {
  NODE_ENV: "production",
  APP_ENV: "demo",
  SOMAFRIK_ENV: "demo",
  SOMAFRIK_SKIP_DEMO_SEED: "true",
  PORT: "5100",
  DEMO_INNER_PORT: "5101",
  DEMO_FRONTEND_ORIGIN: "https://demo.somafrik.app",
  DEMO_ENTRY_ORIGIN: "https://somafrik.app",
  DEMO_ENTRY_RATE_LIMIT_MAX: "100",
  DEMO_INTERNAL_SEED_PIN: "ci-demo-internal-credential-7F32",
};

async function verifyHttpGateway() {
  const proxied = [];
  const app = createDemoGatewayApp({
    env,
    loginToInner: async () => ({
      accessToken: "demo-access-token",
      refreshToken: "demo-refresh-token",
      tokenType: "Bearer",
      expiresIn: 900,
      user: { id: "USR-DEMO", role: "Admin School" },
      role: "school_admin",
    }),
    proxyRequest: (req, res) => {
      proxied.push(req.originalUrl || req.url);
      res.status(200).json({ proxied: true });
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const createResponse = await fetch(`${base}/api/public/demo-sessions`, {
      method: "POST",
      headers: {
        Origin: "https://somafrik.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: "direction",
        discoveryRole: "decider",
        countryIso: "CD",
        organizationName: "École fictive",
      }),
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(createResponse.headers.get("access-control-allow-origin"), "https://somafrik.app");
    const created = await createResponse.json();
    const redirect = new URL(created.redirectUrl);
    assert.equal(redirect.origin, "https://demo.somafrik.app");
    assert.equal(redirect.pathname, "/entry");
    const code = redirect.searchParams.get("code");
    assert.ok(code && code.length >= 20);

    const exchangeResponse = await fetch(`${base}/api/demo/exchange`, {
      method: "POST",
      headers: {
        Origin: "https://demo.somafrik.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    assert.equal(exchangeResponse.status, 200);
    const exchanged = await exchangeResponse.json();
    assert.equal(exchanged.demo, true);
    assert.equal(exchanged.accessToken, "demo-access-token");
    assert.equal(exchanged.refreshToken, undefined, "refresh token must never cross the demo gateway");
    assert.ok(exchanged.expiresIn <= 900);
    assert.match(exchanged.demoSession.id, /^DEMO-[A-F0-9]+$/);

    const replayResponse = await fetch(`${base}/api/demo/exchange`, {
      method: "POST",
      headers: {
        Origin: "https://demo.somafrik.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    assert.equal(replayResponse.status, 410);

    const foreignOrigin = await fetch(`${base}/api/public/demo-sessions`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: "direction",
        discoveryRole: "decider",
        countryIso: "CD",
      }),
    });
    assert.equal(foreignOrigin.status, 403);

    const proxyResponse = await fetch(`${base}/api/classes`, {
      headers: { Origin: "https://demo.somafrik.app" },
    });
    assert.equal(proxyResponse.status, 200);
    assert.deepEqual(proxied, ["/api/classes"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  assert.deepEqual(collectProductionCorsViolations(env), []);
  assert.deepEqual(resolveAllowedOrigins(env), [
    "https://demo.somafrik.app",
    "https://somafrik.app",
  ]);
  const invalidDemoOrigin = collectProductionCorsViolations({
    ...env,
    DEMO_FRONTEND_ORIGIN: "https://somafrik.app",
  });
  assert.ok(
    invalidDemoOrigin.some((message) => message.includes("distinct de PROD/PREPROD")),
    `expected demo origin isolation violation, got ${JSON.stringify(invalidDemoOrigin)}`,
  );

  assert.deepEqual(assertDemoRuntimeEnvironment(env), { publicPort: 5100, innerPort: 5101 });
  assert.equal(resolveDemoInternalSeedPin(env), "ci-demo-internal-credential-7F32");
  assert.throws(
    () => assertDemoRuntimeEnvironment({ ...env, APP_ENV: "production" }),
    /APP_ENV=demo requis/,
  );
  assert.throws(
    () => assertDemoRuntimeEnvironment({ ...env, DEMO_INNER_PORT: "5100" }),
    /doivent être distincts/,
  );
  assert.throws(
    () => assertDemoRuntimeEnvironment({ ...env, DEMO_INTERNAL_SEED_PIN: "1234" }),
    /au moins 16 caractères|trop faible/,
  );
  assert.throws(
    () => assertDemoRuntimeEnvironment({ ...env, DEMO_INTERNAL_SEED_PIN: "" }),
    /au moins 16 caractères/,
  );

  const qualification = validateDemoQualification({
    profile: "enseignant",
    discoveryRole: "utilisateur",
    countryIso: "cd",
    organizationName: " Lycée fictif ",
  });
  assert.equal(qualification.countryIso, "CD");
  assert.equal(qualification.organizationName, "Lycée fictif");
  assert.throws(
    () => validateDemoQualification({ profile: "root", discoveryRole: "decider", countryIso: "CD" }),
    /Profil de démonstration invalide/,
  );

  let now = 1000;
  const store = createDemoTicketStore({ ttlMs: 100, now: () => now });
  const first = store.issue({ profile: "direction" });
  assert.equal(store.size(), 1);
  assert.equal(store.consume(first.code).metadata.profile, "direction");
  assert.equal(store.consume(first.code), null, "ticket must be one-shot");
  const second = store.issue({});
  now = 1200;
  assert.equal(store.consume(second.code), null, "expired ticket must fail closed");

  assert.equal(
    buildDemoRedirectUrl("https://demo.somafrik.app", "opaque"),
    "https://demo.somafrik.app/entry?code=opaque",
  );
  assert.equal(isBlockedDemoGatewayPath("/api/login"), true);
  assert.equal(isBlockedDemoGatewayPath("/api/backoffice/login"), true);
  assert.equal(isBlockedDemoGatewayPath("/api/auth/refresh"), true);
  assert.equal(isBlockedDemoGatewayPath("/api/debug/trace"), true);
  assert.equal(isBlockedDemoGatewayPath("/api/classes"), false);

  const scrubbed = scrubCredentialFields({
    users: [{ identifier: "admin", password: "1234", pinHash: "secret", nested: { temporaryPassword: "x" } }],
  });
  assert.deepEqual(scrubbed, { users: [{ identifier: "admin", nested: {} }] });

  const hardened = hardenBackOfficeCredentials(
    {
      users: [{ identifier: "admin", password: "1234", temporaryPassword: "1234" }],
      nested: { pin: "1234", safe: true },
    },
    "scrypt$demo-hash",
  );
  assert.equal(hardened.users[0].password, undefined);
  assert.equal(hardened.users[0].temporaryPassword, undefined);
  assert.equal(hardened.users[0].passwordHash, "scrypt$demo-hash");
  assert.equal(hardened.users[0].pinHash, "scrypt$demo-hash");
  assert.deepEqual(hardened.nested, { safe: true });

  const resetEnv = {
    APP_ENV: "demo",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    SOMAFRIK_DEMO_RESET_CONFIRM: "RESET_DEMO_DATA",
    DATABASE_URL: "postgresql://demo:demo@localhost:5432/somafrik_demo",
    SOMAFRIK_DEMO_DATABASE_URL_MARKER: "somafrik_demo",
    DEMO_INTERNAL_SEED_PIN: "ci-demo-internal-credential-7F32",
  };
  assert.equal(assertDemoResetSafety(resetEnv).marker, "somafrik_demo");
  assert.throws(
    () => assertDemoResetSafety({ ...resetEnv, APP_ENV: "preproduction" }),
    /APP_ENV=demo requis/,
  );
  assert.throws(
    () => assertDemoResetSafety({ ...resetEnv, DATABASE_URL: "postgresql://x:y@localhost:5432/somafrik" }),
    /ne contient pas le marqueur/,
  );

  await verifyHttpGateway();
  console.log("verify-demo-entry-api: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
