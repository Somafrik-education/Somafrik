"use strict";

/**
 * Preflight historique course_schedule_slots → weekly.
 * Aucun INSERT. Classement explicite : MIGRATABLE | AMBIGUOUS | ORPHAN | EXAM.
 */

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return asTrimmed(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isoWeekdayFromInstant(startsAt, timeZone) {
  if (!startsAt) return null;
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      weekday: "short",
    }).format(date);
    const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return map[weekday] ?? null;
  } catch {
    return null;
  }
}

function localTimeFromInstant(startsAt, timeZone) {
  if (!startsAt) return null;
  const date = startsAt instanceof Date ? startsAt : new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (hour == null || minute == null) return null;
    return `${hour}:${minute}`;
  } catch {
    return null;
  }
}

/**
 * @param {object} row ligne course_schedule_slots
 * @param {object} catalogs
 * @param {object[]} catalogs.subjects
 * @param {object[]} catalogs.schoolCourses active rows
 * @param {object[]} catalogs.teachers
 * @param {object} catalogs.classById
 * @param {object} catalogs.yearById
 * @param {string} [catalogs.timeZone]
 */
function classifyLegacyScheduleRow(row, catalogs = {}) {
  const id = row.id ?? row.legacy_json_id;
  if (asTrimmed(row.slot_kind).toLowerCase() === "exam") {
    return { id, classification: "EXAM", reasons: ["slot_kind=exam — hors planning cours hebdomadaire"] };
  }

  const reasons = [];
  const classId = row.class_id;
  if (!classId) {
    return { id, classification: "ORPHAN", reasons: ["class_id absent"] };
  }

  const klass = catalogs.classById?.[classId] ?? catalogs.classById?.[String(classId)];
  if (!klass) {
    return { id, classification: "ORPHAN", reasons: ["classe introuvable pour class_id"] };
  }

  const yearId = klass.academic_year_id;
  const year = catalogs.yearById?.[yearId] ?? catalogs.yearById?.[String(yearId)];
  if (!yearId || !year) {
    return { id, classification: "ORPHAN", reasons: ["année académique indéterminable"] };
  }

  const subjectName = asTrimmed(row.subject_name);
  if (!subjectName) {
    return { id, classification: "ORPHAN", reasons: ["subject_name vide"] };
  }

  const schoolSubjects = (catalogs.subjects ?? []).filter(
    (subject) => String(subject.school_id) === String(row.school_id),
  );
  const matchingSubjects = schoolSubjects.filter(
    (subject) => normalizeKey(subject.name) === normalizeKey(subjectName),
  );
  if (matchingSubjects.length === 0) {
    return { id, classification: "ORPHAN", reasons: [`matière non résolue: ${subjectName}`] };
  }
  if (matchingSubjects.length > 1) {
    return { id, classification: "AMBIGUOUS", reasons: [`plusieurs matières pour « ${subjectName} »`] };
  }
  const subject = matchingSubjects[0];

  const matchingCourses = (catalogs.schoolCourses ?? []).filter((course) => {
    if (String(course.school_id) !== String(row.school_id)) return false;
    if (String(course.class_id) !== String(classId)) return false;
    if (String(course.subject_id) !== String(subject.id)) return false;
    return asTrimmed(course.status).toLowerCase() === "active";
  });
  if (matchingCourses.length === 0) {
    return { id, classification: "ORPHAN", reasons: ["aucun school_course actif unique"] };
  }
  if (matchingCourses.length > 1) {
    return { id, classification: "AMBIGUOUS", reasons: ["plusieurs school_course actifs"] };
  }
  const course = matchingCourses[0];
  if (!course.teacher_id) {
    return { id, classification: "AMBIGUOUS", reasons: ["school_course sans enseignant"] };
  }

  const slotTeacherId = row.teacher_id ?? null;
  if (!slotTeacherId) {
    return {
      id,
      classification: "AMBIGUOUS",
      reasons: ["teacher_id historique null — enseignant non prouvé"],
    };
  }
  if (String(slotTeacherId) !== String(course.teacher_id)) {
    return {
      id,
      classification: "AMBIGUOUS",
      reasons: ["teacher_id historique ≠ teacher du school_course"],
    };
  }

  const timeZone = catalogs.timeZone || "Africa/Kinshasa";
  const dayOfWeek = isoWeekdayFromInstant(row.starts_at, timeZone);
  const startTime = localTimeFromInstant(row.starts_at, timeZone);
  const endTime = localTimeFromInstant(row.ends_at, timeZone);
  if (!dayOfWeek || !startTime || !endTime) {
    return { id, classification: "AMBIGUOUS", reasons: ["jour/heure indéterminables depuis starts_at/ends_at"] };
  }
  if (endTime <= startTime) {
    return { id, classification: "AMBIGUOUS", reasons: ["horaire historique invalide ou traversant minuit"] };
  }

  reasons.push("class_id, matière, school_course, enseignant et horaire déterminés de façon unique");
  return {
    id,
    classification: "MIGRATABLE",
    reasons,
    target: {
      schoolId: row.school_id,
      academicYearId: yearId,
      schoolCourseId: course.id,
      classId,
      teacherId: course.teacher_id,
      dayOfWeek,
      startTime,
      endTime,
    },
  };
}

function classifyLegacyScheduleRows(rows, catalogs) {
  const summary = { MIGRATABLE: 0, AMBIGUOUS: 0, ORPHAN: 0, EXAM: 0 };
  const items = (rows ?? []).map((row) => {
    const classified = classifyLegacyScheduleRow(row, catalogs);
    summary[classified.classification] += 1;
    return classified;
  });
  return { summary, items };
}

module.exports = {
  classifyLegacyScheduleRow,
  classifyLegacyScheduleRows,
};
