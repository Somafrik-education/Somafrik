function normalizePhoneKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function normalizeSchoolCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isClosedLinkStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return ["inactive", "inactif", "archived", "archivé", "archive", "deleted", "supprimé", "supprime"].includes(
    normalized,
  );
}

function isActiveLinkStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return normalized === "active" || normalized === "actif";
}

function studentIdentityKeys(student = {}) {
  return [
    student.id,
    student.studentUuid,
    student.student_uuid,
    student.studentId,
    student.publicId,
    student.matricule,
    student.studentCode,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function studentMatchesTarget(student, studentId) {
  const target = String(studentId ?? "").trim();
  if (!target) return false;
  return studentIdentityKeys(student).includes(target);
}

function isClosedStudent(student = {}) {
  return student.archived === true || isClosedLinkStatus(student.status);
}

/**
 * Contacts du parent dans l'établissement.
 * Autorité : `user.contactId` ou `contacts.user_id` du même schoolCode.
 * Jamais le téléphone.
 */
function collectParentContactIds(user = {}, state = {}, schoolCode = "") {
  const ids = new Set();
  const direct = String(user.contactId ?? "").trim();
  if (direct) ids.add(direct);
  const userId = String(user.id ?? user.userId ?? "").trim();
  if (!userId) return ids;
  const contacts = Array.isArray(state.contacts) ? state.contacts : [];
  for (const contact of contacts) {
    const linkedUser = String(contact?.userId ?? contact?.user_id ?? "").trim();
    if (!linkedUser || linkedUser !== userId) continue;
    const contactSchool = normalizeSchoolCode(contact?.schoolCode ?? contact?.school_code);
    if (!contactSchool || contactSchool !== schoolCode) continue;
    if (isClosedLinkStatus(contact?.status)) continue;
    const id = String(contact?.id ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Résout les enfants d'un parent quand la lecture PostgreSQL live est indisponible.
 *
 * 1. Canonique projection : contact du parent (contactId ou contacts.user_id)
 *    ↔ relations.fromContactId, élève par id OU studentUuid, même établissement,
 *    relation active.
 * 2. Legacy temporaire : téléphone ↔ student.parentPhone seulement si aucune
 *    relation n'a produit d'enfant. Le login PostgreSQL ne passe pas par ici.
 */
function resolveParentChildren(user = {}, state = {}, schoolCode = "") {
  const normalizedSchoolCode = normalizeSchoolCode(schoolCode || user.schoolCode);
  if (!normalizedSchoolCode) {
    return [];
  }

  const students = Array.isArray(state.students) ? state.students : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];
  const parentPhone = normalizePhoneKey(user.identifier) || normalizePhoneKey(user.phone);
  const contactIds = collectParentContactIds(user, state, normalizedSchoolCode);
  const matched = new Map();

  if (contactIds.size) {
    for (const relation of relations) {
      if (!contactIds.has(String(relation.fromContactId ?? "").trim())) {
        continue;
      }
      if (!isActiveLinkStatus(relation.status)) {
        continue;
      }
      if (relation.schoolCode && normalizeSchoolCode(relation.schoolCode) !== normalizedSchoolCode) {
        continue;
      }
      const studentId = String(relation.toStudentId ?? "").trim();
      if (!studentId) continue;
      const student = students.find(
        (row) =>
          studentMatchesTarget(row, studentId) &&
          normalizeSchoolCode(row.schoolCode ?? row.school_code) === normalizedSchoolCode &&
          !isClosedStudent(row),
      );
      if (student) {
        matched.set(String(student.id ?? studentId), student);
      }
    }
  }

  // Fallback téléphone uniquement si aucune résolution par relation (legacy temporaire).
  if (matched.size === 0 && parentPhone) {
    for (const student of students) {
      if (normalizeSchoolCode(student.schoolCode ?? student.school_code) !== normalizedSchoolCode) {
        continue;
      }
      if (isClosedStudent(student)) continue;
      if (normalizePhoneKey(student.parentPhone) === parentPhone) {
        matched.set(String(student.id), student);
      }
    }
  }

  return [...matched.values()];
}

module.exports = {
  normalizePhoneKey,
  resolveParentChildren,
};
