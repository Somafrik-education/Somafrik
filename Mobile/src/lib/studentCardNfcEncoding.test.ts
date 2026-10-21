import { test } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import React, { act } from "react";
import { createIndividualNfcFlow, createNfcEnrollmentApi, encodeNfcCard, verifyNfcCard, identifyNtag, normalizeNtagUid, ndefForCard, nfcErrorCopy, nfcFailure,
  type EnrollmentCard, type IssuedNfcCard, type NfcEncoderHardware, type NfcEnrollmentApi, type FlowControl, type NfcPhase } from "./studentCardNfcEncoding";
import { studentCardEnrollmentAccess } from "./studentCardEnrollmentAccess";
const UID = "04112233445566";
const OP = "11111111-1111-4111-8111-111111111111";
const TOKEN = `${"A".repeat(22)}.${"B".repeat(43)}`;
const identity = { uid: UID, tagType: "NTAG213" as const };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  let card: IssuedNfcCard = { id: "c1", publicId: "A".repeat(22), cardToken: TOKEN, tokenAvailable: true, medium: "nfc", status: "issued", nfc: { ...identity, state: "pending", operationId: OP, expiresAt: "2026-10-13T23:30:00Z", replacesCardId: null } };
  let stored: EnrollmentCard[] = []; let value = ""; let readOnly = false; let valid = true; let uuidCalls = 0; let enabled = true;
  const events: string[] = []; const phases: NfcPhase[] = [];
  const publicCard = (c: EnrollmentCard) => { const { cardToken: _, ...metadata } = c as IssuedNfcCard; return structuredClone(metadata); };
  const hardware: NfcEncoderHardware = {
    async availability() { events.push("availability"); },
    async inspect() { events.push("inspect"); return identity; },
    async openNdef(uid) { events.push("open"); assert.equal(uid, UID); },
    async readText() { events.push("read"); return value; },
    async writeText(v) { events.push("write"); value = v; },
    async isReadOnly() { return readOnly; }, async close() { events.push("close"); },
  };
  const api: NfcEnrollmentApi = {
    async list(studentId) { events.push("list"); assert.equal(studentId, "s1"); return { cards: stored.map(publicCard), nfcEnabled: enabled }; },
    async issue(studentId, observed, operationId) {
      events.push("issue"); assert.equal(studentId, "s1"); assert.deepEqual(observed, identity); assert.equal(operationId, OP);
      stored.push(publicCard(card)); return card;
    },
    async replace(old, studentId, observed, operationId) {
      assert.equal(old.status, "active"); card = { ...card, nfc: { ...card.nfc!, replacesCardId: old.id } };
      events.push("replace"); return api.issue(studentId, observed, operationId);
    },
    async retry(c, observed, operationId) {
      events.push("retry"); assert.equal(c.id, card.id); assert.deepEqual(observed, identity); assert.ok(operationId);
      card = { ...card, reissued: true, cardToken: `${card.publicId}.${"C".repeat(43)}` }; return card;
    },
    async confirm(c, token, locked, studentId) {
      events.push("confirm"); assert.equal(studentId, "s1"); assert.equal(token, card.cardToken);
      const active = { ...publicCard(c), status: "active", nfc: { ...c.nfc!, state: locked ? "locked" as const : "encoded" as const } };
      stored = stored.map((item) => item.id === c.id ? active : item.id === c.nfc?.replacesCardId ? { ...item, status: "replaced" } : item);
      return active;
    },
  };
  const control: FlowControl = { studentId: "s1", check() { if (!valid) throw nfcFailure("NFC_CANCELLED"); }, phase(p) { phases.push(p); } };
  const flow = createIndividualNfcFlow({ studentId: "s1", hardware, api, valid: () => valid, uuid() { uuidCalls++; return OP; }, phase: control.phase });
  return { get card() { return card; }, api, hardware, events, phases, control, flow,
    get cards() { return stored; }, get uuidCalls() { return uuidCalls; }, get value() { return value; },
    setCards(c: EnrollmentCard[]) { stored = c; }, setValue(v: string) { value = v; }, setReadOnly(v: boolean) { readOnly = v; },
    invalidate() { valid = false; }, setEnabled(v: boolean) { enabled = v; } };
}
test("NTAG213/216 require full GET_VERSION and a 7-byte NXP UID", () => {
  assert.equal(identifyNtag(UID, [0,4,4,2,1,0,15,3]).tagType, "NTAG213");
  assert.equal(identifyNtag(UID, [0,4,4,2,1,0,19,3]).tagType, "NTAG216");
  for (const v of [[], [0,4,4,2,1,0,17,3], [0,4,3,2,1,0,15,3]]) assert.throws(() => identifyNtag(UID, v));
  assert.throws(() => normalizeNtagUid("11223344"));
});
test("individual programming reserves issued/pending, writes, freshly reads, then activates on server", async () => {
  const f = fixture(); const original = f.api.confirm;
  f.api.confirm = async (...args) => {
    assert.equal(f.cards[0].status, "issued"); assert.equal(f.cards[0].nfc?.state, "pending");
    assert.equal(f.value, ndefForCard(TOKEN)); return original(...args);
  };
  const result = await f.flow.program(); assert.equal(result.status, "active"); assert.equal(f.card.status, "issued");
  assert.ok(f.events.indexOf("issue") < f.events.indexOf("write"));
  assert.ok(f.events.lastIndexOf("read") < f.events.indexOf("confirm"));
  assert.deepEqual(f.phases, ["waiting", "reservation", "writing", "verification", "verification", "confirmation", "success"]);
  assert.equal(f.uuidCalls, 1); assert.equal(f.flow.hasUncertainReservation(), false);
  assert.ok(!("makeReadOnly" in f.hardware));
});
for (const mode of ["foreign", "locked", "uid", "model", "write", "readback", "capacity"]) test(`${mode} failure never confirms or reports success`, async () => {
  const f = fixture();
  if (mode === "foreign") f.setValue("other-system:private-data");
  if (mode === "locked") f.setReadOnly(true);
  if (mode === "uid") f.hardware.openNdef = async () => { throw new Error("wrong uid"); };
  if (mode === "model") f.hardware.inspect = async () => { throw new Error("unsupported model"); };
  if (mode === "write" || mode === "capacity") f.hardware.writeText = async () => { throw new Error(mode); };
  if (mode === "readback") f.hardware.writeText = async () => { f.setValue(ndefForCard(`${"A".repeat(22)}.${"C".repeat(43)}`)); };
  await assert.rejects(f.flow.program()); assert.ok(!f.events.includes("confirm")); assert.ok(!f.phases.includes("success")); assert.equal(f.events.at(-1), "close");
  if (["foreign", "locked", "uid", "model"].includes(mode)) assert.ok(!f.events.includes("issue"));
});
for (const code of ["NFC_UNAVAILABLE", "NFC_DISABLED", "NETWORK_UNAVAILABLE", "TIMEOUT", "STUDENT_CARD_TENANT_DENIED"]) test(`${code} during preparation fails closed`, async () => {
  const f = fixture();
  if (code.startsWith("NFC_")) f.hardware.availability = async () => { throw nfcFailure(code); };
  else f.api.list = async () => { throw nfcFailure(code); };
  await assert.rejects(f.flow.program()); assert.ok(!f.events.includes("write")); assert.ok(!f.events.includes("issue"));
});
test("feature flag false blocks programming even with a locally authorized screen", async () => {
  const f = fixture(); f.setEnabled(false); await assert.rejects(f.flow.program(), { code: "NFC_SCOPE_DENIED" }); assert.ok(!f.events.includes("inspect"));
});
for (const code of ["STUDENT_CARD_NFC_EXPIRED", "STUDENT_CARD_INVALID_STATE", "NETWORK_UNAVAILABLE", "TIMEOUT"]) test(`${code} on confirmation never yields active locally`, async () => {
  const f = fixture(); f.api.confirm = async () => { throw nfcFailure(code); };
  await assert.rejects(f.flow.program(), { code }); assert.equal(f.cards[0].status, "issued"); assert.ok(!f.phases.includes("success"));
});
test("a pending or active server response cannot be called successful unless encoded/locked and same reservation", async () => {
  for (const mutation of [{ status: "issued" }, { id: "other" }, { nfc: { ...fixture().card.nfc!, operationId: "other" } }]) {
    const f = fixture(); f.api.confirm = async (c) => ({ ...c, status: "active", ...mutation });
    await assert.rejects(f.flow.program(), { code: "NFC_RESPONSE_INVALID" }); assert.ok(!f.phases.includes("success"));
  }
});
test("lost confirmation response: canonical state read then same token confirmation, no second write/reservation", async () => {
  const f = fixture(); const confirm = f.api.confirm;
  f.api.confirm = async (...args) => { await confirm(...args); throw nfcFailure("TIMEOUT"); };
  await assert.rejects(f.flow.program()); assert.equal(f.cards[0].status, "active");
  f.api.confirm = confirm; assert.equal((await f.flow.resume()).status, "active");
  assert.equal(f.events.filter((e) => e === "write").length, 1); assert.equal(f.events.filter((e) => e === "issue").length, 1);
  assert.equal(f.events.filter((e) => e === "confirm").length, 2); assert.equal(f.uuidCalls, 1);
});
test("after application restart list metadata plus chip relecture resumes without any locally stored secret", async () => {
  const f = fixture(); f.setCards([f.card]); f.setValue(ndefForCard(TOKEN));
  assert.equal((await f.flow.resume(f.cards[0])).status, "active"); assert.ok(!f.events.includes("issue")); assert.ok(!f.events.includes("write")); assert.ok(!f.events.includes("retry"));
});
test("lost reservation response with no visible row retries same UUID and accepts token-less replay normally", async () => {
  const f = fixture(); let calls = 0;
  f.api.issue = async () => { calls++; if (calls === 1) throw nfcFailure("TIMEOUT"); return { ...f.card, cardToken: undefined, tokenAvailable: false, idempotentReplay: true }; };
  await assert.rejects(f.flow.program()); f.setValue(ndefForCard(TOKEN));
  assert.equal((await f.flow.resume()).status, "active"); assert.equal(f.uuidCalls, 1); assert.equal(calls, 2); assert.ok(!f.events.includes("write"));
});
test("lost reservation response with committed pending row cannot create another reservation", async () => {
  const f = fixture(); const issue = f.api.issue;
  f.api.issue = async (...args) => { await issue(...args); throw nfcFailure("TIMEOUT"); };
  await assert.rejects(f.flow.program()); await assert.rejects(f.flow.program(), { code: "NFC_PENDING" });
  await assert.rejects(f.flow.resume(), { code: "NFC_REWRITE_REQUIRED" });
  assert.equal(f.events.filter((e) => e === "issue").length, 1); assert.equal(f.uuidCalls, 1); assert.ok(!f.events.includes("retry"));
});
test("token-less replay on a blank card requests explicit rewrite rather than silently rotating", async () => {
  const f = fixture(); f.api.issue = async () => ({ ...f.card, cardToken: undefined, tokenAvailable: false });
  await assert.rejects(f.flow.program(), { code: "NFC_REWRITE_REQUIRED" }); assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
});
test("explicit rewrite rotates same pending row with UUID, then writes and confirms", async () => {
  const f = fixture(); f.setCards([f.card]); f.setValue(ndefForCard(TOKEN));
  await assert.rejects(f.flow.rewrite(f.card, false), { code: "NFC_REWRITE_REQUIRED" }); assert.ok(!f.events.includes("retry"));
  assert.equal((await f.flow.rewrite(f.card, true)).status, "active");
  assert.equal(f.events.filter((e) => e === "write").length, 1); assert.ok(f.events.indexOf("retry") < f.events.indexOf("write"));
});
test("retry replay without token re-reads chip and confirms without writes", async () => {
  const f = fixture(); f.setCards([f.card]); f.setValue(ndefForCard(TOKEN));
  f.api.retry = async () => ({ ...f.card, cardToken: undefined, tokenAvailable: false, idempotentReplay: true });
  assert.equal((await f.flow.rewrite(f.card, true)).status, "active"); assert.ok(!f.events.includes("write"));
});
test("foreign publicId and read-only cards cannot be overwritten or rotated by explicit rewrite", async () => {
  for (const mode of ["foreign", "locked"]) {
    const f = fixture(); f.setCards([f.card]); if (mode === "foreign") f.setValue(ndefForCard(`${"C".repeat(22)}.${"B".repeat(43)}`)); else f.setReadOnly(true);
    await assert.rejects(f.flow.rewrite(f.card, true)); assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
  }
});
test("a physically locked previously written card resumes by read/confirm only", async () => {
  const f = fixture(); f.setCards([f.card]); f.setValue(ndefForCard(TOKEN)); f.setReadOnly(true);
  assert.equal((await f.flow.resume(f.card)).nfc?.state, "locked"); assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
});
for (const status of ["revoked", "lost", "replaced"]) test(`${status} reservation fails before physical session`, async () => {
  const f = fixture(); f.setCards([{ ...f.card, status }]);
  await assert.rejects(f.flow.resume(f.card)); await assert.rejects(f.flow.rewrite(f.card, true)); assert.ok(!f.events.includes("inspect")); assert.ok(!f.events.includes("retry"));
});
for (const point of ["inspect", "issue", "write", "read", "readOnly"]) test(`cancel/background/scope change during ${point} prevents stale confirmation`, async () => {
  const f = fixture();
  if (point === "inspect") f.hardware.inspect = async () => { f.invalidate(); return identity; };
  if (point === "issue") { const old = f.api.issue; f.api.issue = async (...a) => { const c = await old(...a); f.invalidate(); return c; }; }
  if (point === "write") { const old = f.hardware.writeText; f.hardware.writeText = async (v) => { await old(v); f.invalidate(); }; }
  if (point === "read") { const old = f.hardware.readText; let reads = 0; f.hardware.readText = async () => { const v = await old(); if (++reads === 3) f.invalidate(); return v; }; }
  if (point === "readOnly") { let count = 0; f.hardware.isReadOnly = async () => { if (++count === 3) f.invalidate(); return false; }; }
  await assert.rejects(f.flow.program(), { code: "NFC_CANCELLED" }); assert.ok(!f.events.includes("confirm")); assert.ok(!f.phases.includes("success"));
});
test("cancellation while server confirmation is in flight suppresses stale success and preserves canonical recovery", async () => {
  const f = fixture(); const good = f.api.confirm;
  f.api.confirm = async (...a) => { const c = await good(...a); f.invalidate(); return c; };
  await assert.rejects(f.flow.program(), { code: "NFC_CANCELLED" }); assert.equal(f.cards[0].status, "active"); assert.ok(!f.phases.includes("success"));
});
test("double click and concurrent confirmation rejected while first operation awaits server", async () => {
  const f = fixture(); const gate = deferred<void>(); const entered = deferred<void>(); const issue = f.api.issue;
  f.api.issue = async (...a) => { entered.resolve(); await gate.promise; return issue(...a); };
  const first = f.flow.program(); await entered.promise;
  await assert.rejects(f.flow.program(), { code: "NFC_BUSY" }); await assert.rejects(f.flow.resume(f.card), { code: "NFC_BUSY" });
  gate.resolve(); await first; assert.equal(f.events.filter((e) => e === "confirm").length, 1);
});
for (const fail of [false, true]) test(`replacement preserves old active card until server confirmation (${fail ? "write failure" : "success"})`, async () => {
  const f = fixture(); const old: EnrollmentCard = { ...f.card, id: "old", publicId: "O".repeat(22), status: "active", nfc: null };
  f.setCards([old]); const write = f.hardware.writeText;
  f.hardware.writeText = async (v) => { assert.equal(f.cards.find((c) => c.id === "old")?.status, "active"); if (fail) throw new Error("removed"); return write(v); };
  if (fail) { await assert.rejects(f.flow.program(old)); assert.equal(f.cards[0].status, "active"); }
  else { await f.flow.program(old); assert.equal(f.cards[0].status, "replaced"); assert.equal(f.cards[1].status, "active"); }
  assert.ok(!f.events.includes("revoke"));
});
test("active card demands explicit replacement intent and stale old-card selection is rejected", async () => {
  const f = fixture(); const old = { ...f.card, id: "old", status: "active" }; f.setCards([old]);
  await assert.rejects(f.flow.program(), { code: "NFC_REPLACE_REQUIRED" });
  await assert.rejects(f.flow.program({ ...old, id: "other" })); assert.ok(!f.events.includes("inspect"));
});
test("read/confirm rejects UID, model and foreign payload without writing", async () => {
  for (const mode of ["uid", "type", "token"]) {
    const f = fixture(); f.setValue(ndefForCard(TOKEN));
    if (mode === "uid") f.hardware.inspect = async () => ({ ...identity, uid: "04778899001122" });
    if (mode === "type") f.hardware.inspect = async () => ({ ...identity, tagType: "NTAG216" });
    if (mode === "token") f.setValue(ndefForCard(`${"C".repeat(22)}.${"B".repeat(43)}`));
    await assert.rejects(verifyNfcCard(f.hardware, f.api, f.card, f.control)); assert.ok(!f.events.includes("confirm")); assert.ok(!f.events.includes("write"));
  }
});
test("initial encoder cannot overwrite another secret even of the same publicId without explicit consent", async () => {
  const f = fixture(); f.setValue(ndefForCard(`${f.card.publicId}.${"C".repeat(43)}`));
  await assert.rejects(encodeNfcCard(f.hardware, f.api, { ...f.card, reissued: true }, f.control)); assert.ok(!f.events.includes("write"));
});
test("school READ + UPDATE only; platform ALL_PRIVILEGES never grants enrollment", () => {
  assert.deepEqual(studentCardEnrollmentAccess({ role: "school_admin", permissions: ["Élèves:READ", "Élèves:UPDATE"] }), { canRead: true, canUpdate: true });
  assert.deepEqual(studentCardEnrollmentAccess({ role: "teacher", permissions: ["Élèves:READ"] }), { canRead: true, canUpdate: false });
  for (const role of ["super_admin", "country_admin", "parent_student", "student"]) assert.deepEqual(studentCardEnrollmentAccess({ role, permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"] }), { canRead: false, canUpdate: false });
});
test("failure messages never interpolate secret, raw native payload, or backend details", () => {
  for (const error of [new Error(TOKEN), { code: TOKEN, message: TOKEN }, { code: "TIMEOUT", message: TOKEN }]) assert.ok(!nfcErrorCopy(error).includes(TOKEN));
  assert.match(nfcErrorCopy({ code: "STUDENT_CARD_NFC_EXPIRED" }), /expirée/);
});
test("actual API adapter sends UUIDs, canonical student identity and exact established routes; no card IDs/secrets generated", async () => {
  const f = fixture(); const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const api = createNfcEnrollmentApi(async <T>(path: string, options?: { body?: string }) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : undefined }); return f.card as T;
  });
  await api.list("s1"); await api.issue("s1", identity, OP); await api.replace({ ...f.card, id: "old" }, "s1", identity, OP);
  await api.retry(f.card, identity, OP); await api.confirm(f.card, TOKEN, false, "s1");
  assert.deepEqual(calls.map((c) => c.path), ["/students/s1/cards", "/student-cards", "/student-cards/old/replace", "/student-cards/c1/nfc-retry", "/student-cards/c1/nfc-confirm"]);
  assert.deepEqual(calls[1].body, { studentId: "s1", medium: "nfc", nfc: identity, operationId: OP });
  assert.equal(calls[3].body?.operationId, OP); assert.equal(calls[4].body?.operationId, OP); assert.equal(calls[4].body?.studentId, "s1");
  assert.equal(calls[4].body?.locked, false);
  for (const c of calls.filter((_, i) => i !== 4)) assert.ok(!JSON.stringify(c).includes(TOKEN));
});

test("canonically expired reservation reports expiration before touching the chip", async () => {
  const f = fixture(); f.setCards([{ ...f.card, status: "revoked", revokeReason: "nfc_reservation_expired" }]);
  await assert.rejects(f.flow.resume(f.card), { code: "STUDENT_CARD_NFC_EXPIRED" }); assert.ok(!f.events.includes("inspect"));
});

test("lost retry response requires a new explicit rewrite; recovery never rotates automatically", async () => {
  const f = fixture(); f.setCards([f.card]); const retry = f.api.retry;
  f.api.retry = async (...a) => { await retry(...a); throw nfcFailure("TIMEOUT"); };
  await assert.rejects(f.flow.rewrite(f.card, true));
  await assert.rejects(f.flow.resume(f.card), { code: "NFC_REWRITE_REQUIRED" });
  assert.equal(f.events.filter((e) => e === "retry").length, 1); assert.ok(!f.events.includes("write"));
  f.api.retry = retry; await f.flow.rewrite(f.card, true); assert.equal(f.events.filter((e) => e === "retry").length, 2);
});
test("canonical revocation resolves an uncertain reservation without automatic issuance", async () => {
  const f = fixture(); const issue = f.api.issue;
  f.api.issue = async (...a) => { await issue(...a); throw nfcFailure("TIMEOUT"); };
  await assert.rejects(f.flow.program()); f.setCards([{ ...f.card, status: "revoked" }]);
  await assert.rejects(f.flow.resume(), { code: "STUDENT_CARD_INVALID_STATE" });
  assert.equal(f.flow.hasUncertainReservation(), false); assert.equal(f.events.filter((e) => e === "issue").length, 1);
});
test("inconsistent operation/UID/replacement response cannot reach hardware write", async () => {
  for (const change of [{ operationId: "different" }, { uid: "04778899001122" }, { replacesCardId: "other" }]) {
    const f = fixture(); f.api.issue = async () => ({ ...f.card, nfc: { ...f.card.nfc!, ...change } });
    await assert.rejects(f.flow.program(), { code: "NFC_RESPONSE_INVALID" }); assert.ok(!f.events.includes("write"));
  }
});

test("legacy active encoded cards without reservation UUID remain readable without rotation", async () => {
  const f = fixture(); const legacy: EnrollmentCard = { ...f.card, status: "active", nfc: { ...f.card.nfc!, state: "encoded", operationId: null, expiresAt: null } };
  f.setCards([legacy]); f.setValue(ndefForCard(TOKEN));
  assert.equal((await f.flow.resume(legacy)).status, "active"); assert.ok(!f.events.includes("retry")); assert.ok(!f.events.includes("write"));
});

// ─────────────────────────────────────────────────────────────────────────────
// CARTE-FIX-QR-NFC-MOBILE-RED-01 — tests rouges d'abord (aucun code produit modifié).
// Contrat attendu côté Mobile, adossé aux routes #974 :
//   POST /student-cards/:id/nfc-provision          { cardToken, nfc, operationId } → { cardId, alreadyProvisioned, challenge, expiresAt }
//   POST /student-cards/:id/nfc-provision/confirm  { cardToken relu sur la puce, nfc, operationId, challenge } → carte (même id/publicId)
//   POST /student-cards/verify                     { cardToken, cardId } → { card:{valid}, scope, matchesCard }
// Le QR imprimé porte le jeton complet ; la puce reçoit le MÊME jeton : aucune nouvelle carte, aucun nouveau secret.
// ─────────────────────────────────────────────────────────────────────────────
type ProvisionBegin = { cardId: string; alreadyProvisioned: boolean; challenge?: string; expiresAt?: string; card?: EnrollmentCard };
type CardCheck = { card: { valid: boolean; medium?: string }; scope: string; matchesCard?: boolean };
type ProvisionApi = {
  provision(card: EnrollmentCard, body: { cardToken: string; nfc: typeof identity; operationId: string }): Promise<ProvisionBegin>;
  confirmProvision(card: EnrollmentCard, body: { cardToken: string; nfc: typeof identity; operationId: string; challenge: string }): Promise<EnrollmentCard & { idempotentReplay?: boolean }>;
  verify(card: EnrollmentCard, cardToken: string): Promise<CardCheck>;
};
type RereadInput = { medium: "qr"; cardToken: string } | { medium: "nfc" };
type ProvisionFlow = {
  provision(card: EnrollmentCard, qrToken: string): Promise<EnrollmentCard>;
  reread(card: EnrollmentCard, read: RereadInput): Promise<{ verified: boolean }>;
};
const QR_CARD: EnrollmentCard = { id: "q1", publicId: "A".repeat(22), medium: "nfc_qr", status: "active", nfc: null };
const CHALLENGE = "opaque-server-challenge";
const OTHER_TOKEN = `${"Z".repeat(22)}.${"B".repeat(43)}`;

function provisionFixture(initial: EnrollmentCard = QR_CARD) {
  let stored: EnrollmentCard[] = [structuredClone(initial)]; let value = ""; let valid = true;
  const events: string[] = []; const phases: NfcPhase[] = []; const bodies: Record<string, unknown>[] = [];
  const hardware: NfcEncoderHardware = {
    async availability() { events.push("availability"); },
    async inspect() { events.push("inspect"); return identity; },
    async openNdef(uid) { events.push("open"); assert.equal(uid, UID); },
    async readText() { events.push("read"); return value; },
    async writeText(v) { events.push("write"); value = v; },
    async isReadOnly() { return false; }, async close() { events.push("close"); },
  };
  const forbidden = (name: string) => async (): Promise<never> => { events.push(name); throw nfcFailure("NFC_RESPONSE_INVALID"); };
  const api: NfcEnrollmentApi & ProvisionApi = {
    async list() { events.push("list"); return { cards: structuredClone(stored), nfcEnabled: true }; },
    issue: forbidden("issue"), replace: forbidden("replace"), retry: forbidden("retry"), confirm: forbidden("confirm"),
    async provision(card, body) {
      events.push("provision"); bodies.push({ route: "provision", ...body });
      return { cardId: card.id, alreadyProvisioned: false, challenge: CHALLENGE, expiresAt: "2026-10-21T15:00:00Z" };
    },
    async confirmProvision(card, body) {
      events.push("confirmProvision"); bodies.push({ route: "confirm", ...body });
      assert.equal(ndefForCard(body.cardToken), value, "le jeton confirmé doit être celui relu sur la puce");
      const done: EnrollmentCard = { ...card, medium: "nfc_qr", status: "active", nfc: { ...body.nfc, state: "encoded", operationId: null, expiresAt: null } };
      stored = stored.map((c) => c.id === card.id ? done : c); return structuredClone(done);
    },
    async verify(card, cardToken) {
      events.push("verify"); bodies.push({ route: "verify", cardId: card.id });
      const current = stored.find((c) => c.publicId === cardToken.split(".")[0]);
      const ok = !!current && current.status === "active";
      return ok ? { card: { valid: true, medium: current!.medium }, scope: "school", matchesCard: current!.id === card.id } : { card: { valid: false }, scope: "none" };
    },
  };
  const flow = createIndividualNfcFlow({ studentId: "s1", hardware, api, valid: () => valid, uuid: () => OP, phase: (p) => { phases.push(p); } });
  return { api, hardware, events, phases, bodies, flow,
    get cards() { return stored; }, get value() { return value; },
    setCards(c: EnrollmentCard[]) { stored = c; }, setValue(v: string) { value = v; }, invalidate() { valid = false; } };
}
function provisioning(f: ReturnType<typeof provisionFixture>): ProvisionFlow {
  const flow = f.flow as unknown as Partial<ProvisionFlow>;
  assert.equal(typeof flow.provision, "function", "createIndividualNfcFlow n'expose aucun provisionnement NFC de la carte active existante (flow.provision)");
  return flow as ProvisionFlow;
}
function rereading(f: ReturnType<typeof provisionFixture>): ProvisionFlow {
  const flow = f.flow as unknown as Partial<ProvisionFlow>;
  assert.equal(typeof flow.reread, "function", "createIndividualNfcFlow n'expose aucune relecture en lecture seule (flow.reread)");
  return flow as ProvisionFlow;
}
const MUTATIONS = ["write", "issue", "replace", "retry", "confirm", "provision", "confirmProvision"];
// Rendu réel du panneau (React + react-dom sur un hôte minimal, RN et natif simulés) :
// on observe les boutons effectivement affichés, leur état et l'action déclenchée.
type PanelButton = { label: string; disabled: boolean; onPress: () => void };
type PanelProps = { cards: EnrollmentCard[]; canRead: boolean; canUpdate: boolean; mutationsBlocked?: boolean };
const panelHarness = (() => {
  const state = { cards: [] as EnrollmentCard[], buttons: [] as PanelButton[], calls: [] as string[], alerts: [] as string[] };
  const nodeRequire = createRequire(import.meta.url);
  const loader = Module as unknown as { _load: (...args: unknown[]) => unknown };
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const touchable = (props: { accessibilityLabel?: string; disabled?: boolean; onPress?: () => void; children?: React.ReactNode }) => {
    if (props.accessibilityLabel) state.buttons.push({ label: props.accessibilityLabel, disabled: props.disabled === true, onPress: props.onPress ?? (() => {}) });
    return null;
  };
  const record = (name: string) => async (): Promise<never> => { state.calls.push(name); throw nfcFailure("NFC_CANCELLED"); };
  const mocks: Record<string, unknown> = {
    "react-native": {
      Platform: { OS: "android" }, Text: () => null, TouchableOpacity: touchable,
      View: (props: { testID?: string; children?: React.ReactNode }) => { if (props.testID === "student-card-nfc-enrollment-panel") state.buttons = []; return passthrough(props); },
      Alert: { alert: (title: string) => { state.alerts.push(title); } },
      AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    },
    "../services/studentCardEnrollmentApi": { studentCardEnrollmentApi: {
      async list() { state.calls.push("list"); return { cards: structuredClone(state.cards), nfcEnabled: true }; },
      issue: record("issue"), replace: record("replace"), retry: record("retry"), confirm: record("confirm"),
      provision: record("provision"), confirmProvision: record("confirmProvision"), verify: record("verify"),
    } },
    // Pont natif simulé : le vrai encodeur (import() dynamique du panneau) s'exécute ; aucune puce présentée.
    "react-native-nfc-manager": {
      __esModule: true, NfcAdapter: {}, Ndef: nodeRequire("react-native-nfc-manager/dist/ndef-lib"),
      NfcTech: { Ndef: "Ndef", NfcA: "NfcA", NfcB: "NfcB", IsoDep: "IsoDep" }, NdefStatus: { ReadWrite: 1, ReadOnly: 2, NotSupported: 3 },
      default: {
        start: async () => {}, isSupported: async () => true, isEnabled: async () => true,
        registerTagEvent: async () => {}, unregisterTagEvent: async () => {}, cancelTechnologyRequest: async () => {},
        requestTechnology: async () => { state.calls.push("nfc-request"); throw new Error("aucune puce présentée"); },
      },
    },
  };
  async function flush() { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
  return {
    state,
    async render(props: PanelProps) {
      const g = globalThis as Record<string, unknown>;
      const saved = { window: g.window, act: g.IS_REACT_ACT_ENVIRONMENT, react: g.React };
      g.React = React; // le TSX du panneau est compilé en JSX classique par tsx
      g.window = { event: undefined, HTMLIFrameElement: class {}, document: { activeElement: null } }; g.IS_REACT_ACT_ENVIRONMENT = true;
      const original = loader._load;
      loader._load = function (this: unknown, ...args: unknown[]) { const request = String(args[0]); return request in mocks ? mocks[request] : original.apply(this, args); };
      Object.assign(state, { cards: props.cards, buttons: [], calls: [], alerts: [] });
      const node: Record<string, unknown> = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
        childNodes: [], textContent: "", addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {} };
      node.ownerDocument = { addEventListener() {}, removeEventListener() {}, defaultView: null, documentElement: node };
      const { createRoot } = nodeRequire("react-dom/client") as { createRoot: (c: unknown) => { render(n: React.ReactNode): void; unmount(): void } };
      const { StudentCardNfcEnrollmentPanel } = nodeRequire("../components/StudentCardNfcEnrollmentPanel") as { StudentCardNfcEnrollmentPanel: React.ComponentType<Record<string, unknown>> };
      const root = createRoot(node);
      await act(async () => { root.render(React.createElement(StudentCardNfcEnrollmentPanel, { studentId: "s1", canRead: props.canRead, canUpdate: props.canUpdate, mutationsBlocked: props.mutationsBlocked === true })); });
      await flush();
      return {
        button(label: string) { return state.buttons.find((b) => b.label === label); },
        async press(label: string) { const b = state.buttons.find((x) => x.label === label); assert.ok(b && !b.disabled); await act(async () => { b.onPress(); }); await flush(); },
        async unmount() { await act(async () => { root.unmount(); }); loader._load = original; g.window = saved.window; g.IS_REACT_ACT_ENVIRONMENT = saved.act; g.React = saved.react; },
      };
    },
  };
})();
const ENCODE = "Encoder NFC sur cette carte";
const REREAD = "Relire la carte";
const ENCODED_QR_CARD: EnrollmentCard = { ...QR_CARD, nfc: { ...identity, state: "encoded", operationId: null, expiresAt: null } };

test("RED-01/02 contrôle du harnais — BASELINE PASS : le rendu réel affiche « Remplacer la carte active » (comportement actuel)", async () => {
  const panel = await panelHarness.render({ cards: [QR_CARD], canRead: true, canUpdate: true });
  try {
    assert.ok(panelHarness.state.calls.includes("list"), "le panneau a chargé les cartes");
    const replace = panel.button("Remplacer la carte active");
    assert.ok(replace && !replace.disabled, `boutons affichés : ${panelHarness.state.buttons.map((b) => b.label).join(" | ")} ; appels : ${panelHarness.state.calls.join(",")}`);
  } finally { await panel.unmount(); }
});
test("RED-01 — carte QR active sans puce + Élèves:UPDATE : bouton « Encoder NFC sur cette carte » affiché, sans remplacement", async () => {
  const panel = await panelHarness.render({ cards: [QR_CARD], canRead: true, canUpdate: true });
  try {
    const encode = panel.button(ENCODE);
    assert.ok(encode, `boutons affichés : ${panelHarness.state.buttons.map((b) => b.label).join(" | ")}`);
    assert.equal(encode.disabled, false);
    await panel.press(ENCODE);
    assert.deepEqual(panelHarness.state.alerts.filter((t) => /remplacement/i.test(t)), [], "encoder ne doit jamais demander un remplacement");
    assert.ok(!["issue", "replace", "retry", "confirm"].some((c) => panelHarness.state.calls.includes(c)), "aucune nouvelle carte ni remplacement");
  } finally { await panel.unmount(); }
});
test("RED-02 — carte QR active sans puce : bouton « Relire la carte » affiché sans puce encodée", async () => {
  const panel = await panelHarness.render({ cards: [QR_CARD], canRead: true, canUpdate: true });
  try {
    const reread = panel.button(REREAD);
    assert.ok(reread, `boutons affichés : ${panelHarness.state.buttons.map((b) => b.label).join(" | ")}`);
    assert.equal(reread.disabled, false);
  } finally { await panel.unmount(); }
});
test("RED-03 (panneau) — carte active NFC encodée : « Relire la carte » affiché, aucun encodage initial proposé", async () => {
  const panel = await panelHarness.render({ cards: [ENCODED_QR_CARD], canRead: true, canUpdate: true });
  try {
    assert.equal(panel.button(ENCODE), undefined, "pas d'encodage initial sur une carte déjà encodée");
    assert.ok(panel.button(REREAD), `boutons affichés : ${panelHarness.state.buttons.map((b) => b.label).join(" | ")}`);
  } finally { await panel.unmount(); }
});
for (const status of ["lost", "revoked", "replaced"]) test(`RED-04 (panneau) — BASELINE PASS : carte ${status} seule, ni « Encoder NFC » ni « Relire la carte »`, async () => {
  const panel = await panelHarness.render({ cards: [{ ...QR_CARD, status }], canRead: true, canUpdate: true });
  try { assert.equal(panel.button(ENCODE), undefined); assert.equal(panel.button(REREAD), undefined); }
  finally { await panel.unmount(); }
});
test("RED-03 — carte active avec NFC encodé : relecture disponible, aucun encodage initial", async () => {
  const encoded: EnrollmentCard = { ...QR_CARD, nfc: { ...identity, state: "encoded", operationId: null, expiresAt: null } };
  const f = provisionFixture(encoded);
  await assert.rejects(provisioning(f).provision(encoded, TOKEN), { code: "STUDENT_CARD_NFC_ALREADY_PROVISIONED" });
  assert.ok(!f.events.includes("inspect") && !f.events.includes("write") && !f.events.includes("provision"));
  f.setValue(ndefForCard(TOKEN));
  assert.equal((await rereading(f).reread(encoded, { medium: "nfc" })).verified, true);
  assert.ok(!MUTATIONS.some((m) => f.events.includes(m)));
});
for (const status of ["lost", "revoked", "replaced"]) test(`RED-04 — carte ${status} : ni encodage ni vérification positive`, async () => {
  const card: EnrollmentCard = { ...QR_CARD, status };
  const f = provisionFixture(card);
  await assert.rejects(provisioning(f).provision(card, TOKEN), { code: "STUDENT_CARD_INVALID_STATE" });
  assert.ok(!f.events.includes("inspect") && !f.events.includes("provision") && !f.events.includes("write"));
  assert.equal((await rereading(f).reread(card, { medium: "qr", cardToken: TOKEN })).verified, false);
});
test("RED-05 — scan QR : jeton complet exigé et identité de la carte affichée vérifiée", async () => {
  for (const qr of ["A".repeat(22), `${"A".repeat(22)}.`, "https://example.test/x", OTHER_TOKEN]) {
    const f = provisionFixture();
    await assert.rejects(provisioning(f).provision(QR_CARD, qr), { code: "NFC_FOREIGN" }, `QR refusé : ${qr.slice(0, 4)}…`);
    assert.ok(!f.events.includes("inspect") && !f.events.includes("provision"));
  }
  const f = provisionFixture(); f.setCards([QR_CARD, { ...QR_CARD, id: "other", publicId: "Z".repeat(22) }]);
  assert.equal((await rereading(f).reread(QR_CARD, { medium: "qr", cardToken: OTHER_TOKEN })).verified, false, "une carte valide d'un autre élève n'est pas « vérifiée »");
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const api = createNfcEnrollmentApi(async <T>(path: string, options?: { body?: string }) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : undefined }); return { card: { valid: true }, scope: "school", matchesCard: true } as T;
  }) as NfcEnrollmentApi & Partial<ProvisionApi>;
  assert.equal(typeof api.verify, "function", "l'adaptateur API n'expose pas la relecture /student-cards/verify avec cardId");
  await api.verify!(QR_CARD, TOKEN);
  assert.deepEqual(calls[0], { path: "/student-cards/verify", body: { cardToken: TOKEN, cardId: "q1" } });
});
test("RED-06 — séquence : scan QR → inspection NTAG213 → défi serveur → écriture → relecture → confirmation", async () => {
  const f = provisionFixture();
  await provisioning(f).provision(QR_CARD, TOKEN);
  const order = f.events.filter((e) => ["list", "inspect", "provision", "write", "read", "confirmProvision"].includes(e));
  assert.equal(order[0], "list");
  assert.ok(order.indexOf("inspect") < order.indexOf("provision"));
  assert.ok(order.indexOf("provision") < order.indexOf("write"));
  assert.ok(order.lastIndexOf("read") > order.indexOf("write") && order.lastIndexOf("read") < order.indexOf("confirmProvision"));
  assert.deepEqual(f.bodies[0], { route: "provision", cardToken: TOKEN, nfc: identity, operationId: OP });
  assert.deepEqual(f.bodies[1], { route: "confirm", cardToken: TOKEN, nfc: identity, operationId: OP, challenge: CHALLENGE });
  assert.equal(f.phases.at(-1), "success");
});
for (const medium of ["nfc_qr", "qr"]) test(`RED-07 — même cardId, même publicId, QR imprimé toujours valide (${medium})`, async () => {
  const card = { ...QR_CARD, medium }; const f = provisionFixture(card);
  const result = await provisioning(f).provision(card, TOKEN);
  assert.equal(result.id, "q1"); assert.equal(result.publicId, card.publicId); assert.equal(result.medium, "nfc_qr");
  assert.equal(result.nfc?.state, "encoded"); assert.equal(f.value, ndefForCard(TOKEN), "la puce porte le jeton du QR imprimé");
  assert.ok(!["issue", "replace", "retry", "confirm"].some((m) => f.events.includes(m)), "aucune nouvelle carte ni remplacement");
  assert.equal(f.cards.filter((c) => c.status === "active").length, 1);
  assert.equal((await rereading(f).reread(result, { medium: "qr", cardToken: TOKEN })).verified, true);
});
for (const mode of ["write", "readback"]) test(`RED-08 — ${mode} échoué(e) : aucune confirmation « encodé »`, async () => {
  const f = provisionFixture(); const flow = provisioning(f);
  if (mode === "write") f.hardware.writeText = async () => { throw new Error("tag lost"); };
  else f.hardware.writeText = async () => { f.setValue(ndefForCard(`${"A".repeat(22)}.${"C".repeat(43)}`)); };
  await assert.rejects(flow.provision(QR_CARD, TOKEN));
  assert.ok(!f.events.includes("confirmProvision")); assert.ok(!f.phases.includes("success")); assert.equal(f.cards[0].nfc, null);
});
test("RED-09 — mauvaise puce, contenu étranger, puce déjà affectée ou autre élève : refus", async () => {
  for (const content of ["other-system:private-data", ndefForCard(OTHER_TOKEN)]) {
    const f = provisionFixture(); const flow = provisioning(f); f.setValue(content);
    await assert.rejects(flow.provision(QR_CARD, TOKEN), { code: "NFC_FOREIGN" }); assert.ok(!f.events.includes("provision") && !f.events.includes("write"));
  }
  for (const code of ["STUDENT_CARD_NFC_UID_EXISTS", "STUDENT_CARD_NOT_FOUND", "STUDENT_CARD_INVALID_STATE"]) {
    const f = provisionFixture(); const flow = provisioning(f); f.api.provision = async () => { throw nfcFailure(code); };
    await assert.rejects(flow.provision(QR_CARD, TOKEN), { code }); assert.ok(!f.events.includes("write") && !f.events.includes("confirmProvision"));
  }
  const f = provisionFixture(); const flow = provisioning(f);
  f.hardware.openNdef = async () => { throw nfcFailure("NFC_SAME_CARD"); };
  await assert.rejects(flow.provision(QR_CARD, TOKEN), { code: "NFC_SAME_CARD" }); assert.ok(!f.events.includes("write"));
});
for (const point of ["inspect", "provision", "write", "read"]) test(`RED-10 — annulation ou changement de contexte pendant ${point} : aucune confirmation périmée`, async () => {
  const f = provisionFixture(); const flow = provisioning(f);
  if (point === "inspect") { const o = f.hardware.inspect; f.hardware.inspect = async () => { const r = await o(); f.invalidate(); return r; }; }
  if (point === "provision") { const o = f.api.provision; f.api.provision = async (...a) => { const r = await o(...a); f.invalidate(); return r; }; }
  if (point === "write") { const o = f.hardware.writeText; f.hardware.writeText = async (v) => { await o(v); f.invalidate(); }; }
  if (point === "read") { const o = f.hardware.readText; f.hardware.readText = async () => { const r = await o(); if (f.events.includes("write")) f.invalidate(); return r; }; }
  await assert.rejects(flow.provision(QR_CARD, TOKEN), { code: "NFC_CANCELLED" });
  assert.ok(!f.events.includes("confirmProvision")); assert.ok(!f.phases.includes("success"));
});
test("RED-11 — RBAC : Élèves:READ seul → relecture sans encodage ; Élèves:UPDATE hors ligne → aucun encodage", async () => {
  const readOnly = await panelHarness.render({ cards: [QR_CARD], canRead: true, canUpdate: false });
  try {
    assert.equal(readOnly.button(ENCODE), undefined, "encodage réservé à Élèves:UPDATE / Gérer élèves");
    assert.equal(readOnly.button("Remplacer la carte active"), undefined);
    const reread = readOnly.button(REREAD);
    assert.ok(reread && !reread.disabled, `la relecture doit être offerte avec Élèves:READ ; boutons : ${panelHarness.state.buttons.map((b) => b.label).join(" | ")}`);
  } finally { await readOnly.unmount(); }
  const blocked = await panelHarness.render({ cards: [QR_CARD], canRead: true, canUpdate: true, mutationsBlocked: true });
  try { const encode = blocked.button(ENCODE); assert.ok(!encode || encode.disabled, "aucun encodage sans connexion ni droits à jour"); }
  finally { await blocked.unmount(); }
});
test("RED-12 — tentatives concurrentes ou répétées : aucun doublon ni remplacement implicite", async () => {
  const f = provisionFixture(); const flow = provisioning(f); const gate = deferred<void>();
  const o = f.api.provision; f.api.provision = async (...a) => { await gate.promise; return o(...a); };
  const first = flow.provision(QR_CARD, TOKEN);
  await assert.rejects(flow.provision(QR_CARD, TOKEN), { code: "NFC_BUSY" });
  gate.resolve(); await first;
  assert.equal(f.events.filter((e) => e === "provision").length, 1); assert.equal(f.events.filter((e) => e === "write").length, 1);
  const replay = provisionFixture(); const replayFlow = provisioning(replay); replay.setValue(ndefForCard(TOKEN));
  const already: EnrollmentCard = { ...QR_CARD, nfc: { ...identity, state: "encoded", operationId: null, expiresAt: null } };
  replay.api.provision = async () => { replay.events.push("provision"); return { cardId: "q1", alreadyProvisioned: true, card: already }; };
  assert.equal((await replayFlow.provision(QR_CARD, TOKEN)).nfc?.state, "encoded");
  assert.ok(!replay.events.includes("write") && !replay.events.includes("confirmProvision"), "rejeu idempotent : ni réécriture ni seconde confirmation");
  assert.ok(!["issue", "replace"].some((m) => f.events.includes(m) || replay.events.includes(m)));
});
test("RED-13 — relecture strictement en lecture seule (QR et NFC)", async () => {
  const encoded: EnrollmentCard = { ...QR_CARD, nfc: { ...identity, state: "encoded", operationId: null, expiresAt: null } };
  const f = provisionFixture(encoded); f.setValue(ndefForCard(TOKEN)); const flow = rereading(f);
  await flow.reread(encoded, { medium: "qr", cardToken: TOKEN }); await flow.reread(encoded, { medium: "nfc" });
  assert.deepEqual(MUTATIONS.filter((m) => f.events.includes(m)), [], "aucune écriture puce ni mutation serveur");
  assert.equal(f.events.filter((e) => e === "verify").length, 2);
});
test("RED-14 — aucun secret réaffiché, stocké durablement ou journalisé", async () => {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const api = createNfcEnrollmentApi(async <T>(path: string, options?: { body?: string }) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : undefined }); return {} as T;
  }) as NfcEnrollmentApi & Partial<ProvisionApi>;
  assert.equal(typeof api.provision, "function", "l'adaptateur API n'expose pas POST /student-cards/:id/nfc-provision");
  assert.equal(typeof api.confirmProvision, "function", "l'adaptateur API n'expose pas POST /student-cards/:id/nfc-provision/confirm");
  await api.provision!(QR_CARD, { cardToken: TOKEN, nfc: identity, operationId: OP });
  await api.confirmProvision!(QR_CARD, { cardToken: TOKEN, nfc: identity, operationId: OP, challenge: CHALLENGE });
  assert.deepEqual(calls.map((c) => c.path), ["/student-cards/q1/nfc-provision", "/student-cards/q1/nfc-provision/confirm"]);
  assert.deepEqual(calls[0].body, { cardToken: TOKEN, nfc: identity, operationId: OP });
  for (const code of ["STUDENT_CARD_NFC_ALREADY_PROVISIONED", "STUDENT_CARD_NFC_PROVISION_CHALLENGE_INVALID", "STUDENT_CARD_NFC_PROVISION_CHALLENGE_REQUIRED", "STUDENT_CARD_NFC_PROVISION_UNAVAILABLE"]) {
    const copy = nfcErrorCopy({ code, message: TOKEN });
    assert.ok(!copy.includes(TOKEN));
    assert.notEqual(copy, nfcErrorCopy({ code: "UNMAPPED_CODE" }), `${code} doit avoir un message dédié, pas le message générique`);
  }
  const f = provisionFixture(); const result = await provisioning(f).provision(QR_CARD, TOKEN);
  const rendered = JSON.stringify(result);
  assert.ok(!rendered.includes(TOKEN) && !rendered.includes(CHALLENGE) && !("cardToken" in result));
});
test("RED-16 — BASELINE PASS : le message NDEF somafrik:card tient dans une NTAG213 (137 octets NDEF utiles)", () => {
  const text = ndefForCard(TOKEN);
  const payload = 1 + "en".length + Buffer.byteLength(text, "utf8"); // statut + langue + texte (enregistrement Text, writeText natif)
  const record = 1 + 1 + 1 + 1 + payload; // en-tête court + longueur type + longueur charge + type « T »
  assert.ok(payload < 256, "enregistrement court (SR) attendu");
  assert.ok(record <= 137, `message NDEF de ${record} octets > capacité NTAG213`);
});
