import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { safeLogger, sanitizeUserFacingError } from "../services/safeLogger";
import { nfcErrorCopy, createNfcEnrollmentApi } from "./studentCardNfcEncoding";

const capability = `${"A".repeat(22)}.${"B".repeat(43)}`;
const ndef = `somafrik:card:${capability}`;
for (const form of ["string", "error", "nested", "array"] as const)
  test(`NFC security: logger redacts canonical capability in ${form}`, () => {
    const captured: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args) => {
      captured.push(args);
    };
    try {
      const value =
        form === "string"
          ? `native failure ${ndef}`
          : form === "error"
            ? new Error(`native failure ${capability}`)
            : form === "array"
              ? [{ value: ndef }, capability]
              : { deep: { cardToken: capability, diagnostic: ndef } };
      safeLogger.warn("nfc diagnostic", value);
      const rendered = JSON.stringify(captured);
      assert.equal(
        rendered.includes(capability),
        false,
        "Canonical NFC capability leaked to logger",
      );
      assert.equal(
        rendered.includes("B".repeat(43)),
        false,
        "NFC secret leaked to logger",
      );
      assert.ok(rendered.includes("nfc diagnostic"));
    } finally {
      console.warn = original;
    }
  });
for (const key of [
  "cardToken",
  "card_token",
  "token_hash",
  "capability",
  "secret",
])
  test(`NFC security: logger redacts sensitive ${key} field without depending on its value format`, () => {
    const captured: unknown[][] = [],
      original = console.error;
    console.error = (...args) => {
      captured.push(args);
    };
    try {
      safeLogger.error({
        [key]: "fixture-sensitive-marker",
        status: "pending",
      });
    } finally {
      console.error = original;
    }
    const rendered = JSON.stringify(captured);
    assert.equal(rendered.includes("fixture-sensitive-marker"), false);
    assert.ok(rendered.includes("pending"));
  });
test("NFC security: user-facing sanitizer refuses canonical capability repeatedly", () => {
  for (let i = 0; i < 3; i++)
    assert.equal(
      sanitizeUserFacingError(new Error(`failure ${ndef}`), "Safe error"),
      "Safe error",
    );
  assert.equal(
    sanitizeUserFacingError(new Error("Carte indisponible.")),
    "Carte indisponible.",
  );
});
test("NFC security: programming error dictionary never propagates native or Backend capability text", () => {
  for (const code of [
    "NFC_FOREIGN",
    "NFC_READBACK",
    "STUDENT_CARD_NFC_OPERATION_MISMATCH",
    "UNKNOWN",
  ]) {
    assert.equal(
      nfcErrorCopy(Object.assign(new Error(ndef), { code })).includes(
        capability,
      ),
      false,
    );
  }
});
test("NFC security: enrollment engines do not import persistence, outbox or side-effect APIs", () => {
  for (const name of [
    "studentCardNfcEncoding.ts",
    "studentCardNfcBatch.ts",
    "studentCardNfcEncoderNative.ts",
  ]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /AsyncStorage|SecureStore|sqlite|outbox|makeReadOnly|\/attendance|\/payments|\/transport/,
    );
  }
});
test("Canonical recovery card list explicitly bypasses HTTP cache", async () => {
  let options: unknown;
  const api = createNfcEnrollmentApi(
    async <T>(_path: string, init?: unknown): Promise<T> => {
      options = init;
      return { cards: [], nfcEnabled: true } as T;
    },
  );
  await api.list("11111111-1111-4111-8111-111111111111");
  assert.deepEqual(options, { cache: "no-store" });
});
