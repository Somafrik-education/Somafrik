import type { CourseScheduleSlot } from "./coursePlanning";
import { examRecordId, isExamSchedule, isoToPeriodDate, slotToExamRecord } from "./coursePlanning";
import { examsApi } from "./examsApi";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCanonicalExamId(value: string): boolean {
  return UUID_RE.test(String(value ?? "").trim());
}

function payloadFromSlot(slot: CourseScheduleSlot): Record<string, unknown> {
  const record = slotToExamRecord(slot);
  return {
    name: record.name,
    className: slot.className,
    subject: slot.subject,
    examType: slot.examType || record.examType,
    date: isoToPeriodDate(slot.start) || record.date,
    period: slot.periodName?.trim() || record.period,
    startsAt: slot.start,
    endsAt: slot.end,
    status: record.status,
  };
}

export async function syncPlanningLinkedExamsCanonical(
  previousSchoolSlots: CourseScheduleSlot[],
  nextSchoolSlots: CourseScheduleSlot[],
): Promise<void> {
  const previousExamIds = new Set(
    previousSchoolSlots.filter(isExamSchedule).map((slot) => examRecordId(slot)),
  );
  const nextExamSlots = nextSchoolSlots.filter(isExamSchedule);
  const nextExamIds = new Set(nextExamSlots.map((slot) => examRecordId(slot)));

  for (const id of previousExamIds) {
    if (nextExamIds.has(id) || !isCanonicalExamId(id)) continue;
    await examsApi.archive(id);
  }

  for (const slot of nextExamSlots) {
    const payload = payloadFromSlot(slot);
    const id = examRecordId(slot);
    if (isCanonicalExamId(id)) {
      await examsApi.patch(id, payload);
    } else {
      await examsApi.create(payload);
    }
  }
}

export async function archiveSchoolPlanningExams(): Promise<void> {
  const payload = await examsApi.list();
  for (const exam of payload.exams ?? []) {
    if (!exam?.id || exam.statusCode === "archived") continue;
    await examsApi.archive(exam.id);
  }
}
