import type { CourseScheduleSlot } from "./coursePlanning";
import { pedagogyApi } from "./pedagogyApi";
import { toWeeklyScheduleWritePayload } from "./planningWeeklyWrite";

function scheduleSignature(slot: CourseScheduleSlot): string {
  return JSON.stringify(toWeeklyScheduleWritePayload(slot));
}

export function planningSyncMutations(
  previousSchoolSlots: CourseScheduleSlot[],
  nextSchoolSlots: CourseScheduleSlot[],
): { deletes: string[]; creates: string[]; updates: string[] } {
  const prevById = new Map(previousSchoolSlots.map((slot) => [String(slot.id), slot]));
  const nextById = new Map(nextSchoolSlots.map((slot) => [String(slot.id), slot]));
  const deletes: string[] = [];
  const creates: string[] = [];
  const updates: string[] = [];

  for (const [id] of prevById) {
    if (!nextById.has(id)) deletes.push(id);
  }
  for (const [id, slot] of nextById) {
    if (!prevById.has(id)) {
      creates.push(id);
      continue;
    }
    const previous = prevById.get(id);
    if (previous && scheduleSignature(previous) !== scheduleSignature(slot)) {
      updates.push(id);
    }
  }
  return { deletes, creates, updates };
}

/** Synchronise les créneaux hebdomadaires via POST/PATCH/DELETE canoniques. Aucun className+subject. */
export async function syncSchoolCourseSchedules(
  previousSchoolSlots: CourseScheduleSlot[],
  nextSchoolSlots: CourseScheduleSlot[],
): Promise<void> {
  const { deletes, creates, updates } = planningSyncMutations(previousSchoolSlots, nextSchoolSlots);
  for (const id of deletes) {
    await pedagogyApi.deleteCourseSchedule(id);
  }
  const nextById = new Map(nextSchoolSlots.map((slot) => [String(slot.id), slot]));
  for (const id of creates) {
    const slot = nextById.get(id);
    if (slot) await pedagogyApi.createCourseSchedule(toWeeklyScheduleWritePayload(slot));
  }
  for (const id of updates) {
    const slot = nextById.get(id);
    if (slot) await pedagogyApi.updateCourseSchedule(id, toWeeklyScheduleWritePayload(slot));
  }
}
