// NFC-P0-RECOVERY-02 — visibility and read-only physical recovery (mocks only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  canRecoverExpiredNfcCard, createIndividualNfcFlow, nfcErrorCopy,
  type EnrollmentCard, type NfcEncoderHardware, type NfcEnrollmentApi, type NtagIdentity,
} from "./studentCardNfcEncoding";
import { createNfcBatch } from "./studentCardNfcBatch";

const UID = "04A1B2C3D4E5F6";
const PUB = "A".repeat(22);
const TOKEN = `${PUB}.${"B".repeat(43)}`;
const nfc = (over: Partial<NonNullable<EnrollmentCard["nfc"]>> = {}) => ({
  uid: UID, tagType: "NTAG216" as const, state: "pending" as const, operationId: randomUUID(),
  expiresAt: new Date(Date.now() - 60_000).toISOString(), replacesCardId: null, ...over,
});
const expired = (over: Partial<EnrollmentCard> = {}): EnrollmentCard => ({
  id: "c1", publicId: PUB, medium: "nfc", status: "revoked", revokeReason: "nfc_reservation_expired", nfc: nfc(), ...over,
});

test("T11 recovery button only for a server-expired, non-replacement reservation without conflict", () => {
  const card = expired();
  assert.equal(canRecoverExpiredNfcCard(card, [card]), true);
  for (const reason of ["lost", "replaced", "revoked", "nfc_abandoned", "security", null]) {
    const other = expired({ revokeReason: reason });
    assert.equal(canRecoverExpiredNfcCard(other, [other]), false, String(reason));
  }
  for (const status of ["issued", "active", "lost", "replaced"]) {
    const other = expired({ status });
    assert.equal(canRecoverExpiredNfcCard(other, [other]), false, status);
  }
  const replacement = expired({ nfc: nfc({ replacesCardId: "old" }) });
  assert.equal(canRecoverExpiredNfcCard(replacement, [replacement]), false);
  const encoded = expired({ nfc: nfc({ state: "encoded" }) });
  assert.equal(canRecoverExpiredNfcCard(encoded, [encoded]), false);
  assert.equal(canRecoverExpiredNfcCard(expired({ nfc: null }), []), false);
  const active: EnrollmentCard = { id: "c2", publicId: "x", medium: "nfc", status: "active", nfc: nfc({ uid: "04000000000002", state: "encoded" }) };
  const live: EnrollmentCard = { id: "c3", publicId: "y", medium: "nfc", status: "issued", nfc: nfc({ uid: "04000000000003" }) };
  assert.equal(canRecoverExpiredNfcCard(card, [card, active]), false);
  assert.equal(canRecoverExpiredNfcCard(card, [card, live]), false);
  // A still-issued reservation past its deadline is not offered: the server must materialise it first.
  const stale = expired({ status: "issued", revokeReason: null });
  assert.equal(canRecoverExpiredNfcCard(stale, [stale]), false);
});

type Chip = { identity: NtagIdentity; ndef: string; writes: number; foreignContent?: boolean };
function hardware(chip: Chip): NfcEncoderHardware & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async availability() { calls.push("availability"); },
    async inspect() { calls.push("inspect"); return chip.identity; },
    async openNdef() { calls.push("openNdef"); },
    async readText() {
      calls.push("readText");
      if (chip.foreignContent) throw Object.assign(new Error("NFC_FOREIGN"), { code: "NFC_FOREIGN" });
      return chip.ndef;
    },
    async writeText() { chip.writes++; calls.push("write"); throw new Error("write forbidden in recovery"); },
    async isReadOnly() { calls.push("isReadOnly"); return false; },
    async close() { calls.push("close"); },
  };
}
function api(card: EnrollmentCard, extra: EnrollmentCard[] = []) {
  const recovered: string[] = [];
  const value: NfcEnrollmentApi = {
    async list() { return { nfcEnabled: true, cards: [card, ...extra] }; },
    async issue() { throw new Error("no issue in recovery"); },
    async replace() { throw new Error("no replace in recovery"); },
    async retry() { throw new Error("no retry in recovery"); },
    async confirm() { throw new Error("no confirm in recovery"); },
    async recover(current, token) {
      recovered.push(token);
      return { ...current, status: "active", revokeReason: null, nfc: { ...current.nfc!, state: "encoded" } };
    },
  };
  return { value, recovered };
}
const flow = (a: NfcEnrollmentApi, h: NfcEncoderHardware) =>
  createIndividualNfcFlow({ studentId: "s1", api: a, hardware: h, uuid: randomUUID, valid: () => true, phase() {} });

test("T12 valid Somafrik NDEF: recovered with zero write, no rotation, no confirm", async () => {
  const chip: Chip = { identity: { uid: UID, tagType: "NTAG216" }, ndef: `somafrik:card:${TOKEN}`, writes: 0 };
  const hw = hardware(chip); const backend = api(expired());
  const result = await flow(backend.value, hw).recover(expired());
  assert.equal(result.status, "active"); assert.equal(result.nfc?.state, "encoded");
  assert.deepEqual(backend.recovered, [TOKEN]);
  assert.equal(chip.writes, 0); assert.equal(hw.calls.includes("write"), false);
});

async function refused(chip: Chip, code: string, card = expired(), extra: EnrollmentCard[] = []) {
  const hw = hardware(chip); const backend = api(card, extra);
  await assert.rejects(flow(backend.value, hw).recover(card), { code });
  assert.equal(chip.writes, 0); assert.equal(backend.recovered.length, 0);
  assert.ok(nfcErrorCopy({ code }).includes("Aucune") || code === "STUDENT_CARD_INVALID_STATE");
}

test("T13 empty, invalid, foreign or other-card content: diagnosis, no activation, no write", async () => {
  const id = { uid: UID, tagType: "NTAG216" as const };
  await refused({ identity: id, ndef: "", writes: 0 }, "NFC_RECOVERY_EMPTY");
  await refused({ identity: id, ndef: "somafrik:card:short.bad", writes: 0 }, "NFC_RECOVERY_INVALID_CONTENT");
  await refused({ identity: id, ndef: "https://vendor.example", writes: 0 }, "NFC_RECOVERY_INVALID_CONTENT");
  await refused({ identity: id, ndef: "", writes: 0, foreignContent: true }, "NFC_RECOVERY_FOREIGN_CONTENT");
  await refused({ identity: id, ndef: `somafrik:card:${"C".repeat(22)}.${"B".repeat(43)}`, writes: 0 }, "NFC_RECOVERY_OTHER_CARD");
});

test("T13b UID or physical model mismatch and ineligible states are refused before any read", async () => {
  const ndef = `somafrik:card:${TOKEN}`;
  await refused({ identity: { uid: "04000000000009", tagType: "NTAG216" }, ndef, writes: 0 }, "NFC_RECOVERY_UID_MISMATCH");
  // The reservation says NTAG216: a chip read as NTAG213 is never presumed to match.
  await refused({ identity: { uid: UID, tagType: "NTAG213" }, ndef, writes: 0 }, "NFC_RECOVERY_MODEL_MISMATCH");
  const lost = expired({ revokeReason: "lost" });
  await refused({ identity: { uid: UID, tagType: "NTAG216" }, ndef, writes: 0 }, "STUDENT_CARD_INVALID_STATE", lost);
  const active: EnrollmentCard = { id: "c2", publicId: "x", medium: "nfc", status: "active", nfc: nfc({ uid: "04000000000002", state: "encoded" }) };
  await refused({ identity: { uid: UID, tagType: "NTAG216" }, ndef, writes: 0 }, "STUDENT_CARD_INVALID_STATE", expired(), [active]);
});

test("T13c unsupported chip at inspection is reported as a diagnosis", async () => {
  const hw = hardware({ identity: { uid: UID, tagType: "NTAG216" }, ndef: "", writes: 0 });
  hw.inspect = async () => { throw Object.assign(new Error("NFC_FOREIGN"), { code: "NFC_FOREIGN" }); };
  const backend = api(expired());
  await assert.rejects(flow(backend.value, hw).recover(expired()), { code: "NFC_RECOVERY_UNSUPPORTED_CHIP" });
});

test("T14 collective programming keeps its contract: no recover in batch flows, eligibility unchanged", async () => {
  const snapshots: unknown[] = [];
  const card = expired();
  const backend = api(card);
  const batch = createNfcBatch({
    classId: "k1", classCode: "2B",
    async loadRoster() { return { classId: "k1", classCode: "2B", className: "2ème B", students: [{ id: "s1", name: "Élève test", code: "T-1" }] }; },
    api: backend.value, hardware: hardware({ identity: { uid: UID, tagType: "NTAG216" }, ndef: "", writes: 0 }),
    uuid: randomUUID, valid: () => true, changed(s) { snapshots.push(s); },
  });
  await batch.prepare();
  const entry = batch.snapshot().entries[0];
  assert.equal(entry.cards[0].status, "revoked");
  // An expired (revoked) reservation no longer blocks a new-card selection in the batch.
  batch.select("s1", true, "create");
  assert.equal(batch.snapshot().entries[0].selected, true);
  assert.equal(backend.recovered.length, 0);
});
