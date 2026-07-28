/**
 * Suppression des doublons dans l'état BackOffice (JSON + entités métier).
 */
const { PedagogyGovernanceService } = require("../services/pedagogyGovernanceService");

const pedagogyGovernanceService = new PedagogyGovernanceService();

const SCHOOL_SCOPED_ENTITIES = new Set([
  "contacts",
  "relations",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "presences",
  "notes",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
]);

const DEDUPE_ENTITIES = [
  "schools",
  "users",
  "countries",
  "contacts",
  "relations",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "presences",
  "notes",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
];

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function rowKey(row = {}) {
  return String(row.id ?? row.publicId ?? row.code ?? "");
}

function rowScore(row = {}) {
  return Object.values(row).filter((value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }).length;
}

function isEphemeralId(id) {
  return /^(COURSE-|ASSIGN-|CLASS-|CS-\d)/i.test(String(id ?? ""));
}

function pickPreferredRow(existing = {}, candidate = {}) {
  const existingEphemeral = isEphemeralId(existing.id);
  const candidateEphemeral = isEphemeralId(candidate.id);
  let preferred = existing;
  let other = candidate;

  if (existingEphemeral && !candidateEphemeral) {
    preferred = candidate;
    other = existing;
  } else if (!existingEphemeral && candidateEphemeral) {
    preferred = existing;
    other = candidate;
  } else if (rowScore(candidate) > rowScore(existing)) {
    preferred = candidate;
    other = existing;
  }

  return {
    ...other,
    ...preferred,
    id: preferred.id ?? other.id,
  };
}

function dedupeRows(rows = [], keyFn, label) {
  const byKey = new Map();
  const unkeyed = [];

  for (const row of rows) {
    const key = keyFn(row);
    if (!key) {
      unkeyed.push(row);
      continue;
    }
    const existing = byKey.get(key);
    byKey.set(key, existing ? pickPreferredRow(existing, row) : row);
  }

  const deduped = [...unkeyed, ...byKey.values()];
  return { rows: deduped, removed: rows.length - deduped.length, label };
}

function dedupeById(rows = []) {
  const byId = new Map();
  const withoutId = [];

  for (const row of rows) {
    const id = rowKey(row);
    if (!id) {
      withoutId.push(row);
      continue;
    }
    const existing = byId.get(id);
    byId.set(id, existing ? pickPreferredRow(existing, row) : row);
  }

  return {
    rows: [...withoutId, ...byId.values()],
    removed: rows.length - withoutId.length - byId.size,
  };
}

function isBlankValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function mergeMissingTeacherFields(preferred = {}, rows = []) {
  const merged = { ...preferred };
  for (const row of rows) {
    for (const [key, value] of Object.entries(row ?? {})) {
      if (isBlankValue(merged[key]) && !isBlankValue(value)) {
        merged[key] = value;
      }
    }
  }
  merged.id = preferred.id;
  return merged;
}

function teacherCivilIdentity(row = {}) {
  const schoolCode = normalize(row.schoolCode);
  const name = normalize(row.name ?? row.lastName).replace(/\s+/g, " ");
  const firstName = normalize(row.firstName).replace(/\s+/g, " ");
  if (!schoolCode || !name || !firstName) return null;
  return {
    baseKey: `${schoolCode}|${name}|${firstName}`,
    birthDate: String(row.birthDate ?? "").trim(),
  };
}

function teacherReferenceCount(state = {}, teacher = {}) {
  const aliases = new Set(
    [teacher.id, teacher.publicId, teacher.identifier]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  if (!aliases.size) return 0;

  let count = 0;
  for (const rows of Object.values(state)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (
        aliases.has(String(row?.teacherId ?? "").trim()) ||
        aliases.has(String(row?.authorId ?? "").trim())
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function teacherPreferenceScore(state, teacher) {
  return (
    teacherReferenceCount(state, teacher) * 1000 +
    (String(teacher.userId ?? "").trim() ? 100 : 0) +
    (String(teacher.contactId ?? "").trim() ? 50 : 0) +
    rowScore(teacher)
  );
}

function remapTeacherReferences(state = {}, aliases = new Map()) {
  if (!aliases.size) return state;
  const next = { ...state };

  for (const [entity, rows] of Object.entries(state)) {
    if (!Array.isArray(rows) || entity === "teachers") continue;
    next[entity] = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const teacherId = String(row.teacherId ?? "").trim();
      const authorId = String(row.authorId ?? "").trim();
      const mappedTeacherId = aliases.get(teacherId);
      const mappedAuthorId = aliases.get(authorId);
      if (!mappedTeacherId && !mappedAuthorId) return row;
      return {
        ...row,
        ...(mappedTeacherId ? { teacherId: mappedTeacherId } : {}),
        ...(mappedAuthorId ? { authorId: mappedAuthorId } : {}),
      };
    });
  }

  return next;
}

function dedupeTeacherCivilIdentities(state = {}) {
  const teachers = Array.isArray(state.teachers) ? state.teachers : [];
  const groups = [];
  const passthrough = [];

  for (const teacher of teachers) {
    const identity = teacherCivilIdentity(teacher);
    if (!identity) {
      passthrough.push(teacher);
      continue;
    }

    let group = groups.find(
      (candidate) =>
        candidate.baseKey === identity.baseKey &&
        (!candidate.birthDate ||
          !identity.birthDate ||
          candidate.birthDate === identity.birthDate),
    );
    if (!group) {
      group = { ...identity, rows: [] };
      groups.push(group);
    } else if (!group.birthDate && identity.birthDate) {
      group.birthDate = identity.birthDate;
    }
    group.rows.push(teacher);
  }

  const aliases = new Map();
  const deduped = [...passthrough];
  let removed = 0;

  for (const group of groups) {
    const preferred = [...group.rows].sort(
      (left, right) =>
        teacherPreferenceScore(state, right) - teacherPreferenceScore(state, left),
    )[0];
    const preferredId = String(preferred.id ?? "").trim();
    deduped.push(mergeMissingTeacherFields(preferred, group.rows));

    for (const duplicate of group.rows) {
      if (duplicate === preferred) continue;
      removed += 1;
      if (!preferredId) continue;
      for (const alias of [duplicate.id, duplicate.publicId, duplicate.identifier]) {
        const key = String(alias ?? "").trim();
        if (key) aliases.set(key, preferredId);
      }
    }
  }

  const remapped = remapTeacherReferences({ ...state, teachers: deduped }, aliases);
  return { state: remapped, removed };
}

function weekdayFromIso(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 0 : date.getDay();
}

function extractTimeFromIso(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "00:00";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function courseSlotDedupeKey(slot = {}) {
  return [
    normalize(slot.schoolCode),
    normalize(slot.className),
    normalize(slot.subject),
    String(weekdayFromIso(slot.start)),
    extractTimeFromIso(slot.start),
    extractTimeFromIso(slot.end),
    normalize(slot.periodName ?? ""),
    slot.periodStart ?? "",
    slot.periodEnd ?? "",
  ].join("|");
}

function subjectPeriodDedupeKey(slot = {}) {
  return [
    normalize(slot.schoolCode),
    normalize(slot.className),
    normalize(slot.subject),
    normalize(slot.periodName ?? ""),
    slot.periodStart ?? "",
    slot.periodEnd ?? "",
  ].join("|");
}

function dedupeCourseSchedules(rows = []) {
  const byTimeKey = dedupeRows(rows, courseSlotDedupeKey, "courseSchedules-time");
  const bySubjectPeriod = dedupeRows(byTimeKey.rows, subjectPeriodDedupeKey, "courseSchedules-period");
  return {
    rows: bySubjectPeriod.rows,
    removed: byTimeKey.removed + bySubjectPeriod.removed,
  };
}

function repairMassDeletedRows(state = {}) {
  let next = { ...state, deletedRows: { ...(state.deletedRows ?? {}) } };
  for (const entity of SCHOOL_SCOPED_ENTITIES) {
    const rows = Array.isArray(next[entity]) ? next[entity] : [];
    const deleted = next.deletedRows?.[entity];
    if (!Array.isArray(deleted) || deleted.length <= rows.length || deleted.length < 20) {
      continue;
    }
    delete next.deletedRows[entity];
  }
  return next;
}

function pruneStaleDeletedRows(state = {}) {
  const deletedRows = { ...(state.deletedRows ?? {}) };
  let changed = false;

  for (const entity of Object.keys(deletedRows)) {
    const keys = deletedRows[entity];
    if (!Array.isArray(keys) || !keys.length) continue;
    const live = new Set((state[entity] ?? []).map((row) => rowKey(row)).filter(Boolean));
    const kept = keys.filter((key) => !live.has(String(key)));
    if (kept.length !== keys.length) changed = true;
    if (kept.length) deletedRows[entity] = kept;
    else delete deletedRows[entity];
  }

  return changed ? { ...state, deletedRows } : state;
}

function dedupeBackOfficeState(state = {}) {
  const report = { byEntity: {}, totalRemoved: 0, deletedRowsCleared: [] };
  let next = { ...state };

  const idPass = {};
  for (const entity of DEDUPE_ENTITIES) {
    if (!Array.isArray(next[entity])) continue;
    const result = dedupeById(next[entity]);
    if (result.removed > 0) {
      idPass[entity] = result.removed;
      next[entity] = result.rows;
    }
  }

  const teacherIdentityPass = dedupeTeacherCivilIdentities(next);
  next = teacherIdentityPass.state;
  if (teacherIdentityPass.removed > 0) {
    report.byEntity["teachers:civil-identity"] = teacherIdentityPass.removed;
    report.totalRemoved += teacherIdentityPass.removed;
  }

  const semantic = [
    dedupeRows(next.schools ?? [], (row) => normalize(row.code ?? row.publicId), "schools"),
    dedupeRows(
      next.users ?? [],
      (row) => `${normalize(row.schoolCode)}|${normalize(row.publicId ?? row.identifier ?? row.id)}`,
      "users",
    ),
    dedupeRows(next.countries ?? [], (row) => normalize(row.code), "countries"),
    dedupeRows(
      next.contacts ?? [],
      (row) => {
        const school = normalize(row.schoolCode);
        const contactType = normalize(row.contactType);
        const phone = normalize(row.phone);
        const email = normalize(row.email);
        if (phone) return `${school}|${contactType}|phone:${phone}`;
        if (email) return `${school}|${contactType}|email:${email}`;
        return `${school}|${normalize(row.lastName)}|${normalize(row.firstName)}|${contactType}`;
      },
      "contacts",
    ),
    dedupeRows(
      next.relations ?? [],
      (row) =>
        [
          normalize(row.schoolCode),
          normalize(row.relationType),
          normalize(row.fromContactId),
          normalize(row.toStudentId),
          normalize(row.accountCode),
        ].join("|"),
      "relations",
    ),
    dedupeRows(
      next.students ?? [],
      (row) => {
        const school = normalize(row.schoolCode);
        const matricule = normalize(row.matricule ?? row.publicId);
        if (matricule) return `${school}|${matricule}`;
        return `${school}|${normalize(row.name)}|${normalize(row.className)}`;
      },
      "students",
    ),
    dedupeRows(
      next.teachers ?? [],
      (row) => {
        const school = normalize(row.schoolCode);
        const id = String(row.id ?? "").trim();
        // HOTFIX-PRE-E1-02B : ne pas fusionner TEACHERS-* avec jumeau ENS/TEACHER-*
        // via l'identifier de login (ENS-0001) — chaque id pédagogique reste distinct.
        if (/^TEACHERS-/i.test(id) || /^TEACHER-/i.test(id)) {
          return `${school}|id:${normalize(id)}`;
        }
        return `${school}|${normalize(row.identifier ?? row.publicId ?? row.id)}`;
      },
      "teachers",
    ),
    dedupeRows(
      next.classes ?? [],
      (row) => `${normalize(row.schoolCode)}|${normalize(row.name)}`,
      "classes",
    ),
    dedupeRows(
      next.notes ?? [],
      (row) =>
        [
          normalize(row.schoolCode),
          normalize(row.studentId),
          normalize(row.subject),
          normalize(row.evaluationId),
          normalize(row.date),
          normalize(row.period),
        ].join("|"),
      "notes",
    ),
    dedupeRows(
      next.bulletins ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.studentId)}|${normalize(row.period)}`,
      "bulletins",
    ),
    dedupeRows(
      next.payments ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.studentId)}|${normalize(row.reference ?? row.date)}|${normalize(row.amount)}`,
      "payments",
    ),
    dedupeRows(
      next.presences ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.studentId)}|${normalize(row.date)}|${normalize(row.status)}`,
      "presences",
    ),
    dedupeRows(
      next.exams ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.className)}|${normalize(row.subject)}|${normalize(row.date ?? row.period)}`,
      "exams",
    ),
    dedupeRows(
      next.documents ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.studentId)}|${normalize(row.title)}|${normalize(row.documentType)}`,
      "documents",
    ),
    dedupeRows(
      next.messages ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.from)}|${normalize(row.to)}|${normalize(row.subject)}|${normalize(row.date)}`,
      "messages",
    ),
    dedupeRows(
      next.announcements ?? [],
      (row) =>
        `${normalize(row.schoolCode)}|${normalize(row.title)}|${normalize(row.date)}`,
      "announcements",
    ),
  ];

  for (const pass of semantic) {
    if (pass.removed > 0) {
      report.byEntity[pass.label] = (report.byEntity[pass.label] ?? 0) + pass.removed;
      report.totalRemoved += pass.removed;
      next[pass.label] = pass.rows;
    }
  }

  for (const [entity, removed] of Object.entries(idPass)) {
    if (!removed) continue;
    report.byEntity[`${entity}:id`] = (report.byEntity[`${entity}:id`] ?? 0) + removed;
    report.totalRemoved += removed;
  }

  const coursesBefore = (next.courses ?? []).length;
  const assignmentsBefore = (next.assignments ?? []).length;
  next.courses = pedagogyGovernanceService.dedupeCoursesBySchoolClassSubject(next.courses ?? []);
  next.assignments = pedagogyGovernanceService.dedupeAssignmentsBySchoolClassSubject(next.assignments ?? []);
  const coursesRemoved = coursesBefore - next.courses.length;
  const assignmentsRemoved = assignmentsBefore - next.assignments.length;
  if (coursesRemoved > 0) {
    report.byEntity.courses = (report.byEntity.courses ?? 0) + coursesRemoved;
    report.totalRemoved += coursesRemoved;
  }
  if (assignmentsRemoved > 0) {
    report.byEntity.assignments = (report.byEntity.assignments ?? 0) + assignmentsRemoved;
    report.totalRemoved += assignmentsRemoved;
  }

  const schedulesBefore = (next.courseSchedules ?? []).length;
  const scheduleDedupe = dedupeCourseSchedules(next.courseSchedules ?? []);
  next.courseSchedules = scheduleDedupe.rows;
  if (scheduleDedupe.removed > 0) {
    report.byEntity.courseSchedules = (report.byEntity.courseSchedules ?? 0) + scheduleDedupe.removed;
    report.totalRemoved += scheduleDedupe.removed;
  }

  const beforeDeleted = JSON.stringify(next.deletedRows ?? {});
  next = repairMassDeletedRows(next);
  next = pruneStaleDeletedRows(next);
  if (JSON.stringify(next.deletedRows ?? {}) !== beforeDeleted) {
    report.deletedRowsCleared.push("corrupted-or-stale");
  }

  next.updatedAt = new Date().toISOString();
  return { state: next, report };
}

module.exports = {
  dedupeBackOfficeState,
  dedupeTeacherCivilIdentities,
  dedupeCourseSchedules,
  repairMassDeletedRows,
  pruneStaleDeletedRows,
};
