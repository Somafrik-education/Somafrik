"use strict";

const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
  ignoreClientScope,
} = require("./pedagogyManagement");

function assertTenant(principal, schoolCode) {
  const scope = asTrimmed(principal?.schoolCode);
  if (!scope || scope === "*") return;
  if (asTrimmed(schoolCode).toUpperCase() !== scope.toUpperCase()) {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
}

async function writePedagogyAudit(tx, principal, auditMeta, entry) {
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

function generateCourseCode(schoolCode, existing = []) {
  const prefix = `${asTrimmed(schoolCode).toUpperCase()}-CRS-`;
  let max = 0;
  for (const row of existing) {
    const raw = String(row.course_code ?? row.id ?? "");
    if (!raw.startsWith(prefix)) continue;
    const seq = Number(raw.slice(prefix.length));
    if (Number.isFinite(seq)) max = Math.max(max, seq);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

async function createCourse(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const className = asTrimmed(payload.className);
  const subjectName = asTrimmed(payload.name ?? payload.subject);
  if (!className || !subjectName) {
    throw createPedagogyError(400, "Classe et matière obligatoires.");
  }
  return store.withTransaction(async (tx) => {
    const schoolCode = asTrimmed(principal?.schoolCode);
    if (!schoolCode || schoolCode === "*") {
      throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    assertTenant(principal, school.code);
    const klass = await tx.findClass(school.id, className);
    if (!klass) throw createPedagogyError(404, "Classe introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    const subject = await tx.ensureSubject(school.id, subjectName, Number(payload.coefficient ?? 1));
    let teacherId = null;
    if (payload.teacherId) {
      const teacher = await tx.findTeacher(school.id, payload.teacherId);
      if (!teacher) throw createPedagogyError(404, "Enseignant introuvable.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
      teacherId = teacher.id;
    }
    const courseCode = asTrimmed(payload.id ?? payload.publicId) || generateCourseCode(school.code);
    const saved = await tx.insertCourse({
      schoolId: school.id,
      classId: klass.id,
      subjectId: subject.id,
      teacherId,
      courseCode,
      coefficient: Number(payload.coefficient ?? subject.coefficient ?? 1),
      legacyJsonId: asTrimmed(payload.id) || courseCode,
      profile: { teacherId: payload.teacherId },
    });
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "create_course",
      entityType: "course",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: saved,
    });
    return saved;
  });
}

async function updateCourse(store, courseId, patch, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const existing = await tx.getCourseByCode(courseId, principal);
    if (!existing) throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    assertTenant(principal, existing.schoolCode);
    let teacherId;
    if (patch.teacherId !== undefined) {
      if (!patch.teacherId) {
        teacherId = null;
      } else {
        const school = await tx.getSchoolByCode(existing.schoolCode);
        const teacher = await tx.findTeacher(school.id, patch.teacherId);
        if (!teacher) throw createPedagogyError(404, "Enseignant introuvable.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
        teacherId = teacher.id;
      }
    }
    const saved = await tx.updateCourse(existing.dbId, {
      teacherId,
      coefficient: patch.coefficient != null ? Number(patch.coefficient) : null,
      profile: patch.teacherId != null ? { teacherId: patch.teacherId } : null,
    });
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "update_course",
      entityType: "course",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function deleteCourse(store, courseId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const existing = await tx.getCourseByCode(courseId, principal);
    if (!existing) throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    assertTenant(principal, existing.schoolCode);
    const saved = await tx.archiveCourse(existing.dbId);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "delete_course",
      entityType: "course",
      entityId: existing.id,
      schoolCode: existing.schoolCode,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

function parseScheduleTimes(payload) {
  const startsAt = payload.start ?? payload.startsAt;
  const endsAt = payload.end ?? payload.endsAt;
  if (!startsAt || !endsAt) {
    throw createPedagogyError(400, "Horaires de début et fin obligatoires.");
  }
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw createPedagogyError(400, "Créneau horaire invalide.");
  }
  return { startsAt: startDate.toISOString(), endsAt: endDate.toISOString() };
}

async function createCourseSchedule(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const className = asTrimmed(payload.className);
  const subjectName = asTrimmed(payload.subject);
  if (!className || !subjectName) {
    throw createPedagogyError(400, "Classe et matière obligatoires.");
  }
  const times = parseScheduleTimes(payload);
  return store.withTransaction(async (tx) => {
    const schoolCode = asTrimmed(principal?.schoolCode);
    if (!schoolCode || schoolCode === "*") {
      throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    assertTenant(principal, school.code);
    const klass = await tx.findClass(school.id, className);
    let teacherId = null;
    if (payload.teacherId) {
      const teacher = await tx.findTeacher(school.id, payload.teacherId);
      if (!teacher) throw createPedagogyError(404, "Enseignant introuvable.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
      teacherId = teacher.id;
    }
    const conflicts = await tx.listScheduleConflicts(school.id, {
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      className,
      teacherId,
    });
    if (conflicts.length) {
      throw createPedagogyError(409, "Conflit d'emploi du temps.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT, {
        conflicts: conflicts.map((row) => row.id),
      });
    }
    const saved = await tx.insertScheduleSlot({
      schoolId: school.id,
      classId: klass?.id ?? null,
      className,
      subjectName,
      teacherId,
      kind: payload.kind ?? "course",
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      room: payload.room,
      examName: payload.examName,
      examType: payload.examType,
      examId: payload.examId,
      periodName: payload.periodName,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      legacyJsonId: asTrimmed(payload.id) || undefined,
      profile: {
        teacherId: payload.teacherId,
        teacherName: payload.teacherName,
        room: payload.room,
      },
    });
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "create_course_schedule",
      entityType: "course_schedule",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: saved,
    });
    return saved;
  });
}

async function updateCourseSchedule(store, scheduleId, patch, principal, auditMeta) {
  const times = patch.start || patch.end ? parseScheduleTimes(patch) : null;
  return store.withTransaction(async (tx) => {
    const existing = await tx.getScheduleById(scheduleId, principal);
    if (!existing) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
    assertTenant(principal, existing.schoolCode);
    const school = await tx.getSchoolByCode(existing.schoolCode);
    let teacherId;
    if (patch.teacherId !== undefined) {
      if (!patch.teacherId) teacherId = null;
      else {
        const teacher = await tx.findTeacher(school.id, patch.teacherId);
        if (!teacher) throw createPedagogyError(404, "Enseignant introuvable.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
        teacherId = teacher.id;
      }
    }
    const nextStart = times?.startsAt ?? existing.start;
    const nextEnd = times?.endsAt ?? existing.end;
    const conflicts = await tx.listScheduleConflicts(
      school.id,
      {
        startsAt: nextStart,
        endsAt: nextEnd,
        className: patch.className ?? existing.className,
        teacherId: teacherId ?? null,
      },
      existing.dbId ?? existing.id,
    );
    if (conflicts.length) {
      throw createPedagogyError(409, "Conflit d'emploi du temps.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
    }
    const saved = await tx.updateScheduleSlot(existing.dbId ?? existing.id, {
      className: patch.className,
      subjectName: patch.subject,
      teacherId,
      startsAt: times?.startsAt,
      endsAt: times?.endsAt,
      room: patch.room,
    });
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "update_course_schedule",
      entityType: "course_schedule",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      oldValue: existing,
      newValue: saved,
    });
    return saved;
  });
}

async function deleteCourseSchedule(store, scheduleId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const existing = await tx.getScheduleById(scheduleId, principal);
    if (!existing) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
    assertTenant(principal, existing.schoolCode);
    await tx.deleteScheduleSlot(existing.dbId ?? existing.id);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "delete_course_schedule",
      entityType: "course_schedule",
      entityId: existing.id,
      schoolCode: existing.schoolCode,
      oldValue: existing,
    });
    return { id: existing.id, deleted: true };
  });
}

async function createEvaluation(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  return store.withTransaction(async (tx) => {
    const saved = await tx.upsertEvaluation(payload, principal);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "create_evaluation",
      entityType: "evaluation",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: saved,
    });
    return saved;
  });
}

async function updateEvaluation(store, evaluationId, patch, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const payload = { ...ignoreClientScope(patch), id: evaluationId };
    const saved = await tx.upsertEvaluation(payload, principal);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "update_evaluation",
      entityType: "evaluation",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: saved,
    });
    return saved;
  });
}

async function upsertGrade(store, payload, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const saved = await tx.upsertGrade(payload, principal);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "upsert_grade",
      entityType: "grade",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: saved,
    });
    return saved;
  });
}

async function upsertAttendanceBatch(store, payload, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const saved = await tx.upsertAttendanceBatch(payload, principal);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "upsert_attendance_batch",
      entityType: "attendance",
      entityId: String(saved.length),
      schoolCode: principal?.schoolCode,
      newValue: { count: saved.length },
    });
    return saved;
  });
}

module.exports = {
  createCourse,
  updateCourse,
  deleteCourse,
  createCourseSchedule,
  updateCourseSchedule,
  deleteCourseSchedule,
  createEvaluation,
  updateEvaluation,
  upsertGrade,
  upsertAttendanceBatch,
};
