const { GradeBookService } = require("../services/gradeBookService");

const DEFAULT_PERIODS = ["Trimestre 1"];
const EVALUATIONS = [
  { suffix: "DEV", coef: 1 },
  { suffix: "CTL", coef: 2 },
];

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function hashScore(seed, min = 8, max = 18) {
  const total = String(seed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return min + (total % (max - min + 1));
}

function slug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findTeacherForSubject(teachers, subject) {
  return (
    teachers.find((teacher) => teacher.mainSubject === subject)
    ?? teachers.find((teacher) => (teacher.assignments ?? []).some((item) => item.course === subject || item.subject === subject))
    ?? teachers[0]
  );
}

function buildStudentNotes({ student, classCourses, teachers, schoolCode, period = "Trimestre 1" }) {
  const notes = [];

  classCourses.forEach((course, courseIndex) => {
    const teacher = findTeacherForSubject(teachers, course.name);
    EVALUATIONS.forEach((evaluation, evaluationIndex) => {
      const value = hashScore(`${student.id}-${course.name}-${evaluation.suffix}`);
      const day = pad((hashScore(`${student.id}-${courseIndex}`) % 27) + 1);
      notes.push({
        id: `N-${schoolCode}-${slug(student.id)}-${slug(course.name)}-${evaluation.suffix}`,
        schoolCode,
        studentId: student.id,
        subject: course.name,
        value,
        coefficient: course.coefficient ?? 1,
        date: `2026-0${5 + evaluationIndex}-${day}`,
        evaluationId: `EVAL-${schoolCode}-${slug(course.name)}-${evaluation.suffix}`,
        scale: 20,
        evaluationCoefficient: evaluation.coef,
        period,
        authorId: teacher?.id ?? "",
        enteredAt: `${day}-05-2026 09:00`,
        audit: [{ authorId: teacher?.id ?? "SYSTEM", newValue: value, date: `${day}-05-2026 09:00` }],
      });
    });
  });

  return notes;
}

function buildBulletinsForStudents({ students, courses, notes, schoolCode, period = "Trimestre 1" }) {
  const gradeBook = new GradeBookService({ students, notes, courses });
  const bulletins = [];

  students.forEach((student, index) => {
    if (student.archived) return;

    const report = gradeBook.generateReport(student.id, period, "Publié");
    const status = index % 5 === 0 ? "Brouillon" : index % 7 === 0 ? "En validation" : "Publié";

    bulletins.push({
      id: `BUL-${schoolCode}-${slug(student.id)}-${slug(period)}`,
      schoolCode,
      studentId: student.id,
      studentName: student.name,
      className: student.className,
      period,
      average: Number(report.average ?? 0).toFixed(1),
      rank: String(report.rankLabel ?? "-").replace(" / ", "/"),
      status,
      publishedAt: status === "Publié" ? "01-06-2026" : "",
      teacherComment: "Travail régulier durant la période.",
      principalComment: status === "Publié" ? "Bulletin validé par la direction." : "En attente de validation.",
    });
  });

  return bulletins;
}

function buildSchoolBulletinBundle({
  schoolCode,
  students = [],
  courses = [],
  teachers = [],
  periods = DEFAULT_PERIODS,
  studentsPerClass = 10,
}) {
  const schoolStudents = students.filter((student) => student.schoolCode === schoolCode && !student.archived);
  const schoolCourses = courses.filter((course) => !course.schoolCode || course.schoolCode === schoolCode);
  const schoolTeachers = teachers.filter((teacher) => !teacher.schoolCode || teacher.schoolCode === schoolCode);
  const sampledStudents =
    schoolStudents.length > 60
      ? schoolStudents.filter((_, index) => index % studentsPerClass === 0)
      : schoolStudents;
  const notes = [];
  const bulletins = [];

  periods.forEach((period) => {
    sampledStudents.forEach((student) => {
      const classCourses = schoolCourses.filter((course) => course.className === student.className);
      notes.push(
        ...buildStudentNotes({
          student,
          classCourses,
          teachers: schoolTeachers,
          schoolCode,
          period,
        }),
      );
    });

    bulletins.push(
      ...buildBulletinsForStudents({
        students: sampledStudents,
        courses: schoolCourses,
        notes: notes.filter((note) => !note.period || note.period === period),
        schoolCode,
        period,
      }),
    );
  });

  return { notes, bulletins };
}

function enrichPlatformBulletinData(state = {}, periods = DEFAULT_PERIODS) {
  const students = Array.isArray(state.students) ? state.students : [];
  const courses = Array.isArray(state.courses) ? state.courses : [];
  const teachers = Array.isArray(state.teachers) ? state.teachers : [];
  const schoolCodes = [...new Set(students.map((student) => student.schoolCode).filter(Boolean))];

  const generatedNotes = [];
  const generatedBulletins = [];

  schoolCodes.forEach((schoolCode) => {
    const bundle = buildSchoolBulletinBundle({
      schoolCode,
      students,
      courses,
      teachers,
      periods,
    });
    generatedNotes.push(...bundle.notes);
    generatedBulletins.push(...bundle.bulletins);
  });

  const studentSchoolById = new Map(
    students.map((student) => [String(student.id ?? ""), student.schoolCode]).filter(([id]) => id),
  );
  const regeneratedSchoolCodes = new Set(schoolCodes);
  const noteBelongsToRegeneratedSchool = (note) =>
    regeneratedSchoolCodes.has(note.schoolCode) || regeneratedSchoolCodes.has(studentSchoolById.get(String(note.studentId ?? "")));
  const bulletinBelongsToRegeneratedSchool = (bulletin) =>
    regeneratedSchoolCodes.has(bulletin.schoolCode) || regeneratedSchoolCodes.has(studentSchoolById.get(String(bulletin.studentId ?? "")));

  const generatedNoteIds = new Set(generatedNotes.map((note) => note.id));
  const generatedBulletinIds = new Set(generatedBulletins.map((bulletin) => bulletin.id));
  const preservedNotes = (state.notes ?? []).filter(
    (note) => !noteBelongsToRegeneratedSchool(note) && !generatedNoteIds.has(note.id),
  );
  const preservedBulletins = (state.bulletins ?? []).filter(
    (bulletin) => !bulletinBelongsToRegeneratedSchool(bulletin) && !generatedBulletinIds.has(bulletin.id),
  );

  const deletedRows = { ...(state.deletedRows ?? {}) };
  delete deletedRows.notes;
  delete deletedRows.bulletins;

  return {
    ...state,
    notes: [...generatedNotes, ...preservedNotes],
    bulletins: [...generatedBulletins, ...preservedBulletins],
    deletedRows,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildSchoolBulletinBundle,
  enrichPlatformBulletinData,
};
