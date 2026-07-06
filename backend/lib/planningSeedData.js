/**
 * Créneaux de planning (emploi du temps) pour les tests.
 */

function slug(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getWeekMonday(reference = new Date()) {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function slotDateTime(monday, dayOffset, hour, minute = 0) {
  const date = new Date(monday);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/**
 * Génère un emploi du temps hebdomadaire (lun–ven) pour les cours d'un établissement.
 */
function buildSchoolPlanningSlots({
  schoolCode,
  courses = [],
  classes = [],
  weekStart = getWeekMonday(),
  maxClasses,
}) {
  if (!schoolCode) return [];

  const classNames = [
    ...new Set([
      ...classes.map((row) => String(row.name ?? "").trim()).filter(Boolean),
      ...courses.map((row) => String(row.className ?? "").trim()).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "fr"));

  const limitedClasses = maxClasses ? classNames.slice(0, maxClasses) : classNames;
  const slots = [];
  const hours = [8, 10, 13, 15];

  limitedClasses.forEach((className) => {
    const classCourses = courses.filter(
      (course) =>
        String(course.schoolCode ?? schoolCode) === String(schoolCode) &&
        String(course.className ?? "") === className,
    );

    classCourses.forEach((course, index) => {
      const subject = String(course.name ?? course.subject ?? "").trim();
      if (!subject) return;

      const dayOffset = index % 5;
      const hour = hours[index % hours.length];
      const start = slotDateTime(weekStart, dayOffset, hour);
      const end = slotDateTime(weekStart, dayOffset, hour + 2);

      slots.push({
        id: `CS-${schoolCode}-${slug(className)}-${slug(subject)}-W${dayOffset}-H${hour}`,
        schoolCode,
        className,
        subject,
        teacherId: String(course.teacherId ?? ""),
        teacherName: String(course.teacherName ?? ""),
        start,
        end,
        room: `Salle ${(index % 8) + 1}`,
        periodName: "Trimestre 1",
        periodStart: "01-09-2025",
        periodEnd: "31-12-2025",
        kind: "course",
      });
    });
  });

  return slots;
}

function buildAcademicConfigForSchool(schoolCode, courses = [], classes = []) {
  const classNames = [
    ...new Set([
      ...classes
        .filter((row) => !row.schoolCode || String(row.schoolCode) === String(schoolCode))
        .map((row) => String(row.name ?? "").trim())
        .filter(Boolean),
      ...courses
        .filter((row) => String(row.schoolCode ?? schoolCode) === String(schoolCode))
        .map((row) => String(row.className ?? "").trim())
        .filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b, "fr"));

  const subjectsByClass = {};
  classNames.forEach((className) => {
    const subjects = [
      ...new Set(
        courses
          .filter(
            (row) =>
              String(row.schoolCode ?? schoolCode) === String(schoolCode) &&
              String(row.className ?? "") === className,
          )
          .map((row) => String(row.name ?? row.subject ?? "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "fr"));
    if (subjects.length) {
      subjectsByClass[className] = subjects;
    }
  });

  return {
    periodMode: "trimestre",
    reportCardMode: "period",
    defaultGradeScale: 20,
    classNames,
    subjectsByClass,
    periods: [
      {
        id: "trimestre-1",
        name: "Trimestre 1",
        type: "Trimestre",
        order: 1,
        startDate: "01-09-2025",
        endDate: "31-12-2025",
        active: true,
      },
      {
        id: "trimestre-2",
        name: "Trimestre 2",
        type: "Trimestre",
        order: 2,
        startDate: "01-01-2026",
        endDate: "31-03-2026",
        active: false,
      },
      {
        id: "trimestre-3",
        name: "Trimestre 3",
        type: "Trimestre",
        order: 3,
        startDate: "01-04-2026",
        endDate: "30-06-2026",
        active: false,
      },
    ],
  };
}

function buildAcademicConfigsFromState(state = {}) {
  const schoolCodes = [
    ...new Set([
      ...(state.students ?? []).map((row) => row.schoolCode).filter(Boolean),
      ...(state.courses ?? []).map((row) => row.schoolCode).filter(Boolean),
      ...(state.classes ?? []).map((row) => row.schoolCode).filter(Boolean),
    ]),
  ];

  const configs = {};
  schoolCodes.forEach((schoolCode) => {
    configs[schoolCode] = buildAcademicConfigForSchool(
      schoolCode,
      state.courses ?? [],
      state.classes ?? [],
    );
  });
  return configs;
}

function enrichPlatformPlanningData(state = {}, options = {}) {
  const weekStart = options.weekStart ?? getWeekMonday();
  const maxClasses = options.maxClasses;
  const students = Array.isArray(state.students) ? state.students : [];
  const courses = Array.isArray(state.courses) ? state.courses : [];
  const classes = Array.isArray(state.classes) ? state.classes : [];

  const schoolCodes = [
    ...new Set([
      ...students.map((row) => row.schoolCode).filter(Boolean),
      ...courses.map((row) => row.schoolCode).filter(Boolean),
    ]),
  ];

  const generated = [];
  schoolCodes.forEach((schoolCode) => {
    generated.push(
      ...buildSchoolPlanningSlots({
        schoolCode,
        courses,
        classes,
        weekStart,
        maxClasses,
      }),
    );
  });

  const generatedIds = new Set(generated.map((row) => row.id));
  const regeneratedSchoolCodes = new Set(schoolCodes);
  const preserved = (state.courseSchedules ?? []).filter((row) => {
    if (generatedIds.has(row.id)) return false;
    return !regeneratedSchoolCodes.has(row.schoolCode);
  });

  const deletedRows = { ...(state.deletedRows ?? {}) };
  delete deletedRows.courseSchedules;

  return {
    ...state,
    courseSchedules: [...generated, ...preserved],
    deletedRows,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildSchoolPlanningSlots,
  buildAcademicConfigForSchool,
  buildAcademicConfigsFromState,
  enrichPlatformPlanningData,
  getWeekMonday,
};
