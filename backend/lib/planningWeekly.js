"use strict";

/**
 * Contrat Planning V2 hebdomadaire : jour 1–7, heures locales TIME, DTO canonique.
 * La récurrence métier n'est pas calculée ici — voir planningWeeklyOccurrences.
 */

const { PEDAGOGY_ERROR, asTrimmed, createPedagogyError } = require("./pedagogyManagement");

/** 1 = lundi … 7 = dimanche. Jamais Date.getDay() (0 = dimanche). */
const DAY_OF_WEEK_MIN = 1;
const DAY_OF_WEEK_MAX = 7;

function parseDayOfWeek(value) {
  if (value === undefined || value === null || value === "") {
    throw createPedagogyError(
      400,
      "dayOfWeek obligatoire (1 = lundi … 7 = dimanche).",
      PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK,
    );
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < DAY_OF_WEEK_MIN || n > DAY_OF_WEEK_MAX) {
    throw createPedagogyError(
      400,
      "dayOfWeek invalide : attendu 1 (lundi) à 7 (dimanche).",
      PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK,
    );
  }
  return n;
}

function parseLocalTime(value, label) {
  const raw = asTrimmed(value);
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) {
    throw createPedagogyError(
      400,
      `${label} invalide (HH:MM).`,
      PEDAGOGY_ERROR.INVALID_TIME_RANGE,
    );
  }
  return `${match[1]}:${match[2]}:00`;
}

function assertTimeOrder(startTime, endTime) {
  if (asTrimmed(endTime) <= asTrimmed(startTime)) {
    throw createPedagogyError(
      400,
      "endTime doit être strictement postérieur à startTime (pas de cours à cheval sur minuit).",
      PEDAGOGY_ERROR.INVALID_TIME_RANGE,
    );
  }
}

function formatTimeHm(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  }
  const raw = asTrimmed(value);
  if (!raw) return "";
  return raw.slice(0, 5);
}

function isoWeekdayFromUtcDate(date) {
  const js = date.getUTCDay();
  return js === 0 ? 7 : js;
}

function mapExclusionViolation(error) {
  const constraint = String(error?.constraint ?? "");
  const message = String(error?.message ?? "");
  if (constraint.includes("room") || /no_room_overlap/i.test(message)) {
    return createPedagogyError(
      409,
      "Conflit d'emploi du temps : salle déjà occupée.",
      PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
      { constraint: constraint || undefined, pgCode: error?.code },
    );
  }
  if (constraint.includes("class") || /no_class_overlap/i.test(message)) {
    return createPedagogyError(
      409,
      "Conflit d'emploi du temps : classe déjà occupée.",
      PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
      { constraint: constraint || undefined, pgCode: error?.code },
    );
  }
  const teacher = constraint.includes("teacher") || /no_teacher_overlap/i.test(message);
  return createPedagogyError(
    409,
    teacher ? "Conflit d'emploi du temps : enseignant déjà occupé." : "Conflit d'emploi du temps.",
    PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    { constraint: constraint || undefined, pgCode: error?.code },
  );
}

function isExclusionViolation(error) {
  return (
    error?.code === "23P01" ||
    /exclusion|overlap|no_class_overlap|no_teacher_overlap|no_room_overlap/i.test(String(error?.message ?? ""))
  );
}

function mapWeeklyScheduleDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolCourseId: row.school_course_id,
    academicYearId: row.academic_year_id,
    classId: row.class_id,
    teacherId: row.teacher_id,
    subjectId: row.subject_id,
    dayOfWeek: Number(row.day_of_week),
    startTime: formatTimeHm(row.start_time),
    endTime: formatTimeHm(row.end_time),
    status: row.status,
    schoolCode: row.school_code,
    roomId: row.room_id || null,
    room: row.room_name || row.room || "",
    roomCode: row.room_code || "",
    roomCapacity: row.room_capacity == null || row.room_capacity === "" ? null : Number(row.room_capacity),
    classCode: row.class_code || "",
    className: row.class_name || "",
    courseName: row.subject_name || "",
    subject: row.subject_name || "",
    teacherName: row.teacher_name || "",
    teacherCode: row.teacher_code || "",
    academicYearName: row.academic_year_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  DAY_OF_WEEK_MIN,
  DAY_OF_WEEK_MAX,
  parseDayOfWeek,
  parseLocalTime,
  assertTimeOrder,
  formatTimeHm,
  isoWeekdayFromUtcDate,
  mapExclusionViolation,
  isExclusionViolation,
  mapWeeklyScheduleDto,
};
