import assert from "node:assert/strict";
import { test } from "node:test";
import { canDiagnoseNfc, classifyDiagnosisNdef, sanitizeDiagnosisResult, visibleDiagnosisHolder } from "./studentCardNfcDiagnosis";

test("R3-2 rejects unauthenticated and platform-only sessions", () => {
  assert.equal(canDiagnoseNfc(null), false);
  assert.equal(canDiagnoseNfc({ roleKey: "SUPER_ADMIN", permissions: ["Élèves:UPDATE"] }), false);
  assert.equal(canDiagnoseNfc({ roleKey: "SCHOOL_ADMIN", permissions: [] }), false);
  assert.equal(canDiagnoseNfc({ roleKey: "SCHOOL_ADMIN", permissions: ["Élèves:UPDATE"] }), true);
  assert.equal(canDiagnoseNfc({ roleKeys: ["SCHOOL_ADMIN", "PARENT"], permissions: ["Élèves:UPDATE"] }), false);
});
test("R3-2 classifies NDEF without leaking the token secret", () => {
  assert.deepEqual(classifyDiagnosisNdef(""), { state: "empty" });
  const token = "A".repeat(22) + "." + "B".repeat(43);
  assert.deepEqual(classifyDiagnosisNdef("somafrik:card:" + token), { state: "somafrik", publicId: "A".repeat(22) });
  assert.deepEqual(classifyDiagnosisNdef("https://example.org"), { state: "foreign" });
});
test("R3-2 hides cross-school holder even if server payload is malformed", () => {
  const result = sanitizeDiagnosisResult({
    code: "OTHER_SCHOOL", sameSchool: false, message: "Autre établissement.",
    physicalSource: "client_declared", physical: "BLANK", recoverable: true,
    actions: ["reencode_for_holder"], holder: { firstName: "SECRET" },
    card: { id: "secret-id" },
  });
  assert.equal(visibleDiagnosisHolder(result), null);
  assert.equal(result.card, undefined);
  assert.deepEqual(result.actions, ["contact_owner_school"]);
  assert.equal(result.recoverable, false);
});
test("R3-2 requires explicit client_declared marker", () => {
  assert.throws(() => sanitizeDiagnosisResult({ code: "UID_UNKNOWN", message: "", sameSchool: null, actions: [] }));
});
