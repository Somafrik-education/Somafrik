import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLECTIVE_ROLL_CALL_COPY,
  addRollCallScan,
  createRollCallDraft,
  createRollCallNfcLoop,
  rollCallProgress,
  rollCallScanFailure,
  rollCallScopeKey,
  rollCallValidateBody,
  undoLastRollCallScan,
  validateRollCallDraft,
  type NfcReadLike,
  type RollCallFeedback,
} from "./studentCardRollCall";

const context = {
  scopeKey: rollCallScopeKey({ resourceScopeKey: "r", schoolCode: "CD-1", classId: "class-1", date: "2026-10-15" }),
  sessionId: "11111111-1111-4111-8111-111111111111",
  classId: "class-1",
  date: "2026-10-15",
};
const scanOf = (n: number) => ({ dedupKey: `dedup-${n}`, receipt: `rc1.receipt-${n}` });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("le compteur suit les élèves distincts : trois lectures de la même carte = 1", () => {
  let draft = createRollCallDraft(context);
  const feedbacks: string[] = [];
  for (const scan of [scanOf(1), scanOf(1), scanOf(2), scanOf(1)]) {
    const next = addRollCallScan(draft, scan);
    draft = next.draft;
    feedbacks.push(next.feedback.kind);
  }
  assert.deepEqual(feedbacks, ["accepted", "duplicate", "accepted", "duplicate"]);
  assert.deepEqual(rollCallProgress(draft, 25), { count: 2, total: 25, percent: 8, remaining: 23 });
});

test("annuler le dernier retire uniquement le dernier élève compté", () => {
  let draft = createRollCallDraft(context);
  for (const n of [1, 2, 3]) draft = addRollCallScan(draft, scanOf(n)).draft;
  draft = undoLastRollCallScan(draft);
  assert.deepEqual(draft.entries.map((entry) => entry.dedupKey), ["dedup-1", "dedup-2"]);
  draft = undoLastRollCallScan(undoLastRollCallScan(undoLastRollCallScan(draft)));
  assert.equal(draft.entries.length, 0, "jamais négatif");
  assert.equal(addRollCallScan(draft, scanOf(3)).feedback.kind, "accepted", "rescanner après annulation recompte");
});

test("progression bornée et effectif nul sans division par zéro", () => {
  let draft = createRollCallDraft(context);
  for (const n of [1, 2, 3]) draft = addRollCallScan(draft, scanOf(n)).draft;
  assert.deepEqual(rollCallProgress(draft, 2), { count: 3, total: 2, percent: 100, remaining: 0 });
  assert.deepEqual(rollCallProgress(null, 0), { count: 0, total: 0, percent: 0, remaining: 0 });
});

test("le corps de validation ne contient que des reçus opaques, et l'opération est la session", async () => {
  let draft = createRollCallDraft(context);
  for (const n of [1, 2]) draft = addRollCallScan(draft, scanOf(n)).draft;
  assert.deepEqual(rollCallValidateBody(draft, "TCH-A"), {
    sessionId: context.sessionId, classId: "class-1", date: "2026-10-15",
    receipts: ["rc1.receipt-1", "rc1.receipt-2"], teacherId: "TCH-A",
  });
  const calls: { body: unknown; key: string }[] = [];
  const outcome = await validateRollCallDraft(draft, {
    validate: async (body, options) => { calls.push({ body, key: options.idempotencyKey }); return { recorded: 2 }; },
  });
  assert.deepEqual(outcome, { kind: "validated", recorded: 2, message: COLLECTIVE_ROLL_CALL_COPY.validated(2) });
  assert.equal(calls[0].key, context.sessionId);
  assert.deepEqual(await validateRollCallDraft(createRollCallDraft(context), { validate: async () => ({}) }),
    { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.emptyDraft });
});

test("cartes devenues invalides : seules les positions signalées par le serveur sont retirées", async () => {
  let draft = createRollCallDraft(context);
  for (const n of [1, 2, 3]) draft = addRollCallScan(draft, scanOf(n)).draft;
  const outcome = await validateRollCallDraft(draft, {
    validate: async () => {
      throw Object.assign(new Error("x"), { status: 409, code: "ROLL_CALL_CARD_INVALID", details: { invalidReceiptIndexes: [1] } });
    },
  });
  assert.equal(outcome.kind, "cards_invalid");
  assert.deepEqual(outcome.kind === "cards_invalid" ? outcome.draft.entries.map((e) => e.dedupKey) : [], ["dedup-1", "dedup-3"]);
  for (const code of ["ROLL_CALL_RECEIPT_EXPIRED", "ROLL_CALL_CONTEXT_MISMATCH"]) {
    const expired = await validateRollCallDraft(draft, { validate: async () => { throw Object.assign(new Error("x"), { code }); } });
    assert.deepEqual(expired, { kind: "expired", message: COLLECTIVE_ROLL_CALL_COPY.expired });
  }
  const offline = await validateRollCallDraft(draft, {
    validate: async () => { throw Object.assign(new Error("x"), { status: 0, code: "NETWORK_UNAVAILABLE" }); },
  });
  assert.deepEqual(offline, { kind: "error", message: COLLECTIVE_ROLL_CALL_COPY.offline }, "le brouillon reste intact");
});

test("refus de scan : messages sans identité, arrêt seulement si la classe est hors périmètre", () => {
  const cases: [Record<string, unknown>, string, boolean][] = [
    [{ status: 409, code: "ROLL_CALL_CLASS_MISMATCH" }, COLLECTIVE_ROLL_CALL_COPY.refusedClass, false],
    [{ status: 403, code: "ROLL_CALL_CLASS_FORBIDDEN" }, COLLECTIVE_ROLL_CALL_COPY.forbidden, true],
    [{ status: 404, code: "STUDENT_CARD_NOT_FOUND" }, COLLECTIVE_ROLL_CALL_COPY.refusedCard, false],
    [{ status: 409, code: "STUDENT_CARD_INVALID_STATE" }, COLLECTIVE_ROLL_CALL_COPY.refusedCard, false],
    [{ status: 0, code: "NETWORK_UNAVAILABLE" }, COLLECTIVE_ROLL_CALL_COPY.offline, false],
    [{ code: "TIMEOUT" }, COLLECTIVE_ROLL_CALL_COPY.timeout, false],
  ];
  for (const [error, message, stop] of cases) {
    assert.deepEqual(rollCallScanFailure(error), { feedback: rollCallScanFailure(error).feedback, stop });
    assert.equal(rollCallScanFailure(error).feedback.message, message);
  }
});

test("boucle NFC : lectures successives sans rouvrir le lecteur, une seule lecture à la fois, arrêt net", async () => {
  const reads: ReturnType<typeof deferred<NfcReadLike>>[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const submitted: string[] = [];
  const feedbacks: RollCallFeedback[] = [];
  const listening: boolean[] = [];
  const loop = createRollCallNfcLoop({
    read: () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      const next = deferred<NfcReadLike>();
      reads.push(next);
      return next.promise.finally(() => { concurrent -= 1; });
    },
    submit: async (token) => { submitted.push(token); return { stop: false }; },
    onFeedback: (feedback) => feedbacks.push(feedback),
    onListening: (value) => listening.push(value),
  });
  loop.start();
  await tick();
  reads[0].resolve({ ok: true, token: "A.a" });
  await tick(); await tick();
  reads[1].resolve({ ok: false, reason: "timeout" });
  await tick(); await tick();
  reads[2].resolve({ ok: false, reason: "invalid_prefix" });
  await tick(); await tick();
  reads[3].resolve({ ok: true, token: "B.b" });
  await tick(); await tick();
  assert.deepEqual(submitted, ["A.a", "B.b"]);
  assert.equal(maxConcurrent, 1);
  assert.equal(feedbacks[0].message, COLLECTIVE_ROLL_CALL_COPY.notSomafrik);
  loop.stop();
  reads[4].resolve({ ok: true, token: "C.c" });
  await tick(); await tick();
  assert.deepEqual(submitted, ["A.a", "B.b"], "aucune carte traitée après stop()");
  assert.equal(reads.length, 5, "aucune nouvelle lecture après stop()");
  assert.equal(listening.at(-1), false);
});

test("boucle NFC : NFC désactivé ou classe hors périmètre arrêtent la boucle", async () => {
  for (const scenario of ["disabled", "forbidden"] as const) {
    const listening: boolean[] = [];
    let reads = 0;
    const loop = createRollCallNfcLoop({
      read: async () => {
        reads += 1;
        return scenario === "disabled" ? { ok: false, reason: "disabled" } : { ok: true, token: "A.a" };
      },
      submit: async () => ({ stop: true }),
      onFeedback: () => {},
      onListening: (value) => listening.push(value),
    });
    loop.start();
    await tick(); await tick(); await tick();
    assert.equal(reads, 1, scenario);
    assert.deepEqual(listening, [true, false], scenario);
  }
});

test("garde-fous : l'appel collectif n'affiche aucune identité et ne journalise ni ne stocke rien", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname ?? __dirname, "..");
  const sources = ["components/StudentCardRollCallModal.tsx", "lib/studentCardRollCall.ts", "services/studentCardRollCallApi.ts"]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  for (const source of sources) {
    assert.doesNotMatch(source, /studentName|studentCode|firstName|lastName|photoUrl|matricule|financeLabel/);
    assert.doesNotMatch(source, /console\.|safeLogger|AsyncStorage|SecureStore|SQLite|outbox/i);
  }
  const modal = sources[0];
  assert.match(modal, /validatingRef\.current\) return; \/\/ double soumission bloquée/);
  assert.match(modal, /releaseNfcSession/);
  assert.doesNotMatch(modal, /recordStudentCardAttendance|readStudentCardFinance|resolveStudentCard/, "aucun pointage ni contrôle d'impayés dans l'appel collectif");
});
