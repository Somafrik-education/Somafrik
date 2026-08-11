import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import {
  authorizationDecisionToHttpStatus,
  extractBearerCredential,
  isJwtTemporalPolicySatisfied,
} from "../src/index.js";

const EVALUATION_TIME = 1_000_000;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

test("normative V2.1m cases with evaluationTime = 1_000_000", () => {
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_900, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_030, 1_000_030, 1_000_900, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_031, 1_000_031, 1_000_900, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_031, 1_000_900, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(999_070, 999_070, 999_970, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(999_071, 999_071, 999_971, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_000, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_901, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 999_999, 1_000_900, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_100, 1_000_100, EVALUATION_TIME),
    false,
  );
});

test("accepts nbf === iat and exact lifetime bounds of 1 and 900 seconds", () => {
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_001, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_900, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_901, EVALUATION_TIME),
    false,
  );
});

test("applies iat and nbf future skew bounds exactly at +30 and +31", () => {
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_030, 1_000_030, 1_000_900, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_031, 1_000_031, 1_000_900, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_030, 1_000_900, EVALUATION_TIME),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_031, 1_000_900, EVALUATION_TIME),
    false,
  );
});

test("applies exclusive expiry bound at evaluationTime - 30 and - 29", () => {
  assert.equal(
    isJwtTemporalPolicySatisfied(999_070, 999_070, 999_970, EVALUATION_TIME),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(999_071, 999_071, 999_971, EVALUATION_TIME),
    true,
  );
  assert.equal(999_970, EVALUATION_TIME - 30);
  assert.equal(999_971, EVALUATION_TIME - 29);
});

test("handles evaluationTime < 30 without negative expiry threshold widening", () => {
  assert.equal(isJwtTemporalPolicySatisfied(0, 0, 1, 0), true);
  assert.equal(isJwtTemporalPolicySatisfied(0, 0, 900, 29), true);
  assert.equal(isJwtTemporalPolicySatisfied(0, 0, 1, 29), true);
  assert.equal(isJwtTemporalPolicySatisfied(30, 30, 31, 0), true);
  assert.equal(isJwtTemporalPolicySatisfied(31, 31, 32, 0), false);
  assert.equal(isJwtTemporalPolicySatisfied(59, 59, 60, 29), true);
  assert.equal(isJwtTemporalPolicySatisfied(60, 60, 61, 29), false);
  assert.equal(isJwtTemporalPolicySatisfied(0, 0, 1, 30), true);
  assert.equal(isJwtTemporalPolicySatisfied(0, 0, 1, 31), false);
});

test("handles values near Number.MAX_SAFE_INTEGER without overflow widening", () => {
  const evaluationTime = MAX_SAFE - 1000;
  assert.equal(
    isJwtTemporalPolicySatisfied(
      evaluationTime,
      evaluationTime,
      evaluationTime + 900,
      evaluationTime,
    ),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      evaluationTime + 30,
      evaluationTime + 30,
      evaluationTime + 900,
      evaluationTime,
    ),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      evaluationTime + 31,
      evaluationTime + 31,
      evaluationTime + 900,
      evaluationTime,
    ),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(MAX_SAFE - 900, MAX_SAFE - 900, MAX_SAFE, MAX_SAFE),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(MAX_SAFE - 30, MAX_SAFE - 30, MAX_SAFE, MAX_SAFE),
    true,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(MAX_SAFE, MAX_SAFE, MAX_SAFE, MAX_SAFE),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      MAX_SAFE - 901,
      MAX_SAFE - 901,
      MAX_SAFE,
      MAX_SAFE,
    ),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      MAX_SAFE - 930,
      MAX_SAFE - 930,
      MAX_SAFE - 30,
      MAX_SAFE,
    ),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      MAX_SAFE - 929,
      MAX_SAFE - 929,
      MAX_SAFE - 29,
      MAX_SAFE,
    ),
    true,
  );
  // Naive evaluationTime + 30 would lose precision near MAX_SAFE; policy must not widen.
  assert.equal(
    isJwtTemporalPolicySatisfied(MAX_SAFE, MAX_SAFE, MAX_SAFE, MAX_SAFE - 30),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(
      MAX_SAFE - 30,
      MAX_SAFE - 30,
      MAX_SAFE,
      MAX_SAFE - 30,
    ),
    true,
  );
});

test("rejects invalid types for each of the four parameters", () => {
  const valid = [1_000_000, 1_000_000, 1_000_900, EVALUATION_TIME];
  const invalidSamples = [
    ["undefined", undefined],
    ["null", null],
    ["numeric string", "1000000"],
    ["string 1", "1"],
    ["decimal", 1.5],
    ["NaN", Number.NaN],
    ["+Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["negative", -1],
    ["unsafe positive", MAX_SAFE + 1],
    ["unsafe negative", -MAX_SAFE - 1],
    ["true", true],
    ["false", false],
    ["bigint", 1n],
    ["symbol", Symbol("time")],
    ["object", {}],
    ["null-proto object", Object.create(null)],
    ["array", []],
    ["number array", [1_000_000]],
    ["function", () => 1_000_000],
    ["Number object", new Number(1_000_000)],
  ];

  for (let parameterIndex = 0; parameterIndex < 4; parameterIndex += 1) {
    for (const [label, sample] of invalidSamples) {
      const args = valid.slice();
      args[parameterIndex] = sample;
      assert.equal(
        isJwtTemporalPolicySatisfied(args[0], args[1], args[2], args[3]),
        false,
        `parameter ${parameterIndex} rejected for ${label}`,
      );
    }
  }

  assert.equal(isJwtTemporalPolicySatisfied(), false);
  assert.equal(isJwtTemporalPolicySatisfied(1_000_000), false);
  assert.equal(isJwtTemporalPolicySatisfied(1_000_000, 1_000_000), false);
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_900),
    false,
  );
});

test("never throws on hostile inputs and never authorizes access", () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile proxy");
      },
      valueOf() {
        throw new Error("hostile valueOf");
      },
    },
  );
  assert.equal(isJwtTemporalPolicySatisfied(hostile, hostile, hostile, hostile), false);
  assert.equal(
    isJwtTemporalPolicySatisfied(
      {
        valueOf() {
          throw new Error("valueOf");
        },
      },
      1,
      2,
      1,
    ),
    false,
  );
  assert.equal(
    isJwtTemporalPolicySatisfied(1_000_000, 1_000_000, 1_000_900, EVALUATION_TIME),
    true,
  );
});

test("public API surface adds only isJwtTemporalPolicySatisfied without crypto JWT", () => {
  const require = createRequire(import.meta.url);
  const apiPackage = require("../package.json");
  assert.equal(apiPackage.dependencies, undefined);
  assert.equal(apiPackage.devDependencies, undefined);

  assert.equal(typeof authorizationDecisionToHttpStatus, "function");
  assert.equal(typeof extractBearerCredential, "function");
  assert.equal(typeof isJwtTemporalPolicySatisfied, "function");

  assert.equal(
    extractBearerCredential("Bearer ExactTokenValue"),
    "ExactTokenValue",
  );
  assert.equal(authorizationDecisionToHttpStatus("unknown"), 401);

  const source = require("node:fs").readFileSync(
    new URL("../src/jwt-temporal-policy.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("Date.now"), false);
  assert.equal(source.includes("new Date"), false);
  assert.equal(source.includes("atob"), false);
  assert.equal(source.includes("Buffer"), false);
  assert.equal(source.includes("createVerify"), false);
  assert.equal(source.includes("createPublicKey"), false);
  assert.equal(source.includes("jsonwebtoken"), false);
  assert.equal(source.includes("jose"), false);
  assert.equal(/base64/i.test(source), false);
});
