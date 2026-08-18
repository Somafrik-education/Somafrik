"use strict";

const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
  ignoreClientScope,
  tenantSchoolCodeFromPrincipal,
} = require("./pedagogyManagement");
const {
  resolveCanonicalClass,
  resolveCanonicalSubject,
  assertOpenAcademicYearForClass,
  resolveCanonicalPeriod,
  resolveTeacherWithActiveAssignment,
  mapPedagogyPersistenceError,
} = require("./pedagogyReferences");

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

async function createCourse(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const className = asTrimmed(payload.className);
  const subjectName = asTrimmed(payload.name ?? payload.subject);
  if (!className || !subjectName) {
    throw createPedagogyError(400, "Classe et matière obligatoires.");
  }
  return store.withTransaction(async (tx) => {
    const school = await resolveSchoolContext(tx, principal);
    const klass = await resolveCanonicalClass(tx, school.id, className);
    const academicYear = await assertOpenAcademicYearForClass(tx, klass);
    const subject = await resolveCanonicalSubject(tx, school.id, subjectName);
    const { teacherId } = await resolveTeacherWithActiveAssignment(tx, {
      schoolId: school.id,
      teacherKey: payload.teacherId,
      classId: klass.id,
      subjectId: subject.id,
      academicYearId: academicYear.id,
    });
    const existingCourses = await tx.all(
      `SELECT course_code FROM school_courses WHERE school_id = $1`,
      [school.id],
    );
    const courseCode =
      asTrimmed(payload.id ?? payload.publicId) || generateCourseCode(school.code, existingCourses);
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
    const school = await tx.getSchoolByCode(existing.schoolCode);
    const courseRow = await tx.getCourseContextByCode(courseId, principal);
    if (!courseRow) throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    await assertOpenAcademicYearForClass(tx, { academic_year_id: courseRow.academic_year_id });

    let teacherId;
    if (patch.teacherId !== undefined) {
      if (!patch.teacherId) {
        teacherId = null;
      } else {
        const resolved = await resolveTeacherWithActiveAssignment(tx, {
          schoolId: school.id,
          teacherKey: patch.teacherId,
          classId: courseRow.class_id,
          subjectId: courseRow.subject_id,
          academicYearId: courseRow.academic_year_id,
        });
        teacherId = resolved.teacherId;
      }
    }
    const saved = await tx.updateCourse(courseRow.course_db_id, {
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
    const courseRow = await tx.getCourseContextByCode(courseId, principal);
    if (courseRow) {
      await assertOpenAcademicYearForClass(tx, { academic_year_id: courseRow.academic_year_id });
    }
    const saved = await tx.archiveCourse(courseRow?.course_db_id ?? existing.dbId);
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
    const school = await resolveSchoolContext(tx, principal);
    const klass = await resolveCanonicalClass(tx, school.id, className);
    const academicYear = await assertOpenAcademicYearForClass(tx, klass);
    const subject = await resolveCanonicalSubject(tx, school.id, subjectName);
    if (payload.periodName) {
      await resolveCanonicalPeriod(tx, academicYear.id, payload.periodName);
    }
    const { teacherId } = await resolveTeacherWithActiveAssignment(tx, {
      schoolId: school.id,
      teacherKey: payload.teacherId,
      classId: klass.id,
      subjectId: subject.id,
      academicYearId: academicYear.id,
    });
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
      classId: klass.id,
      className,
      subjectName: subject.name,
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
    const nextClassName = asTrimmed(patch.className ?? existing.className);
    const nextSubjectName = asTrimmed(patch.subject ?? existing.subject);
    const klass = await resolveCanonicalClass(tx, school.id, nextClassName);
    const academicYear = await assertOpenAcademicYearForClass(tx, klass);
    const subject = await resolveCanonicalSubject(tx, school.id, nextSubjectName);
    if (patch.periodName ?? existing.periodName) {
      await resolveCanonicalPeriod(tx, academicYear.id, patch.periodName ?? existing.periodName);
    }

    const classOrSubjectChanged =
      nextClassName !== asTrimmed(existing.className) ||
      nextSubjectName !== asTrimmed(existing.subject);

    let finalTeacherId = null;
    let profilePatch = null;
    if (patch.teacherId !== undefined) {
      if (!patch.teacherId) {
        finalTeacherId = null;
        profilePatch = { teacherId: "", teacherName: "" };
      } else {
        const resolved = await resolveTeacherWithActiveAssignment(tx, {
          schoolId: school.id,
          teacherKey: patch.teacherId,
          classId: klass.id,
          subjectId: subject.id,
          academicYearId: academicYear.id,
        });
        finalTeacherId = resolved.teacherId;
        profilePatch = { teacherId: patch.teacherId };
      }
    } else if (existing.teacherDbId) {
      finalTeacherId = existing.teacherDbId;
      if (classOrSubjectChanged) {
        const teacher =
          (await tx.findTeacher(school.id, existing.teacherId)) ??
          (await tx.findTeacher(school.id, existing.teacherDbId));
        const teacherKey = asTrimmed(teacher?.teacher_code ?? existing.teacherId);
        if (teacherKey) {
          const resolved = await resolveTeacherWithActiveAssignment(tx, {
            schoolId: school.id,
            teacherKey,
            classId: klass.id,
            subjectId: subject.id,
            academicYearId: academicYear.id,
          });
          finalTeacherId = resolved.teacherId;
        }
      }
    }

    const nextStart = times?.startsAt ?? existing.start;
    const nextEnd = times?.endsAt ?? existing.end;
    const conflicts = await tx.listScheduleConflicts(
      school.id,
      {
        startsAt: nextStart,
        endsAt: nextEnd,
        className: nextClassName,
        teacherId: finalTeacherId,
      },
      existing.dbId ?? existing.id,
    );
    if (conflicts.length) {
      throw createPedagogyError(409, "Conflit d'emploi du temps.", PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
    }
    const saved = await tx.updateScheduleSlot(existing.dbId ?? existing.id, {
      classId: klass.id,
      className: nextClassName,
      subjectName: subject.name,
      teacherId: finalTeacherId,
      startsAt: nextStart,
      endsAt: nextEnd,
      room: patch.room !== undefined ? patch.room : existing.room,
      profile: profilePatch,
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
  const payload = {
    ...ignoreClientScope(rawPayload),
    schoolCode: tenantSchoolCodeFromPrincipal(principal),
  };
  try {
    return await store.withTransaction(async (tx) => {
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
  } catch (error) {
    throw mapPedagogyPersistenceError(error);
  }
}

async function updateEvaluation(store, evaluationId, patch, principal, auditMeta) {
  try {
    return await store.withTransaction(async (tx) => {
      const payload = {
        ...ignoreClientScope(patch),
        id: evaluationId,
        schoolCode: tenantSchoolCodeFromPrincipal(principal),
      };
      const saved = await tx.upsertEvaluation(payload, principal, { requireExisting: true });
      await writePedagogyAudit(tx, principal, auditMeta, {
        action: "update_evaluation",
        entityType: "evaluation",
        entityId: saved.id,
        schoolCode: saved.schoolCode,
        newValue: saved,
      });
      return saved;
    });
  } catch (error) {
    throw mapPedagogyPersistenceError(error);
  }
}

async function upsertGrade(store, payload, principal, auditMeta) {
  const scopedPayload = {
    ...ignoreClientScope(payload),
    schoolCode: tenantSchoolCodeFromPrincipal(principal),
  };
  try {
    return await store.withTransaction(async (tx) => {
      const saved = await tx.upsertGrade(scopedPayload, principal);
      await writePedagogyAudit(tx, principal, auditMeta, {
        action: "upsert_grade",
        entityType: "grade",
        entityId: saved.id,
        schoolCode: saved.schoolCode,
        newValue: saved,
      });
      return saved;
    });
  } catch (error) {
    throw mapPedagogyPersistenceError(error);
  }
}

async function upsertAttendanceBatch(store, payload, principal, auditMeta) {
  const tenantCode = tenantSchoolCodeFromPrincipal(principal);
  try {
    return await store.withTransaction(async (tx) => {
      const batchClassCode = asTrimmed(payload.classCode ?? payload.class_code);
      const batchClassId = asTrimmed(payload.classId ?? payload.class_id);
      const items = Array.isArray(payload.items)
        ? payload.items.map((item) => ({
            ...ignoreClientScope(item),
            schoolCode: tenantCode,
            classCode: asTrimmed(item.classCode ?? item.class_code) || batchClassCode,
            classId: asTrimmed(item.classId ?? item.class_id) || batchClassId,
          }))
        : [];
      const saved = [];
      for (const item of items) {
        saved.push(await tx.upsertAttendance(item, principal));
      }
      await writePedagogyAudit(tx, principal, auditMeta, {
        action: "upsert_attendance_batch",
        entityType: "attendance",
        entityId: String(saved.length),
        schoolCode: principal?.schoolCode,
        newValue: { count: saved.length },
      });
      return saved;
    });
  } catch (error) {
    throw mapPedagogyPersistenceError(error);
  }
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
