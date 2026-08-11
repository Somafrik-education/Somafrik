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

function pipelineSource() {
  return readFileSync(
    new URL("../src/jwt-access-pipeline.js", import.meta.url),
    "utf8",
  );
}

async function withVerifySpy(run) {
  const originalVerify = globalThis.crypto.subtle.verify;
  let verifyCalls = 0;
  globalThis.crypto.subtle.verify = async (...args) => {
    verifyCalls += 1;
    return originalVerify.apply(globalThis.crypto.subtle, args);
  };
  try {
    return await run(() => verifyCalls);
  } finally {
    globalThis.crypto.subtle.verify = originalVerify;
  }
}

test("accepts a valid RS256 JWT and returns exact new { sub, sid, jti }", async () => {
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
  assert.equal(Object.getOwnPropertySymbols(result).length, 0);

  const decoded = decodeJwtCompactStrict(token);
  assert.notEqual(result, decoded.payload);
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

test("rejects invalid or hostile compact tokens without cryptography", async () => {
  const { publicKey } = await generateRs256Pair();
  const candidates = [candidate(publicKey)];

  await withVerifySpy(async (getCalls) => {
    for (const token of [
      undefined,
      null,
      1,
      {},
      "",
      "a.b",
      "not-a-jwt",
      "@@@.@@@.@@@",
    ]) {
      assert.equal(
        await verifyJwtAccessTokenCryptographically(
          token,
          EXPECTED_ISSUER,
          EVALUATION_TIME,
          candidates,
        ),
        null,
      );
    }
    assert.equal(getCalls(), 0);
  });
});

test("rejects invalid claims and temporal cases without kid resolution crypto", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const candidates = [candidate(publicKey)];

  const cases = [
    { ...NOMINAL_PAYLOAD, iss: "https://other.example" },
    { ...NOMINAL_PAYLOAD, aud: "other-api" },
    { ...NOMINAL_PAYLOAD, sub: "bad/sub" },
    { ...NOMINAL_PAYLOAD, sid: "" },
    { ...NOMINAL_PAYLOAD, jti: "jti with space" },
    { ...NOMINAL_PAYLOAD, exp: EVALUATION_TIME },
    { ...NOMINAL_PAYLOAD, nbf: EVALUATION_TIME + 31, exp: EVALUATION_TIME + 931 },
  ];

  await withVerifySpy(async (getCalls) => {
    for (const payload of cases) {
      const { token } = await buildSignedToken(
        NOMINAL_HEADER,
        payload,
        privateKey,
      );
      assert.equal(
        await verifyJwtAccessTokenCryptographically(
          token,
          EXPECTED_ISSUER,
          EVALUATION_TIME,
          candidates,
        ),
        null,
      );
    }

    const badAlg = await buildSignedToken(
      { ...NOMINAL_HEADER, alg: "HS256" },
      NOMINAL_PAYLOAD,
      privateKey,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        badAlg.token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        candidates,
      ),
      null,
    );

    const badTyp = await buildSignedToken(
      { ...NOMINAL_HEADER, typ: "jwt" },
      NOMINAL_PAYLOAD,
      privateKey,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        badTyp.token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        candidates,
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
        Number.NaN,
        candidates,
      ),
      null,
    );

    assert.equal(getCalls(), 0);
  });
});

test("rejects kid resolution failures without RS256 cryptography", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { publicKey: otherKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );

  await withVerifySpy(async (getCalls) => {
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [],
      ),
      null,
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
        [
          candidate(publicKey, { status: "active" }),
          candidate(otherKey, { status: "inactive" }),
        ],
      ),
      null,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey, { kid: "KEY-2026.01" })],
      ),
      null,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        new Proxy([candidate(publicKey)], {}),
      ),
      null,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [new Proxy(candidate(publicKey), {})],
      ),
      null,
    );
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(/** @type {CryptoKey} */ (new Proxy(publicKey, {})))],
      ),
      null,
    );

    const tooMany = [];
    for (let index = 0; index < 257; index += 1) {
      tooMany.push(candidate(publicKey, { kid: `k-${index}` }));
    }
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        tooMany,
      ),
      null,
    );

    assert.equal(getCalls(), 0);
  });
});

test("rejects invalid signatures and incompatible keys after kid resolution", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { publicKey: wrongPublic } = await generateRs256Pair();
  const { token, signingInput } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );

  await withVerifySpy(async (getCalls) => {
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(wrongPublic)],
      ),
      null,
    );
    assert.ok(getCalls() >= 1);

    const parts = token.split(".");
    const alteredSig = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}aa`;
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        alteredSig,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey)],
      ),
      null,
    );

    const alteredInput = await buildSignedToken(
      NOMINAL_HEADER,
      { ...NOMINAL_PAYLOAD, jti: "JTI-2026-0002" },
      privateKey,
    );
    // Reuse original signature bytes with a different signing input by splicing.
    const mixed = `${alteredInput.signingInput}.${token.split(".")[2]}`;
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        mixed,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey)],
      ),
      null,
    );
    assert.notEqual(alteredInput.signingInput, signingInput);

    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(privateKey)],
      ),
      null,
    );
  });
});

test("statically proves brick order predicates stop conditions and no test seam", () => {
  const source = pipelineSource();

  assert.equal(source.includes("__setJwtAccessPipelineBricksForTests"), false);
  assert.equal(source.includes("DEFAULT_BRICKS"), false);
  assert.equal(/\blet\s+bricks\b/.test(source), false);
  assert.equal(/\bvar\s+bricks\b/.test(source), false);
  assert.equal(/\bbricks\s*=/.test(source), false);

  assert.match(
    source,
    /import\s+\{\s*decodeJwtCompactStrict\s*\}\s+from\s+"\.\/jwt-compact-decoder\.js"/,
  );
  assert.match(
    source,
    /import\s+\{\s*isJwtClaimsPolicySatisfied\s*\}\s+from\s+"\.\/jwt-claims-policy\.js"/,
  );
  assert.match(
    source,
    /import\s+\{\s*resolveJwtRs256VerificationKey\s*\}\s+from\s+"\.\/jwt-kid-resolver\.js"/,
  );
  assert.match(
    source,
    /import\s+\{\s*verifyJwtRs256Signature\s*\}\s+from\s+"\.\/jwt-rs256-verifier\.js"/,
  );
  assert.equal(source.includes('from "./index.js"'), false);

  const decodeCall = source.indexOf("decodeJwtCompactStrict(compactToken)");
  const claimsCall = source.indexOf("isJwtClaimsPolicySatisfied(");
  const kidCall = source.indexOf("resolveJwtRs256VerificationKey(");
  const rs256Call = source.indexOf("await verifyJwtRs256Signature(");
  assert.ok(decodeCall > 0);
  assert.ok(claimsCall > decodeCall);
  assert.ok(kidCall > claimsCall);
  assert.ok(rs256Call > kidCall);

  const afterDecode = source.slice(decodeCall, claimsCall);
  assert.equal(afterDecode.includes("return null"), true);
  assert.equal(afterDecode.includes("isExactDecodedJwt"), true);

  const afterClaims = source.slice(claimsCall, kidCall);
  assert.equal(afterClaims.includes("!== true"), true);
  assert.equal(afterClaims.includes("return null"), true);

  const afterKid = source.slice(kidCall, rs256Call);
  assert.equal(afterKid.includes("return null"), true);

  const afterRs256 = source.slice(rs256Call);
  assert.equal(afterRs256.includes("!== true"), true);
  assert.equal(afterRs256.includes("return null"), true);

  assert.equal(source.includes("subtle.verify"), false);
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("process.env"), false);
  assert.equal(source.includes("console."), false);
  assert.equal(source.includes("importKey"), false);
  assert.equal(source.includes("JWKS"), false);

  const exportMatches = source.match(/^export\s+/gm) || [];
  assert.equal(exportMatches.length, 1);
  assert.equal(
    source.includes("export async function verifyJwtAccessTokenCryptographically"),
    true,
  );
});

test("observable pipeline stop: decode claims kid failures never call subtle.verify", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );

  await withVerifySpy(async (getCalls) => {
    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        "bad.token.value",
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey)],
      ),
      null,
    );
    assert.equal(getCalls(), 0);

    const badClaims = await buildSignedToken(
      NOMINAL_HEADER,
      { ...NOMINAL_PAYLOAD, aud: "wrong" },
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
    assert.equal(getCalls(), 0);

    assert.equal(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey, { status: "inactive" })],
      ),
      null,
    );
    assert.equal(getCalls(), 0);

    assert.deepEqual(
      await verifyJwtAccessTokenCryptographically(
        token,
        EXPECTED_ISSUER,
        EVALUATION_TIME,
        [candidate(publicKey)],
      ),
      {
        sub: "USR-2026-0001",
        sid: "SID-2026-0001",
        jti: "JTI-2026-0001",
      },
    );
    assert.ok(getCalls() >= 1);
  });
});

test("result confidentiality and input immutability", async () => {
  const { publicKey, privateKey } = await generateRs256Pair();
  const { token } = await buildSignedToken(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    privateKey,
  );
  const candidates = [candidate(publicKey)];
  const tokenCopy = token;
  const issuerCopy = EXPECTED_ISSUER;
  const snapshot = JSON.stringify(
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
  for (const forbidden of [
    "kid",
    "iss",
    "aud",
    "iat",
    "nbf",
    "exp",
    "alg",
    "typ",
    "signature",
    "signingInput",
    "protectedHeader",
    "payload",
    "verificationKey",
    "token",
  ]) {
    assert.equal(forbidden in result, false);
  }

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
    snapshot,
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

test("public API non-regression without session PEM JWKS seam or JWT libs", async () => {
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

  const indexModule = await import("../src/index.js");
  assert.equal(
    Object.hasOwn(indexModule, "__setJwtAccessPipelineBricksForTests"),
    false,
  );
  assert.equal(
    Object.hasOwn(indexModule, "verifyJwtAccessTokenCryptographically"),
    true,
  );

  const pipelineModule = await import("../src/jwt-access-pipeline.js");
  assert.deepEqual(Object.keys(pipelineModule).sort(), [
    "verifyJwtAccessTokenCryptographically",
  ]);
});
