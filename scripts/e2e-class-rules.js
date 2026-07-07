/**
 * Règles métier Classes (alignées sur web/src/lib/classRules.ts, assignments.ts,
 * academicConfig.ts et EntityPage.tsx CLASSE-003).
 */
const { normalize, newId } = require("./e2e-api-helpers");

const DEFAULT_LEVELS = ["1ère", "2ème", "3ème", "4ème", "5ème", "6ème"];
const DEFAULT_TRACKS = ["Générale", "Sciences", "Lettres", "Technique", "Commerciale"];
const DEFAULT_CLASS_NAMES = DEFAULT_LEVELS.flatMap((level) => [`${level} A`, `${level} B`]);

function normalizeClassName(value) {
  return normalize(String(value ?? ""));
}

function resolveSubjectsByClass(config, classNames) {
  const stored = config.subjectsByClass;
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    const result = {};
    classNames.forEach((className) => {
      const list = stored[className];
      result[className] = Array.isArray(list) ? list : [];
    });
    Object.entries(stored).forEach(([className, list]) => {
      if (!result[className] && Array.isArray(list) && list.length) {
        result[className] = list;
      }
    });
    return result;
  }
  return {};
}

function getSchoolAcademicLists(state, schoolCode) {
  const config = (state.academicConfigs?.[schoolCode ?? ""] ?? {});
  const levels =
    Array.isArray(config.levels) && config.levels.length ? config.levels : DEFAULT_LEVELS;
  const tracks =
    Array.isArray(config.tracks) && config.tracks.length ? config.tracks : DEFAULT_TRACKS;
  const classNames =
    Array.isArray(config.classNames) && config.classNames.length
      ? config.classNames
      : DEFAULT_CLASS_NAMES;
  const subjectsByClass = resolveSubjectsByClass(config, classNames);
  return { levels, tracks, classNames, subjectsByClass };
}

function mergeSelectOptions(configList, extra = []) {
  return [...new Set([...configList, ...extra.filter(Boolean)])].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

function filterSchoolClassRecords(classes, schoolCode) {
  if (!schoolCode || schoolCode === "*") return classes ?? [];
  return (classes ?? []).filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function findClassByName(classes, name, excludeId) {
  const target = normalizeClassName(name);
  if (!target) return undefined;
  return (classes ?? []).find(
    (row) =>
      normalizeClassName(row.name) === target && String(row.id ?? "") !== String(excludeId ?? ""),
  );
}

function validateUniqueClassName(name, classes, excludeId) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "Le nom de classe est requis.";
  if (findClassByName(classes, trimmed, excludeId)) {
    return `La classe « ${trimmed} » existe déjà dans l'établissement.`;
  }
  return null;
}

function classRecordPriority(row) {
  let score = 0;
  const id = String(row.id ?? "");
  if (!id.startsWith("CLASS-")) score += 20;
  if (row.publicId) score += 10;
  if (row.level) score += 3;
  if (row.track) score += 3;
  if (row.teacherId) score += 2;
  return score;
}

function dedupeClassesByName(rows) {
  const best = new Map();
  for (const row of rows ?? []) {
    const key = normalizeClassName(row.name ?? row.className);
    if (!key) continue;
    const current = best.get(key);
    if (!current || classRecordPriority(row) > classRecordPriority(current)) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr"),
  );
}

function getAvailableClassNameOptions(configuredNames, existingClasses, currentName) {
  const taken = new Set(
    (existingClasses ?? []).map((row) => normalizeClassName(row.name)).filter(Boolean),
  );
  const current = normalizeClassName(currentName);
  if (current) taken.delete(current);

  const options = [];
  const seen = new Set();
  for (const name of configuredNames ?? []) {
    const key = normalizeClassName(name);
    if (!key || seen.has(key)) continue;
    if (taken.has(key) && key !== current) continue;
    seen.add(key);
    options.push(String(name).trim());
  }
  if (current && !seen.has(current) && String(currentName ?? "").trim()) {
    options.push(String(currentName).trim());
  }
  return options.sort((a, b) => a.localeCompare(b, "fr"));
}

function scopedSchoolStudents(state, schoolCode) {
  const rows = state.students ?? [];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function classBelongsToSchool(item, schoolCode, className) {
  const target = normalizeClassName(className);
  if (normalizeClassName(item.name) !== target) return false;
  if (!schoolCode || schoolCode === "*") return true;
  const itemSchool = normalize(item.schoolCode ?? "");
  return !itemSchool || itemSchool === normalize(schoolCode);
}

function validateClassDeletion(className, state, schoolCode) {
  const target = normalizeClassName(className);
  if (!target) return "Le nom de la classe est requis.";

  const students = scopedSchoolStudents(state, schoolCode);
  const enrolled = students.filter((student) => normalizeClassName(student.className) === target);
  if (enrolled.length) {
    return `Suppression refusée : ${enrolled.length} élève(s) encore inscrit(s) dans cette classe.`;
  }

  const courses = (state.courses ?? []).filter(
    (course) => normalizeClassName(course.className) === target,
  );
  if (courses.length) {
    return `Suppression refusée : ${courses.length} cours lié(s) à cette classe. Retirez-les d'abord.`;
  }

  const courseSchedules = (state.courseSchedules ?? []).filter(
    (slot) => normalizeClassName(slot.className) === target,
  );
  if (courseSchedules.length) {
    return `Suppression refusée : ${courseSchedules.length} créneau(x) planning lié(s) à cette classe. Retirez-les dans Planning de cours.`;
  }

  return null;
}

function removeSchoolClassFromState(state, row, schoolCode) {
  const className = String(row.name ?? "").trim();
  const error = validateClassDeletion(className, state, schoolCode);
  if (error) return { ok: false, error };

  const allClasses = state.classes ?? [];
  const nextClasses = allClasses.filter(
    (item) => !classBelongsToSchool(item, schoolCode, className),
  );

  if (nextClasses.length === allClasses.length) {
    const target = normalizeClassName(className);
    const hasSyntheticOnly =
      String(row.id ?? "").startsWith("CLASS-") ||
      normalizeClassName(String(row.id ?? "").replace(/^CLASS-/i, "")) === target;
    if (hasSyntheticOnly) {
      return {
        ok: false,
        error:
          "Suppression refusée : cette classe n'existe que via des inscriptions élèves ou la configuration. Retirez d'abord les élèves ou modifiez la liste dans Configuration.",
      };
    }
    return { ok: false, error: "Suppression refusée : classe introuvable dans le périmètre établissement." };
  }

  const patch = { classes: nextClasses };

  if (schoolCode && schoolCode !== "*") {
    const currentConfig = { ...(state.academicConfigs?.[schoolCode] ?? {}) };
    if (Array.isArray(currentConfig.classNames)) {
      currentConfig.classNames = currentConfig.classNames.filter(
        (name) => normalizeClassName(name) !== normalizeClassName(className),
      );
    }
    patch.academicConfigs = {
      ...state.academicConfigs,
      [schoolCode]: currentConfig,
    };
  }

  return { ok: true, patch };
}

function scopedStudents(user, state) {
  const schoolCode = user?.schoolCode;
  const rows = state.students ?? [];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function scopedTeachers(user, state) {
  const schoolCode = user?.schoolCode;
  const rows = state.teachers ?? [];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function scopedCourses(user, state) {
  const schoolCode = user?.schoolCode;
  const rows = state.courses ?? [];
  if (!schoolCode || schoolCode === "*") return rows;
  return rows.filter((row) => normalize(row.schoolCode) === normalize(schoolCode));
}

function scopedClasses(user, state) {
  const schoolCode = user?.schoolCode;
  const scopedStudentsList = scopedStudents(user, state);
  const classNames = new Set(
    scopedStudentsList.map((s) => String(s.className ?? "")).filter(Boolean),
  );
  const base =
    !schoolCode || schoolCode === "*"
      ? (state.classes ?? [])
      : (state.classes ?? []).filter(
          (item) =>
            normalize(item.schoolCode) === normalize(schoolCode) ||
            classNames.has(String(item.name ?? "")),
        );

  const rows = [...base];
  classNames.forEach((className) => {
    if (!rows.some((item) => normalize(String(item.name ?? "")) === normalize(className))) {
      rows.push({ id: `CLASS-${className}`, name: className, schoolCode });
    }
  });
  return dedupeClassesByName(rows);
}

function getTeacherDisplayName(teacher) {
  const name = String(teacher.name ?? "").trim();
  const firstName = String(teacher.firstName ?? "").trim();
  if (name && firstName && !normalize(name).includes(normalize(firstName))) {
    return `${firstName} ${name}`.trim();
  }
  return name || firstName || "Enseignant";
}

function resolveAssignmentSchoolCode(user, state, schoolCode) {
  if (schoolCode && schoolCode !== "*") return schoolCode;
  if (user?.schoolCode && user.schoolCode !== "*") return user.schoolCode;
  return state.schools?.[0]?.code;
}

function isKnownClassName(className, classes, state, schoolCode) {
  if (
    (classes ?? []).some(
      (schoolClass) => normalize(String(schoolClass.name ?? "")) === normalize(className),
    )
  ) {
    return true;
  }
  const { classNames } = getSchoolAcademicLists(state, schoolCode);
  return classNames.some((name) => normalize(name) === normalize(className));
}

function getAssignmentSelectOptions(user, state, className, schoolCode) {
  const resolvedSchoolCode = resolveAssignmentSchoolCode(user, state, schoolCode);
  const teachers = scopedTeachers(user, state);
  const classes = scopedClasses(user, state);
  const courses = scopedCourses(user, state);
  const selectedClass = normalize(className);
  const { classNames: configuredClasses } = getSchoolAcademicLists(state, resolvedSchoolCode);

  const classOptions = new Set();
  classes.forEach((schoolClass) => {
    const name = String(schoolClass.name ?? "").trim();
    if (name) classOptions.add(name);
  });
  configuredClasses.forEach((name) => {
    if (String(name).trim()) classOptions.add(String(name).trim());
  });

  const subjectNames = new Set();
  const subjects = [];
  courses
    .filter((course) => !selectedClass || normalize(String(course.className ?? "")) === selectedClass)
    .forEach((course) => {
      const name = String(course.name ?? "").trim();
      if (!name || subjectNames.has(name)) return;
      subjectNames.add(name);
      subjects.push({ value: name, label: name });
    });

  return {
    teachers: teachers.map((teacher) => ({
      value: String(teacher.id ?? ""),
      label: getTeacherDisplayName(teacher),
    })),
    classes: [...classOptions]
      .sort((a, b) => a.localeCompare(b, "fr"))
      .map((name) => ({ value: name, label: name })),
    subjects: subjects.sort((a, b) => a.label.localeCompare(b.label, "fr")),
  };
}

/** CLASSE-003 : classe archivée exclue des nouvelles inscriptions (EntityPage.tsx). */
function getEnrollmentClassNameSelectOptions(state, schoolCode, editingClassName, extra = []) {
  const { classNames: configuredClasses } = getSchoolAcademicLists(state, schoolCode);
  const archivedClassNames = new Set(
    (state.classes ?? [])
      .filter((cls) => normalize(String(cls.status ?? "")) === normalize("Archivée"))
      .map((cls) => normalize(String(cls.name ?? cls.className ?? ""))),
  );
  const currentValue = normalize(String(editingClassName ?? ""));
  return mergeSelectOptions(configuredClasses, extra).filter(
    (option) => !archivedClassNames.has(normalize(option)) || normalize(option) === currentValue,
  );
}

function resolveSchoolYear(now = new Date()) {
  const year = now.getFullYear();
  return `${year - 1}-${year}`;
}

function pickUnusedClassName(state, schoolCode) {
  const { classNames } = getSchoolAcademicLists(state, schoolCode);
  const existing = filterSchoolClassRecords(state.classes ?? [], schoolCode);
  const taken = new Set(existing.map((row) => normalizeClassName(row.name)).filter(Boolean));
  for (const name of classNames) {
    const key = normalizeClassName(name);
    if (!key || taken.has(key)) continue;
    // validateClassDeletion vérifie les cours/élèves globaux par nom (comportement UI).
    if (validateClassDeletion(String(name).trim(), state, schoolCode)) continue;
    return String(name).trim();
  }
  throw new Error("Aucun nom de classe disponible pour le test E2E.");
}

function ensureExplicitAcademicClassNames(state, schoolCode) {
  const { classNames } = getSchoolAcademicLists(state, schoolCode);
  const current = state.academicConfigs?.[schoolCode] ?? {};
  if (Array.isArray(current.classNames) && current.classNames.length) {
    return { patch: null, classNames: current.classNames };
  }
  return {
    patch: {
      academicConfigs: {
        ...state.academicConfigs,
        [schoolCode]: { ...current, classNames: [...classNames] },
      },
    },
    classNames,
  };
}

function prepareClassForSave(form, schoolCode) {
  return {
    ...form,
    name: String(form.name ?? "").trim(),
    className: String(form.name ?? form.className ?? "").trim(),
    level: String(form.level ?? "").trim(),
    track: String(form.track ?? "").trim(),
    cycle: String(form.cycle ?? "").trim(),
    schoolYear: String(form.schoolYear ?? "").trim(),
    capacity: String(form.capacity ?? "").trim(),
    schoolCode: String(schoolCode ?? form.schoolCode ?? "").trim(),
    status: String(form.status ?? "Active").trim() || "Active",
  };
}

function saveSchoolClassFlow(state, classDraft, schoolCode, editingId) {
  const prepared = prepareClassForSave(classDraft, schoolCode);
  const schoolClasses = filterSchoolClassRecords(state.classes ?? [], schoolCode);
  const conflict = validateUniqueClassName(prepared.name, schoolClasses, editingId);
  if (conflict) return { ok: false, error: conflict };

  const classRecord = {
    ...prepared,
    id: editingId ?? classDraft.id ?? newId("CLASS"),
    publicId: classDraft.publicId ?? newId("CLS"),
  };

  const classes = editingId
    ? (state.classes ?? []).map((row) => (String(row.id) === String(editingId) ? classRecord : row))
    : [classRecord, ...(state.classes ?? [])];

  return { ok: true, classRecord, patch: { classes } };
}

module.exports = {
  DEFAULT_CLASS_NAMES,
  normalizeClassName,
  getSchoolAcademicLists,
  mergeSelectOptions,
  filterSchoolClassRecords,
  findClassByName,
  validateUniqueClassName,
  getAvailableClassNameOptions,
  validateClassDeletion,
  removeSchoolClassFromState,
  scopedClasses,
  isKnownClassName,
  getAssignmentSelectOptions,
  getEnrollmentClassNameSelectOptions,
  pickUnusedClassName,
  ensureExplicitAcademicClassNames,
  prepareClassForSave,
  saveSchoolClassFlow,
  resolveSchoolYear,
};
