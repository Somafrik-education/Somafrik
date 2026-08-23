/**
 *   npx tsx Mobile/src/lib/attendanceTruth.test.ts
 */
import assert from "node:assert/strict";
import {
  applyRollCallStatus,
  assertRollCallReadyToSave,
  confirmRollCallEntries,
  emptyRollCallEntry,
  findTodayPresenceForStudent,
  getRollCallDraftStats,
  hydrateRollCallStatus,
  isAttendedStatus,
  isJustifiedAbsence,
  lastDraftStatus,
  markRosterPresent,
  presentFlagForStatus,
  resolveClassCourseLabel,
  rollCallEntryFromPresence,
  shouldPreserveLocalAttendanceDraft,
} from "./attendanceTruth";
import { rollCallInitialStatus } from "../domain/metrics/schoolMetrics";

function run() {
  assert.equal(hydrateRollCallStatus(undefined), null);
  assert.equal(hydrateRollCallStatus(null), null);
  assert.equal(hydrateRollCallStatus({ present: true, status: "Présent" }), "Présent");
  assert.equal(hydrateRollCallStatus({ present: false, status: "Absent" }), "Absent");
  assert.equal(hydrateRollCallStatus({ present: true, status: "Retard" }), "Retard");
  assert.equal(hydrateRollCallStatus({ present: false, status: "Justifié" }), "Justifié");
  assert.equal(hydrateRollCallStatus({ present: false, status: "excused" }), "Justifié");

  // P0 : l'ancien helper ne doit plus être la source d'un faux Présent métier.
  assert.equal(rollCallInitialStatus(undefined), null);

  const today = findTodayPresenceForStudent(
    [
      { studentId: "stu-1", date: "2026-08-20", status: "Absent", present: false },
      { studentId: "stu-1", date: "23-08-2026", status: "Retard", present: true },
    ],
    { id: "stu-1" },
    "23-08-2026",
  );
  assert.equal(today?.status, "Retard");
  assert.equal(
    findTodayPresenceForStudent(
      [{ studentId: "stu-1", date: "2026-08-20", status: "Absent", present: false }],
      { id: "stu-1" },
      "23-08-2026",
    ),
    undefined,
  );

  const unset = rollCallEntryFromPresence(undefined);
  assert.equal(unset.status, null);
  assert.equal(unset.source, "unset");
  assert.equal(shouldPreserveLocalAttendanceDraft(unset), false);

  const confirmed = rollCallEntryFromPresence({ status: "Absent", present: false });
  assert.equal(confirmed.source, "postgres");
  assert.equal(confirmed.status, "Absent");

  const draft = applyRollCallStatus(unset, "Présent", "Enseignant", new Date("2026-08-23T08:00:00"));
  assert.equal(draft.source, "draft");
  assert.equal(draft.status, "Présent");
  assert.equal(shouldPreserveLocalAttendanceDraft(draft), true);

  const cycle = ["Présent", "Absent", "Retard", "Justifié", "Présent"] as const;
  let current = emptyRollCallEntry();
  const seen: string[] = [];
  for (const status of cycle) {
    current = applyRollCallStatus(current, status, "Enseignant", new Date("2026-08-23T08:00:00"));
    seen.push(current.status ?? "");
  }
  assert.deepEqual(seen, [...cycle]);
  assert.equal(lastDraftStatus(cycle.map((status) => ({ status }))), "Présent");

  const roster = ["a", "b", "c", "d"];
  const emptyStats = getRollCallDraftStats(roster, {});
  assert.equal(emptyStats.present, 0);
  assert.equal(emptyStats.absent, 0);
  assert.equal(emptyStats.late, 0);
  assert.equal(emptyStats.justified, 0);
  assert.equal(emptyStats.rate, 0);
  assert.equal(emptyStats.total, 4);

  const mixed = {
    a: applyRollCallStatus(undefined, "Présent", "QA"),
    b: applyRollCallStatus(undefined, "Absent", "QA"),
    c: applyRollCallStatus(undefined, "Retard", "QA"),
    d: applyRollCallStatus(undefined, "Justifié", "QA"),
  };
  const mixedStats = getRollCallDraftStats(roster, mixed);
  assert.equal(mixedStats.present, 1);
  assert.equal(mixedStats.absent, 1);
  assert.equal(mixedStats.late, 1);
  assert.equal(mixedStats.justified, 1);
  assert.equal(mixedStats.attended, 2);
  assert.equal(mixedStats.rate, 50);
  assert.equal(isAttendedStatus("Retard"), true);
  assert.equal(isAttendedStatus("Justifié"), false);
  assert.equal(isJustifiedAbsence("Justifié"), true);
  assert.equal(presentFlagForStatus("Justifié"), false);
  assert.equal(presentFlagForStatus("Retard"), true);

  const incomplete = assertRollCallReadyToSave(roster, { a: mixed.a });
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.deepEqual(incomplete.missingIds, ["b", "c", "d"]);

  const marked = markRosterPresent(roster, {}, "QA", new Date("2026-08-23T08:00:00"));
  assert.equal(assertRollCallReadyToSave(roster, marked).ok, true);
  assert.equal(getRollCallDraftStats(roster, marked).present, 4);
  assert.equal(getRollCallDraftStats(roster, marked).rate, 100);
  assert.equal(marked.a.source, "draft");

  const afterOneAbsent = {
    ...marked,
    b: applyRollCallStatus(marked.b, "Absent", "QA"),
    c: applyRollCallStatus(marked.c, "Retard", "QA"),
    d: applyRollCallStatus(marked.d, "Justifié", "QA"),
  };
  const afterStats = getRollCallDraftStats(roster, afterOneAbsent);
  assert.equal(afterStats.present, 1);
  assert.equal(afterStats.absent, 1);
  assert.equal(afterStats.late, 1);
  assert.equal(afterStats.justified, 1);

  const confirmedAll = confirmRollCallEntries(afterOneAbsent, roster);
  assert.equal(confirmedAll.a.source, "postgres");
  assert.equal(confirmedAll.a.modifiedAt, undefined);
  assert.equal(shouldPreserveLocalAttendanceDraft(confirmedAll.a), false);

  assert.equal(resolveClassCourseLabel([]), "Cours non renseignés");
  assert.equal(resolveClassCourseLabel(["Maths", ""]), "Maths");

  console.log("attendanceTruth.test.ts OK");
}

run();
