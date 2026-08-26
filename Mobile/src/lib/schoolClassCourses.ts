export type SchoolClassCourseLike = {
  id?: string;
  publicId?: string;
  className?: string;
  name?: string;
  subject?: string;
  course?: string;
  coefficient?: number;
  status?: string;
};

export type SchoolSubjectLike = {
  id?: string;
  code?: string;
  subjectCode?: string;
  name?: string;
  status?: string;
};

export type SchoolClassLike = {
  name?: string;
  status?: string;
  archived?: boolean;
};

export function normalizeCourseKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isArchivedOrInactiveStatus(status: unknown): boolean {
  const value = normalizeCourseKey(status);
  return (
    value.includes("archiv") ||
    value === "inactive" ||
    value === "inactif" ||
    value === "cancelled" ||
    value === "annule" ||
    value === "deleted" ||
    value === "supprime"
  );
}

export function activeClassNames(rows: readonly SchoolClassLike[]): string[] {
  return rows
    .filter((row) => !row.archived && !isArchivedOrInactiveStatus(row.status))
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean)
    .filter((name, index, values) => values.findIndex((value) => normalizeCourseKey(value) === normalizeCourseKey(name)) === index)
    .sort((left, right) => left.localeCompare(right, "fr"));
}

export function activeCoursesForClass<T extends SchoolClassCourseLike>(
  courses: readonly T[],
  className: string,
): T[] {
  const classKey = normalizeCourseKey(className);
  if (!classKey) return [];
  return courses.filter(
    (course) =>
      normalizeCourseKey(course.className) === classKey &&
      !isArchivedOrInactiveStatus(course.status),
  );
}

export function assignableSubjectsForClass<T extends SchoolSubjectLike>(
  subjects: readonly T[],
  courses: readonly SchoolClassCourseLike[],
  className: string,
): T[] {
  const assigned = new Set(
    activeCoursesForClass(courses, className)
      .map((course) => normalizeCourseKey(course.name ?? course.subject ?? course.course))
      .filter(Boolean),
  );
  return subjects
    .filter((subject) => !isArchivedOrInactiveStatus(subject.status))
    .filter((subject) => {
      const name = normalizeCourseKey(subject.name);
      return Boolean(name) && !assigned.has(name);
    })
    .sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? ""), "fr"));
}
