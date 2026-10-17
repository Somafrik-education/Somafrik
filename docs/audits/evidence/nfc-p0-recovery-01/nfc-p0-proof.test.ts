// NFC-P0-RECOVERY-01 — preuves reproductibles des causes de rejet.
// Mocks uniquement : aucune carte physique, aucun réseau, aucune base de données.
// Exécution (depuis Mobile/) : npx --yes tsx --test ../docs/audits/evidence/nfc-p0-recovery-01/nfc-p0-proof.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createIndividualNfcFlow, ndefForCard,
  type EnrollmentCard, type NfcEncoderHardware, type NfcEnrollmentApi, type IssuedNfcCard,
} from "../../../../Mobile/src/lib/studentCardNfcEncoding";

const UID = "04A1B2C3D4E5F6"; // UID fictif
const PUB = "A".repeat(22);
const TOKEN = `${PUB}.${"B".repeat(43)}`; // capability fictive

type Chip = { ndef: string; readOnly: boolean; writes: number };
function hardware(chip: Chip, opts: { readbackLost?: boolean } = {}): NfcEncoderHardware {
  let wrote = false;
  const lost = () => Object.assign(new Error("lost"), { code: "NFC_SAME_CARD" });
  return {
    async availability() {}, async inspect() { return { uid: UID, tagType: "NTAG213" }; },
    async openNdef() {}, async close() {},
    async readText() { if (opts.readbackLost && wrote) throw lost(); return chip.ndef; },
    // L'écriture réussit sur la puce, puis la re-présentation pour relecture échoue.
    async writeText(v) { chip.ndef = v; chip.writes++; wrote = true; if (opts.readbackLost) throw lost(); },
    async isReadOnly() { return chip.readOnly; },
  };
}

// Backend en mémoire reproduisant l'index unique GLOBAL sur nfc_uid
// (backend/db/migrations/20261012_student_cards_nfc_encoding.sql, l.23-24).
function backend() {
  const cards: (EnrollmentCard & { expired?: boolean })[] = [];
  const api: NfcEnrollmentApi = {
    async list() { return { nfcEnabled: true, cards: cards.map(({ expired, ...c }) => c) }; },
    async issue(_studentId, identity, operationId) {
      if (cards.some((c) => c.nfc?.uid === identity.uid)) throw Object.assign(new Error("23505"), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
      const card = { id: `c${cards.length}`, publicId: PUB, medium: "nfc", status: "issued",
        nfc: { ...identity, state: "pending" as const, operationId, expiresAt: new Date(Date.now() + 1_800_000).toISOString(), replacesCardId: null } };
      cards.push(card);
      return { ...card, cardToken: TOKEN, tokenAvailable: true } as IssuedNfcCard;
    },
    async replace() { throw new Error("hors périmètre"); },
    async retry() { throw new Error("hors périmètre"); },
    async confirm(card) {
      const c = cards.find((x) => x.id === card.id)!;
      if (c.expired) throw Object.assign(new Error(), { code: "STUDENT_CARD_NFC_EXPIRED" });
      c.status = "active"; c.nfc = { ...c.nfc!, state: "encoded" };
      const { expired, ...rest } = c; return rest;
    },
  };
  return { api, cards, expireAll() {
    for (const c of cards) if (c.status === "issued") { c.status = "revoked"; c.revokeReason = "nfc_reservation_expired"; c.expired = true; }
  } };
}
const flow = (api: NfcEnrollmentApi, hw: NfcEncoderHardware, studentId = "s1") =>
  createIndividualNfcFlow({ studentId, api, hardware: hw, uuid: randomUUID, valid: () => true, phase() {} });

test("P-01 carte vierge : une écriture, relecture, confirmation", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  const card = await flow(b.api, hardware(chip)).program();
  assert.equal(card.status, "active"); assert.equal(chip.writes, 1); assert.equal(chip.ndef, ndefForCard(TOKEN));
});

test("P-02 écriture faite mais relecture interrompue : NDEF Somafrik sur la puce, backend toujours pending", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  await assert.rejects(flow(b.api, hardware(chip, { readbackLost: true })).program(), { code: "NFC_SAME_CARD" });
  assert.equal(chip.ndef, ndefForCard(TOKEN)); assert.equal(b.cards[0].status, "issued");
});

test("P-03 avant expiration : resume(card) récupère sans réécriture", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  await assert.rejects(flow(b.api, hardware(chip, { readbackLost: true })).program());
  const pending = (await b.api.list("s1")).cards[0];
  const card = await flow(b.api, hardware(chip)).resume(pending);
  assert.equal(card.status, "active"); assert.equal(chip.writes, 1);
});

test("P-04 après expiration (30 min) : la même carte est refusée NFC_FOREIGN, pour tout élève", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  await assert.rejects(flow(b.api, hardware(chip, { readbackLost: true })).program());
  b.expireAll();
  await assert.rejects(flow(b.api, hardware(chip)).program(), { code: "NFC_FOREIGN" });
  await assert.rejects(flow(b.api, hardware(chip), "s2").program(), { code: "NFC_FOREIGN" });
  assert.equal(chip.writes, 1); // la puce n'est pas modifiée par le refus
});

test("P-05 réservation expirée avant toute écriture : puce vierge refusée STUDENT_CARD_NFC_UID_EXISTS", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  await b.api.issue("s1", { uid: UID, tagType: "NTAG213" }, randomUUID()); b.expireAll();
  await assert.rejects(flow(b.api, hardware(chip)).program(), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
  await assert.rejects(flow(b.api, hardware(chip), "s2").program(), { code: "STUDENT_CARD_NFC_UID_EXISTS" });
  assert.equal(chip.writes, 0);
});

test("P-06 double présentation d'une carte déjà encodée : aucune seconde écriture", async () => {
  const chip = { ndef: "", readOnly: false, writes: 0 }; const b = backend();
  await flow(b.api, hardware(chip)).program();
  await flow(b.api, hardware(chip)).resume((await b.api.list("s1")).cards[0]);
  assert.equal(chip.writes, 1);
});

test("P-07 contenu NDEF préexistant (ex. URL fournisseur) : NFC_FOREIGN avant réservation, aucune écriture", async () => {
  const chip = { ndef: "https://vendor.example", readOnly: false, writes: 0 }; const b = backend();
  await assert.rejects(flow(b.api, hardware(chip)).program(), { code: "NFC_FOREIGN" });
  assert.equal(b.cards.length, 0); assert.equal(chip.writes, 0);
});

test("P-08 NDEF en lecture seule : même code NFC_FOREIGN que « incompatible », aucune écriture", async () => {
  const chip = { ndef: "", readOnly: true, writes: 0 }; const b = backend();
  await assert.rejects(flow(b.api, hardware(chip)).program(), { code: "NFC_FOREIGN" });
  assert.equal(chip.writes, 0);
});
