/**
 * HOTFIX-SYNC-03 — Écriture enseignant limitée à evaluations + notes.
 * Ne pas élargir l'accès global à /backoffice/state.
 */

const { assignmentMatchesTeacher, resolveTeacherAssignments } = require("../services/authService");

const TEACHER_NOTES_WRITABLE_KEYS = Object.freeze(["evaluations", "notes"]);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function teacherHasNotesWritePermission(principal) {
  if (principal?.role === "Enseignant") {
    return true;
  }
  const permissions = new Set(principal?.permissions ?? []);
  return (
    permissions.has("modifier notes") ||
    permissions.has("Modifier notes") ||
    permissions.has("Notes:CREATE") ||
    permissions.has("Notes:UPDATE") ||
    permissions.has("Notes:CRUD") ||
    permissions.has("Evaluations:CRUD") ||
    permissions.has("ALL_PRIVILEGES")
  );
}

/**
 * @param {string[]} touchedKeys
 * @returns {{ ok: true } | { ok: false, forbidden: string[] }}
 */
function evaluateTeacherNotesTouchedKeys(touchedKeys = []) {
  const forbidden = touchedKeys.filter((key) => !TEACHER_NOTES_WRITABLE_KEYS.includes(key));
  if (forbidden.length) {
    return { ok: false, forbidden };
  }
  return { ok: true };
}

function resolveTeacherRecord(principal, state = {}) {
  const userId = String(principal?.sub ?? principal?.id ?? "").trim();
  const teachers = Array.isArray(state.teachers) ? state.teachers : [];
  return (
    teachers.find((teacher) => {
      const ids = [teacher.id, teacher.publicId, teacher.userId, teacher.contactId]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      return userId && ids.includes(userId);
    }) ??
    teachers.find((teacher) => {
      const email = normalizeText(teacher.email);
      const identifier = normalizeText(principal?.identifier ?? principal?.email);
      return email && identifier && email === identifier;
    }) ??
    null
  );
}

function resolveSessionTeacherId(principal, state = {}) {
  const teacher = resolveTeacherRecord(principal, state);
  return String(teacher?.id ?? teacher?.publicId ?? principal?.sub ?? principal?.id ?? "").trim();
}

function teacherIsAssignedToClassSubject(principal, state, className, subjectName) {
  const teacher = resolveTeacherRecord(principal, state);
  if (!teacher) {
    // Fallback : classNames / subjects portés par la session JWT
    const classKey = normalizeText(className);
    const subjectKey = normalizeText(subjectName);
    if (!classKey || !subjectKey) return false;
    const sessionClasses = new Set((principal?.classNames ?? []).map(normalizeText));
    const sessionSubjects = new Set(
      (principal?.subjects ?? principal?.subjectNames ?? []).map(normalizeText),
    );
    if (sessionClasses.size && sessionSubjects.size) {
      return sessionClasses.has(classKey) && sessionSubjects.has(subjectKey);
    }
    return false;
  }
  const assignments = resolveTeacherAssignments(teacher, principal, state.assignments ?? []);
  const classKey = normalizeText(className);
  const subjectKey = normalizeText(subjectName);
  if (!classKey || !subjectKey) return false;
  return assignments.some(
    (assignment) =>
      normalizeText(assignment.className) === classKey &&
      normalizeText(assignment.course ?? assignment.subject) === subjectKey,
  );
}

function rowMatchesSessionTeacher(row, sessionTeacherId, principal) {
  const sessionId = String(sessionTeacherId ?? "").trim();
  const principalId = String(principal?.sub ?? principal?.id ?? "").trim();
  const tid = String(row?.teacherId ?? row?.authorId ?? "").trim();
  if (!tid) return true;
  return (sessionId && tid === sessionId) || (principalId && tid === principalId);
}

/**
 * Une ligne payload est mutable par l'enseignant si :
 * - création (id absent du store) → stamp session (ignore teacherId client forgé)
 * - ou la ligne existante appartient déjà à la session / est legacy sans owner
 * Les lignes d'autres enseignants sont ignorées (pas d'écrasement).
 */
function canTeacherMutateRow(row, sessionTeacherId, principal, currentRows = []) {
  const id = String(row?.id ?? "").trim();
  const existing = (currentRows ?? []).find((item) => String(item.id ?? "").trim() === id);
  if (!existing) return true;
  return rowMatchesSessionTeacher(existing, sessionTeacherId, principal);
}

function isOwnedBySessionTeacher(row, sessionTeacherId, principal, currentRows = []) {
  return canTeacherMutateRow(row, sessionTeacherId, principal, currentRows);
}

/**
 * Vérifie chaque évaluation du payload pour l'enseignant connecté.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function assertTeacherEvaluationsAuthorized(principal, state, evaluations = []) {
  if (!Array.isArray(evaluations) || !evaluations.length) {
    return { ok: true };
  }
  const schoolCode = String(principal?.schoolCode ?? "")
    .trim()
    .toUpperCase();
  for (const evaluation of evaluations) {
    const evalSchool = String(evaluation.schoolCode ?? schoolCode)
      .trim()
      .toUpperCase();
    if (schoolCode && schoolCode !== "*" && evalSchool && evalSchool !== schoolCode) {
      return {
        ok: false,
        message: "Permission insuffisante : établissement hors périmètre enseignant.",
      };
    }
    if (
      !teacherIsAssignedToClassSubject(
        principal,
        state,
        evaluation.className,
        evaluation.subject ?? evaluation.subjectId,
      )
    ) {
      return {
        ok: false,
        message: `Permission insuffisante : non affecté à ${evaluation.className ?? "?"} / ${evaluation.subject ?? evaluation.subjectId ?? "?"}.`,
      };
    }
  }
  return { ok: true };
}

function assertTeacherNotesAuthorized(principal, state, notes = []) {
  if (!Array.isArray(notes) || !notes.length) {
    return { ok: true };
  }
  const schoolCode = String(principal?.schoolCode ?? "")
    .trim()
    .toUpperCase();
  for (const note of notes) {
    const noteSchool = String(note.schoolCode ?? schoolCode)
      .trim()
      .toUpperCase();
    if (schoolCode && schoolCode !== "*" && noteSchool && noteSchool !== schoolCode) {
      return {
        ok: false,
        message: "Permission insuffisante : établissement hors périmètre enseignant.",
      };
    }
    if (
      !teacherIsAssignedToClassSubject(
        principal,
        state,
        note.className,
        note.subject ?? note.subjectId,
      )
    ) {
      return {
        ok: false,
        message: `Permission insuffisante : non affecté à ${note.className ?? "?"} / ${note.subject ?? note.subjectId ?? "?"}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Force teacherId = identité session (jamais un teacherId libre client).
 */
function stampEvaluationsWithSessionTeacher(evaluations = [], principal, state = {}) {
  const teacherId = resolveSessionTeacherId(principal, state);
  const teacher = resolveTeacherRecord(principal, state);
  const teacherName = teacher
    ? `${String(teacher.firstName ?? "").trim()} ${String(teacher.lastName ?? teacher.name ?? "").trim()}`.trim()
    : String(principal?.name ?? "").trim();
  return (evaluations ?? []).map((evaluation) => ({
    ...evaluation,
    teacherId: teacherId || evaluation.teacherId,
    teacherName: teacherName || evaluation.teacherName,
    schoolCode:
      String(evaluation.schoolCode ?? "").trim() ||
      String(principal?.schoolCode ?? "").trim(),
  }));
}

function stampNotesWithSessionTeacher(notes = [], principal, state = {}) {
  const teacherId = resolveSessionTeacherId(principal, state);
  return (notes ?? []).map((note) => ({
    ...note,
    authorId: teacherId || note.authorId,
    teacherId: teacherId || note.teacherId,
    schoolCode:
      String(note.schoolCode ?? "").trim() || String(principal?.schoolCode ?? "").trim(),
  }));
}

/**
 * Upsert partiel par identifiant (HOTFIX-SYNC-03/04 — revue CTO).
 * L'absence d'une ligne dans le patch n'est JAMAIS une suppression :
 * current + remplacement des ids présents + ajout des nouveaux + conservation du reste.
 * Une suppression explicite nécessitera une op dédiée (hors chemin PUT partiel).
 */
function mergeTeacherOwnedRows(currentRows = [], stampedPatch = []) {
  const patchedById = new Map();
  for (const row of stampedPatch ?? []) {
    const id = String(row?.id ?? "").trim();
    if (id) patchedById.set(id, row);
  }

  const seen = new Set();
  const merged = [];

  for (const row of currentRows ?? []) {
    const id = String(row?.id ?? "").trim();
    if (!id) {
      merged.push(row);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(patchedById.has(id) ? patchedById.get(id) : row);
  }

  for (const row of stampedPatch ?? []) {
    const id = String(row?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }

  return merged;
}

/**
 * Prépare le body enseignant : clés autorisées uniquement + stamp teacher session.
 */
function prepareTeacherNotesWritePayload(rawBody = {}, principal, state = {}) {
  const touched = Object.keys(rawBody ?? {}).filter((key) =>
    Object.prototype.hasOwnProperty.call(rawBody, key),
  );
  // auditLog client ignoré pour le filtrage métier (rejeté via touchedKeys côté assert).
  const extra = touched.filter(
    (key) => key !== "auditLog" && !TEACHER_NOTES_WRITABLE_KEYS.includes(key),
  );
  if (extra.length) {
    return {
      ok: false,
      message: `Permission insuffisante pour modifier ces données (${extra.join(", ")}).`,
      forbidden: extra,
    };
  }

  const keysDecision = evaluateTeacherNotesTouchedKeys(
    touched.filter((key) => key !== "auditLog"),
  );
  if (!keysDecision.ok) {
    return {
      ok: false,
      message: "Permission insuffisante pour modifier ces données.",
      forbidden: keysDecision.forbidden,
    };
  }
  if (!teacherHasNotesWritePermission(principal)) {
    return {
      ok: false,
      message: "Permission insuffisante pour modifier les notes.",
      forbidden: ["notes"],
    };
  }

  const sessionTeacherId = resolveSessionTeacherId(principal, state);
  const ownedEvaluations = Array.isArray(rawBody.evaluations)
    ? rawBody.evaluations.filter((row) =>
        canTeacherMutateRow(row, sessionTeacherId, principal, state.evaluations ?? []),
      )
    : undefined;
  const ownedNotes = Array.isArray(rawBody.notes)
    ? rawBody.notes.filter((row) =>
        canTeacherMutateRow(row, sessionTeacherId, principal, state.notes ?? []),
      )
    : undefined;

  const evaluations = ownedEvaluations
    ? stampEvaluationsWithSessionTeacher(ownedEvaluations, principal, state)
    : undefined;
  const notes = ownedNotes ? stampNotesWithSessionTeacher(ownedNotes, principal, state) : undefined;

  if (evaluations) {
    const authz = assertTeacherEvaluationsAuthorized(principal, state, evaluations);
    if (!authz.ok) {
      return { ok: false, message: authz.message, forbidden: ["evaluations"] };
    }
  }
  if (notes) {
    const authz = assertTeacherNotesAuthorized(principal, state, notes);
    if (!authz.ok) {
      return { ok: false, message: authz.message, forbidden: ["notes"] };
    }
  }

  const payload = {};
  if (evaluations) {
    payload.evaluations = mergeTeacherOwnedRows(state.evaluations ?? [], evaluations);
  }
  if (notes) {
    payload.notes = mergeTeacherOwnedRows(state.notes ?? [], notes);
  }
  return { ok: true, payload, sessionTeacherId };
}

function isTeacherNotesPrincipal(principal) {
  return String(principal?.role ?? "") === "Enseignant";
}

module.exports = {
  TEACHER_NOTES_WRITABLE_KEYS,
  teacherHasNotesWritePermission,
  evaluateTeacherNotesTouchedKeys,
  resolveTeacherRecord,
  resolveSessionTeacherId,
  teacherIsAssignedToClassSubject,
  assertTeacherEvaluationsAuthorized,
  assertTeacherNotesAuthorized,
  stampEvaluationsWithSessionTeacher,
  stampNotesWithSessionTeacher,
  mergeTeacherOwnedRows,
  prepareTeacherNotesWritePayload,
  isTeacherNotesPrincipal,
  isOwnedBySessionTeacher,
  canTeacherMutateRow,
  rowMatchesSessionTeacher,
  assignmentMatchesTeacher,
};
