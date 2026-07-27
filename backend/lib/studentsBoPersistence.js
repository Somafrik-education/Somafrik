/**
 * HOTFIX-PRE-E1-01 — Persistance PostgreSQL élèves + inscriptions.
 *
 * Contrat : docs/ux/design-system/CONTRAT-HOTFIX-PRE-E1-01.md
 *
 * Mapping stable uniquement :
 *   student_code ← matricule ?? publicId ?? id
 *   school_id    ← schoolCode
 *   class_id     ← className (ensure classe école)
 *   academic_year_id ← année courante école
 *
 * Interdit : résolution nominale fragile (prénom/nom) pour POST /api/notes.
 */

/**
 * Identifiant stable BO → `students.student_code`.
 * @param {object} record
 * @returns {string}
 */
function resolveStableStudentCode(record = {}) {
  return String(record.matricule ?? record.publicId ?? record.id ?? "").trim();
}

/**
 * @param {object} record
 * @returns {{ ok: true, studentCode: string, schoolCode: string } | { ok: false, code: string, error: string }}
 */
function validateStudentSyncRecord(record = {}) {
  const schoolCode = String(record.schoolCode ?? "")
    .trim()
    .toUpperCase();
  const studentCode = resolveStableStudentCode(record);
  if (!schoolCode || schoolCode === "*") {
    return {
      ok: false,
      code: "STUDENT_SYNC_SCHOOL_REQUIRED",
      error: "schoolCode obligatoire pour synchroniser un élève",
    };
  }
  if (!studentCode) {
    return {
      ok: false,
      code: "STUDENT_SYNC_ID_REQUIRED",
      error: "Identifiant élève stable manquant (id/publicId/matricule)",
    };
  }
  return { ok: true, studentCode, schoolCode };
}

/**
 * Indique si le payload BO touche la collection students (sync attendue).
 * Absent / non-tableau ⇒ no-op (PUT partiel notes/évaluations).
 * @param {object} payload
 */
function shouldSyncStudentsFromPayload(payload = {}) {
  return Array.isArray(payload?.students);
}

/**
 * Fusionne les ACK élèves/inscriptions avec l'ACK notes existant.
 * @param {{ accepted?: { students?: string[], enrollments?: string[] }, rejected?: object[] }} studentSync
 * @param {{ accepted?: { evaluations?: string[], notes?: string[] }, rejected?: object[] }} notesSync
 */
function mergeStudentAndNotesSyncAck(studentSync = {}, notesSync = {}) {
  const accepted = [
    ...((studentSync.accepted?.students ?? []).map((id) => ({
      entity: "students",
      id: String(id),
    })) ?? []),
    ...((studentSync.accepted?.enrollments ?? []).map((id) => ({
      entity: "enrollments",
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
  const rejected = [...(studentSync.rejected ?? []), ...(notesSync.rejected ?? [])];
  return { accepted, rejected };
}

module.exports = {
  resolveStableStudentCode,
  validateStudentSyncRecord,
  shouldSyncStudentsFromPayload,
  mergeStudentAndNotesSyncAck,
};
