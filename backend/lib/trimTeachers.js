/**
 * Réduit le nombre d'enseignants et nettoie les références associées.
 */

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function teacherReferenceKeys(teacher = {}) {
  return [
    String(teacher.id ?? ""),
    String(teacher.publicId ?? ""),
    String(teacher.identifier ?? ""),
    String(teacher.userId ?? ""),
  ].filter(Boolean);
}

function buildKeptTeacherKeySet(teachers = []) {
  const keys = new Set();
  for (const teacher of teachers) {
    teacherReferenceKeys(teacher).forEach((key) => keys.add(key));
  }
  return keys;
}

function referencesKeptTeacher(value, keptKeys) {
  const key = String(value ?? "").trim();
  return Boolean(key && keptKeys.has(key));
}

function isTeacherUserRole(role) {
  const key = normalize(role);
  return key === "enseignant" || key.includes("prof");
}

function selectTeachersToKeep(teachers = [], keep = 15) {
  const sorted = [...teachers].sort((left, right) => {
    const leftAssignments = Array.isArray(left.assignments) ? left.assignments.length : 0;
    const rightAssignments = Array.isArray(right.assignments) ? right.assignments.length : 0;
    if (rightAssignments !== leftAssignments) {
      return rightAssignments - leftAssignments;
    }
    const leftSchool = String(left.schoolCode ?? "");
    const rightSchool = String(right.schoolCode ?? "");
    if (leftSchool !== rightSchool) {
      return leftSchool.localeCompare(rightSchool);
    }
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
  return sorted.slice(0, Math.max(0, keep));
}

function findKeptTeacherForCourse(teachers, keptKeys, course = {}) {
  const schoolCode = normalize(course.schoolCode);
  const className = normalize(course.className);
  const subject = normalize(course.subject ?? course.name);
  return teachers.find((teacher) => {
    if (normalize(teacher.schoolCode) !== schoolCode) return false;
    const assignments = Array.isArray(teacher.assignments) ? teacher.assignments : [];
    return assignments.some(
      (assignment) =>
        normalize(assignment.className) === className &&
        normalize(assignment.course ?? assignment.subject) === subject,
    );
  });
}

function trimTeachersState(state = {}, options = {}) {
  const keep = Number(options.keep ?? 15);
  const teachers = Array.isArray(state.teachers) ? state.teachers : [];
  const keptTeachers = selectTeachersToKeep(teachers, keep);
  const keptKeys = buildKeptTeacherKeySet(keptTeachers);
  const removedCount = teachers.length - keptTeachers.length;

  const keptTeacherById = new Map();
  for (const teacher of keptTeachers) {
    teacherReferenceKeys(teacher).forEach((key) => keptTeacherById.set(key, teacher));
  }

  const assignments = (state.assignments ?? []).filter((assignment) =>
    referencesKeptTeacher(assignment.teacherId, keptKeys),
  );
  const removedAssignments = (state.assignments ?? []).length - assignments.length;

  const courses = (state.courses ?? []).map((course) => {
    if (referencesKeptTeacher(course.teacherId, keptKeys)) {
      return course;
    }
    const fallback =
      assignments.find(
        (assignment) =>
          normalize(assignment.schoolCode) === normalize(course.schoolCode) &&
          normalize(assignment.className) === normalize(course.className) &&
          normalize(assignment.subject ?? assignment.course) === normalize(course.subject ?? course.name),
      ) ?? findKeptTeacherForCourse(keptTeachers, keptKeys, course);
    if (!fallback) {
      return { ...course, teacherId: "", teacherName: "" };
    }
    const teacher =
      keptTeacherById.get(String(fallback.teacherId ?? "")) ??
      keptTeachers.find((row) => normalize(row.schoolCode) === normalize(course.schoolCode));
    return {
      ...course,
      teacherId: teacher?.id ?? fallback.teacherId ?? "",
      teacherName: teacher?.name ?? fallback.teacherName ?? "",
    };
  });

  const courseTeacherByKey = new Map();
  for (const course of courses) {
    const key = [
      normalize(course.schoolCode),
      normalize(course.className),
      normalize(course.subject ?? course.name),
    ].join("|");
    courseTeacherByKey.set(key, {
      teacherId: course.teacherId ?? "",
      teacherName: course.teacherName ?? "",
    });
  }

  const courseSchedules = (state.courseSchedules ?? []).map((slot) => {
    if (referencesKeptTeacher(slot.teacherId, keptKeys)) {
      return slot;
    }
    const key = [
      normalize(slot.schoolCode),
      normalize(slot.className),
      normalize(slot.subject),
    ].join("|");
    const fromCourse = courseTeacherByKey.get(key);
    if (!fromCourse?.teacherId && !fromCourse?.teacherName) {
      return { ...slot, teacherId: "", teacherName: "" };
    }
    return { ...slot, ...fromCourse };
  });

  const classes = (state.classes ?? []).map((schoolClass) => {
    if (!schoolClass.teacherId || referencesKeptTeacher(schoolClass.teacherId, keptKeys)) {
      return schoolClass;
    }
    return { ...schoolClass, teacherId: "" };
  });

  const users = (state.users ?? []).filter((user) => {
    if (!isTeacherUserRole(user.role)) {
      return true;
    }
    const identifier = String(user.identifier ?? user.publicId ?? user.id ?? "");
    return referencesKeptTeacher(identifier, keptKeys);
  });
  const removedUsers = (state.users ?? []).length - users.length;

  const normalizedKeptTeachers = keptTeachers.map((teacher) => ({
    ...teacher,
    assignments: (teacher.assignments ?? []).filter((assignment) => {
      const className = normalize(assignment.className);
      const subject = normalize(assignment.course ?? assignment.subject);
      return assignments.some(
        (row) =>
          referencesKeptTeacher(row.teacherId, keptKeys) &&
          normalize(row.className) === className &&
          normalize(row.subject ?? row.course) === subject,
      );
    }),
  }));

  const next = {
    ...state,
    teachers: normalizedKeptTeachers,
    assignments,
    courses,
    courseSchedules,
    classes,
    users,
    updatedAt: new Date().toISOString(),
  };

  return {
    state: next,
    report: {
      keep,
      teachersBefore: teachers.length,
      teachersAfter: normalizedKeptTeachers.length,
      removedTeachers: removedCount,
      removedAssignments,
      removedUsers,
    },
  };
}

module.exports = { trimTeachersState, selectTeachersToKeep };
