import { test } from "node:test";
import assert from "node:assert/strict";
import { createIndividualNfcFlow, createNfcEnrollmentApi, encodeNfcCard, verifyNfcCard, identifyNtag, normalizeNtagUid, ndefForCard, nfcEnrollmentInterruption, nfcErrorCopy, nfcFailure,
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
test("foreground loss after writing keeps a read-back code and never a capability", () => {
  for (const phase of ["writing", "verification", "confirmation"] as const) {
    const decision = nfcEnrollmentInterruption({ nextAppState: "background", phase, working: true });
    assert.deepEqual(decision, { closeHardware: true, invalidate: true, code: "NFC_READBACK_INTERRUPTED" });
    const copy = nfcErrorCopy(Object.assign(new Error(TOKEN), { code: decision.code }));
    assert.equal(copy.includes(TOKEN), false);
    assert.match(copy, /après l’écriture/);
    assert.match(copy, /Relire et confirmer/);
  }
  for (const phase of ["initial", "reservation", "waiting", "resume"] as const) {
    const decision = nfcEnrollmentInterruption({ nextAppState: "inactive", phase, working: true });
    assert.equal(decision.code, "NFC_CANCELLED");
    const copy = nfcErrorCopy(nfcFailure(decision.code!));
    assert.equal(copy.includes(TOKEN), false);
    assert.doesNotMatch(copy, /après l’écriture/);
  }
  const idle = nfcEnrollmentInterruption({ nextAppState: "background", phase: "confirmation", working: false });
  assert.equal(idle.code, null);
  assert.equal(idle.closeHardware, true);
  assert.deepEqual(nfcEnrollmentInterruption({ nextAppState: "active", phase: "writing", working: true }), { closeHardware: false, invalidate: false, code: null });
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
