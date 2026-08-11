import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import {
  authorizationDecisionToHttpStatus,
  decodeJwtCompactStrict,
  extractBearerCredential,
  isJwtClaimsPolicySatisfied,
  isJwtTemporalPolicySatisfied,
  resolveJwtRs256VerificationKey,
  verifyJwtAccessTokenCryptographically,
  verifyJwtRs256Signature,
} from "../src/index.js";
import {
  __setJwtAccessPipelineBricksForTests,
  verifyJwtAccessTokenCryptographically as verifyFromModule,
} from "../src/jwt-access-pipeline.js";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const EXPECTED_ISSUER = "https://auth.somafrik.example/v2";
const EVALUATION_TIME = 1_000_000;
const KID = "key-2026.01";

const NOMINAL_HEADER = { alg: "RS256", typ: "JWT", kid: KID };
const NOMINAL_PAYLOAD = {
  iss: EXPECTED_ISSUER,
  aud: "somafrik-api-v2",
  sub: "USR-2026-0001",
  sid: "SID-2026-0001",
  iat: 1_000_000,
  nbf: 1_000_000,
  exp: 1_000_900,
  jti: "JTI-2026-0001",
};

function encodeBase64Url(bytes) {
  let output = "";
  const length = bytes.length;
  let index = 0;
  while (index + 2 < length) {
    const value =
      (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      ALPHABET[(value >> 18) & 63] +
      ALPHABET[(value >> 12) & 63] +
      ALPHABET[(value >> 6) & 63] +
      ALPHABET[value & 63];
    index += 3;
  }
  if (index < length) {
    if (length - index === 1) {
      const value = bytes[index] << 16;
      output += ALPHABET[(value >> 18) & 63] + ALPHABET[(value >> 12) & 63];
    } else {
      const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
      output +=
        ALPHABET[(value >> 18) & 63] +
        ALPHABET[(value >> 12) & 63] +
        ALPHABET[(value >> 6) & 63];
    }
  }
  return output;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

async function generateRs256Pair(modulusLength = 2048) {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

async function buildSignedToken(header, payload, privateKey) {
  const headerSegment = encodeBase64Url(utf8(JSON.stringify(header)));
  const payloadSegment = encodeBase64Url(utf8(JSON.stringify(payload)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureBuffer = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    utf8(signingInput),
  );
  const signatureSegment = encodeBase64Url(new Uint8Array(signatureBuffer));
  return {
    token: `${signingInput}.${signatureSegment}`,
    signingInput,
  };
}

function candidate(verificationKey, overrides = {}) {
  return {
    kid: overrides.kid ?? KID,
    status: overrides.status ?? "active",
    verificationKey,
  };
}

test("accepts a valid RS256 JWT and returns exact sub sid jti", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );

  const result = await verifyJwtAccessTokenCryptographically(
    token,
    EXPECTED_ISSUER,
    EVALUATION_TIME,
    [candidate(publicKey)],
  );

  assert.deepEqual(result, {
    sub: "USR-2026-0001",
    sid: "SID-2026-0001",
    jti: "JTI-2026-0001",
  });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyNames(result).sort(), [
    "jti",
    "sid",
    "sub",
  ]);
});

test("returns sub sid jti without normalization", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const payload = {
    ...NOMINAL_PAYLOAD,
    sub: "USR.exact_Case:01-A",
    sid: "SID.exact_Case:01-A",
    jti: "JTI.exact_Case:01-A",
  };
  const { token } = await buildSignedToken(NOMINAL_HEADER, payload, privateKey);
  const result = await verifyJwtAccessTokenCryptographically(
    token,
    EXPECTED_ISSUER,
    EVALUATION_TIME,
    [candidate(publicKey)],
  );
  assert.deepEqual(result, {
    sub: "USR.exact_Case:01-A",
    sid: "SID.exact_Case:01-A",
    jti: "JTI.exact_Case:01-A",
  });
});

test("calls the four bricks in exact order on success", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  const order = [];
  const restore = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict(compactToken) {
      order.push("decode");
      return decodeJwtCompactStrict(compactToken);
    },
    isJwtClaimsPolicySatisfied(...args) {
      order.push("claims");
      return isJwtClaimsPolicySatisfied(...args);
    },
    resolveJwtRs256VerificationKey(...args) {
      order.push("kid");
      return resolveJwtRs256VerificationKey(...args);
    },
    async verifyJwtRs256Signature(...args) {
      order.push("rs256");
      return verifyJwtRs256Signature(...args);
    },
  });

  try {
    const result = await verifyFromModule(
      token,
      EXPECTED_ISSUER,
      EVALUATION_TIME,
      [candidate(publicKey)],
    );
    assert.deepEqual(result, {
      sub: "USR-2026-0001",
      sid: "SID-2026-0001",
      jti: "JTI-2026-0001",
    });
    assert.deepEqual(order, ["decode", "claims", "kid", "rs256"]);
  } finally {
    restore();
  }
});

test("stops after decode failure without calling later bricks", async () => {
  const order = [];
  const restore = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict() {
      order.push("decode");
      return null;
    },
    isJwtClaimsPolicySatisfied() {
      order.push("claims");
      return true;
    },
    resolveJwtRs256VerificationKey() {
      order.push("kid");
      return {};
    },
    async verifyJwtRs256Signature() {
      order.push("rs256");
      return true;
    },
  });

  try {
    assert.equal(
      await verifyFromModule("bad", EXPECTED_ISSUER, EVALUATION_TIME, []),
      null,
    );
    assert.deepEqual(order, ["decode"]);
  } finally {
    restore();
  }
});

test("stops after claims failure without kid or crypto", async () => {
  const order = [];
  const restore = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict(compactToken) {
      order.push("decode");
      return decodeJwtCompactStrict(compactToken);
    },
    isJwtClaimsPolicySatisfied() {
      order.push("claims");
      return false;
    },
    resolveJwtRs256VerificationKey() {
      order.push("kid");
      return {};
    },
    async verifyJwtRs256Signature() {
      order.push("rs256");
      return true;
    },
  });

  try {
    const { publicKey, privateKey } = await generateRs256Pair();
    const { token } = await buildSignedToken(
      NOMINAL_HEADER,
      NOMINAL_PAYLOAD,
      privateKey,
    );
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
    assert.deepEqual(order, ["decode", "claims"]);
  } finally {
    restore();
  }
});

test("stops after kid failure without crypto and keeps RS256 last", async () => {
  const order = [];
  const restore = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict(compactToken) {
      order.push("decode");
      return decodeJwtCompactStrict(compactToken);
    },
    isJwtClaimsPolicySatisfied(...args) {
      order.push("claims");
      return isJwtClaimsPolicySatisfied(...args);
    },
    resolveJwtRs256VerificationKey() {
      order.push("kid");
      return null;
    },
    async verifyJwtRs256Signature() {
      order.push("rs256");
      return true;
    },
  });

  try {
    const { publicKey, privateKey } = await generateRs256Pair();
    const { token } = await buildSignedToken(
      NOMINAL_HEADER,
      NOMINAL_PAYLOAD,
      privateKey,
    );
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
    assert.deepEqual(order, ["decode", "claims", "kid"]);
  } finally {
    restore();
  }
});

test("applies exact success predicates for each brick", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  const realDecoded = decodeJwtCompactStrict(token);

  const unexpectedDecodeCases = [
    null,
    undefined,
    true,
    1,
    "decoded",
    [],
    { protectedHeader: realDecoded.protectedHeader },
    {
      ...realDecoded,
      extra: true,
    },
    new Proxy(realDecoded, {}),
  ];
  for (const unexpected of unexpectedDecodeCases) {
    const restore = __setJwtAccessPipelineBricksForTests({
      decodeJwtCompactStrict: () => unexpected,
      isJwtClaimsPolicySatisfied: () => true,
      resolveJwtRs256VerificationKey: () => publicKey,
      verifyJwtRs256Signature: async () => true,
    });
    try {
      assert.equal(
        await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
          candidate(publicKey),
        ]),
        null,
      );
    } finally {
      restore();
    }
  }

  for (const unexpected of [false, "true", 1, {}, null, undefined]) {
    const restore = __setJwtAccessPipelineBricksForTests({
      decodeJwtCompactStrict: () => realDecoded,
      isJwtClaimsPolicySatisfied: () => unexpected,
      resolveJwtRs256VerificationKey: () => publicKey,
      verifyJwtRs256Signature: async () => true,
    });
    try {
      assert.equal(
        await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
          candidate(publicKey),
        ]),
        null,
      );
    } finally {
      restore();
    }
  }

  for (const unexpected of [
    null,
    undefined,
    true,
    1,
    {},
    new Proxy(publicKey, {}),
  ]) {
    const restore = __setJwtAccessPipelineBricksForTests({
      decodeJwtCompactStrict: () => realDecoded,
      isJwtClaimsPolicySatisfied: () => true,
      resolveJwtRs256VerificationKey: () => unexpected,
      verifyJwtRs256Signature: async () => true,
    });
    try {
      assert.equal(
        await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
          candidate(publicKey),
        ]),
        null,
      );
    } finally {
      restore();
    }
  }

  for (const unexpected of [false, "true", 1, {}, null, undefined]) {
    const restore = __setJwtAccessPipelineBricksForTests({
      decodeJwtCompactStrict: () => realDecoded,
      isJwtClaimsPolicySatisfied: () => true,
      resolveJwtRs256VerificationKey: () => publicKey,
      verifyJwtRs256Signature: async () => unexpected,
    });
    try {
      assert.equal(
        await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
          candidate(publicKey),
        ]),
        null,
      );
    } finally {
      restore();
    }
  }
});

test("returns null when a brick throws or rejects", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  const realDecoded = decodeJwtCompactStrict(token);

  const throwingDecode = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict() {
      throw new Error("decode boom");
    },
  });
  try {
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
  } finally {
    throwingDecode();
  }

  const throwingClaims = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict: () => realDecoded,
    isJwtClaimsPolicySatisfied() {
      throw new Error("claims boom");
    },
  });
  try {
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
  } finally {
    throwingClaims();
  }

  const throwingKid = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict: () => realDecoded,
    isJwtClaimsPolicySatisfied: () => true,
    resolveJwtRs256VerificationKey() {
      throw new Error("kid boom");
    },
  });
  try {
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
  } finally {
    throwingKid();
  }

  const rejectingRs256 = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict: () => realDecoded,
    isJwtClaimsPolicySatisfied: () => true,
    resolveJwtRs256VerificationKey: () => publicKey,
    async verifyJwtRs256Signature() {
      throw new Error("rs256 boom");
    },
  });
  try {
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
  } finally {
    rejectingRs256();
  }

  const rejectingPromise = __setJwtAccessPipelineBricksForTests({
    decodeJwtCompactStrict: () => realDecoded,
    isJwtClaimsPolicySatisfied: () => true,
    resolveJwtRs256VerificationKey: () => publicKey,
    verifyJwtRs256Signature: async () => Promise.reject(new Error("reject")),
  });
  try {
    assert.equal(
      await verifyFromModule(token, EXPECTED_ISSUER, EVALUATION_TIME, [
        candidate(publicKey),
      ]),
      null,
    );
  } finally {
    rejectingPromise();
  }
});

test("returns null for invalid compact claims kid and signature failures", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { publicKey: otherPublic } = await generateRs256Pair();

  assert.equal(
    await verifyJwtAccessTokenCryptographically(
      "not-a-jwt",
      EXPECTED_ISSUER,
      EVALUATION_TIME,
      [candidate(publicKey)],
    ),
    null,
  );

  const badClaimsPayload = { ...NOMINAL_PAYLOAD, aud: "other-api" };
  const badClaims = await buildSignedToken(
    NOMINAL_HEADER,
    badClaimsPayload,
    privateKey,
  );
  assert.equal(
    await verifyJwtAccessTokenCryptographically(
      badClaims.token,
      EXPECTED_ISSUER,
      EVALUATION_TIME,
      [candidate(publicKey)],
    ),
    null,
  );

  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  assert.equal(
    await verifyJwtAccessTokenCryptographically(
      token,
      EXPECTED_ISSUER,
      EVALUATION_TIME,
      [candidate(publicKey, { status: "inactive" })],
    ),
    null,
  );
  assert.equal(
    await verifyJwtAccessTokenCryptographically(
      token,
      EXPECTED_ISSUER,
      EVALUATION_TIME,
      [candidate(otherPublic)],
    ),
    null,
  );
});

test("result contains only sub sid jti and never mutates inputs", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  const candidates = [candidate(publicKey)];
  const tokenCopy = token;
  const issuerCopy = EXPECTED_ISSUER;
  const candidatesSnapshot = JSON.stringify(
    candidates.map((entry) => ({
      kid: entry.kid,
      status: entry.status,
      sameKey: entry.verificationKey === publicKey,
    })),
  );

  const result = await verifyJwtAccessTokenCryptographically(
    token,
    EXPECTED_ISSUER,
    EVALUATION_TIME,
    candidates,
  );
  assert.deepEqual(Object.keys(result).sort(), ["jti", "sid", "sub"]);
  assert.equal("kid" in result, false);
  assert.equal("iss" in result, false);
  assert.equal("signature" in result, false);
  assert.equal("signingInput" in result, false);
  assert.equal("protectedHeader" in result, false);
  assert.equal("payload" in result, false);
  assert.equal("verificationKey" in result, false);
  assert.equal(token, tokenCopy);
  assert.equal(EXPECTED_ISSUER, issuerCopy);
  assert.equal(
    JSON.stringify(
      candidates.map((entry) => ({
        kid: entry.kid,
        status: entry.status,
        sameKey: entry.verificationKey === publicKey,
      })),
    ),
    candidatesSnapshot,
  );
});

test("never rejects the returned promise for hostile inputs", async () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile");
      },
    },
  );
  const cases = [
    [undefined, undefined, undefined, undefined],
    [null, null, null, null],
    [hostile, hostile, hostile, hostile],
    [1, 1, 1, 1],
  ];
  for (const args of cases) {
    const result = await verifyJwtAccessTokenCryptographically(
      args[0],
      args[1],
      args[2],
      args[3],
    );
    assert.equal(result, null);
  }
});

test("public API non-regression without session PEM JWKS or JWT libs", async () => {
  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);

  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof decodeJwtCompactStrict, "function");
  assert.equal(typeof isJwtClaimsPolicySatisfied, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");
  assert.equal(typeof resolveJwtRs256VerificationKey, "function");
  assert.equal(typeof verifyJwtRs256Signature, "function");
  assert.equal(typeof verifyJwtAccessTokenCryptographically, "function");
  assert.equal(
    Object.hasOwn(
      await import("../src/index.js"),
      "__setJwtAccessPipelineBricksForTests",
    ),
    false,
  );

  const source = readFileSync(
    new URL("../src/jwt-access-pipeline.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("subtle.verify"), false);
  assert.equal(source.includes("importKey"), false);
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(source.includes("JWKS"), false);
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("console."), false);
});
