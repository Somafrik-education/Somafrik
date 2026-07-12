const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldAllowDevOrigins,
  resolveAllowedOrigins,
  collectProductionCorsViolations,
  assertProductionCors,
  buildCorsOptions,
  isLocalOrPrivateOrigin,
} = require("../lib/corsConfig");

class BusinessError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

describe("corsConfig", () => {
  it("autorise les origines de dev hors production", () => {
    assert.equal(shouldAllowDevOrigins({ NODE_ENV: "development" }), true);
    assert.equal(shouldAllowDevOrigins({ NODE_ENV: "test" }), true);
  });

  it("refuse les origines de dev automatiques en production", () => {
    assert.equal(shouldAllowDevOrigins({ NODE_ENV: "production" }), false);
    assert.deepEqual(
      resolveAllowedOrigins({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.somafrik.com",
      }),
      ["https://app.somafrik.com"],
    );
  });

  it("concatène les origines de dev en développement", () => {
    const origins = resolveAllowedOrigins({
      NODE_ENV: "development",
      CORS_ORIGINS: "http://localhost:5173",
    });

    assert.ok(origins.includes("http://localhost:5173"));
    assert.ok(origins.includes("http://localhost:5174"));
  });

  it("rejette CORS wildcard ou local en production", () => {
    assert.ok(
      collectProductionCorsViolations({
        NODE_ENV: "production",
        CORS_ORIGINS: "*",
      }).some((message) => message.includes("wildcard")),
    );

    assert.ok(
      collectProductionCorsViolations({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.somafrik.com,http://localhost:5173",
      }).some((message) => message.includes("locales ou privées")),
    );

    assert.ok(isLocalOrPrivateOrigin("http://192.168.1.35:5000"));
    assert.equal(isLocalOrPrivateOrigin("https://app.somafrik.com"), false);
  });

  it("accepte une configuration CORS production explicite", () => {
    assert.deepEqual(
      collectProductionCorsViolations({
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.somafrik.com,https://admin.somafrik.com",
      }),
      [],
    );
  });

  it("bloque le démarrage si CORS production est invalide", () => {
    assert.throws(
      () =>
        assertProductionCors({
          NODE_ENV: "production",
          CORS_ORIGINS: "http://localhost:5173",
        }),
      /Configuration CORS de production non sécurisée/,
    );
  });

  it("n'autorise pas localhost via le bypass dev en production", () => {
    const options = buildCorsOptions(
      { BusinessError },
      {
        NODE_ENV: "production",
        CORS_ORIGINS: "https://app.somafrik.com",
      },
    );

    options.origin("http://localhost:5173", (error, allowed) => {
      assert.ok(error);
      assert.equal(allowed, undefined);
    });

    options.origin("https://app.somafrik.com", (error, allowed) => {
      assert.equal(error, null);
      assert.equal(allowed, true);
    });
  });

  it("autorise localhost via le bypass dev en développement", () => {
    const options = buildCorsOptions(
      { BusinessError },
      {
        NODE_ENV: "development",
        CORS_ORIGINS: "https://app.somafrik.com",
      },
    );

    options.origin("http://localhost:9999", (error, allowed) => {
      assert.equal(error, null);
      assert.equal(allowed, true);
    });
  });
});
