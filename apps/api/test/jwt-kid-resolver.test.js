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
  verifyJwtRs256Signature,
} from "../src/index.js";

const ALLOWED_KID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-";

async function generateRs256Pair(modulusLength = 2048, hash = "SHA-256") {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash,
    },
    true,
    ["sign", "verify"],
  );
}

/**
 * @param {CryptoKey} verificationKey
 * @param {{ kid?: string, status?: string }} [overrides]
 */
function candidate(verificationKey, overrides = {}) {
  return {
    kid: overrides.kid ?? "key-2026.01",
    status: overrides.status ?? "active",
    verificationKey,
  };
}

function asciiKid(length) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += ALLOWED_KID_CHARS[index % ALLOWED_KID_CHARS.length];
  }
  return value;
}

function assertNull(kid, keyCandidates, message) {
  assert.equal(resolveJwtRs256VerificationKey(kid, keyCandidates), null, message);
}

function assertNoThrow(kid, keyCandidates) {
  assert.doesNotThrow(() => resolveJwtRs256VerificationKey(kid, keyCandidates));
  assert.equal(resolveJwtRs256VerificationKey(kid, keyCandidates), null);
}

test("resolves exact active candidate with compatible 2048 key", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const candidates = [candidate(publicKey)];
  const resolved = resolveJwtRs256VerificationKey("key-2026.01", candidates);
  assert.equal(resolved, publicKey);
});

test("accepts compatible 3072 and 4096 keys and null prototype candidates", async () => {
  for (const modulusLength of [3072, 4096]) {
    const { publicKey } = await generateRs256Pair(modulusLength);
    const resolved = resolveJwtRs256VerificationKey("key-2026.01", [
      candidate(publicKey),
    ]);
    assert.equal(resolved, publicKey, `modulus ${modulusLength}`);
  }

  const { publicKey } = await generateRs256Pair(2048);
  const nullProto = Object.create(null);
  nullProto.kid = "key-2026.01";
  nullProto.status = "active";
  nullProto.verificationKey = publicKey;
  assert.equal(
    resolveJwtRs256VerificationKey("key-2026.01", [nullProto]),
    publicKey,
  );
});

test("accepts kid bounds and full allowed charset", async () => {
  const { publicKey } = await generateRs256Pair(2048);

  const kid1 = "A";
  assert.equal(
    resolveJwtRs256VerificationKey(kid1, [candidate(publicKey, { kid: kid1 })]),
    publicKey,
  );

  const kid128 = asciiKid(128);
  assert.equal(
    resolveJwtRs256VerificationKey(kid128, [
      candidate(publicKey, { kid: kid128 }),
    ]),
    publicKey,
  );

  const fullCharset = ALLOWED_KID_CHARS;
  assert.equal(
    resolveJwtRs256VerificationKey(fullCharset, [
      candidate(publicKey, { kid: fullCharset }),
    ]),
    publicKey,
  );
});

test("returns the exact CryptoKey reference from the matching candidate", async () => {
  const { publicKey: keyA } = await generateRs256Pair(2048);
  const { publicKey: keyB } = await generateRs256Pair(2048);
  const candidates = [
    candidate(keyA, { kid: "other-key", status: "inactive" }),
    candidate(keyB, { kid: "target-key", status: "active" }),
  ];
  assert.equal(
    resolveJwtRs256VerificationKey("target-key", candidates),
    keyB,
  );
  assert.notEqual(
    resolveJwtRs256VerificationKey("target-key", candidates),
    keyA,
  );
});

test("rejects invalid kid values without trim or coercion", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const candidates = [candidate(publicKey)];

  assertNull(undefined, candidates);
  assertNull(null, candidates);
  assertNull(12, candidates);
  assertNull({}, candidates);
  assertNull("", candidates);
  assertNull(asciiKid(129), candidates);
  assertNull("key 2026", candidates);
  assertNull("key\t2026", candidates);
  assertNull("key\n2026", candidates);
  assertNull("clé-2026", candidates);
  assertNull("key/2026", candidates);
  assertNull("key\\2026", candidates);
  assertNull("KEY-2026.01", [candidate(publicKey, { kid: "key-2026.01" })]);
  assertNull(" key-2026.01", candidates);
  assertNull("key-2026.01 ", candidates);
  assertNull("key-2026.01", [
    {
      kid: 12,
      status: "active",
      verificationKey: publicKey,
    },
  ]);
});

test("rejects invalid or hostile keyCandidates structures", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const kid = "key-2026.01";

  assertNull(kid, undefined);
  assertNull(kid, null);
  assertNull(kid, "candidates");
  assertNull(kid, 1);
  assertNull(kid, { 0: candidate(publicKey), length: 1 });

  class MyArray extends Array {}
  assertNull(kid, MyArray.from([candidate(publicKey)]));

  const sparse = [];
  sparse.length = 1;
  sparse[0] = candidate(publicKey);
  delete sparse[0];
  sparse.length = 1;
  assertNull(kid, sparse);

  const withHole = [candidate(publicKey), candidate(publicKey, { kid: "x" })];
  delete withHole[1];
  assertNull(kid, withHole);

  const extraProp = [candidate(publicKey)];
  extraProp.extra = true;
  assertNull(kid, extraProp);

  const withSymbol = [candidate(publicKey)];
  Object.defineProperty(withSymbol, Symbol("x"), { value: true });
  assertNull(kid, withSymbol);

  const getterArray = [candidate(publicKey)];
  Object.defineProperty(getterArray, "0", {
    get() {
      return candidate(publicKey);
    },
    enumerable: true,
    configurable: true,
  });
  assertNull(kid, getterArray);

  const hostileProxy = new Proxy([candidate(publicKey)], {
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
  assertNoThrow(kid, hostileProxy);

  const transparentProxiedCandidates = new Proxy([candidate(publicKey)], {});
  assertNull(kid, transparentProxiedCandidates);

  const tooMany = [];
  for (let index = 0; index < 257; index += 1) {
    tooMany.push(candidate(publicKey, { kid: `k-${index}` }));
  }
  assertNull(kid, tooMany);

  const maxOk = [];
  for (let index = 0; index < 256; index += 1) {
    maxOk.push(
      candidate(publicKey, {
        kid: index === 0 ? kid : `k-${index}`,
        status: index === 0 ? "active" : "inactive",
      }),
    );
  }
  assert.equal(resolveJwtRs256VerificationKey(kid, maxOk), publicKey);
});

test("rejects invalid candidate shapes", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const kid = "key-2026.01";

  assertNull(kid, [null]);
  assertNull(kid, ["candidate"]);
  assertNull(kid, [1]);
  assertNull(kid, [[]]);
  assertNull(kid, [{ kid, status: "active" }]);
  assertNull(kid, [{ kid, verificationKey: publicKey }]);
  assertNull(kid, [{ status: "active", verificationKey: publicKey }]);
  assertNull(kid, [
    { kid, status: "active", verificationKey: publicKey, extra: true },
  ]);

  const inherited = Object.create({
    kid,
    status: "active",
    verificationKey: publicKey,
  });
  assertNull(kid, [inherited]);

  const onlyInherited = Object.create({
    kid,
    status: "active",
    verificationKey: publicKey,
  });
  assertNull(kid, [onlyInherited]);

  const getterCandidate = {};
  Object.defineProperty(getterCandidate, "kid", {
    get() {
      return kid;
    },
    enumerable: true,
  });
  Object.defineProperty(getterCandidate, "status", {
    value: "active",
    enumerable: true,
  });
  Object.defineProperty(getterCandidate, "verificationKey", {
    value: publicKey,
    enumerable: true,
  });
  assertNull(kid, [getterCandidate]);

  const withSymbol = {
    kid,
    status: "active",
    verificationKey: publicKey,
  };
  Object.defineProperty(withSymbol, Symbol("x"), { value: true });
  assertNull(kid, [withSymbol]);

  class CandidateClass {
    constructor() {
      this.kid = kid;
      this.status = "active";
      this.verificationKey = publicKey;
    }
  }
  assertNull(kid, [new CandidateClass()]);

  const hostileCandidate = new Proxy(candidate(publicKey), {
    get() {
      throw new Error("hostile");
    },
    ownKeys() {
      throw new Error("hostile");
    },
    getOwnPropertyDescriptor() {
      throw new Error("hostile");
    },
  });
  assertNoThrow(kid, [hostileCandidate]);

  const transparentProxiedCandidate = new Proxy(candidate(publicKey), {});
  assertNull(kid, [transparentProxiedCandidate]);

  assertNull(kid, [candidate(publicKey, { kid: "" })]);
  assertNull(kid, [candidate(publicKey, { kid: "bad/kid" })]);
  assertNull(kid, [candidate(publicKey, { kid: asciiKid(129) })]);
  assertNull(kid, [
    {
      kid,
      status: 1,
      verificationKey: publicKey,
    },
  ]);
  assertNull(kid, [
    {
      kid,
      status: "retired",
      verificationKey: publicKey,
    },
  ]);
  assertNull(kid, [
    {
      kid,
      status: "ACTIVE",
      verificationKey: publicKey,
    },
  ]);
});

test("enforces uniqueness ambiguity and inactive status", async () => {
  const { publicKey: keyA } = await generateRs256Pair(2048);
  const { publicKey: keyB } = await generateRs256Pair(2048);
  const kid = "key-2026.01";

  assertNull(kid, []);
  assertNull(kid, [candidate(keyA, { kid: "other" })]);

  assertNull(kid, [
    candidate(keyA, { kid, status: "active" }),
    candidate(keyB, { kid, status: "active" }),
  ]);

  assertNull(kid, [
    candidate(keyA, { kid, status: "active" }),
    candidate(keyB, { kid, status: "inactive" }),
  ]);

  assertNull(kid, [
    candidate(keyA, { kid, status: "inactive" }),
    candidate(keyB, { kid, status: "inactive" }),
  ]);

  assertNull(kid, [candidate(keyA, { kid, status: "inactive" })]);

  assertNull(kid, [candidate(keyA, { kid: "KEY-2026.01", status: "active" })]);

  assertNull(kid, [
    candidate(keyA, { kid: "other", status: "active" }),
    {
      kid: "malformed",
      status: "active",
      verificationKey: keyB,
      extra: true,
    },
  ]);

  const orderA = [
    candidate(keyA, { kid: "other", status: "inactive" }),
    candidate(keyB, { kid, status: "active" }),
  ];
  const orderB = [
    candidate(keyB, { kid, status: "active" }),
    candidate(keyA, { kid: "other", status: "inactive" }),
  ];
  assert.equal(resolveJwtRs256VerificationKey(kid, orderA), keyB);
  assert.equal(resolveJwtRs256VerificationKey(kid, orderB), keyB);
});

test("rejects incompatible CryptoKey shapes", async () => {
  const kid = "key-2026.01";
  const { publicKey, privateKey } = await generateRs256Pair(2048);

  assertNull(kid, [candidate(privateKey)]);

  const rsaPss = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign", "verify"],
  );
  assertNull(kid, [candidate(rsaPss.publicKey)]);

  const ecdsa = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  assertNull(kid, [candidate(ecdsa.publicKey)]);

  const hmac = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
  assertNull(kid, [candidate(hmac)]);

  const sha384 = await generateRs256Pair(2048, "SHA-384");
  assertNull(kid, [candidate(sha384.publicKey)]);

  let generated1024 = null;
  try {
    generated1024 = await generateRs256Pair(1024);
  } catch {
    generated1024 = null;
  }
  if (generated1024 !== null) {
    assertNull(kid, [candidate(generated1024.publicKey)]);
  } else {
    const fake1024 = {
      type: "public",
      usages: ["verify"],
      algorithm: {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: { name: "SHA-256" },
      },
    };
    Object.setPrototypeOf(fake1024, CryptoKey.prototype);
    assertNull(kid, [candidate(/** @type {CryptoKey} */ (fake1024))]);
  }

  const wrongExponent = {
    type: "public",
    usages: ["verify"],
    algorithm: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 3]),
      hash: { name: "SHA-256" },
    },
  };
  Object.setPrototypeOf(wrongExponent, CryptoKey.prototype);
  assertNull(kid, [candidate(/** @type {CryptoKey} */ (wrongExponent))]);

  const noVerify = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  // extract public without verify usage via import would be hard; use synthetic
  const noVerifyFake = {
    type: "public",
    usages: ["encrypt"],
    algorithm: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: { name: "SHA-256" },
    },
  };
  Object.setPrototypeOf(noVerifyFake, CryptoKey.prototype);
  assertNull(kid, [candidate(/** @type {CryptoKey} */ (noVerifyFake))]);
  // real private key of sign-only pair is also rejected
  assertNull(kid, [candidate(noVerify.privateKey)]);

  const mimic = {
    type: "public",
    usages: ["verify"],
    algorithm: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: { name: "SHA-256" },
    },
  };
  Object.setPrototypeOf(mimic, CryptoKey.prototype);
  assertNull(kid, [candidate(/** @type {CryptoKey} */ (mimic))]);

  const hostileKey = new Proxy(publicKey, {
    get() {
      throw new Error("hostile key");
    },
  });
  assertNoThrow(kid, [candidate(/** @type {CryptoKey} */ (hostileKey))]);

  const transparentProxiedKey = new Proxy(publicKey, {});
  assertNull(kid, [candidate(/** @type {CryptoKey} */ (transparentProxiedKey))]);
});

test("rejects transparent Proxies on keyCandidates candidate and verificationKey", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const kid = "key-2026.01";

  assert.equal(
    resolveJwtRs256VerificationKey(kid, [candidate(publicKey)]),
    publicKey,
  );

  assertNull(kid, new Proxy([candidate(publicKey)], {}));
  assertNull(kid, [new Proxy(candidate(publicKey), {})]);
  assertNull(kid, [
    candidate(/** @type {CryptoKey} */ (new Proxy(publicKey, {}))),
  ]);
});

test("never throws never mutates and never calls subtle.verify", async () => {
  const { publicKey } = await generateRs256Pair(2048);
  const candidates = [candidate(publicKey)];
  const snapshot = JSON.stringify(
    candidates.map((entry) => ({
      kid: entry.kid,
      status: entry.status,
      sameKey: entry.verificationKey === publicKey,
    })),
  );

  const originalVerify = globalThis.crypto.subtle.verify;
  let verifyCalls = 0;
  globalThis.crypto.subtle.verify = async (...args) => {
    verifyCalls += 1;
    return originalVerify.apply(globalThis.crypto.subtle, args);
  };

  try {
    assert.equal(
      resolveJwtRs256VerificationKey("key-2026.01", candidates),
      publicKey,
    );
    assertNull("missing", candidates);
    assertNoThrow(undefined, undefined);
    assertNoThrow(
      "key-2026.01",
      new Proxy([], {
        get() {
          throw new Error("hostile");
        },
      }),
    );
    assert.equal(verifyCalls, 0);
  } finally {
    globalThis.crypto.subtle.verify = originalVerify;
  }

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

test("public API non-regression without PEM JWKS crypto or JWT libs", async () => {
  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);

  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof decodeJwtCompactStrict, "function");
  assert.equal(typeof isJwtClaimsPolicySatisfied, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");
  assert.equal(typeof verifyJwtRs256Signature, "function");
  assert.equal(typeof resolveJwtRs256VerificationKey, "function");

  const source = readFileSync(
    new URL("../src/jwt-kid-resolver.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("subtle.verify"), false);
  assert.equal(source.includes("importKey"), false);
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(source.includes("JWKS"), false);
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("process.env"), false);
});
