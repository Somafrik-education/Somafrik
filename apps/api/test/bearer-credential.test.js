import assert from "node:assert/strict";
import test from "node:test";

import { extractBearerCredential } from "../src/index.js";

test("extracts an exact valid Bearer credential without normalization", () => {
  assert.equal(extractBearerCredential("Bearer abc.def_ghi-123"), "abc.def_ghi-123");
  assert.equal(extractBearerCredential("Bearer a~b+c/d=="), "a~b+c/d==");
  assert.equal(
    extractBearerCredential("Bearer ExactTokenValue"),
    "ExactTokenValue",
  );
});

test("accepts case-insensitive Bearer scheme with exactly one ASCII space", () => {
  assert.equal(extractBearerCredential("bearer tokenvalue"), "tokenvalue");
  assert.equal(extractBearerCredential("BEARER tokenvalue"), "tokenvalue");
  assert.equal(extractBearerCredential("BeArEr tokenvalue"), "tokenvalue");
  assert.equal(extractBearerCredential("Bearer  tokenvalue"), null);
  assert.equal(extractBearerCredential("Bearer\ttokenvalue"), null);
  assert.equal(extractBearerCredential("Bearer\u00A0tokenvalue"), null);
  assert.equal(extractBearerCredential("Bearer"), null);
  assert.equal(extractBearerCredential("Bearer "), null);
});

test("rejects empty oversized and forbidden credential characters", () => {
  assert.equal(extractBearerCredential("Bearer "), null);
  assert.equal(extractBearerCredential(`Bearer ${"a".repeat(4097)}`), null);
  assert.equal(extractBearerCredential(`Bearer ${"a".repeat(4096)}`), "a".repeat(4096));
  assert.equal(extractBearerCredential("Bearer token value"), null);
  assert.equal(extractBearerCredential("Bearer token\tvalue"), null);
  assert.equal(extractBearerCredential("Bearer token,value"), null);
  assert.equal(extractBearerCredential("Bearer token;value"), null);
  assert.equal(extractBearerCredential("Bearer token\"value"), null);
  assert.equal(extractBearerCredential("Bearer =abc"), null);
  assert.equal(extractBearerCredential("Bearer ab=cd"), null);
  assert.equal(extractBearerCredential("Bearer ab\u0000cd"), null);
  assert.equal(extractBearerCredential("Bearer ab\u0085cd"), null);
  assert.equal(extractBearerCredential("Bearer ab\u009Fcd"), null);
});

test("rejects arrays duplicates commas and multi-header shapes", () => {
  assert.equal(extractBearerCredential(["Bearer token"]), null);
  assert.equal(extractBearerCredential(["Bearer a", "Bearer b"]), null);
  assert.equal(extractBearerCredential("Bearer a, Bearer b"), null);
  assert.equal(extractBearerCredential("Bearer a,Bearer b"), null);
  assert.equal(extractBearerCredential("Basic abc"), null);
  assert.equal(extractBearerCredential("Token abc"), null);
});

test("returns null without throwing for hostile objects and proxies", () => {
  let getterCalls = 0;
  const hostile = {
    get length() {
      getterCalls += 1;
      throw new Error("hostile getter");
    },
    toString() {
      getterCalls += 1;
      return "Bearer secret";
    },
  };
  assert.equal(extractBearerCredential(hostile), null);
  assert.equal(getterCalls, 0);

  const hostileProxy = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile proxy");
      },
      ownKeys() {
        throw new Error("hostile proxy");
      },
    },
  );
  assert.equal(extractBearerCredential(hostileProxy), null);
  assert.equal(extractBearerCredential(null), null);
  assert.equal(extractBearerCredential(undefined), null);
  assert.equal(extractBearerCredential(1), null);
  assert.equal(extractBearerCredential(true), null);
});

test("does not extract credentials from URLs or query strings", () => {
  assert.equal(
    extractBearerCredential("https://api.example/x?access_token=secret"),
    null,
  );
  assert.equal(
    extractBearerCredential("https://api.example/x?token=Bearer%20secret"),
    null,
  );
  assert.equal(
    extractBearerCredential("/api/report.pdf?access_token=abc.def"),
    null,
  );
  assert.equal(extractBearerCredential("Bearer%20abc"), null);
});
