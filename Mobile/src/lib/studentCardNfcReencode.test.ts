// NFC-P0-R2 — blank-card re-encoding (mock chip + stateful mock backend, no hardware).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIndividualNfcFlow, ndefForCard, nfcErrorCopy,
  type EnrollmentCard, type IssuedNfcCard, type NfcEncoderHardware, type NfcEnrollmentApi, type NtagIdentity,
} from "./studentCardNfcEncoding";
import { createNfcBatch } from "./studentCardNfcBatch";

const PUB = "P".repeat(22);
const secret = (c: string) => c.repeat(43);

type Chip = { identity: NtagIdentity; ndef: string; readOnly?: boolean; foreign?: boolean; writes: number;
  failWrite?: boolean; loseAfterWrite?: boolean; corruptReadback?: boolean };
function hardware(chip: Chip) {
  let written = false;
  const lost = (code: string) => Object.assign(new Error(code), { code });
  const hw: NfcEncoderHardware & { calls: string[] } = {
    calls: [],
    async availability() {},
    async inspect() { hw.calls.push("inspect"); return chip.identity; },
    async openNdef() { hw.calls.push("openNdef"); },
    async readText() {
      hw.calls.push("readText");
      if (chip.foreign) throw lost("NFC_FOREIGN");
      if (written && chip.loseAfterWrite) throw lost("NFC_SAME_CARD");
      if (written && chip.corruptReadback) return `${chip.ndef}x`;
      return chip.ndef;
    },
    async writeText(value) {
      hw.calls.push("write");
      if (chip.failWrite) throw lost("NFC_SESSION_CANCELLED");
      chip.ndef = value; chip.writes++; written = true;
      if (chip.loseAfterWrite) throw lost("NFC_SAME_CARD");
    },
    async isReadOnly() { hw.calls.push("isReadOnly"); return chip.readOnly === true; },
    async close() { hw.calls.push("close"); },
  };
  return hw;
}

/** Minimal model of the canonical row: same id/publicId/UID, rotating secret, original UUID. */
function backend(tagType: NtagIdentity["tagType"] = "NTAG216", uid = "04A1B2C3D4E5F6") {
  const opId = randomUUID();
  const row = { status: "revoked", revokeReason: "nfc_reservation_expired" as string | null, state: "pending" as "pending" | "encoded",
    secret: secret("O"), reopens: 0, confirms: 0, rotations: 0 };
  let seq = 0;
  const view = (): EnrollmentCard => ({ id: "c1", publicId: PUB, medium: "nfc", status: row.status, revokeReason: row.revokeReason,
    nfc: { uid, tagType, state: row.state, operationId: opId, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), replacesCardId: null } });
  const issued = (): IssuedNfcCard => ({ ...view(), cardToken: `${PUB}.${row.secret}`, tokenAvailable: true, reissued: true });
  const api: NfcEnrollmentApi = {
    async list() { return { nfcEnabled: true, cards: [view()] }; },
    async issue() { throw new Error("no new reservation in R2"); },
    async replace() { throw new Error("no replace in R2"); },
    async retry(card, identity) {
      if (row.status !== "issued" || identity.uid !== uid) throw Object.assign(new Error(), { code: "STUDENT_CARD_INVALID_STATE" });
      row.rotations++; row.secret = secret(String.fromCharCode(65 + (++seq % 20))); return issued();
    },
    async confirm(_card, token) {
      if (row.status !== "issued" || token !== `${PUB}.${row.secret}`) throw Object.assign(new Error(), { code: "STUDENT_CARD_NOT_FOUND" });
      row.status = "active"; row.revokeReason = null; row.state = "encoded"; row.confirms++; return view();
    },
    async reencode(_card, identity) {
      if (identity.uid !== uid || identity.tagType !== tagType) throw Object.assign(new Error(), { code: "STUDENT_CARD_NFC_MISMATCH" });
      if (row.status !== "revoked") throw Object.assign(new Error(), { code: "STUDENT_CARD_INVALID_STATE" });
      row.status = "issued"; row.revokeReason = null; row.reopens++; row.secret = secret(String.fromCharCode(65 + (++seq % 20)));
      return issued();
    },
  };
  return { api, row, uid, tagType };
}
const flow = (api: NfcEnrollmentApi, hw: NfcEncoderHardware) =>
  createIndividualNfcFlow({ studentId: "s1", api, hardware: hw, uuid: randomUUID, valid: () => true, phase() {} });
const yes = async () => true;
const card = (b: ReturnType<typeof backend>) => ({ id: "c1", publicId: PUB } as EnrollmentCard);

for (const tagType of ["NTAG213", "NTAG216"] as const) {
  test(`R2-15/R2-18/R2-25 blank ${tagType}: diagnosis, consent, reopen, write, re-read, confirm`, async () => {
    const b = backend(tagType); const chip: Chip = { identity: { uid: b.uid, tagType }, ndef: "", writes: 0 };
    const asked: NtagIdentity[] = [];
    const result = await flow(b.api, hardware(chip)).reencode(card(b), async (identity) => { asked.push(identity); return true; });
    assert.deepEqual(asked, [{ uid: b.uid, tagType }]);
    assert.equal(result.status, "active"); assert.equal(result.nfc?.state, "encoded"); assert.equal(result.id, "c1");
    assert.equal(chip.writes, 1); assert.equal(chip.ndef, ndefForCard(`${PUB}.${b.row.secret}`));
    assert.equal(b.row.reopens, 1); assert.equal(b.row.confirms, 1);
  });
}

test("R2-16 consent refused: no reservation, no write", async () => {
  const b = backend(); const chip: Chip = { identity: { uid: b.uid, tagType: "NTAG216" }, ndef: "", writes: 0 };
  await assert.rejects(flow(b.api, hardware(chip)).reencode(card(b), async () => false), { code: "NFC_REWRITE_REQUIRED" });
  assert.equal(chip.writes, 0); assert.equal(b.row.reopens, 0); assert.equal(b.row.status, "revoked");
});

async function refused(chipOver: Partial<Chip>, code: string, tagType: NtagIdentity["tagType"] = "NTAG216") {
  const b = backend(tagType); const chip: Chip = { identity: { uid: b.uid, tagType }, ndef: "", writes: 0, ...chipOver };
  let asked = false;
  await assert.rejects(flow(b.api, hardware(chip)).reencode(card(b), async () => { asked = true; return true; }), { code });
  assert.equal(chip.writes, 0); assert.equal(b.row.reopens, 0); assert.equal(asked, false, "no consent asked before a clean diagnosis");
  assert.ok(nfcErrorCopy({ code }).toLowerCase().includes("aucune écriture"), code);
}

test("R2-17 other UID or other physical model: no write", async () => {
  await refused({ identity: { uid: "04000000000009", tagType: "NTAG216" } }, "NFC_RECOVERY_UID_MISMATCH");
  await refused({ identity: { uid: "04A1B2C3D4E5F6", tagType: "NTAG213" } }, "NFC_RECOVERY_MODEL_MISMATCH");
  await refused({ identity: { uid: "04A1B2C3D4E5F6", tagType: "NTAG216" } }, "NFC_RECOVERY_MODEL_MISMATCH", "NTAG213");
});

test("R2-19 chip already holds this card's Somafrik token: routed to R1, no write", async () => {
  await refused({ ndef: ndefForCard(`${PUB}.${secret("Q")}`) }, "NFC_RECOVERY_USE_R1");
});

test("R2-20 foreign, other-card or invalid content: refused, never erased", async () => {
  await refused({ foreign: true }, "NFC_RECOVERY_FOREIGN_CONTENT");
  await refused({ ndef: ndefForCard(`${"Z".repeat(22)}.${secret("Q")}`) }, "NFC_RECOVERY_OTHER_CARD");
  await refused({ ndef: "https://vendor.example" }, "NFC_RECOVERY_INVALID_CONTENT");
});

test("R2-21 read-only chip: refused before any reservation or write", async () => {
  await refused({ readOnly: true }, "NFC_RECOVERY_READ_ONLY");
});

test("R2-22 interruption before write: server keeps one reservation; resume never writes blindly; explicit rewrite recovers", async () => {
  const b = backend(); const chip: Chip = { identity: { uid: b.uid, tagType: "NTAG216" }, ndef: "", writes: 0, failWrite: true };
  const f = flow(b.api, hardware(chip));
  await assert.rejects(f.reencode(card(b), yes), { code: "NFC_SESSION_CANCELLED" });
  assert.equal(b.row.status, "issued"); assert.equal(b.row.reopens, 1); assert.equal(chip.ndef, "");
  // A second reencode cannot create another reservation (the row is no longer eligible).
  await assert.rejects(f.reencode(card(b), yes), { code: "STUDENT_CARD_INVALID_STATE" });
  assert.equal(b.row.reopens, 1);
  chip.failWrite = false;
  const issuedCard = (await b.api.list("s1")).cards[0];
  await assert.rejects(f.resume(issuedCard), { code: "NFC_REWRITE_REQUIRED" }); // blank chip: no silent write
  assert.equal(chip.writes, 0);
  const active = await f.rewrite(issuedCard, true); // explicit consent, canonical secret rotation
  assert.equal(active.status, "active"); assert.equal(b.row.rotations, 1); assert.equal(chip.writes, 1);
});

test("R2-23 interruption after write: resume re-reads the written token and confirms without rewriting", async () => {
  const b = backend(); const chip: Chip = { identity: { uid: b.uid, tagType: "NTAG216" }, ndef: "", writes: 0, loseAfterWrite: true };
  const f = flow(b.api, hardware(chip));
  await assert.rejects(f.reencode(card(b), yes), { code: "NFC_SAME_CARD" });
  assert.equal(b.row.status, "issued"); assert.equal(chip.writes, 1);
  chip.loseAfterWrite = false;
  const resumed = await flow(b.api, hardware(chip)).resume((await b.api.list("s1")).cards[0]);
  assert.equal(resumed.status, "active"); assert.equal(chip.writes, 1); assert.equal(b.row.rotations, 0);
});

test("R2-24 wrong read-back: activation refused", async () => {
  const b = backend(); const chip: Chip = { identity: { uid: b.uid, tagType: "NTAG216" }, ndef: "", writes: 0, corruptReadback: true };
  await assert.rejects(flow(b.api, hardware(chip)).reencode(card(b), yes), { code: "NFC_READBACK" });
  assert.equal(b.row.confirms, 0); assert.equal(b.row.status, "issued");
});

test("R2-26 collective programming unchanged: batch flows never expose reencode", async () => {
  const b = backend();
  const batch = createNfcBatch({
    classId: "k1", classCode: "2B",
    async loadRoster() { return { classId: "k1", classCode: "2B", className: "2ème B", students: [{ id: "s1", name: "Élève test", code: "T-1" }] }; },
    api: b.api, hardware: hardware({ identity: { uid: b.uid, tagType: "NTAG216" }, ndef: "", writes: 0 }),
    uuid: randomUUID, valid: () => true, changed() {},
  });
  await batch.prepare();
  assert.equal(batch.snapshot().entries[0].cards[0].status, "revoked");
  assert.equal("reencode" in batch, false); assert.equal(b.row.reopens, 0);
});
