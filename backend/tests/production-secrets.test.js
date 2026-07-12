const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  collectProductionSecretViolations,
  assertProductionSecrets,
  resolvePostgresPassword,
  EXAMPLE_JWT_SECRET,
  MIN_JWT_SECRET_LENGTH,
} = require("../lib/productionSecrets");

const STRONG_JWT_SECRET = "a".repeat(MIN_JWT_SECRET_LENGTH);

describe("productionSecrets", () => {
  it("ignore les contrôles hors production", () => {
    assert.deepEqual(
      collectProductionSecretViolations({
        NODE_ENV: "development",
        POSTGRES_PASSWORD: "change-me",
        JWT_SECRET: EXAMPLE_JWT_SECRET,
      }),
      []
    );
  });

  it("rejette le mot de passe PostgreSQL d'exemple", () => {
    const violations = collectProductionSecretViolations({
      NODE_ENV: "production",
      POSTGRES_PASSWORD: "change-me",
      JWT_SECRET: STRONG_JWT_SECRET,
    });

    assert.ok(violations.some((message) => message.includes("change-me")));
  });

  it("détecte le mot de passe d'exemple via DATABASE_URL", () => {
    const violations = collectProductionSecretViolations({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://somafrik:change-me@postgres:5432/somafrik",
      JWT_SECRET: STRONG_JWT_SECRET,
    });

    assert.ok(violations.some((message) => message.includes("change-me")));
  });

  it("rejette un JWT manquant, d'exemple ou trop court", () => {
    assert.ok(
      collectProductionSecretViolations({
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "secure-db-password",
      }).some((message) => message.includes("JWT_SECRET est obligatoire"))
    );

    assert.ok(
      collectProductionSecretViolations({
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "secure-db-password",
        JWT_SECRET: EXAMPLE_JWT_SECRET,
      }).some((message) => message.includes("valeur d'exemple"))
    );

    assert.ok(
      collectProductionSecretViolations({
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "secure-db-password",
        JWT_SECRET: "too-short",
      }).some((message) => message.includes("trop court"))
    );
  });

  it("accepte une configuration production sécurisée", () => {
    assert.deepEqual(
      collectProductionSecretViolations({
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "secure-db-password",
        JWT_SECRET: STRONG_JWT_SECRET,
        SOMAFRIK_SKIP_DEMO_SEED: "true",
      }),
      []
    );
  });

  it("rejette l'absence de SOMAFRIK_SKIP_DEMO_SEED=true en production", () => {
    const violations = collectProductionSecretViolations({
      NODE_ENV: "production",
      POSTGRES_PASSWORD: "secure-db-password",
      JWT_SECRET: STRONG_JWT_SECRET,
      SOMAFRIK_SKIP_DEMO_SEED: "false",
    });

    assert.ok(violations.some((message) => message.includes("SOMAFRIK_SKIP_DEMO_SEED=true")));
  });

  it("lève une erreur explicite au démarrage", () => {
    assert.throws(
      () =>
        assertProductionSecrets({
          NODE_ENV: "production",
          POSTGRES_PASSWORD: "change-me",
          JWT_SECRET: EXAMPLE_JWT_SECRET,
        }),
      /Configuration de production non sécurisée/
    );
  });

  it("résout le mot de passe PostgreSQL depuis DATABASE_URL", () => {
    assert.equal(
      resolvePostgresPassword({
        DATABASE_URL: "postgresql://somafrik:from-url@localhost:5432/somafrik",
      }),
      "from-url"
    );
  });
});
