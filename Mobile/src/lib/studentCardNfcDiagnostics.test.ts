// NFC-P0-R2-SMOKE-FIX-01 — reproduce the R2 smoke failure and pin explicit diagnostics.
// Mocks only: no hardware, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIndividualNfcFlow, nfcErrorCopy,
  type EnrollmentCard, type IssuedNfcCard, type NfcEncoderHardware, type NfcEnrollmentApi, type NtagIdentity,
} from "./studentCardNfcEncoding";

const PUB = "G".repeat(22);
const UID = "04A1B2C3D4E5F6";
const GENERIC = "Résultat non confirmé. Vérifiez la connexion, relisez l’état puis reprenez l’opération existante.";
/** Same shape as ApiClientError from services/httpClient for a non-JSON 404 (Express default page). */
const httpError = (status: number, code?: string) => Object.assign(new Error("La requête a échoué."), { name: "ApiClientError", status, code });

type Chip = { ndef: string; writes: number; writeFails?: boolean; tagType?: NtagIdentity["tagType"] };
function hardware(chip: Chip): NfcEncoderHardware {
  return {
    async availability() {},
    async inspect() { return { uid: UID, tagType: chip.tagType ?? "NTAG216" }; },
    async openNdef() {},
    async readText() { return chip.ndef; },
    async writeText(value) {
      if (chip.writeFails) throw new Error("android.nfc.TagLostException: Tag was lost."); // native: no code
      chip.ndef = value; chip.writes++;
    },
    async isReadOnly() { return false; },
    async close() {},
  };
}
function backend(options: { reencode?: "missing" | "ok"; confirm?: "network" | "server500" | "ok" } = {}) {
  const row = { status: "revoked", revokeReason: "nfc_reservation_expired" as string | null, state: "pending" as "pending" | "encoded",
    secret: "S".repeat(43), reopens: 0, activations: 0 };
  const opId = randomUUID();
  const view = (): EnrollmentCard => ({ id: "grace-card", publicId: PUB, medium: "nfc", status: row.status, revokeReason: row.revokeReason,
    nfc: { uid: UID, tagType: "NTAG216", state: row.state, operationId: opId, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), replacesCardId: null } });
  let confirmMode = options.confirm ?? "ok";
  const api: NfcEnrollmentApi = {
    async list() { return { nfcEnabled: true, cards: [view()] }; },
    async issue() { throw new Error("unexpected"); }, async replace() { throw new Error("unexpected"); },
    async retry() { throw new Error("unexpected"); },
    async confirm(_card, token) {
      if (confirmMode === "network") throw httpError(0, "NETWORK_UNAVAILABLE");
      if (confirmMode === "server500") throw httpError(500);
      if (row.status !== "issued" || token !== `${PUB}.${row.secret}`) throw httpError(404, "STUDENT_CARD_NOT_FOUND");
      row.status = "active"; row.revokeReason = null; row.state = "encoded"; row.activations++; return view();
    },
    async reencode() {
      // Backend at develop fbdbe02: no route → Express default HTML 404, no business code.
      if ((options.reencode ?? "ok") === "missing") throw httpError(404);
      row.status = "issued"; row.revokeReason = null; row.reopens++;
      return { ...view(), cardToken: `${PUB}.${row.secret}`, tokenAvailable: true, reissued: true } as IssuedNfcCard;
    },
  };
  return { api, row, setConfirm(mode: typeof confirmMode) { confirmMode = mode; } };
}
const flow = (api: NfcEnrollmentApi, hw: NfcEncoderHardware) =>
  createIndividualNfcFlow({ studentId: "grace", api, hardware: hw, uuid: randomUUID, valid: () => true, phase() {} });
const card = { id: "grace-card", publicId: PUB } as EnrollmentCard;

test("SMOKE-01 reproduced: R2 APK against a backend without nfc-reencode → explicit 'server incompatible', no write", async () => {
  const b = backend({ reencode: "missing" }); const chip: Chip = { ndef: "", writes: 0 };
  const error = await flow(b.api, hardware(chip)).reencode(card, async () => true).catch((e) => e);
  assert.equal(error.status, 404); assert.equal(error.code, undefined);
  const copy = nfcErrorCopy(error);
  assert.notEqual(copy, GENERIC, "the smoke showed the generic copy: it must now be explicit");
  assert.match(copy, /ne prend pas en charge cette opération NFC/);
  assert.match(copy, /Aucune réservation ni écriture/);
  assert.equal(chip.writes, 0); assert.equal(b.row.status, "revoked"); assert.equal(b.row.reopens, 0);
});

test("SMOKE-02 R2 endpoint available: reopen, write, re-read, single activation", async () => {
  const b = backend(); const chip: Chip = { ndef: "", writes: 0 };
  const active = await flow(b.api, hardware(chip)).reencode(card, async () => true);
  assert.equal(active.status, "active"); assert.equal(chip.writes, 1); assert.equal(b.row.activations, 1);
});

test("SMOKE-03 native write failure (card removed) → 'write not confirmed', never 'blank', no activation", async () => {
  const b = backend(); const chip: Chip = { ndef: "", writes: 0, writeFails: true };
  const error = await flow(b.api, hardware(chip)).reencode(card, async () => true).catch((e) => e);
  assert.equal(error.code, "NFC_WRITE_UNCONFIRMED");
  assert.match(nfcErrorCopy(error), /Ne considérez pas la carte comme vierge/);
  assert.equal(b.row.activations, 0); assert.equal(b.row.status, "issued"); // one reservation, resumable
});

test("SMOKE-04 confirmation lost after write: explicit message, then resume confirms without rewrite or double attribution", async () => {
  for (const mode of ["network", "server500"] as const) {
    const b = backend({ confirm: mode }); const chip: Chip = { ndef: "", writes: 0 };
    const error = await flow(b.api, hardware(chip)).reencode(card, async () => true).catch((e) => e);
    assert.equal(error.nfcWritten, true, mode); // original transport/server code is preserved
    assert.equal(error.code, mode === "network" ? "NETWORK_UNAVAILABLE" : undefined);
    assert.match(nfcErrorCopy(error), /Ne réécrivez pas/);
    assert.equal(chip.writes, 1); assert.equal(b.row.activations, 0);
    b.setConfirm("ok");
    const resumed = await flow(b.api, hardware(chip)).resume((await b.api.list("grace")).cards[0]);
    assert.equal(resumed.status, "active"); assert.equal(chip.writes, 1); assert.equal(b.row.activations, 1);
  }
});

test("SMOKE-05 business codes keep precedence; RBAC 403 stays a rights message", () => {
  assert.match(nfcErrorCopy(httpError(403)), /droits/);
  assert.match(nfcErrorCopy(httpError(404, "STUDENT_CARD_NOT_FOUND")), /ne correspond pas/);
  assert.match(nfcErrorCopy(httpError(404, "STUDENT_CARD_NFC_DISABLED")), /désactivée/);
  assert.match(nfcErrorCopy(httpError(409, "STUDENT_CARD_NFC_EXPIRED")), /expirée/);
  assert.match(nfcErrorCopy(httpError(409, "STUDENT_CARD_NFC_CONFLICT")), /concurrente/);
  assert.match(nfcErrorCopy(httpError(409, "STUDENT_CARD_ACTIVE_ALREADY_EXISTS")), /déjà une carte active/);
  assert.match(nfcErrorCopy(httpError(0, "TIMEOUT")), /pas répondu à temps/);
  assert.match(nfcErrorCopy(httpError(0, "NETWORK_UNAVAILABLE")), /Pas de connexion/);
  assert.match(nfcErrorCopy(httpError(0, "BACKEND_UNREACHABLE")), /injoignable/);
  assert.match(nfcErrorCopy(httpError(502)), /Erreur du serveur/);
  assert.equal(nfcErrorCopy(new Error("x")), GENERIC);
});

test("SMOKE-06 no diagnostic copy ever contains a token, secret or UID", () => {
  const secret = "S".repeat(43);
  for (const e of [httpError(404), httpError(500), httpError(0, "TIMEOUT"), { code: "NFC_WRITE_UNCONFIRMED" }, Object.assign(httpError(0, "TIMEOUT"), { nfcWritten: true })]) {
    const copy = nfcErrorCopy(e);
    for (const forbidden of [secret, PUB, UID, "somafrik:card:"]) assert.equal(copy.includes(forbidden), false);
  }
});
