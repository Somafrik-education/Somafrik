const { parsePeriodDate } = require("./academicPeriods");

const TEACHER_MIN_ENTRY_AGE_YEARS = 18;

function startOfCalendarDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Un enseignant ne peut entrer dans l'établissement qu'à partir de ses 18 ans. */
function validateTeacherSchoolEntry(teacher = {}) {
  const entryDate = String(teacher.entryDate ?? "").trim();
  if (!entryDate) return null;

  const birthDate = String(teacher.birthDate ?? "").trim();
  if (!birthDate) {
    return "La date de naissance est requise pour enregistrer une date d'entrée.";
  }

  const birth = parsePeriodDate(birthDate);
  const entry = parsePeriodDate(entryDate);
  if (!birth || !entry) return null;

  if (startOfCalendarDay(entry).getTime() < startOfCalendarDay(birth).getTime()) {
    return "La date d'entrée ne peut pas être antérieure à la date de naissance.";
  }

  const minEntry = new Date(
    birth.getFullYear() + TEACHER_MIN_ENTRY_AGE_YEARS,
    birth.getMonth(),
    birth.getDate(),
  );
  if (startOfCalendarDay(entry).getTime() < startOfCalendarDay(minEntry).getTime()) {
    return "Un enseignant doit avoir au moins 18 ans à la date d'entrée dans l'établissement.";
  }

  return null;
}

module.exports = {
  TEACHER_MIN_ENTRY_AGE_YEARS,
  validateTeacherSchoolEntry,
};
