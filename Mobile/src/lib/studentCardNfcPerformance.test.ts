import assert from "node:assert/strict";
import { test } from "node:test";
import { runStudentCardScanFlow } from "./studentCardScan";

const response = {
  card: { status: "active" }, student: { id: "student-1", firstName: "Test", lastName: "NFC", studentCode: "E-1" },
  class: { id: "class-1", classCode: "A", className: "Classe A" },
};
const snapshot = () => ({ generation: 1, resourceScopeKey: "s-1", schoolCode: "CD-1", classId: "class-1", classCode: "A" });
function setup(overrides: Record<string, unknown> = {}) {
  let commit!: (value: typeof response) => void;
  let financeDone!: (value: any) => void;
  const calls: string[] = [];
  const attendance = new Promise<typeof response>(resolve => { commit = resolve; });
  const finance = new Promise<any>(resolve => { financeDone = resolve; });
  const flow = runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: snapshot(), selectedClass: { classId: "class-1", classCode: "A" },
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-19", financeEnabled: true, parallelFinance: true,
    isOffline: () => false, currentScope: snapshot,
    resolveCard: async () => { calls.push("resolve"); return response; },
    recordAttendance: () => { calls.push("attendance"); return attendance; },
    readFinance: () => { calls.push("finance"); return finance; },
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
    ...overrides,
  });
  return { flow, calls, commit, financeDone };
}
test("NFC-PERF-01 finance begins while attendance is pending; success requires commit", async () => {
  const x = setup();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(x.calls, ["resolve", "finance", "attendance"]);
  let completed = false;
  void x.flow.then(() => { completed = true; });
  x.financeDone({ finance: { code: "UP_TO_DATE" } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(completed, false, "financial answer must never confirm attendance");
  x.commit(response);
  const result = await x.flow;
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.view.attendanceRecorded, true);
});
test("NFC-PERF-01 failed financial lookup cannot invalidate successful attendance", async () => {
  const x = setup({ readFinance: async () => { throw new Error("finance unavailable"); } });
  await new Promise<void>(resolve => setImmediate(resolve));
  x.commit(response);
  const result = await x.flow;
  assert.equal(result.kind, "success");
  if (result.kind === "success") assert.equal(result.view.financeUnavailable, true);
});
test("NFC-PERF-01 no finance call on mismatched class", async () => {
  const x = setup({ resolveCard: async () => ({ ...response, class: { id: "class-2", classCode: "B", className: "Classe B" } }) });
  const result = await x.flow;
  assert.equal(result.kind, "class_mismatch");
  assert.deepEqual(x.calls, []);
});

test("NFC-PERF-02 one POST: no resolver, class scope provided, confirmed server response only", async () => {
  let calls = 0;
  let selected = "";
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token", scope: snapshot(),
    selectedClass: { classId: "class-1", classCode: "A" },
    author: { status: "teacher_session" }, attendanceDate: "2026-10-19",
    financeEnabled: false, singleRequestAttendance: true,
    isOffline: () => false, currentScope: snapshot,
    resolveCard: async () => { throw new Error("resolver must be skipped"); },
    recordAttendance: async (_token, attendance) => {
      calls += 1;
      selected = String(attendance.expectedClassId);
      return response;
    },
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(calls, 1);
  assert.equal(selected, "class-1");
  assert.equal(outcome.kind, "success");
});

test("NFC-PERF-02 QR unchanged: without the NFC flag, resolve then record, no expectedClassId", async () => {
  const calls: string[] = [];
  const sent: Record<string, unknown>[] = [];
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token", scope: snapshot(),
    selectedClass: { classId: "class-1", classCode: "A" },
    author: { status: "teacher_session" }, attendanceDate: "2026-10-19",
    financeEnabled: false,
    isOffline: () => false, currentScope: snapshot,
    resolveCard: async () => { calls.push("resolve"); return response; },
    recordAttendance: async (_token, attendance, idempotencyKey) => {
      calls.push("record");
      sent.push({ ...attendance, idempotencyKey });
      return response;
    },
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
  });
  assert.deepEqual(calls, ["resolve", "record"]);
  assert.equal(Object.hasOwn(sent[0], "expectedClassId"), false);
  assert.equal(sent[0].idempotencyKey, "11111111-1111-4111-8111-111111111111");
  assert.equal(outcome.kind, "success");
});

test("NFC-PERF-02 single request: server class refusal or invalid card → no success, idempotency key kept", async () => {
  for (const code of ["STUDENT_CARD_CLASS_MISMATCH", "STUDENT_CARD_INVALID_STATE", "STUDENT_CARD_NOT_FOUND"]) {
    const keys: string[] = [];
    const outcome = await runStudentCardScanFlow({
      cardToken: "synthetic.token", scope: snapshot(),
      selectedClass: { classId: "class-1", classCode: "A" },
      author: { status: "teacher_session" }, attendanceDate: "2026-10-19",
      financeEnabled: false, singleRequestAttendance: true,
      isOffline: () => false, currentScope: snapshot,
      resolveCard: async () => { throw new Error("resolver must be skipped"); },
      recordAttendance: async (_token, _attendance, idempotencyKey) => {
        keys.push(idempotencyKey);
        throw Object.assign(new Error("refused"), { code });
      },
      createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(outcome.kind, "error", code);
    assert.deepEqual(keys, ["11111111-1111-4111-8111-111111111111"], code);
  }
});
