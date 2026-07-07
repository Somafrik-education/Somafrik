/**
 * Règles métier inscription / affectation élève (alignées UI Mon établissement).
 */
const { normalize, todayPeriodDate } = require("./e2e-api-helpers");

function resolveSchoolYear(now = new Date()) {
  const year = now.getFullYear();
  return `${year - 1}-${year}`;
}

function assertStudentHasContact(student) {
  return Boolean(String(student?.contactId ?? "").trim());
}

/**
 * Un élève ne doit pas être affecté deux fois dans la même classe pour la même année.
 * Retourne un message d'erreur ou null si OK.
 */
function validateDuplicateClassEnrollment(students, candidate, { editingId } = {}) {
  const contactId = String(candidate.contactId ?? "").trim();
  const className = normalize(candidate.className);
  const schoolYear = normalize(candidate.schoolYear);
  const schoolCode = normalize(candidate.schoolCode);
  if (!contactId || !className || !schoolYear) {
    return null;
  }

  const duplicate = (students ?? []).find((row) => {
    if (editingId && String(row.id) === String(editingId)) return false;
    if (normalize(row.contactId) !== normalize(contactId)) return false;
    if (schoolCode && normalize(row.schoolCode) !== schoolCode) return false;
    return normalize(row.className) === className && normalize(row.schoolYear) === schoolYear;
  });

  if (duplicate) {
    return `Cet élève est déjà inscrit en ${candidate.className} pour l'année ${candidate.schoolYear}.`;
  }
  return null;
}

function buildEnrollmentPatch(student, fields) {
  const matricule = String(fields.matricule ?? student.matricule ?? student.id ?? "").trim();
  return {
    ...student,
    className: String(fields.className ?? student.className ?? "").trim(),
    schoolYear: String(fields.schoolYear ?? student.schoolYear ?? resolveSchoolYear()).trim(),
    schoolStatus: String(fields.schoolStatus ?? student.schoolStatus ?? "Inscrit").trim(),
    enrollmentDate: String(fields.enrollmentDate ?? student.enrollmentDate ?? todayPeriodDate()).trim(),
    matricule,
    publicId: student.publicId ?? matricule,
    parentPhone: String(fields.parentPhone ?? student.parentPhone ?? "").trim(),
    parentName: String(fields.parentName ?? student.parentName ?? "").trim(),
    archived: false,
  };
}

function studentsInClass(students, className, schoolCode) {
  return (students ?? []).filter(
    (row) =>
      normalize(row.className) === normalize(className) &&
      (!schoolCode || normalize(row.schoolCode) === normalize(schoolCode)),
  );
}

module.exports = {
  resolveSchoolYear,
  assertStudentHasContact,
  validateDuplicateClassEnrollment,
  buildEnrollmentPatch,
  studentsInClass,
};
