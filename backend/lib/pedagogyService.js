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
  requireTeacherWithActiveAssignment,
  assertAcademicYearForWeeklySlot,
  mapPedagogyPersistenceError,
} = require("./pedagogyReferences");
const {
  parseDayOfWeek,
  parseLocalTime,
  assertTimeOrder,
  isExclusionViolation,
  mapExclusionViolation,
} = require("./planningWeekly");
const {
  expandWeeklyOccurrences,
  resolveSchoolTimeZone,
} = require("./planningWeeklyOccurrences");
const { mergeAttendanceTeacherKey } = require("./presencesAttendanceAuthz");
const {
  resolveActiveRoomId,
  capacityWarningFor,
  assertNoLegacyRoomTextWrite,
} = require("./schoolRoomsService");
const { overlayOccurrenceReplacement } = require("./courseScheduleReplacementsService");
const {
  resolvePlanningSchoolScope,
  hasPlanningMembershipAttached,
  assertPlanningPatchAccess,
} = require("./planningSchoolScope");

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
  const auditSchoolId = asTrimmed(entry.schoolId);
  const auditSchoolCode = asTrimmed(entry.schoolCode);
  await tx.recordPedagogyAudit({
    schoolId: auditSchoolId || undefined,
    schoolCode: auditSchoolCode || (auditSchoolId ? "" : principal?.schoolCode),
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

async function resolvePlanningWriteSchool(tx, principal) {
  const scope = resolvePlanningSchoolScope(principal);
  if (scope.mode === "school" && scope.schoolId && typeof tx.getSchoolById === "function") {
    const school = await tx.getSchoolById(scope.schoolId);
    if (!school) {
      throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }
    return school;
  }
  if (hasPlanningMembershipAttached(principal) && scope.mode === "none") {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  if (scope.mode === "country" || scope.mode === "all") {
    throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  return resolveSchoolContext(tx, principal);
}

async function resolveSchoolForExistingSlot(tx, existing) {
  if (existing?.schoolId && typeof tx.getSchoolById === "function") {
    const school = await tx.getSchoolById(existing.schoolId);
    if (school) return school;
  }
  if (existing?.schoolCode) {
    const school = await tx.getSchoolByCode(existing.schoolCode);
    if (school) return school;
  }
  throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
}

function assertPlanningSlotAccess(principal, existing, school = null) {
  const scope = resolvePlanningSchoolScope(principal);
  if (scope.mode === "school" || scope.mode === "country" || scope.mode === "all") {
    assertPlanningPatchAccess(principal, existing);
    return;
  }
  if (hasPlanningMembershipAttached(principal) && scope.mode === "none") {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  // Leftover store path: compare JWT leftover to the school row loaded by UUID,
  // never to DTO schoolCode (login_code may be empty on seed schools).
  const leftoverTarget = asTrimmed(school?.code) || asTrimmed(existing?.schoolCode);
  assertTenant(principal, leftoverTarget);
}

async function createCourse(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const className = asTrimmed(payload.className);
  const subjectName = asTrimmed(payload.name ?? payload.subject);
  if (!className || !subjectName) {
    throw createPedagogyError(400, "Classe et cours obligatoires.");
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

async function loadCanonicalSchoolCourse(tx, school, schoolCourseId) {
  const key = asTrimmed(schoolCourseId);
  if (!key) {
    throw createPedagogyError(400, "schoolCourseId obligatoire.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  }
  const course = await tx.getSchoolCourseContext(key, school.id);
  if (!course) {
    throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  }
  if (String(course.school_id) !== String(school.id)) {
    throw createPedagogyError(404, "Cours introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
  }
  if (asTrimmed(course.status).toLowerCase() !== "active") {
    throw createPedagogyError(
      409,
      "Le cours n'est pas actif.",
      PEDAGOGY_ERROR.SCHOOL_COURSE_INACTIVE,
    );
  }
  if (!course.teacher_id) {
    throw createPedagogyError(
      400,
      "Le cours n'a pas d'enseignant : un créneau hebdomadaire ne peut pas être créé sans enseignant.",
      PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );
  }
  return course;
}

async function assertWeeklySlotReferences(tx, school, payload, { requireOpenYear }) {
  const schoolCourseId = payload.schoolCourseId ?? payload.school_course_id;
  const academicYearId = payload.academicYearId ?? payload.academic_year_id;
  if (!asTrimmed(academicYearId)) {
    throw createPedagogyError(400, "academicYearId obligatoire.", PEDAGOGY_ERROR.ACADEMIC_YEAR_MISMATCH);
  }
  const course = await loadCanonicalSchoolCourse(tx, school, schoolCourseId);
  const year = await assertAcademicYearForWeeklySlot(tx, {
    schoolId: school.id,
    academicYearId,
    classAcademicYearId: course.class_academic_year_id,
    requireOpen: requireOpenYear,
  });
  const teacherKey = course.teacher_code || course.teacher_id;
  await requireTeacherWithActiveAssignment(tx, {
    schoolId: school.id,
    teacherKey,
    classId: course.class_id,
    subjectId: course.subject_id,
    academicYearId: year.id,
  });
  return { course, year };
}

function parseWeeklyTimes(payload, fallback = {}) {
  const dayOfWeek = parseDayOfWeek(payload.dayOfWeek ?? payload.day_of_week ?? fallback.dayOfWeek);
  const startTime = parseLocalTime(payload.startTime ?? payload.start_time ?? fallback.startTime, "startTime");
  const endTime = parseLocalTime(payload.endTime ?? payload.end_time ?? fallback.endTime, "endTime");
  assertTimeOrder(startTime, endTime);
  return { dayOfWeek, startTime, endTime };
}

async function persistWeeklySlot(tx, fn) {
  try {
    return await fn();
  } catch (error) {
    if (isExclusionViolation(error)) {
      throw mapExclusionViolation(error);
    }
    throw mapPedagogyPersistenceError(error);
  }
}

async function createCourseSchedule(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  if (asTrimmed(payload.className) && !asTrimmed(payload.schoolCourseId ?? payload.school_course_id)) {
    throw createPedagogyError(
      400,
      "schoolCourseId obligatoire : className + subject ne sont plus une autorité Planning V2.",
      PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );
  }
  return store.withTransaction(async (tx) => {
    const school = await resolvePlanningWriteSchool(tx, principal);
    const { course, year } = await assertWeeklySlotReferences(tx, school, payload, { requireOpenYear: true });
    const times = parseWeeklyTimes(payload);
    assertNoLegacyRoomTextWrite(payload);
    const { roomId, room } = await resolveActiveRoomId(tx, school.id, payload.roomId ?? payload.room_id);
    let classSize = 0;
    if (roomId && typeof tx.classActiveEnrollmentCount === "function") {
      classSize = await tx.classActiveEnrollmentCount(course.class_id, school.id);
    }
    const saved = await persistWeeklySlot(tx, () =>
      tx.insertWeeklyScheduleSlot({
        schoolId: school.id,
        academicYearId: year.id,
        schoolCourseId: course.id,
        classId: course.class_id,
        teacherId: course.teacher_id,
        dayOfWeek: times.dayOfWeek,
        startTime: times.startTime,
        endTime: times.endTime,
        status: "active",
        room: room?.name || "",
        roomId,
      }),
    );
    if (!saved) {
      throw createPedagogyError(
        403,
        "Accès refusé : établissement hors périmètre.",
        PEDAGOGY_ERROR.TENANT_MISMATCH,
      );
    }
    const warning = capacityWarningFor(room, classSize);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "create_course_schedule",
      entityType: "course_schedule",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      newValue: { ...saved, capacityWarning: warning },
    });
    return warning ? { ...saved, capacityWarning: warning } : saved;
  });
}

async function updateCourseSchedule(store, scheduleId, patchRaw, principal, auditMeta) {
  const patch = ignoreClientScope(patchRaw);
  return store.withTransaction(async (tx) => {
    const existing = await tx.getWeeklyScheduleById(scheduleId, principal);
    if (!existing) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    const school = await resolveSchoolForExistingSlot(tx, existing);
    assertPlanningSlotAccess(principal, existing, school);
    const nextPayload = {
      schoolCourseId: patch.schoolCourseId ?? patch.school_course_id ?? existing.schoolCourseId,
      academicYearId: patch.academicYearId ?? patch.academic_year_id ?? existing.academicYearId,
    };
    const { course, year } = await assertWeeklySlotReferences(tx, school, nextPayload, { requireOpenYear: true });
    const times = parseWeeklyTimes(patch, existing);
    const hasRoomIdPatch =
      Object.prototype.hasOwnProperty.call(patch, "roomId") ||
      Object.prototype.hasOwnProperty.call(patch, "room_id");
    const hasRoomTextPatch = Object.prototype.hasOwnProperty.call(patch, "room");
    assertNoLegacyRoomTextWrite(patch);
    let nextRoomId = existing.roomId;
    if (hasRoomIdPatch) {
      nextRoomId = patch.roomId ?? patch.room_id;
    } else if (hasRoomTextPatch) {
      nextRoomId = null;
    }
    const { roomId, room } = await resolveActiveRoomId(tx, school.id, nextRoomId);
    let classSize = 0;
    if (roomId && typeof tx.classActiveEnrollmentCount === "function") {
      classSize = await tx.classActiveEnrollmentCount(course.class_id, school.id);
    }
    const saved = await persistWeeklySlot(tx, () =>
      tx.updateWeeklyScheduleSlot(existing.id, {
        schoolId: school.id,
        academicYearId: year.id,
        schoolCourseId: course.id,
        classId: course.class_id,
        teacherId: course.teacher_id,
        dayOfWeek: times.dayOfWeek,
        startTime: times.startTime,
        endTime: times.endTime,
        room: room?.name || (!hasRoomIdPatch && !hasRoomTextPatch ? existing.room : "") || "",
        roomId,
      }),
    );
    const warning = capacityWarningFor(room, classSize);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "update_course_schedule",
      entityType: "course_schedule",
      entityId: saved.id,
      schoolCode: saved.schoolCode,
      oldValue: existing,
      newValue: { ...saved, capacityWarning: warning },
    });
    return warning ? { ...saved, capacityWarning: warning } : saved;
  });
}

async function deleteCourseSchedule(store, scheduleId, principal, auditMeta) {
  return store.withTransaction(async (tx) => {
    const existing = await tx.getWeeklyScheduleById(scheduleId, principal);
    if (!existing) throw createPedagogyError(404, "Créneau introuvable.", PEDAGOGY_ERROR.COURSE_NOT_FOUND);
    const school = await resolveSchoolForExistingSlot(tx, existing);
    assertPlanningSlotAccess(principal, existing, school);
    const saved = await tx.cancelWeeklyScheduleSlot(existing.id);
    await writePedagogyAudit(tx, principal, auditMeta, {
      action: "cancel_course_schedule",
      entityType: "course_schedule",
      entityId: existing.id,
      schoolCode: existing.schoolCode,
      oldValue: existing,
      newValue: saved,
    });
    return {
      id: existing.id,
      status: saved.status,
      deleted: false,
      cancelled: true,
    };
  });
}

function isTeacherRole(principal) {
  const role = String(principal?.role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return role === "enseignant" || role === "teacher" || role.includes("prof");
}

function isPlanningCourseOptionsProjection(query = {}) {
  const projection = asTrimmed(query.projection).toLowerCase();
  return projection === "course-options" || projection === "planning-course-options";
}

async function listPlanningCourseOptions(store, principal, query = {}, school = null) {
  if (!school?.id) {
    return { projection: "planning-course-options", items: [] };
  }
  const filters = {
    schoolId: school.id,
    classId: asTrimmed(query.classId || query.class_id) || null,
    className: asTrimmed(query.className || query.class_name) || null,
    academicYearId: asTrimmed(query.academicYearId || query.academic_year_id) || null,
    teacherId: null,
  };
  if (isTeacherRole(principal)) {
    const teacherId = await store.resolveTeacherIdForPrincipal(principal, school.id);
    if (!teacherId) return { projection: "planning-course-options", items: [] };
    filters.teacherId = teacherId;
  }
  if (typeof store.listPlanningCourseOptions !== "function") {
    return { projection: "planning-course-options", items: [] };
  }
  const items = await store.listPlanningCourseOptions(filters);
  return { projection: "planning-course-options", items };
}

function isPlanningDiagnosticsProjection(query = {}) {
  const projection = asTrimmed(query.projection).toLowerCase();
  return projection === "diagnostics" || projection === "conflicts";
}

async function listPlanningDiagnostics(store, principal, query = {}, school = null) {
  if (!school?.id || typeof store.listPlanningDiagnostics !== "function") {
    return { projection: "diagnostics", items: [] };
  }
  const items = await store.listPlanningDiagnostics({ schoolId: school.id });
  return { projection: "diagnostics", items };
}

function hasPublicPlanningLoginCode(row) {
  return Boolean(String(row?.schoolCode ?? "").trim());
}

function publicWeeklyScheduleRows(rows, scope) {
  if (!scope) return rows;
  if (Array.isArray(rows)) return rows.filter(hasPublicPlanningLoginCode);
  return rows;
}

async function resolvePlanningListSchool(store, principal) {
  const scope = resolvePlanningSchoolScope(principal);
  if (scope.mode === "school") {
    if (scope.schoolId && typeof store.getSchoolById === "function") {
      const school = await store.getSchoolById(scope.schoolId);
      if (!school) {
        throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
      }
      return { school, scope };
    }
    if (hasPlanningMembershipAttached(principal)) {
      throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }
  }
  if (scope.mode === "country" || scope.mode === "all") {
    return { school: null, scope };
  }
  if (hasPlanningMembershipAttached(principal) && scope.mode === "none") {
    throw createPedagogyError(403, "Accès refusé : établissement hors périmètre.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  const schoolCode = asTrimmed(principal?.schoolCode);
  let school = null;
  if (schoolCode && schoolCode !== "*") {
    school = await store.getSchoolByCode(schoolCode);
    if (!school) {
      throw createPedagogyError(404, "Établissement introuvable.", PEDAGOGY_ERROR.TENANT_MISMATCH);
    }
  }
  return { school, scope: null };
}

async function listCourseSchedules(store, principal, query = {}) {
  const { school, scope } = await resolvePlanningListSchool(store, principal);
  if (isPlanningCourseOptionsProjection(query)) {
    return listPlanningCourseOptions(store, principal, query, school);
  }
  if (isPlanningDiagnosticsProjection(query)) {
    return listPlanningDiagnostics(store, principal, query, school);
  }
  const from = asTrimmed(query.from);
  const to = asTrimmed(query.to);
  const leftoverSchoolCode = asTrimmed(principal?.schoolCode);
  const filters = {
    schoolId: school?.id ?? null,
    schoolCode: scope ? null : school?.code ?? leftoverSchoolCode,
    countryCode: scope?.mode === "country" ? scope.countryCode : null,
    academicYearId: asTrimmed(query.academicYearId || query.academic_year_id) || null,
    classId: asTrimmed(query.classId || query.class_id) || null,
    teacherId: asTrimmed(query.teacherId || query.teacher_id) || null,
    schoolCourseId: asTrimmed(query.schoolCourseId || query.school_course_id) || null,
    dayOfWeek: query.dayOfWeek != null && query.dayOfWeek !== "" ? parseDayOfWeek(query.dayOfWeek) : null,
    status: asTrimmed(query.status) || "active",
  };

  if (isTeacherRole(principal)) {
    if (!school?.id) return [];
    const teacherId = await store.resolveTeacherIdForPrincipal(principal, school.id);
    if (!teacherId) return [];
    if (filters.teacherId && String(filters.teacherId) !== String(teacherId)) {
      return [];
    }
    if (from && to) {
      filters.teacherOrSubstituteId = teacherId;
      delete filters.teacherId;
      filters.from = from;
      filters.to = to;
    } else {
      filters.teacherId = teacherId;
    }
  }

  const rows = await store.listWeeklyScheduleSlots(filters);
  if (!from || !to) {
    return publicWeeklyScheduleRows(rows, scope);
  }

  const timeZone = resolveSchoolTimeZone(school?.timezone || school?.profile_payload?.timezone);
  let replacements = [];
  if (school?.id && typeof store.listActiveReplacementsForSlots === "function") {
    replacements = await store.listActiveReplacementsForSlots({
      schoolId: school.id,
      slotIds: rows.map((row) => row.id),
      from,
      to,
    });
  }
  const replacementByKey = new Map(
    replacements.map((row) => [`${row.weeklySlotId}|${row.occurrenceDate}`, row]),
  );
  const items = rows.flatMap((slot) =>
    expandWeeklyOccurrences(slot, { from, to, timeZone }).map((occurrence) => {
      const replacement = replacementByKey.get(`${slot.id}|${occurrence.occurrenceDate}`);
      return overlayOccurrenceReplacement(slot, { ...occurrence, projection: "occurrence" }, replacement);
    }),
  );
  return {
    projection: "occurrences",
    from,
    to,
    timeZone,
    items: publicWeeklyScheduleRows(items, scope),
  };
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
  const { presenceAuditSchoolCode } = require("./presenceSchoolScope");
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
            ...mergeAttendanceTeacherKey(item, payload),
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
        schoolId: asTrimmed(principal?.presenceSchoolId) || undefined,
        schoolCode: presenceAuditSchoolCode(principal) || undefined,
        newValue: { count: saved.length },
      });
      return saved;
    });
  } catch (error) {
    throw mapPedagogyPersistenceError(error);
  }
}

module.exports = {
  generateCourseCode,
  createCourse,
  updateCourse,
  deleteCourse,
  createCourseSchedule,
  updateCourseSchedule,
  deleteCourseSchedule,
  listCourseSchedules,
  listPlanningCourseOptions,
  createEvaluation,
  updateEvaluation,
  upsertGrade,
  upsertAttendanceBatch,
};
