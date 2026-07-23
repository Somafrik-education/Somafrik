function normalizePhoneKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Résout les enfants d'un parent (D3.4b).
 *
 * 1. Canonique : `user.contactId` ↔ `relations.fromContactId` (= `contact.id`)
 * 2. Legacy temporaire : téléphone ↔ `student.parentPhone` **seulement**
 *    si aucune liaison relation n'a produit d'enfant.
 */
function resolveParentChildren(user = {}, state = {}, schoolCode = "") {
  const normalizedSchoolCode = String(schoolCode || user.schoolCode || "").trim().toUpperCase();
  if (!normalizedSchoolCode) {
    return [];
  }

  const students = Array.isArray(state.students) ? state.students : [];
  const relations = Array.isArray(state.relations) ? state.relations : [];
  const parentPhone = normalizePhoneKey(user.identifier) || normalizePhoneKey(user.phone);
  const contactId = String(user.contactId ?? "").trim();
  const matched = new Map();

  if (contactId) {
    for (const relation of relations) {
      if (String(relation.fromContactId ?? "").trim() !== contactId) {
        continue;
      }
      if (
        relation.schoolCode &&
        String(relation.schoolCode).trim().toUpperCase() !== normalizedSchoolCode
      ) {
        continue;
      }
      const studentId = String(relation.toStudentId ?? "").trim();
      if (!studentId) continue;
      const student = students.find(
        (row) =>
          String(row.id) === studentId &&
          String(row.schoolCode ?? "").trim().toUpperCase() === normalizedSchoolCode,
      );
      if (student) {
        matched.set(studentId, student);
      }
    }
  }

  // Fallback téléphone uniquement si aucune résolution par relation (legacy temporaire).
  if (matched.size === 0 && parentPhone) {
    for (const student of students) {
      if (String(student.schoolCode ?? "").trim().toUpperCase() !== normalizedSchoolCode) {
        continue;
      }
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
