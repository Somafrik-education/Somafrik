"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashSecret, verifySecret } = require("../services/credentialService");
const {
  isPlatformSuperadminAccount,
  isForbiddenSuperadminSecret,
  rejectsKnownSuperadminSecret,
  assertAcceptableSuperadminPassword,
  resolveNonProductionSuperadminPassword,
  superadminLoginPassword,
  collectProductionSuperadminSecretViolations,
  assertProductionSuperadminSecret,
  applySuperadminSeedSecrets,
  hashSeedUserSecrets,
  nonProductionFallbackPassword,
} = require("./superadminSeedSecret");

const ROOT = path.resolve(__dirname, "../..");

test("isPlatformSuperadminAccount couvre le contrat SUPER_ADMIN", () => {
  assert.equal(isPlatformSuperadminAccount({ role: "Super Administrateur Somafrik" }), true);
  assert.equal(isPlatformSuperadminAccount({ role: "Super Administrateur OKAFRIK" }), true);
  assert.equal(isPlatformSuperadminAccount({ role: "SUPER_ADMIN" }), true);
  assert.equal(isPlatformSuperadminAccount({ roleKeys: ["SUPER_ADMIN"] }), true);
  assert.equal(isPlatformSuperadminAccount({ identifier: "superadmin" }), true);
  assert.equal(isPlatformSuperadminAccount({ identifier: "superadmin-02" }), true);
  assert.equal(isPlatformSuperadminAccount({ email: "superadmin@somafrik.app" }), true);
  assert.equal(isPlatformSuperadminAccount({}, { role: "super_admin" }), true);
  assert.equal(isPlatformSuperadminAccount({ role: "Admin School", identifier: "admin" }), false);
  assert.equal(isPlatformSuperadminAccount({ identifier: "admin-rdc" }), false);
});

test("1234 et placeholders restent des secrets Superadmin interdits", () => {
  assert.equal(isForbiddenSuperadminSecret("1234"), true);
  assert.equal(isForbiddenSuperadminSecret("change-me-now"), true);
  assert.equal(isForbiddenSuperadminSecret("GENERER-MOT-DE-PASSE-FORT-ICI"), true);
  assert.equal(isForbiddenSuperadminSecret(nonProductionFallbackPassword()), false);
  assert.equal(rejectsKnownSuperadminSecret("1234", { NODE_ENV: "development" }), true);
  assert.equal(
    rejectsKnownSuperadminSecret(nonProductionFallbackPassword(), { NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    rejectsKnownSuperadminSecret(nonProductionFallbackPassword(), { NODE_ENV: "development" }),
    false,
  );
});

test("le fallback non-prod n'est jamais résolu en production", () => {
  assert.throws(
    () => resolveNonProductionSuperadminPassword({ NODE_ENV: "production" }),
    /pas résolu en production/,
  );
  const resolved = resolveNonProductionSuperadminPassword({ NODE_ENV: "test" });
  assert.equal(resolved, nonProductionFallbackPassword());
  assert.notEqual(resolved, "1234");
  assert.ok(resolved.length >= 12);
  assert.equal(
    resolveNonProductionSuperadminPassword({
      NODE_ENV: "test",
      SOMAFRIK_SUPERADMIN_PASSWORD: "Local.Superadmin.Ok12",
    }),
    "Local.Superadmin.Ok12",
  );
});

test("production refuse un bootstrap Superadmin 1234 même si SKIP_DEMO_SEED=true", () => {
  const violations = collectProductionSuperadminSecretViolations({
    NODE_ENV: "production",
    SOMAFRIK_SKIP_DEMO_SEED: "true",
    BOOTSTRAP_SUPERADMIN_PASSWORD: "1234",
  });
  assert.ok(violations.some((item) => /interdit/i.test(item)));
  assert.throws(
    () =>
      assertProductionSuperadminSecret({
        NODE_ENV: "production",
        BOOTSTRAP_SUPERADMIN_PASSWORD: nonProductionFallbackPassword(),
      }),
    /interdit/,
  );
  assert.deepEqual(
    collectProductionSuperadminSecretViolations({
      NODE_ENV: "production",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
    }),
    [],
  );
});

test("hash Superadmin n'utilise jamais le pin fallback 1234", () => {
  const hashed = hashSeedUserSecrets({
    role: "Super Administrateur Somafrik",
    identifier: "superadmin",
    password: "",
    temporaryPassword: "",
  });
  assert.equal(verifySecret("1234", hashed.passwordHash), false);
  assert.equal(verifySecret("1234", hashed.pinHash), false);
  assert.equal(verifySecret(superadminLoginPassword(), hashed.passwordHash), true);
  assert.equal(verifySecret(superadminLoginPassword(), hashed.pinHash), true);
});

test("un hash 1234 Superadmin ne passe pas rejectsKnownSuperadminSecret", () => {
  const hashed = hashSecret("1234");
  assert.equal(verifySecret("1234", hashed), true);
  assert.equal(rejectsKnownSuperadminSecret("1234"), true);
  assert.doesNotThrow(() => assertAcceptableSuperadminPassword(superadminLoginPassword(), { env: { NODE_ENV: "test" } }));
});

test("applySuperadminSeedSecrets n'écrit pas 1234", () => {
  const seed = {
    userAccounts: [
      { id: "USER-SUPERADMIN", identifier: "superadmin", role: "Super Administrateur Somafrik", password: "", pin: "" },
      { id: "USER-ADMIN", identifier: "admin", role: "Admin School", password: "1234" },
    ],
  };
  applySuperadminSeedSecrets(seed, { NODE_ENV: "test" });
  assert.equal(seed.userAccounts[0].password, superadminLoginPassword());
  assert.notEqual(seed.userAccounts[0].password, "1234");
  assert.equal(seed.userAccounts[1].password, "1234");
});

test("garde source : aucun secret Superadmin/1234 versionné dans le seed produit", () => {
  const files = [
    "backend/data.js",
    "backend/lib/bulkPlatformSeed.js",
    "web/src/lib/demoAccounts.ts",
    "Mobile/src/data/catalog.ts",
  ];
  const nearby1234 = [
    /identifier:\s*["']superadmin["'][\s\S]{0,500}password:\s*["']1234["']/,
    /password:\s*["']1234["'][\s\S]{0,500}identifier:\s*["']superadmin["']/,
    /identifier:\s*["']superadmin["'][\s\S]{0,500}password:\s*DEMO_PASSWORD/,
    /id:\s*["']USER-SUPERADMIN["'][\s\S]{0,800}["']1234["']/,
  ];
  for (const relative of files) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const pattern of nearby1234) {
      assert.equal(pattern.test(source), false, `${relative} réintroduit Superadmin/1234 (${pattern})`);
    }
  }

  const dataJs = fs.readFileSync(path.join(ROOT, "backend/data.js"), "utf8");
  const superadminBlock = dataJs.match(/id: "USER-SUPERADMIN"[\s\S]*?history:/);
  assert.ok(superadminBlock, "bloc USER-SUPERADMIN introuvable");
  assert.equal(/1234/.test(superadminBlock[0]), false, "USER-SUPERADMIN versionne encore 1234");

  const demoAccounts = fs.readFileSync(path.join(ROOT, "web/src/lib/demoAccounts.ts"), "utf8");
  assert.equal(/profile:\s*"superadmin"/.test(demoAccounts), false, "le picker démo web ne doit plus coller Superadmin/1234");

  const postgresSource = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  assert.match(postgresSource, /hashSeedUserSecrets/, "le seed PG Superadmin doit hasher via hashSeedUserSecrets");
});
