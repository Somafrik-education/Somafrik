"use strict";

const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
  ignoreClientScope,
} = require("./pedagogyManagement");
const { isoWeekdayFromUtcDate, isExclusionViolation, mapExclusionViolation, formatTimeHm } = require("./planningWeekly");
const { parseCivilDate, formatCivilDate } = require("./planningWeeklyOccurrences");
const { mapPedagogyPersistenceError } = require("./pedagogyReferences");

const REPLACEMENT_STATUSES = new Set(["planned", "completed", "cancelled"]);

function isTeacherRole(principal) {
  const role = String(principal?.role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return role === "enseignant" || role === "teacher" || role.includes("prof");
}

function assertTenant(principal, schoolCode) {
  const scope = asTrimmed(principal?.schoolCode);
  if (!scope || scope === "*") return;
  if (asTrimmed(schoolCode).toUpperCase() !== scope.toUpperCase()) {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
}

async function resolveSchoolContext(tx, principal) {
  const schoolCode = asTrimmed(principal?.schoolCode);
  if (!schoolCode || schoolCode === "*") {
    throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  const school = await tx.getSchoolByCode(schoolCode);
  if (!school) throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  assertTenant(principal, school.code);
  return school;
}

async function writeAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordPedagogyAudit !== "function") {
    throw createPedagogyError(500, "Audit pédagogie indisponible dans la transaction.");
  }
  await tx.recordPedagogyAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: principal?.sub || principal?.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

function parseOccurrenceDate(value) {
  const date = parseCivilDate(value);
  if (!date) {
    throw createPedagogyError(400, "occurrenceDate obligatoire (YYYY-MM-DD).", PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH);
  }
  return formatCivilDate(date);
}

function parseReplacementStatus(value, fallback = "planned") {
  const raw = asTrimmed(value).toLowerCase() || fallback;
  if (!REPLACEMENT_STATUSES.has(raw)) {
    throw createPedagogyError(400, "status remplacement invalide (planned|completed|cancelled).", "INVALID_REPLACEMENT_STATUS");
  }
  return raw;
}

function mapReplacementPersistenceError(error) {
  if (error?.code && Object.values(PEDAGOGY_ERROR).includes(error.code)) {
    return error;
  }
  const message = String(error?.message ?? "");
  if (/REPLACEMENT_WEEKDAY_MISMATCH/i.test(message)) {
    return createPedagogyError(
      400,
      "La date d'occurrence ne correspond pas au jour du créneau hebdomadaire.",
      PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH,
    );
  }
  if (/REPLACEMENT_DATE_OUT_OF_YEAR/i.test(message)) {
    return createPedagogyError(
      400,
      "La date d'occurrence n'appartient pas à l'année académique du créneau.",
      PEDAGOGY_ERROR.REPLACEMENT_DATE_OUT_OF_YEAR,
    );
  }
  if (/SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT/i.test(message) || (isExclusionViolation(error) && /substitute/i.test(message))) {
    return createPedagogyError(
      409,
      "Le remplaçant est déjà occupé sur ce créneau.",
      PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT,
    );
  }
  if (error?.code === "23505" || /uq_course_schedule_replacements_active_occurrence/i.test(message)) {
    return createPedagogyError(
      409,
      "Un remplacement actif existe déjà pour cette occurrence.",
      PEDAGOGY_ERROR.REPLACEMENT_OCCURRENCE_CONFLICT,
    );
  }
  if (isExclusionViolation(error)) return mapExclusionViolation(error);
  return mapPedagogyPersistenceError(error);
}

function timesOverlap(startA, endA, startB, endB) {
  return asTrimmed(startA) < asTrimmed(endB) && asTrimmed(startB) < asTrimmed(endA);
}

async function assertSubstituteAvailable(tx, { schoolId, academicYearId, weeklySlotId, occurrenceDate, startTime, endTime, substituteTeacherId, excludeReplacementId }) {
  const weekday = isoWeekdayFromUtcDate(parseCivilDate(occurrenceDate));
  const weeklyConflict = await tx.findSubstituteWeeklyOverlap({
    schoolId,
    academicYearId,
    teacherId: substituteTeacherId,
    dayOfWeek: weekday,
    startTime,
    endTime,
  });
  if (weeklyConflict) {
    throw createPedagogyError(
      409,
      "Le remplaçant est déjà en cours à cet horaire.",
      PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT,
    );
  }
  const replacementConflict = await tx.findSubstituteReplacementOverlap({
    schoolId,
    substituteTeacherId,
    occurrenceDate,
    startTime,
    endTime,
    excludeReplacementId: excludeReplacementId ?? null,
    excludeWeeklySlotId: weeklySlotId,
  });
  if (replacementConflict) {
    throw createPedagogyError(
      409,
      "Le remplaçant est déjà affecté comme remplaçant ailleurs sur ce créneau.",
      PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT,
    );
  }
}

async function listCourseScheduleReplacements(store, principal, query = {}) {
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const filters = {
      schoolId: school.id,
      from: asTrimmed(query.from) || null,
      to: asTrimmed(query.to) || null,
      teacherId: asTrimmed(query.teacherId || query.originalTeacherId) || null,
      substituteTeacherId: asTrimmed(query.substituteTeacherId) || null,
      classId: asTrimmed(query.classId) || null,
      weeklySlotId: asTrimmed(query.weeklySlotId || query.scheduleId) || null,
      status: asTrimmed(query.status) || null,
    };
    if (filters.status === "all") filters.status = null;
    if (isTeacherRole(principal)) {
      const teacherId = await tx.resolveTeacherIdForPrincipal(principal, school.id);
      if (!teacherId) return { items: [] };
      filters.concernedTeacherId = teacherId;
    }
    const items = await tx.listCourseScheduleReplacements(filters);
    return { items };
  });
}

async function listReplacementTeacherOptions(store, principal, query = {}) {
  if (isTeacherRole(principal)) {
    throw createPedagogyError(
      403,
      "Seul un Admin School ou un Préfet des Études peut consulter les options de remplaçant.",
      "PERMISSION_DENIED",
    );
  }
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const weeklySlotId = asTrimmed(query.weeklySlotId || query.scheduleId);
    const occurrenceDate = parseOccurrenceDate(query.occurrenceDate);
    if (!weeklySlotId) {
      throw createPedagogyError(400, "weeklySlotId obligatoire.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    }
    const slot = await tx.getWeeklyScheduleById(weeklySlotId, principal);
    if (!slot) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    if (Number(slot.dayOfWeek) !== isoWeekdayFromUtcDate(parseCivilDate(occurrenceDate))) {
      throw createPedagogyError(
        400,
        "La date d'occurrence ne correspond pas au jour du créneau hebdomadaire.",
        PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH,
      );
    }
    const teachers = await tx.listEligibleSubstituteTeachers({
      schoolId: school.id,
      academicYearId: slot.academicYearId,
      weeklySlotId: slot.id,
      occurrenceDate,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      originalTeacherId: slot.teacherId,
      subjectName: slot.subject || slot.courseName,
    });
    return {
      weeklySlotId: slot.id,
      occurrenceDate,
      originalTeacherId: slot.teacherId,
      originalTeacherName: slot.teacherName,
      items: teachers,
    };
  });
}

async function createCourseScheduleReplacement(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const weeklySlotId = asTrimmed(payload.weeklySlotId || payload.scheduleId);
  const occurrenceDate = parseOccurrenceDate(payload.occurrenceDate);
  const substituteTeacherId = asTrimmed(payload.substituteTeacherId);
  if (!weeklySlotId) throw createPedagogyError(400, "weeklySlotId obligatoire.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  if (!substituteTeacherId) {
    throw createPedagogyError(400, "substituteTeacherId obligatoire.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
  }
  return store.withTransaction(async (tx) => {
    try {
      const school = await resolveSchoolContext(tx, principal);
      const actorId = await tx.resolveActorUserId(principal);
      const slot = await tx.lockWeeklyScheduleForReplacement(weeklySlotId, school.id);
      if (!slot) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
      if (String(slot.teacher_id) === substituteTeacherId) {
        throw createPedagogyError(
          400,
          "Le remplaçant doit être distinct du titulaire.",
          PEDAGOGY_ERROR.SUBSTITUTE_SAME_AS_ORIGINAL,
        );
      }
      await tx.lockTeacherForReplacement(substituteTeacherId, school.id);
      await assertSubstituteAvailable(tx, {
        schoolId: school.id,
        academicYearId: slot.academic_year_id,
        weeklySlotId: slot.id,
        occurrenceDate,
        startTime: formatTimeHm(slot.start_time),
        endTime: formatTimeHm(slot.end_time),
        substituteTeacherId,
      });
      const saved = await tx.insertCourseScheduleReplacement({
        schoolId: school.id,
        weeklySlotId: slot.id,
        occurrenceDate,
        originalTeacherId: slot.teacher_id,
        substituteTeacherId,
        reason: asTrimmed(payload.reason) || null,
        note: asTrimmed(payload.note) || null,
        status: parseReplacementStatus(payload.status, "planned"),
        createdBy: actorId,
        academicYearId: slot.academic_year_id,
        startTime: slot.start_time,
        endTime: slot.end_time,
      });
      const snapshot = await tx.getCourseScheduleReplacementById(saved.id, school.id);
      await writeAudit(tx, principal, auditMeta, {
        action: "REPLACEMENT_CREATE",
        entityType: "course_schedule_replacement",
        entityId: snapshot.id,
        schoolCode: school.code,
        newValue: {
          ...snapshot,
          weeklySlotId: slot.id,
          occurrenceDate,
          originalTeacherId: slot.teacher_id,
          substituteTeacherId,
        },
      });
      return snapshot;
    } catch (error) {
      throw mapReplacementPersistenceError(error);
    }
  });
}

async function updateCourseScheduleReplacement(store, replacementId, rawPatch, principal, auditMeta) {
  const patch = ignoreClientScope(rawPatch);
  return store.withTransaction(async (tx) => {
    try {
      const school = await resolveSchoolContext(tx, principal);
      const existing = await tx.getCourseScheduleReplacementById(replacementId, school.id);
      if (!existing) throw createPedagogyError(404, "Remplacement introuvable.", PEDAGOGY_ERROR.REPLACEMENT_NOT_FOUND);
      if (existing.status === "cancelled") {
        throw createPedagogyError(409, "Remplacement déjà annulé.", PEDAGOGY_ERROR.REPLACEMENT_NOT_FOUND);
      }
      const slot = await tx.lockWeeklyScheduleForReplacement(existing.weeklySlotId, school.id);
      const nextSubstitute = asTrimmed(patch.substituteTeacherId) || existing.substituteTeacherId;
      if (String(slot.teacher_id) === String(nextSubstitute)) {
        throw createPedagogyError(
          400,
          "Le remplaçant doit être distinct du titulaire.",
          PEDAGOGY_ERROR.SUBSTITUTE_SAME_AS_ORIGINAL,
        );
      }
      await tx.lockTeacherForReplacement(nextSubstitute, school.id);
      await assertSubstituteAvailable(tx, {
        schoolId: school.id,
        academicYearId: slot.academic_year_id,
        weeklySlotId: slot.id,
        occurrenceDate: existing.occurrenceDate,
        startTime: formatTimeHm(slot.start_time),
        endTime: formatTimeHm(slot.end_time),
        substituteTeacherId: nextSubstitute,
        excludeReplacementId: existing.id,
      });
      const saved = await tx.updateCourseScheduleReplacement(existing.id, school.id, {
        substituteTeacherId: patch.substituteTeacherId !== undefined ? nextSubstitute : undefined,
        reason: patch.reason !== undefined ? asTrimmed(patch.reason) || null : undefined,
        note: patch.note !== undefined ? asTrimmed(patch.note) || null : undefined,
        status: patch.status !== undefined ? parseReplacementStatus(patch.status, existing.status) : undefined,
      });
      await writeAudit(tx, principal, auditMeta, {
        action: "REPLACEMENT_UPDATE",
        entityType: "course_schedule_replacement",
        entityId: saved.id,
        schoolCode: school.code,
        oldValue: existing,
        newValue: saved,
      });
      return saved;
    } catch (error) {
      throw mapReplacementPersistenceError(error);
    }
  });
}

async function cancelCourseScheduleReplacement(store, replacementId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const existing = await tx.getCourseScheduleReplacementById(replacementId, school.id);
    if (!existing) throw createPedagogyError(404, "Remplacement introuvable.", PEDAGOGY_ERROR.REPLACEMENT_NOT_FOUND);
    const actorId = await tx.resolveActorUserId(principal);
    const saved = await tx.cancelCourseScheduleReplacement(existing.id, school.id, actorId);
    await writeAudit(tx, principal, auditMeta, {
      action: "REPLACEMENT_CANCEL",
      entityType: "course_schedule_replacement",
      entityId: saved.id,
      schoolCode: school.code,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

function overlayOccurrenceReplacement(slot, occurrence, replacement) {
  if (!replacement || replacement.status === "cancelled") {
    return {
      ...slot,
      ...occurrence,
      teacher: slot.teacherName || "",
      teacherName: slot.teacherName || "",
      replacement: false,
    };
  }
  return {
    ...slot,
    ...occurrence,
    teacher: replacement.substituteTeacherName || replacement.substituteTeacherId,
    teacherName: replacement.substituteTeacherName || "",
    teacherId: replacement.substituteTeacherId,
    originalTeacher: replacement.originalTeacherName || slot.teacherName || "",
    originalTeacherId: replacement.originalTeacherId || slot.teacherId,
    replacement: true,
    replacementId: replacement.id,
  };
}

module.exports = {
  isTeacherRole,
  timesOverlap,
  parseOccurrenceDate,
  listCourseScheduleReplacements,
  listReplacementTeacherOptions,
  createCourseScheduleReplacement,
  updateCourseScheduleReplacement,
  cancelCourseScheduleReplacement,
  overlayOccurrenceReplacement,
  mapReplacementPersistenceError,
};
