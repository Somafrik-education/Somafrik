/**
 * LOT 3 — contrat Mobile Planning weekly V2.
 *   npx tsx Mobile/src/lib/planningV2.test.ts
 */
import assert from "node:assert/strict";
import {
  assertNoLegacyPlanningIdentity,
  buildCreateReplacementPayload,
  buildCreateWeeklySlotPayload,
  buildUpdateWeeklySlotPayload,
  displayedOccurrencesForDay,
  formatSlotHours,
  mapPlanningConflictMessage,
  normalizePlanningCourseOption,
  normalizeReplacement,
  normalizeSchoolRoom,
  normalizeWeeklySlot,
  overlayReplacementForDate,
  PLANNING_V2_COPY,
  resolveReplacementProjection,
  selectableRooms,
  slotsForDay,
  stripPlanningClientScope,
} from "./planningV2";

function conflictError(message: string, status = 409, code = "COURSE_SCHEDULE_CONFLICT") {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  error.code = code;
  return error;
}

function run() {
  const weekly = normalizeWeeklySlot({
    id: "slot-1",
    academicYearId: "year-1",
    dayOfWeek: 1,
    startTime: "8:00:00",
    from: "ignored",
    endTime: "09:00",
    classId: "class-1",
    classCode: "3A",
    className: "3e A",
    schoolCourseId: "course-1",
    courseName: "Mathématiques",
    teacherId: "teacher-a",
    teacherCode: "ENS-0001",
    teacherName: "M. Okito",
    roomId: "room-4",
    room: "Salle 4",
    status: "active",
  });
  assert.ok(weekly);
  assert.equal(weekly.dayOfWeek, 1);
  assert.equal(weekly.startTime, "08:00");
  assert.equal(weekly.endTime, "09:00");
  assert.equal(weekly.schoolCourseId, "course-1");
  assert.equal(weekly.roomId, "room-4");
  assert.equal(weekly.roomName, "Salle 4");
  assert.equal(weekly.teacherId, "teacher-a");
  assert.equal(normalizeWeeklySlot({ id: "x", schoolCourseId: "c" }), null);

  const monday = slotsForDay([weekly], 1);
  assert.equal(monday.length, 1);
  assert.equal(slotsForDay([weekly], 2).length, 0);
  assert.equal(formatSlotHours(weekly), "08:00 – 09:00");

  const option = normalizePlanningCourseOption({
    schoolCourseId: "course-1",
    academicYearId: "year-1",
    classId: "class-1",
    className: "3e A",
    name: "Mathématiques",
    teacherId: "ENS-0001",
    teacherName: "M. Okito",
  });
  assert.ok(option);
  assert.equal(option.courseName, "Mathématiques");
  assert.equal(option.teacherCode, "ENS-0001");
  assert.equal(option.teacherId, "");

  const room = normalizeSchoolRoom({ id: "room-4", name: "Salle 4", roomType: "classroom", status: "active" });
  const archived = normalizeSchoolRoom({ id: "room-old", name: "Gymnase", status: "archived" });
  assert.ok(room && archived);
  const selectable = selectableRooms([room, archived], "room-old");
  assert.equal(selectable.some((item) => item.id === "room-4"), true);
  assert.equal(selectable.some((item) => item.id === "room-old"), true);
  assert.equal(
    selectableRooms([room, archived]).some((item) => item.id === "room-old"),
    false,
  );

  const created = buildCreateWeeklySlotPayload({
    schoolCourseId: "course-1",
    academicYearId: "year-1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:00",
    roomId: "room-4",
  });
  assert.equal(created.schoolCourseId, "course-1");
  assert.equal(created.roomId, "room-4");
  assert.equal(created.schoolCode, undefined);
  assert.equal(created.teacherId, undefined);
  assert.equal(created.subject, undefined);
  assert.equal(created.room, undefined);
  assert.equal(created.className, undefined);
  assertNoLegacyPlanningIdentity(created);

  const stripped = stripPlanningClientScope({
    schoolCourseId: "course-1",
    schoolCode: "CD-2026",
    teacherId: "forged",
    subject: "Maths",
    room: "Salle 4",
  });
  assert.equal(stripped.schoolCode, undefined);
  assert.equal(stripped.teacherId, undefined);
  assert.equal(stripped.subject, undefined);
  assert.equal(stripped.room, undefined);

  const updated = buildUpdateWeeklySlotPayload({ roomId: "room-4", startTime: "10:00", endTime: "11:00" });
  assert.equal(updated.roomId, "room-4");
  assert.equal(updated.teacherId, undefined);

  assert.equal(
    mapPlanningConflictMessage(conflictError("Conflit d'emploi du temps : classe déjà occupée.")),
    PLANNING_V2_COPY.conflictClass,
  );
  assert.equal(
    mapPlanningConflictMessage(conflictError("Conflit d'emploi du temps : enseignant déjà occupé.")),
    PLANNING_V2_COPY.conflictTeacher,
  );
  assert.equal(
    mapPlanningConflictMessage(conflictError("Conflit d'emploi du temps : salle déjà occupée.")),
    PLANNING_V2_COPY.conflictRoom,
  );
  assert.notEqual(
    mapPlanningConflictMessage(conflictError("Conflit d'emploi du temps.")),
    "",
  );

  const replacement = normalizeReplacement({
    id: "rep-1",
    weeklySlotId: "slot-1",
    occurrenceDate: "2026-09-14",
    originalTeacherId: "teacher-a",
    originalTeacherName: "M. Okito",
    substituteTeacherId: "teacher-b",
    substituteTeacherName: "Mme Mbala",
    status: "planned",
  });
  assert.ok(replacement);
  const overlay = overlayReplacementForDate(weekly, [replacement], "2026-09-14");
  assert.equal(overlay.isReplacement, true);
  assert.equal(overlay.teacherId, "teacher-a");
  assert.equal(overlay.originalTeacherName, "M. Okito");
  assert.equal(overlay.substituteTeacherName, "Mme Mbala");
  const masterUnchanged = overlayReplacementForDate(weekly, [replacement], "2026-09-21");
  assert.equal(masterUnchanged.isReplacement, false);
  assert.equal(masterUnchanged.teacherId, weekly.teacherId);

  const displayed = displayedOccurrencesForDay({
    slots: [weekly],
    replacements: [replacement],
    dayOfWeek: 1,
    occurrenceDate: "2026-09-14",
  });
  assert.equal(displayed[0].isReplacement, true);
  assert.equal(displayed[0].replacementsUnverified, false);

  const replacementsFailed = resolveReplacementProjection(
    { status: "error", data: [] },
    true,
  );
  assert.equal(replacementsFailed.showUnavailableWarning, true);
  assert.equal(replacementsFailed.confirmedEmpty, false);
  assert.equal(replacementsFailed.overlay, false);
  assert.equal(replacementsFailed.unverified, true);
  const failedOccurrences = displayedOccurrencesForDay({
    slots: [weekly],
    replacements: replacementsFailed.replacements,
    dayOfWeek: 1,
    occurrenceDate: "2026-09-14",
    unverified: replacementsFailed.unverified,
  });
  assert.equal(failedOccurrences[0].isReplacement, false);
  assert.equal(failedOccurrences[0].replacementsUnverified, true);
  assert.equal(failedOccurrences[0].teacherName, "M. Okito");
  assert.notEqual(replacementsFailed.showUnavailableWarning, replacementsFailed.confirmedEmpty);

  const replacementsOffline = resolveReplacementProjection({ status: "offline", data: [] }, true);
  assert.equal(replacementsOffline.showUnavailableWarning, true);
  assert.equal(replacementsOffline.confirmedEmpty, false);

  const replacementsEmpty = resolveReplacementProjection({ status: "empty", data: [] }, true);
  assert.equal(replacementsEmpty.showUnavailableWarning, false);
  assert.equal(replacementsEmpty.confirmedEmpty, true);
  assert.equal(replacementsEmpty.overlay, true);
  const emptyOccurrences = displayedOccurrencesForDay({
    slots: [weekly],
    replacements: replacementsEmpty.replacements,
    dayOfWeek: 1,
    occurrenceDate: "2026-09-14",
    unverified: replacementsEmpty.unverified,
  });
  assert.equal(emptyOccurrences[0].isReplacement, false);
  assert.equal(emptyOccurrences[0].replacementsUnverified, false);
  assert.equal(emptyOccurrences[0].teacherName, "M. Okito");

  const replacementsOk = resolveReplacementProjection({ status: "success", data: [replacement] }, true);
  assert.equal(replacementsOk.showUnavailableWarning, false);
  assert.equal(replacementsOk.confirmedEmpty, false);
  assert.equal(replacementsOk.overlay, true);
  const okOccurrences = displayedOccurrencesForDay({
    slots: [weekly],
    replacements: replacementsOk.replacements,
    dayOfWeek: 1,
    occurrenceDate: "2026-09-14",
    unverified: replacementsOk.unverified,
  });
  assert.equal(okOccurrences[0].isReplacement, true);
  assert.equal(okOccurrences[0].replacementsUnverified, false);
  assert.equal(okOccurrences[0].substituteTeacherName, "Mme Mbala");

  assert.equal(PLANNING_V2_COPY.replacementsUnavailable, "Remplacements indisponibles");
  assert.equal(PLANNING_V2_COPY.usualTeacherUnverified, "Titulaire habituel (non vérifié)");

  const replacementWrite = buildCreateReplacementPayload({
    weeklySlotId: "slot-1",
    occurrenceDate: "2026-09-14",
    substituteTeacherId: "teacher-b",
    reason: "Absence",
  });
  assert.equal(replacementWrite.weeklySlotId, "slot-1");
  assert.equal(replacementWrite.substituteTeacherId, "teacher-b");
  assert.equal(replacementWrite.teacherId, undefined);

  assert.equal(PLANNING_V2_COPY.empty, "Aucun créneau planifié");
  assert.equal(PLANNING_V2_COPY.error, "Impossible de charger le planning");
}

run();
console.log("planningV2.test.ts OK");
