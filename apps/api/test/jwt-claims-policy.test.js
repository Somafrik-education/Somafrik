import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  authorizationDecisionToHttpStatus,
  extractBearerCredential,
  isJwtClaimsPolicySatisfied,
  isJwtTemporalPolicySatisfied,
} from "../src/index.js";

const EVALUATION_TIME = 1_000_000;
const EXPECTED_ISSUER = "https://auth.somafrik.example/v2";
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function validHeader(overrides = {}) {
  return {
    alg: "RS256",
    typ: "JWT",
    kid: "key-2026.01",
    ...overrides,
  };
}

function validPayload(overrides = {}) {
  return {
    iss: EXPECTED_ISSUER,
    aud: "somafrik-api-v2",
    sub: "USR-2026-0001",
    sid: "SID-2026-0001",
    iat: 1_000_000,
    nbf: 1_000_000,
    exp: 1_000_900,
    jti: "JTI-2026-0001",
    ...overrides,
  };
}

function assertSatisfied(header, payload, expectedIssuer, evaluationTime) {
  const issuer = arguments.length >= 3 ? expectedIssuer : EXPECTED_ISSUER;
  const time = arguments.length >= 4 ? evaluationTime : EVALUATION_TIME;
  assert.equal(
    isJwtClaimsPolicySatisfied(header, payload, issuer, time),
    true,
  );
}

function assertRejected(header, payload, expectedIssuer, evaluationTime) {
  const issuer = arguments.length >= 3 ? expectedIssuer : EXPECTED_ISSUER;
  const time = arguments.length >= 4 ? evaluationTime : EVALUATION_TIME;
  assert.equal(
    isJwtClaimsPolicySatisfied(header, payload, issuer, time),
    false,
  );
}

function asciiTokenId(length) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet.charAt(index % alphabet.length);
  }
  return value;
}

test("accepts exact header and payload including null-prototype objects", () => {
  assertSatisfied(validHeader(), validPayload());

  const nullProtoHeader = Object.assign(Object.create(null), validHeader());
  const nullProtoPayload = Object.assign(Object.create(null), validPayload());
  assertSatisfied(nullProtoHeader, nullProtoPayload);

  const reorderedHeader = { kid: "key-2026.01", alg: "RS256", typ: "JWT" };
  const reorderedPayload = {
    jti: "JTI-2026-0001",
    exp: 1_000_900,
    nbf: 1_000_000,
    iat: 1_000_000,
    sid: "SID-2026-0001",
    sub: "USR-2026-0001",
    aud: "somafrik-api-v2",
    iss: EXPECTED_ISSUER,
  };
  assertSatisfied(reorderedHeader, reorderedPayload);
});

test("rejects invalid header shapes and algorithms", () => {
  assertRejected(undefined, validPayload());
  assertRejected(null, validPayload());
  assertRejected("RS256", validPayload());
  assertRejected(1, validPayload());
  assertRejected([], validPayload());
  assertRejected(validHeader({ alg: "HS256" }), validPayload());
  assertRejected(validHeader({ typ: "jwt" }), validPayload());
  assertRejected({ alg: "RS256", typ: "JWT" }, validPayload());
  assertRejected({ ...validHeader(), extra: "x" }, validPayload());

  const withSymbol = validHeader();
  Object.defineProperty(withSymbol, Symbol("x"), { value: "y" });
  assertRejected(withSymbol, validPayload());

  const inherited = Object.create({
    alg: "RS256",
    typ: "JWT",
    kid: "key-2026.01",
  });
  assertRejected(inherited, validPayload());

  const inheritedAlg = Object.create({ alg: "HS256" });
  inheritedAlg.alg = "RS256";
  inheritedAlg.typ = "JWT";
  inheritedAlg.kid = "key-2026.01";
  assertRejected(inheritedAlg, validPayload());

  const getterHeader = {};
  Object.defineProperty(getterHeader, "alg", {
    get() {
      return "RS256";
    },
    enumerable: true,
  });
  Object.defineProperty(getterHeader, "typ", { value: "JWT", enumerable: true });
  Object.defineProperty(getterHeader, "kid", {
    value: "key-2026.01",
    enumerable: true,
  });
  assertRejected(getterHeader, validPayload());

  class HeaderClass {
    constructor() {
      this.alg = "RS256";
      this.typ = "JWT";
      this.kid = "key-2026.01";
    }
  }
  assertRejected(new HeaderClass(), validPayload());

  const hostileProxy = new Proxy(validHeader(), {
    get() {
      throw new Error("hostile proxy");
    },
    ownKeys() {
      throw new Error("hostile proxy");
    },
    getOwnPropertyDescriptor() {
      throw new Error("hostile proxy");
    },
  });
  assertRejected(hostileProxy, validPayload());
});

test("enforces strict kid format including 128 and 129 bounds", () => {
  assertRejected(validHeader({ kid: "" }), validPayload());
  assertRejected(validHeader({ kid: "key 2026" }), validPayload());
  assertRejected(validHeader({ kid: "clé-2026" }), validPayload());
  assertRejected(validHeader({ kid: "key/2026" }), validPayload());
  assertRejected(validHeader({ kid: "key\\2026" }), validPayload());
  assertRejected(validHeader({ kid: "key\t2026" }), validPayload());
  assertRejected(validHeader({ kid: 12 }), validPayload());
  assertSatisfied(validHeader({ kid: asciiTokenId(128) }), validPayload());
  assertRejected(validHeader({ kid: asciiTokenId(129) }), validPayload());
  assertSatisfied(
    validHeader({ kid: "ABC.xyz_09:Z-end" }),
    validPayload(),
  );
});

test("rejects invalid payload shapes and forbidden extra claims", () => {
  assertRejected(validHeader(), undefined);
  assertRejected(validHeader(), null);
  assertRejected(validHeader(), "payload");
  assertRejected(validHeader(), 1);
  assertRejected(validHeader(), []);

  for (const key of ["iss", "aud", "sub", "sid", "iat", "nbf", "exp", "jti"]) {
    const payload = validPayload();
    delete payload[key];
    assertRejected(validHeader(), payload);
  }

  const forbiddenExtras = [
    "role",
    "roles",
    "tenant",
    "tenantId",
    "tenantScope",
    "permission",
    "permissions",
    "rights",
    "scope",
    "scopes",
    "schoolId",
    "countryId",
    "authorization",
    "unknownClaim",
  ];
  for (const key of forbiddenExtras) {
    assertRejected(validHeader(), validPayload({ [key]: "x" }));
  }

  const withSymbol = validPayload();
  Object.defineProperty(withSymbol, Symbol("role"), { value: "admin" });
  assertRejected(validHeader(), withSymbol);

  const inherited = Object.create(validPayload());
  assertRejected(validHeader(), inherited);

  const getterPayload = validPayload();
  Object.defineProperty(getterPayload, "sub", {
    get() {
      return "USR-2026-0001";
    },
    enumerable: true,
  });
  assertRejected(validHeader(), getterPayload);

  class PayloadClass {
    constructor() {
      Object.assign(this, validPayload());
    }
  }
  assertRejected(validHeader(), new PayloadClass());

  const hostileProxy = new Proxy(validPayload(), {
    get() {
      throw new Error("hostile proxy");
    },
    ownKeys() {
      throw new Error("hostile proxy");
    },
  });
  assertRejected(validHeader(), hostileProxy);

  assertRejected(validHeader(), validPayload(), undefined);
  assertRejected(validHeader(), validPayload(), null);
  assertRejected(validHeader(), validPayload(), 12);
  assertRejected(validHeader(), new Date());
  assertRejected(validHeader(), new Map());
  assertRejected(validHeader(), new Set());
  assertRejected(validHeader(), /jwt/);
  assertRejected(validHeader(), () => ({}));
});

test("validates expectedIssuer and iss with exact equality and bounds", () => {
  assertRejected(validHeader(), validPayload({ iss: "" }), EXPECTED_ISSUER);
  assertRejected(validHeader(), validPayload(), "");
  assertRejected(validHeader(), validPayload({ iss: 1 }), EXPECTED_ISSUER);
  assertRejected(validHeader(), validPayload(), ["issuer"]);

  const issuerPrefix = "https://auth.example/";
  const issuer2048 = `${issuerPrefix}${"a".repeat(2048 - issuerPrefix.length)}`;
  assert.equal(issuer2048.length, 2048);
  assertSatisfied(
    validHeader(),
    validPayload({ iss: issuer2048 }),
    issuer2048,
  );

  const issuer2049 = `${issuer2048}x`;
  assert.equal(issuer2049.length, 2049);
  assertRejected(validHeader(), validPayload({ iss: issuer2049 }), issuer2049);
  assertRejected(validHeader(), validPayload({ iss: issuer2048 }), issuer2049);

  assertRejected(
    validHeader(),
    validPayload({ iss: `https://auth.example/\u0000` }),
    `https://auth.example/\u0000`,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: `https://auth.example/\u007F` }),
    `https://auth.example/\u007F`,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: `https://auth.example/\u0085` }),
    `https://auth.example/\u0085`,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: ` ${EXPECTED_ISSUER}` }),
    ` ${EXPECTED_ISSUER}`,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: `${EXPECTED_ISSUER} ` }),
    `${EXPECTED_ISSUER} `,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: EXPECTED_ISSUER.toUpperCase() }),
    EXPECTED_ISSUER,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: `${EXPECTED_ISSUER}/` }),
    EXPECTED_ISSUER,
  );
  assertRejected(
    validHeader(),
    validPayload({ iss: EXPECTED_ISSUER }),
    `${EXPECTED_ISSUER}/`,
  );
});

test("requires exact audience string somafrik-api-v2", () => {
  assertSatisfied(validHeader(), validPayload({ aud: "somafrik-api-v2" }));
  assertRejected(validHeader(), validPayload({ aud: "Somafrik-API-V2" }));
  assertRejected(validHeader(), validPayload({ aud: "other" }));
  assertRejected(validHeader(), validPayload({ aud: ["somafrik-api-v2"] }));
  assertRejected(validHeader(), validPayload({ aud: " somafrik-api-v2" }));
  assertRejected(validHeader(), validPayload({ aud: { toString: () => "somafrik-api-v2" } }));
});

test("enforces strict sub sid and jti formats including 128 and 129 bounds", () => {
  for (const key of ["sub", "sid", "jti"]) {
    assertRejected(validHeader(), validPayload({ [key]: "" }));
    assertRejected(validHeader(), validPayload({ [key]: 12 }));
    assertRejected(validHeader(), validPayload({ [key]: "has space" }));
    assertRejected(validHeader(), validPayload({ [key]: "has\tcontrol" }));
    assertRejected(validHeader(), validPayload({ [key]: "ünicode" }));
    assertRejected(validHeader(), validPayload({ [key]: "a/b" }));
    assertRejected(validHeader(), validPayload({ [key]: "a\\b" }));
    assertSatisfied(validHeader(), validPayload({ [key]: asciiTokenId(128) }));
    assertRejected(validHeader(), validPayload({ [key]: asciiTokenId(129) }));
    assertSatisfied(
      validHeader(),
      validPayload({ [key]: "ABC.xyz_09:Z-end" }),
    );
  }
});

test("delegates temporal checks to V2.1n including normative cases", () => {
  const cases = [
    [1_000_000, 1_000_000, 1_000_900, true],
    [1_000_030, 1_000_030, 1_000_900, true],
    [1_000_031, 1_000_031, 1_000_900, false],
    [1_000_000, 1_000_031, 1_000_900, false],
    [999_070, 999_070, 999_970, false],
    [999_071, 999_071, 999_971, true],
    [1_000_000, 1_000_000, 1_000_000, false],
    [1_000_000, 1_000_000, 1_000_901, false],
    [1_000_000, 999_999, 1_000_900, false],
    [1_000_000, 1_000_100, 1_000_100, false],
  ];

  for (const [iat, nbf, exp, expected] of cases) {
    assert.equal(
      isJwtTemporalPolicySatisfied(iat, nbf, exp, EVALUATION_TIME),
      expected,
    );
    assert.equal(
      isJwtClaimsPolicySatisfied(
        validHeader(),
        validPayload({ iat, nbf, exp }),
        EXPECTED_ISSUER,
        EVALUATION_TIME,
      ),
      expected,
    );
  }

  assertRejected(validHeader(), validPayload(), EXPECTED_ISSUER, undefined);
  assertRejected(validHeader(), validPayload(), EXPECTED_ISSUER, "1000000");
  assertRejected(validHeader(), validPayload(), EXPECTED_ISSUER, 1.5);
  assertRejected(
    validHeader(),
    validPayload({ iat: 999_070, nbf: 999_070, exp: 999_970 }),
  );
  assertSatisfied(
    validHeader(),
    validPayload({ iat: 999_071, nbf: 999_071, exp: 999_971 }),
  );

  const near = MAX_SAFE - 1000;
  assertSatisfied(
    validHeader(),
    validPayload({ iat: near, nbf: near, exp: near + 900 }),
    EXPECTED_ISSUER,
    near,
  );
  assertRejected(
    validHeader(),
    validPayload({ iat: near + 31, nbf: near + 31, exp: near + 900 }),
    EXPECTED_ISSUER,
    near,
  );

  const source = readFileSync(
    new URL("../src/jwt-claims-policy.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /isJwtTemporalPolicySatisfied\(/);
  assert.equal(source.includes("CLOCK_SKEW_SECONDS"), false);
  assert.equal(source.includes("MAX_TOKEN_LIFETIME_SECONDS"), false);
  assert.equal(source.includes("Date.now"), false);
});

test("public API non-regression without JWT crypto dependencies", () => {
  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);
  assert.equal(apiPackage.devDependencies, undefined);

  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");
  assert.equal(typeof isJwtClaimsPolicySatisfied, "function");
  assert.equal(extractBearerCredential("Bearer ExactTokenValue"), "ExactTokenValue");
  assert.equal(authorizationDecisionToHttpStatus("unknown"), 401);

  const source = readFileSync(
    new URL("../src/jwt-claims-policy.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("JSON.parse"), false);
  assert.equal(source.includes("atob"), false);
  assert.equal(source.includes("Buffer"), false);
  assert.equal(source.includes("createVerify"), false);
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(source.includes("base64url"), false);
  assert.equal(source.includes("base64"), false);
});
