/**
 * HOTFIX-PRE-E1-02 / 02B — Sync BO → PG enseignants + affectations.
 *
 * Contrat : docs/ux/design-system/CONTRAT-HOTFIX-PRE-E1-02.md
 * Rectificatif 02B : docs/ux/design-system/CONTRAT-HOTFIX-PRE-E1-02B.md
 *
 * Mapping stable (02B) :
 *   teacher_code ← id TEACHERS-* (canonique) ; sinon TEACHER-* ; sinon publicId/id
 *   assignment   ← teacherId + className + subject/course + schoolCode + année
 *
 * Interdit : résolution nominale d'enseignant pour notes/évaluations.
 */

function resolveStableTeacherCode(record = {}) {
  const id = String(record.id ?? "").trim();
  const publicId = String(record.publicId ?? "").trim();
  const legacy = String(record.teacherCode ?? record.teacher_code ?? "").trim();
  // HOTFIX-PRE-E1-02B : ne pas laisser un publicId ENS-* écraser l'id pédagogique TEACHERS-*.
  if (/^TEACHERS-/i.test(id)) return id;
  if (/^TEACHERS-/i.test(publicId)) return publicId;
  if (/^TEACHER-/i.test(id) && !/^TEACHERS-/i.test(id)) return id;
  return publicId || id || legacy;
}

function resolveAssignmentSubject(record = {}) {
  return String(record.subject ?? record.course ?? record.subjectName ?? "").trim();
}

function validateTeacherSyncRecord(record = {}) {
  const schoolCode = String(record.schoolCode ?? "")
    .trim()
    .toUpperCase();
  const teacherCode = resolveStableTeacherCode(record);
  if (!schoolCode || schoolCode === "*") {
    return {
      ok: false,
      code: "TEACHER_SYNC_SCHOOL_REQUIRED",
      error: "schoolCode obligatoire pour synchroniser un enseignant",
    };
  }
  if (!teacherCode) {
    return {
      ok: false,
      code: "TEACHER_SYNC_ID_REQUIRED",
      error: "Identifiant enseignant stable manquant (id/publicId)",
    };
  }
  return { ok: true, teacherCode, schoolCode };
}

function validateAssignmentSyncRecord(record = {}) {
  const schoolCode = String(record.schoolCode ?? "")
    .trim()
    .toUpperCase();
  const teacherCode = String(record.teacherId ?? record.teacher_code ?? "").trim();
  const className = String(record.className ?? "").trim();
  const subjectName = resolveAssignmentSubject(record);
  if (!schoolCode || schoolCode === "*") {
    return {
      ok: false,
      code: "ASSIGNMENT_SYNC_SCHOOL_REQUIRED",
      error: "schoolCode obligatoire pour synchroniser une affectation",
    };
  }
  if (!teacherCode) {
    return {
      ok: false,
      code: "ASSIGNMENT_SYNC_TEACHER_REQUIRED",
      error: "teacherId obligatoire pour synchroniser une affectation",
    };
  }
  if (!className) {
    return {
      ok: false,
      code: "ASSIGNMENT_SYNC_CLASS_REQUIRED",
      error: "className obligatoire pour synchroniser une affectation",
    };
  }
  if (!subjectName) {
    return {
      ok: false,
      code: "ASSIGNMENT_SYNC_SUBJECT_REQUIRED",
      error: "subject/course obligatoire pour synchroniser une affectation",
    };
  }
  return {
    ok: true,
    schoolCode,
    teacherCode,
    className,
    subjectName,
    assignmentKey: `${teacherCode}|${className}|${subjectName}`,
  };
}

function shouldSyncTeachersFromPayload(payload = {}) {
  return Array.isArray(payload?.teachers);
}

function shouldSyncAssignmentsFromPayload(payload = {}) {
  return Array.isArray(payload?.assignments);
}

/**
 * Fusionne ACK élèves + staff pédagogique + notes.
 */
function mergePreE1SyncAck(studentSync = {}, staffSync = {}, notesSync = {}) {
  const accepted = [
    ...((studentSync.accepted?.students ?? []).map((id) => ({
      entity: "students",
      id: String(id),
    })) ?? []),
    ...((studentSync.accepted?.enrollments ?? []).map((id) => ({
      entity: "enrollments",
      id: String(id),
    })) ?? []),
    ...((staffSync.accepted?.teachers ?? []).map((id) => ({
      entity: "teachers",
      id: String(id),
    })) ?? []),
    ...((staffSync.accepted?.assignments ?? []).map((id) => ({
      entity: "assignments",
      id: String(id),
    })) ?? []),
    ...((notesSync.accepted?.evaluations ?? []).map((id) => ({
      entity: "evaluations",
      id: String(id),
    })) ?? []),
    ...((notesSync.accepted?.notes ?? []).map((id) => ({
      entity: "notes",
      id: String(id),
    })) ?? []),
  ];
  const rejected = [
    ...(studentSync.rejected ?? []),
    ...(staffSync.rejected ?? []),
    ...(notesSync.rejected ?? []),
  ];
  return { accepted, rejected };
}

module.exports = {
  resolveStableTeacherCode,
  resolveAssignmentSubject,
  validateTeacherSyncRecord,
  validateAssignmentSyncRecord,
  shouldSyncTeachersFromPayload,
  shouldSyncAssignmentsFromPayload,
  mergePreE1SyncAck,
};
