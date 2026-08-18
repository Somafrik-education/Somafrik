import type { CourseScheduleSlot } from "./coursePlanning";
import { pedagogyApi } from "./pedagogyApi";
import { toWeeklyScheduleWritePayload } from "./planningWeeklyWrite";

function scheduleSignature(slot: CourseScheduleSlot): string {
  return JSON.stringify(toWeeklyScheduleWritePayload(slot));
}

/** Synchronise les créneaux hebdomadaires via POST/PATCH/DELETE canoniques. Aucun className+subject. */
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
    const payload = toWeeklyScheduleWritePayload(slot);
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
