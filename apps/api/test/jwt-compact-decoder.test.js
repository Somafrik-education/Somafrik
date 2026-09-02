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
} from "../src/index.js";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

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

function compactFromParts(headerObject, payloadObject, signatureBytes) {
  const headerSegment = encodeBase64Url(utf8(JSON.stringify(headerObject)));
  const payloadSegment = encodeBase64Url(utf8(JSON.stringify(payloadObject)));
  const signatureSegment = encodeBase64Url(signatureBytes);
  return {
    token: `${headerSegment}.${payloadSegment}.${signatureSegment}`,
    headerSegment,
    payloadSegment,
    signatureSegment,
  };
}

const NOMINAL_HEADER = { alg: "RS256", typ: "JWT", kid: "key-2026.01" };
const NOMINAL_PAYLOAD = {
  iss: "https://auth.somafrik.example/v2",
  aud: "somafrik-api-v2",
  sub: "USR-2026-0001",
  sid: "SID-2026-0001",
  iat: 1_000_000,
  nbf: 1_000_000,
  exp: 1_000_900,
  jti: "JTI-2026-0001",
};
const NOMINAL_SIGNATURE = new Uint8Array([1, 2, 3, 4, 5]);

test("decodes a nominal compact JWT with exact returned properties", () => {
  const { token, headerSegment, payloadSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const decoded = decodeJwtCompactStrict(token);
  assert.notEqual(decoded, null);
  assert.deepEqual(decoded.protectedHeader, NOMINAL_HEADER);
  assert.deepEqual(decoded.payload, NOMINAL_PAYLOAD);
  assert.equal(decoded.signingInput, `${headerSegment}.${payloadSegment}`);
  assert.equal(decoded.signature instanceof Uint8Array, true);
  assert.equal(decoded.signature.constructor, Uint8Array);
  assert.equal(Buffer.isBuffer(decoded.signature), false);
  assert.deepEqual([...decoded.signature], [...NOMINAL_SIGNATURE]);
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.protectedHeader), true);
  assert.equal(Object.isFrozen(decoded.payload), true);
  assert.equal(decoded.signature instanceof Uint8Array, true);
  assert.equal(Buffer.isBuffer(decoded.signature), false);
});

test("rejects absent primitives hostile objects and length 4097", () => {
  assert.equal(decodeJwtCompactStrict(), null);
  assert.equal(decodeJwtCompactStrict(undefined), null);
  assert.equal(decodeJwtCompactStrict(null), null);
  assert.equal(decodeJwtCompactStrict(1), null);
  assert.equal(decodeJwtCompactStrict(true), null);
  assert.equal(decodeJwtCompactStrict({}), null);
  assert.equal(decodeJwtCompactStrict([]), null);
  assert.equal(decodeJwtCompactStrict(""), null);
  assert.equal(decodeJwtCompactStrict("a".repeat(4097)), null);

  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile");
      },
      ownKeys() {
        throw new Error("hostile");
      },
    },
  );
  assert.equal(decodeJwtCompactStrict(hostile), null);
});

test("rejects invalid segment counts and empty segments", () => {
  const { token } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const [h, p, s] = token.split(".");
  assert.equal(decodeJwtCompactStrict(h), null);
  assert.equal(decodeJwtCompactStrict(`${h}.${p}`), null);
  assert.equal(decodeJwtCompactStrict(`${h}.${p}.${s}.x`), null);
  assert.equal(decodeJwtCompactStrict(`.${p}.${s}`), null);
  assert.equal(decodeJwtCompactStrict(`${h}..${s}`), null);
  assert.equal(decodeJwtCompactStrict(`${h}.${p}.`), null);
  assert.equal(decodeJwtCompactStrict(0), null);
  assert.equal(decodeJwtCompactStrict(1), null);
  assert.equal(decodeJwtCompactStrict(2), null);
  assert.equal(decodeJwtCompactStrict(4), null);
});

test("rejects +, /, =, spaces, controls and Unicode in segments", () => {
  const { headerSegment, payloadSegment, signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}+.${payloadSegment}.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}/${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}.${signatureSegment}=`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment} .${payloadSegment}.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}\t.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}.${signatureSegment}é`),
    null,
  );
});

test("rejects Base64URL length mod 4 === 1 and non-canonical residual bits", () => {
  const { headerSegment, payloadSegment, signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  assert.equal(headerSegment.length % 4 === 1, false);
  assert.equal(
    decodeJwtCompactStrict(`A.${payloadSegment}.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.A.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}.A`),
    null,
  );

  // "_x" decodes permissively like "_w" but is non-canonical.
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}._x`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(`_x.${payloadSegment}.${signatureSegment}`),
    null,
  );
});

test("rejects invalid UTF-8 and forbids U+FFFD replacement acceptance", () => {
  const { payloadSegment, signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const invalidUtf8 = encodeBase64Url(new Uint8Array([0xff]));
  assert.equal(
    decodeJwtCompactStrict(`${invalidUtf8}.${payloadSegment}.${signatureSegment}`),
    null,
  );
  assert.equal(
    decodeJwtCompactStrict(
      `${encodeBase64Url(utf8('{"alg":"RS256"}'))}.${invalidUtf8}.${signatureSegment}`,
    ),
    null,
  );
});

test("rejects invalid JSON and non-object roots", () => {
  const { signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const roots = ["null", "[]", '"string"', "1", "true", "false"];
  for (const root of roots) {
    const header = encodeBase64Url(utf8(root));
    const payload = encodeBase64Url(utf8('{"ok":true}'));
    assert.equal(decodeJwtCompactStrict(`${header}.${payload}.${signatureSegment}`), null);
    assert.equal(decodeJwtCompactStrict(`${payload}.${header}.${signatureSegment}`), null);
  }
  const invalidJson = encodeBase64Url(utf8("{"));
  const validObject = encodeBase64Url(utf8('{"ok":true}'));
  assert.equal(
    decodeJwtCompactStrict(`${invalidJson}.${validObject}.${signatureSegment}`),
    null,
  );
});

test("rejects duplicate keys at root and nested levels", () => {
  const { signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const payload = encodeBase64Url(utf8('{"ok":true}'));
  const rootDup = encodeBase64Url(utf8('{"a":1,"a":2}'));
  assert.equal(
    decodeJwtCompactStrict(`${rootDup}.${payload}.${signatureSegment}`),
    null,
  );
  const nestedDup = encodeBase64Url(utf8('{"outer":{"a":1,"a":2}}'));
  assert.equal(
    decodeJwtCompactStrict(`${nestedDup}.${payload}.${signatureSegment}`),
    null,
  );
  const arrayNestedDup = encodeBase64Url(utf8('{"items":[{"a":1,"a":2}]}'));
  assert.equal(
    decodeJwtCompactStrict(`${arrayNestedDup}.${payload}.${signatureSegment}`),
    null,
  );
});

test("rejects dangerous keys at root and nested levels", () => {
  const { signatureSegment } = compactFromParts(
    NOMINAL_HEADER,
    NOMINAL_PAYLOAD,
    NOMINAL_SIGNATURE,
  );
  const payload = encodeBase64Url(utf8('{"ok":true}'));
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const root = encodeBase64Url(utf8(`{"${key}":1,"ok":true}`));
    assert.equal(
      decodeJwtCompactStrict(`${root}.${payload}.${signatureSegment}`),
      null,
    );
    const nested = encodeBase64Url(utf8(`{"outer":{"${key}":1}}`));
    assert.equal(
      decodeJwtCompactStrict(`${nested}.${payload}.${signatureSegment}`),
      null,
    );
  }
});

test("rejects empty or non-canonical signatures and preserves signingInput bytes", () => {
  const headerSegment = encodeBase64Url(utf8(JSON.stringify(NOMINAL_HEADER)));
  const payloadSegment = encodeBase64Url(utf8(JSON.stringify(NOMINAL_PAYLOAD)));

  // Empty signature bytes cannot be represented canonically as a non-empty
  // Base64URL segment that decodes to zero octets with canonicity.
  assert.equal(
    decodeJwtCompactStrict(`${headerSegment}.${payloadSegment}.`),
    null,
  );

  const decoded = decodeJwtCompactStrict(
    `${headerSegment}.${payloadSegment}.${encodeBase64Url(NOMINAL_SIGNATURE)}`,
  );
  assert.notEqual(decoded, null);
  assert.equal(decoded.signingInput, `${headerSegment}.${payloadSegment}`);
  assert.equal(decoded.signingInput.includes(headerSegment), true);
  assert.equal(decoded.signature instanceof Uint8Array, true);
  assert.equal(Object.getPrototypeOf(decoded.signature), Uint8Array.prototype);
});

test("never throws on hostile inputs and keeps public API surface non-regressive", () => {
  const cases = [
    undefined,
    null,
    0,
    1,
    2,
    4,
    true,
    false,
    {},
    [],
    () => "a.b.c",
    new Date(),
    new Proxy(
      {},
      {
        get() {
          throw new Error("hostile");
        },
      },
    ),
    "a".repeat(4097),
    "....",
    "a.b",
    "a.b.c.d",
  ];
  for (const sample of cases) {
    assert.doesNotThrow(() => {
      assert.equal(decodeJwtCompactStrict(sample), null);
    });
  }

  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);
  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof isJwtClaimsPolicySatisfied, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");
  assert.equal(typeof decodeJwtCompactStrict, "function");

  const source = readFileSync(
    new URL("../src/jwt-compact-decoder.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(source.includes("createVerify"), false);
  assert.equal(source.includes("isJwtClaimsPolicySatisfied"), false);
  assert.equal(source.includes("Date.now"), false);
});
