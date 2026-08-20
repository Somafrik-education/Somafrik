/**
 *   npx tsx Mobile/src/lib/attendanceDraft.test.ts
 */
import assert from "node:assert/strict";
import {
  clearConfirmedAttendanceDirty,
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

  console.log("attendanceDraft.test.ts OK");
}

run();
