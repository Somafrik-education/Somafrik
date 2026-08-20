/**
 *   npx tsx Mobile/src/lib/attendanceDraft.test.ts
 */
import assert from "node:assert/strict";
import {
  clearConfirmedAttendanceDirty,
  hydrateAttendanceAfterConfirmedSave,
  mergeConfirmedPresences,
  shouldPreserveLocalAttendanceDraft,
  type AttendanceDraftEntry,
} from "./attendanceDraft";

function run() {
  assert.equal(shouldPreserveLocalAttendanceDraft({ modifiedAt: "20-08-2026 10:00" }), true);
  assert.equal(shouldPreserveLocalAttendanceDraft({}), false);
  assert.equal(shouldPreserveLocalAttendanceDraft(undefined), false);

  const draft: Record<string, AttendanceDraftEntry> = {
    "stu-1": {
      status: "Absent",
      modifiedAt: "20-08-2026 10:00",
      modifiedBy: "Enseignant",
      previousStatus: "Présent",
    },
    "stu-2": {
      status: "Présent",
    },
  };

  const afterConfirm = clearConfirmedAttendanceDirty(draft, ["stu-1"]);
  assert.equal(afterConfirm["stu-1"]?.modifiedAt, undefined);
  assert.equal(afterConfirm["stu-1"]?.status, "Absent");
  assert.equal(shouldPreserveLocalAttendanceDraft(afterConfirm["stu-1"]), false);
  assert.equal(afterConfirm["stu-2"]?.status, "Présent");

  const previousPresences = [
    { id: "PRE-1", studentId: "stu-1", date: "20-08-2026", status: "Présent", present: true },
  ];
  const savedPresences = [
    { id: "PRE-1", studentId: "stu-1", date: "20-08-2026", status: "Absent", present: false },
  ];
  const failedRefresh = hydrateAttendanceAfterConfirmedSave({
    attendance: draft,
    studentIds: ["stu-1"],
    previousPresences,
    savedPresences,
    refreshSucceeded: false,
  });
  assert.equal(failedRefresh.attendance["stu-1"]?.modifiedAt, undefined);
  assert.equal(failedRefresh.attendance["stu-1"]?.status, "Absent");
  assert.equal(failedRefresh.presences[0]?.status, "Absent");
  assert.equal(
    shouldPreserveLocalAttendanceDraft(failedRefresh.attendance["stu-1"]),
    false,
  );
  const rehydrated = [...failedRefresh.presences]
    .reverse()
    .find((presence) => presence.studentId === "stu-1");
  assert.equal(rehydrated?.status, "Absent");
  assert.notEqual(rehydrated?.status, previousPresences[0]?.status);

  const merged = mergeConfirmedPresences(previousPresences, savedPresences);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.status, "Absent");

  console.log("attendanceDraft.test.ts OK");
}

run();
