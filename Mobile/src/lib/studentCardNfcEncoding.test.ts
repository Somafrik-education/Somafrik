import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeNfcCard, verifyOrLockNfcCard, retryAndEncodeNfcCard, identifyNtag, normalizeNtagUid, ndefForCard, type IssuedNfcCard, type NfcEncoderHardware, type NfcEnrollmentApi } from "./studentCardNfcEncoding";
import { studentCardEnrollmentAccess } from "./studentCardEnrollmentAccess";
const UID = "04112233445566";
const TOKEN = `${"A".repeat(22)}.${"B".repeat(43)}`;
function fixture() {
  const card: IssuedNfcCard = { id: "c1", publicId: "A".repeat(22), cardToken: TOKEN, medium: "nfc", status: "active", nfc: { uid: UID, tagType: "NTAG213", state: "pending" } };
  let value = ""; let readOnly = false; const events: string[] = [];
  const hardware: NfcEncoderHardware = {
    async inspect() { events.push("inspect"); return { uid: UID, tagType: "NTAG213" }; },
    async openNdef(uid) { events.push("open"); assert.equal(uid, UID); },
    async readText() { events.push("read"); return value; },
    async writeText(v) { events.push("write"); value = v; },
    async isReadOnly() { return readOnly; },
    async makeReadOnly() { events.push("lock"); readOnly = true; },
    async close() { events.push("close"); },
  };
  const api: NfcEnrollmentApi = {
    async issue() { return card; },
    async retry() { events.push("retry"); return { ...card, reissued: true }; },
    async confirm(c, token, locked) { events.push(locked ? "confirm-locked" : "confirm-encoded"); assert.equal(token, TOKEN); return { ...c, nfc: { ...c.nfc!, state: locked ? "locked" : "encoded" } }; },
  };
  return { card, hardware, api, events, setValue: (v: string) => { value = v; }, setReadOnly: (v: boolean) => { readOnly = v; } };
}
test("NTAG213/216 recognized by full GET_VERSION, not by UID alone", () => {
  assert.equal(identifyNtag(UID, [0,4,4,2,1,0,15,3]).tagType, "NTAG213");
  assert.equal(identifyNtag(UID, [0,4,4,2,1,0,19,3]).tagType, "NTAG216");
  for (const version of [[], [0,4,4,2,1,0,17,3], [0,4,3,2,1,0,15,3]]) assert.throws(() => identifyNtag(UID, version));
  assert.throws(() => normalizeNtagUid("11223344"));
});
test("New card: write then read-back then server confirmation, no automatic lock", async () => {
  const f = fixture();
  assert.equal((await encodeNfcCard(f.hardware, f.api, f.card)).nfc?.state, "encoded");
  assert.deepEqual(f.events, ["open", "read", "write", "read", "confirm-encoded", "close"]);
});
test("Foreign payload, locked blank card, mismatched card: no write or confirmation", async () => {
  for (const mode of ["foreign", "locked", "mismatch"]) {
    const f = fixture();
    if (mode === "foreign") f.setValue("other-system:private-data");
    if (mode === "locked") f.setReadOnly(true);
    if (mode === "mismatch") f.hardware.openNdef = async () => { throw new Error("wrong uid"); };
    await assert.rejects(encodeNfcCard(f.hardware, f.api, f.card));
    assert.ok(!f.events.includes("write")); assert.ok(!f.events.includes("confirm-encoded")); assert.equal(f.events.at(-1), "close");
  }
});
test("Read-back mismatch fails closed before confirmation and lock", async () => {
  const f = fixture(); f.hardware.writeText = async () => { f.events.push("write"); };
  await assert.rejects(encodeNfcCard(f.hardware, f.api, f.card));
  assert.ok(!f.events.includes("confirm-encoded")); assert.ok(!f.events.includes("lock"));
});
test("Retry after confirmation outage reads same capability without rewriting", async () => {
  const f = fixture();
  const good = f.api.confirm;
  f.api.confirm = async () => { throw new Error("offline"); };
  await assert.rejects(encodeNfcCard(f.hardware, f.api, f.card));
  f.api.confirm = good;
  await encodeNfcCard(f.hardware, f.api, f.card);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
});
test("Lock only after server capability validation and same UID/model inspection", async () => {
  const f = fixture(); f.setValue(ndefForCard(TOKEN));
  assert.equal((await verifyOrLockNfcCard(f.hardware, f.api, f.card, true)).nfc?.state, "locked");
  assert.ok(f.events.indexOf("confirm-encoded") < f.events.indexOf("lock"));
  assert.ok(f.events.indexOf("lock") < f.events.indexOf("confirm-locked"));
  assert.equal(f.events.at(-1), "close");
});
test("Wrong UID/model/secret, backend denied, or no lock: no irreversible write", async () => {
  for (const mode of ["uid", "type", "token", "denied", "verify-only"]) {
    const f = fixture(); f.setValue(ndefForCard(TOKEN));
    if (mode === "uid") f.hardware.inspect = async () => ({ uid: "04778899001122", tagType: "NTAG213" });
    if (mode === "type") f.hardware.inspect = async () => ({ uid: UID, tagType: "NTAG216" });
    if (mode === "token") f.setValue(ndefForCard(`${"C".repeat(22)}.${"B".repeat(43)}`));
    if (mode === "denied") f.api.confirm = async () => { throw new Error("403"); };
    if (mode === "verify-only") await verifyOrLockNfcCard(f.hardware, f.api, f.card, false);
    else await assert.rejects(verifyOrLockNfcCard(f.hardware, f.api, f.card, true));
    assert.ok(!f.events.includes("lock")); assert.ok(!f.events.includes("write"));
  }
});
test("False lock success is not reported to backend", async () => {
  const f = fixture(); f.setValue(ndefForCard(TOKEN));
  f.hardware.makeReadOnly = async () => { f.events.push("lock"); };
  await assert.rejects(verifyOrLockNfcCard(f.hardware, f.api, f.card, true));
  assert.ok(!f.events.includes("confirm-locked"));
});
test("UI permission uses school READ + UPDATE; platform ALL_PRIVILEGES never grants enrollment", () => {
  assert.deepEqual(studentCardEnrollmentAccess({ role: "school_admin", permissions: ["Élèves:READ", "Élèves:UPDATE"] }), { canRead: true, canUpdate: true });
  assert.deepEqual(studentCardEnrollmentAccess({ role: "teacher", permissions: ["Élèves:READ"] }), { canRead: true, canUpdate: false });
  for (const role of ["super_admin", "country_admin", "parent_student", "student"]) assert.deepEqual(studentCardEnrollmentAccess({ role, permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"] }), { canRead: false, canUpdate: false });
});

test("Interrupted blank reservation rotates and encodes the same UID", async () => {
  const f = fixture();
  assert.equal((await retryAndEncodeNfcCard(f.hardware, f.api, f.card)).nfc?.state, "encoded");
  assert.ok(f.events.indexOf("retry") < f.events.indexOf("write"));
});
test("Pending physically locked card recovers without secret rotation or writes", async () => {
  const f = fixture(); f.setValue(ndefForCard(TOKEN)); f.setReadOnly(true);
  assert.equal((await retryAndEncodeNfcCard(f.hardware, f.api, f.card)).nfc?.state, "locked");
  assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
});
test("Retry cannot overwrite another publicId or a blank locked card", async () => {
  for (const locked of [true, false]) {
    const f = fixture(); f.setReadOnly(locked);
    if (!locked) f.setValue(ndefForCard(`${"C".repeat(22)}.${"B".repeat(43)}`));
    await assert.rejects(retryAndEncodeNfcCard(f.hardware, f.api, f.card));
    assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
  }
});
test("Only an explicit pending retry can rewrite the previous secret of the same publicId", async () => {
  const f = fixture(); f.setValue(ndefForCard(`${f.card.publicId}.${"C".repeat(43)}`));
  await assert.rejects(encodeNfcCard(f.hardware, f.api, f.card));
  f.card.reissued = true;
  await encodeNfcCard(f.hardware, f.api, f.card);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
});
