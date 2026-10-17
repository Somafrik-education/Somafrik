// CARTE-NFC-BATCH-01 — une réservation expirée (encore `issued/pending` côté serveur tant
// qu'aucune action n'a déclenché l'expiration paresseuse) ne doit jamais bloquer la classe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNfcBatch, eligibleForNewCard, type BatchRoster } from "./studentCardNfcBatch";
import {
  createIndividualNfcFlow,
  nfcFailure,
  nfcReservationExpired,
  type EnrollmentCard,
  type IssuedNfcCard,
  type NfcEncoderHardware,
  type NfcEnrollmentApi,
} from "./studentCardNfcEncoding";

const CLASS = "22222222-2222-4222-8222-222222222222";
const IDS = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"];
const BLANK = ["04A1A2A3A4A5A6", "04B1B2B3B4B5B6", "04C1C2C3C4C5C6"];
const OLD_UID = "04D1D2D3D4D5D6";
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const future = () => new Date(Date.now() + 20 * 60 * 1000).toISOString();

/** Fake server reproducing the backend rules: lazy expiry at reservation, UID unique for ever, audit. */
function server(options: { flag: boolean } = { flag: true }) {
  const rows = new Map<string, IssuedNfcCard[]>();
  const audit: string[] = [];
  const calls: string[] = [];
  const expiredNow = (c: IssuedNfcCard) => c.status === "issued" && c.nfc?.state === "pending" && Date.parse(c.nfc.expiresAt!) <= Date.now();
  const view = (c: IssuedNfcCard): EnrollmentCard => {
    const { cardToken, tokenAvailable, ...safe } = structuredClone(c);
    if (safe.nfc && options.flag) (safe.nfc as { expired?: boolean }).expired = expiredNow(c);
    return safe;
  };
  function expire(studentId: string) {
    for (const c of rows.get(studentId) || []) if (expiredNow(c)) {
      c.status = "revoked"; c.revokeReason = "nfc_reservation_expired"; audit.push(`expired:${c.id}`);
    }
  }
  const api: NfcEnrollmentApi = {
    async list(id) { calls.push(`list:${id}`); return { nfcEnabled: true, cards: (rows.get(id) || []).map(view) }; },
    async issue(id, identity, operationId) {
      calls.push(`issue:${id}`);
      expire(id);
      if ([...rows.values()].flat().some((c) => c.nfc?.uid === identity.uid)) throw nfcFailure("STUDENT_CARD_NFC_UID_EXISTS");
      if ((rows.get(id) || []).some((c) => c.status === "issued")) throw nfcFailure("STUDENT_CARD_NFC_RESERVATION_EXISTS");
      if ((rows.get(id) || []).some((c) => c.status === "active")) throw nfcFailure("STUDENT_CARD_ACTIVE_ALREADY_EXISTS");
      const publicId = String.fromCharCode(65 + IDS.indexOf(id)).repeat(22);
      const card: IssuedNfcCard = { id: randomUUID(), publicId, medium: "nfc", status: "issued", cardToken: `${publicId}.${"S".repeat(43)}`, tokenAvailable: true,
        nfc: { ...identity, state: "pending", operationId, expiresAt: future(), replacesCardId: null } };
      rows.set(id, [...(rows.get(id) || []), card]);
      audit.push(`reserved:${card.id}`);
      return structuredClone(card);
    },
    async replace() { throw new Error("not used"); },
    async retry() { calls.push("retry"); throw nfcFailure("STUDENT_CARD_NFC_EXPIRED"); },
    async confirm(card, token, locked, id) {
      calls.push(`confirm:${id}`);
      expire(id);
      const stored = rows.get(id)?.find((c) => c.id === card.id);
      if (!stored) throw nfcFailure("STUDENT_CARD_NOT_FOUND");
      if (stored.status === "revoked") throw nfcFailure("STUDENT_CARD_NFC_EXPIRED");
      assert.equal(token, stored.cardToken);
      stored.status = "active"; stored.nfc!.state = locked ? "locked" : "encoded";
      return view(stored);
    },
  };
  /** Pre-existing reservation of a previous, interrupted session (chip never written). */
  function stale(studentId: string, expiresAt: string) {
    const card: IssuedNfcCard = { id: randomUUID(), publicId: "Z".repeat(22), medium: "nfc", status: "issued", cardToken: `${"Z".repeat(22)}.${"Y".repeat(43)}`,
      nfc: { uid: OLD_UID, tagType: "NTAG216", state: "pending", operationId: randomUUID(), expiresAt, replacesCardId: null } };
    rows.set(studentId, [card]);
    return card;
  }
  return { api, rows, audit, calls, stale };
}

/** Phone side: whatever card the operator presents; records each wait for a card. */
function phone() {
  const chips = new Map<string, string>([...BLANK, OLD_UID].map((uid) => [uid, ""]));
  let presented: string | null = null;
  const events: string[] = [];
  const hardware: NfcEncoderHardware = {
    async availability() {},
    async inspect() {
      events.push("inspect");
      if (!presented) throw nfcFailure("NFC_TIMEOUT"); // nobody presents the old chip: the session would wait for ever
      return { uid: presented, tagType: "NTAG216" };
    },
    async openNdef(uid) { if (uid !== presented) throw nfcFailure("NFC_SAME_CARD"); },
    async readText() { return chips.get(presented!) || ""; },
    async writeText(value) { events.push(`write:${presented}`); chips.set(presented!, value); },
    async isReadOnly() { return false; },
    async close() {},
  };
  return { hardware, events, chips, present(uid: string | null) { presented = uid; } };
}

function classBatch(srv: ReturnType<typeof server>, ph: ReturnType<typeof phone>) {
  const roster: BatchRoster = { classId: CLASS, classCode: "4A", className: "4ème A",
    students: IDS.map((id, i) => ({ id, name: `Élève ${i + 1}`, code: `E-${i + 1}` })) };
  return createNfcBatch({
    classId: CLASS, classCode: "4A", api: srv.api, hardware: ph.hardware, uuid: randomUUID, valid: () => true,
    async loadRoster() { return structuredClone(roster); },
    changed(s) { if (s.currentId) ph.present(BLANK[IDS.indexOf(s.currentId)]); },
  });
}

for (const flag of [true, false]) {
  const how = flag ? "indicateur serveur" : "horloge de l’appareil (Backend sans indicateur)";
  test(`NFC-03 réservation expirée du 1er élève (${how}) : sélection, nouvelle carte vierge, trois cartes, bilan 3/0/0`, async () => {
    const srv = server({ flag }), ph = phone();
    const stale = srv.stale(IDS[0], past());
    const batch = classBatch(srv, ph);
    await batch.prepare();
    batch.selectAll();
    assert.deepEqual(batch.snapshot().entries.map((e) => e.selected), [true, true, true]);
    await batch.start();
    const s = batch.snapshot();
    assert.equal(s.mode, "result");
    assert.deepEqual(s.counters, { total: 3, programmed: 3, remaining: 0, errors: 0, inProgress: 0 });
    assert.deepEqual(ph.events.filter((e) => e.startsWith("write")), BLANK.map((u) => `write:${u}`));
    assert.equal(srv.calls.filter((c) => c.startsWith("issue")).length, 3);
    assert.ok(!srv.calls.includes("retry"));
    // History kept: the expired reservation is revoked by the server (with audit) and keeps its UID.
    const old = srv.rows.get(IDS[0])!.find((c) => c.id === stale.id)!;
    assert.equal(old.status, "revoked");
    assert.equal(old.nfc?.uid, OLD_UID);
    assert.ok(srv.audit.includes(`expired:${stale.id}`));
    assert.equal(srv.rows.get(IDS[0])!.filter((c) => c.status === "active").length, 1);
  });
}

test("NFC-03 non-régression : une réservation encore valide reste une reprise (aucune nouvelle réservation)", async () => {
  const srv = server(), ph = phone();
  srv.stale(IDS[0], future());
  const batch = classBatch(srv, ph);
  await batch.prepare();
  batch.selectAll();
  assert.equal(batch.snapshot().entries[0].selected, false);
  assert.equal(eligibleForNewCard(batch.snapshot().entries[0]), false);
});

test("NFC-03 le serveur fait foi : réservation déclarée valide par le serveur malgré une horloge en avance", () => {
  const card: EnrollmentCard = { id: "c", publicId: "P", medium: "nfc", status: "issued",
    nfc: { uid: OLD_UID, tagType: "NTAG216", state: "pending", operationId: "o", expiresAt: past(), replacesCardId: null, expired: false } };
  assert.equal(nfcReservationExpired(card), false);
  assert.equal(nfcReservationExpired({ ...card, nfc: { ...card.nfc!, expired: undefined } }), true);
  assert.equal(nfcReservationExpired({ ...card, nfc: { ...card.nfc!, expired: undefined, expiresAt: "invalide" } }), false);
  assert.equal(nfcReservationExpired({ ...card, status: "active", nfc: { ...card.nfc!, state: "encoded", expired: true } }), false);
});

test("NFC-06 présenter la puce de la réservation expirée : refus UID déjà enregistré, aucune écriture, aucune carte active", async () => {
  const srv = server(), ph = phone();
  srv.stale(IDS[0], past());
  const batch = createNfcBatch({
    classId: CLASS, classCode: "4A", api: srv.api, hardware: ph.hardware, uuid: randomUUID, valid: () => true,
    async loadRoster() { return { classId: CLASS, classCode: "4A", className: "4ème A", students: [{ id: IDS[0], name: "Élève 1", code: "E-1" }] }; },
    changed() {},
  });
  ph.present(OLD_UID);
  await batch.prepare();
  batch.selectAll();
  await batch.start();
  const s = batch.snapshot();
  assert.equal(s.mode, "paused");
  assert.deepEqual(s.counters, { total: 1, programmed: 0, remaining: 1, errors: 1, inProgress: 0 });
  assert.match(s.entries[0].error || "", /déjà (affectée|enregistrée)/);
  assert.ok(!ph.events.some((e) => e.startsWith("write")));
  assert.equal(srv.rows.get(IDS[0])!.some((c) => c.status === "active"), false);
});

test("NFC-01 parcours individuel : une réservation expirée ne bloque plus la programmation d’une nouvelle carte", async () => {
  const srv = server(), ph = phone();
  srv.stale(IDS[0], past());
  ph.present(BLANK[0]);
  const flow = createIndividualNfcFlow({ studentId: IDS[0], api: srv.api, hardware: ph.hardware, uuid: randomUUID, valid: () => true, phase() {} });
  const card = await flow.program();
  assert.equal(card.status, "active");
  assert.equal(card.nfc?.uid, BLANK[0]);
});

test("NFC-01 reprise d’une réservation expirée signalée par le serveur : refus immédiat, sans attendre la carte", async () => {
  const srv = server(), ph = phone();
  const stale = srv.stale(IDS[0], past());
  const flow = createIndividualNfcFlow({ studentId: IDS[0], api: srv.api, hardware: ph.hardware, uuid: randomUUID, valid: () => true, phase() {} });
  const [listed] = (await srv.api.list(IDS[0])).cards;
  assert.equal(listed.id, stale.id);
  await assert.rejects(flow.resume(listed), { code: "STUDENT_CARD_NFC_EXPIRED" });
  assert.ok(!ph.events.includes("inspect"));
});
