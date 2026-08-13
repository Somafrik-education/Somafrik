import type { CourseScheduleSlot } from "./coursePlanning";
import { pedagogyApi } from "./pedagogyApi";

function toApiPayload(slot: CourseScheduleSlot): Record<string, unknown> {
  return {
    id: slot.id,
    className: slot.className,
    subject: slot.subject,
    teacherId: slot.teacherId,
    teacherName: slot.teacherName,
    start: slot.start,
    end: slot.end,
    room: slot.room,
    kind: slot.kind,
    examName: slot.examName,
    examType: slot.examType,
    examId: slot.examId,
    periodName: slot.periodName,
    periodStart: slot.periodStart,
    periodEnd: slot.periodEnd,
  };
}

function scheduleSignature(slot: CourseScheduleSlot): string {
  return JSON.stringify(toApiPayload(slot));
}

/** Synchronise les créneaux d'un établissement via les APIs PostgreSQL dédiées. */
export async function syncSchoolCourseSchedules(
  previousSchoolSlots: CourseScheduleSlot[],
  nextSchoolSlots: CourseScheduleSlot[],
): Promise<void> {
  const prevById = new Map(previousSchoolSlots.map((slot) => [String(slot.id), slot]));
  const nextById = new Map(nextSchoolSlots.map((slot) => [String(slot.id), slot]));

  for (const [id] of prevById) {
    if (!nextById.has(id)) {
      await pedagogyApi.deleteCourseSchedule(id);
    }
  }

  for (const [id, slot] of nextById) {
    const payload = toApiPayload(slot);
    if (!prevById.has(id)) {
      await pedagogyApi.createCourseSchedule(payload);
      continue;
    }
    const previous = prevById.get(id);
    if (previous && scheduleSignature(previous) !== scheduleSignature(slot)) {
      await pedagogyApi.updateCourseSchedule(id, payload);
    }
  }
}
