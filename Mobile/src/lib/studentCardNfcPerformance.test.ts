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
