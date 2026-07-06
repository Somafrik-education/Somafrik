import type { BackOfficeState } from "../types";
import { normalize } from "./format";

type Row = Record<string, unknown>;

interface SubjectLink {
  subject: string;
  className: string;
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}`;
}

export function getTeacherDisplayName(teacher: Row): string {
  const name = String(teacher.name ?? "").trim();
  const firstName = String(teacher.firstName ?? "").trim();
  if (name && firstName && !normalize(name).includes(normalize(firstName))) {
    return `${firstName} ${name}`.trim();
  }
  return name || firstName || "Enseignant";
}

export function findTeacherByName(teachers: Row[], teacherName: string): Row | undefined {
  const q = normalize(teacherName);
  if (!q) return undefined;
  return teachers.find((teacher) => {
    const display = normalize(getTeacherDisplayName(teacher));
    const raw = normalize(teacher.name);
    const first = normalize(teacher.firstName);
    return display === q || raw === q || first === q || `${first} ${raw}`.trim() === q;
  });
}

/** Liens matière ↔ classe déduits des affectations enregistrées sur l'enseignant. */
export function extractTeacherSubjectLinks(teacher: Row): SubjectLink[] {
  const seen = new Set<string>();
  const links: SubjectLink[] = [];

  const add = (subject: string, className = "") => {
    const value = subject.trim();
    if (!value) return;
    const key = `${normalize(value)}|${normalize(className)}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ subject: value, className: className.trim() });
  };

  if (Array.isArray(teacher.assignments)) {
    for (const entry of teacher.assignments as Row[]) {
      add(String(entry.course ?? entry.subject ?? ""), String(entry.className ?? ""));
    }
  }

  return links;
}

function teacherMatchesReference(teacher: Row, reference: string): boolean {
  const target = String(reference ?? "").trim();
  if (!target) return false;
  return [teacher.id, teacher.publicId].some((value) => String(value ?? "") === target);
}

/** Classes affectées à un enseignant (affectations et responsabilité de classe). */
export function getTeacherAssignedClassNames(
  teacher: Row,
  state?: Pick<BackOfficeState, "assignments" | "classes">,
): string[] {
  const names = new Set<string>();

  if (Array.isArray(teacher.assignedClasses)) {
    for (const name of teacher.assignedClasses as string[]) {
      const value = String(name ?? "").trim();
      if (value) names.add(value);
    }
  }

  for (const link of extractTeacherSubjectLinks(teacher)) {
    if (link.className) names.add(link.className);
  }

  if (state?.assignments) {
    for (const assignment of state.assignments as Row[]) {
      const teacherRef = String(assignment.teacherId ?? "").trim();
      if (!teacherRef || !teacherMatchesReference(teacher, teacherRef)) continue;
      const className = String(assignment.className ?? "").trim();
      if (className) names.add(className);
    }
  }

  if (state?.classes) {
    for (const schoolClass of state.classes as Row[]) {
      const responsible = String(schoolClass.teacherId ?? "").trim();
      if (!responsible || !teacherMatchesReference(teacher, responsible)) continue;
      const className = String(schoolClass.name ?? "").trim();
      if (className) names.add(className);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, "fr"));
}

export function formatTeacherClasses(
  teacher: Row,
  state?: Pick<BackOfficeState, "assignments" | "classes">,
): string {
  const list = getTeacherAssignedClassNames(teacher, state);
  return list.length ? list.join(", ") : "—";
}

function sameSchoolScope(row: Row, schoolCode?: string): boolean {
  if (!schoolCode || schoolCode === "*") return true;
  const rowSchool = normalize(String(row.schoolCode ?? ""));
  if (!rowSchool) return true;
  return rowSchool === normalize(schoolCode);
}

function matchesSubjectLink(row: Row, link: SubjectLink, schoolCode?: string): boolean {
  if (!sameSchoolScope(row, schoolCode)) return false;
  const subject = normalize(String(row.subject ?? row.course ?? row.name ?? ""));
  const className = normalize(String(row.className ?? ""));
  return subject === normalize(link.subject) && className === normalize(link.className);
}

function isEphemeralCourseId(id: unknown): boolean {
  return /^COURSE-/i.test(String(id ?? ""));
}

function pickPreferredCourse(existing: Row, candidate: Row): Row {
  const existingEphemeral = isEphemeralCourseId(existing.id);
  const candidateEphemeral = isEphemeralCourseId(candidate.id);
  const preferred =
    existingEphemeral && !candidateEphemeral
      ? candidate
      : !existingEphemeral && candidateEphemeral
        ? existing
        : candidate;
  const other = preferred === existing ? candidate : existing;

  return {
    ...preferred,
    ...other,
    id: preferred.id,
    schoolCode: preferred.schoolCode ?? other.schoolCode,
    className: preferred.className ?? other.className,
    name: preferred.name ?? other.name,
    teacherId: preferred.teacherId ?? other.teacherId,
    teacherName: preferred.teacherName ?? other.teacherName,
    coefficient: preferred.coefficient ?? other.coefficient ?? 1,
  };
}

function upsertCourse(
  courses: Row[],
  link: SubjectLink,
  teacherId: string,
  teacherName: string,
  schoolCode?: string,
): Row[] {
  const matches = courses
    .map((course, index) => ({ course, index }))
    .filter(({ course }) => matchesSubjectLink(course, link, schoolCode));

  if (matches.length > 1) {
    const merged = matches.slice(1).reduce((base, item) => pickPreferredCourse(base, item.course), matches[0].course);
    const withoutDupes = courses.filter((course) => !matches.some(({ course: row }) => row === course));
    return upsertCourse([merged, ...withoutDupes], link, teacherId, teacherName, schoolCode);
  }

  const idx = matches[0]?.index ?? -1;

  if (idx >= 0) {
    const existing = courses[idx];
    const sameTeacher =
      (teacherId && String(existing.teacherId ?? "") === teacherId) ||
      (teacherName && normalize(existing.teacherName) === normalize(teacherName));

    if (
      (String(existing.teacherId ?? "") || String(existing.teacherName ?? "")) &&
      (teacherId || teacherName) &&
      !sameTeacher
    ) {
      return courses;
    }

    return courses.map((course, index) =>
      index === idx
        ? {
            ...course,
            name: link.subject,
            className: link.className,
            teacherName,
            teacherId,
            schoolCode: schoolCode ?? course.schoolCode,
          }
        : course,
    );
  }

  return [
    {
      id: newId("COURSE"),
      name: link.subject,
      className: link.className,
      teacherName,
      teacherId,
      schoolCode,
      coefficient: 1,
    },
    ...courses,
  ];
}

function upsertAssignment(
  assignments: Row[],
  link: SubjectLink,
  teacherId: string,
  teacherName: string,
  schoolCode?: string,
  preserveId?: string,
): Row[] {
  const idx = assignments.findIndex((assignment) => matchesSubjectLink(assignment, link, schoolCode));

  if (idx >= 0) {
    const existing = assignments[idx];
    const sameTeacher =
      (teacherId && String(existing.teacherId ?? "") === teacherId) ||
      (teacherName && normalize(existing.teacherName) === normalize(teacherName));

    if (
      (String(existing.teacherId ?? "") || String(existing.teacherName ?? "")) &&
      (teacherId || teacherName) &&
      !sameTeacher
    ) {
      return assignments;
    }

    return assignments.map((assignment, index) =>
      index === idx
        ? {
            ...assignment,
            id: preserveId ?? assignment.id,
            subject: link.subject,
            course: link.subject,
            className: link.className,
            teacherName,
            teacherId,
            schoolCode: schoolCode ?? assignment.schoolCode,
          }
        : assignment,
    );
  }

  return [
    {
      id: preserveId ?? newId("ASSIGN"),
      subject: link.subject,
      course: link.subject,
      className: link.className,
      teacherName,
      teacherId,
      schoolCode,
    },
    ...assignments,
  ];
}

function applySchoolCode(item: Row, schoolCode?: string): Row {
  if (!schoolCode || schoolCode === "*") return item;
  return { ...item, schoolCode };
}

/** Clé métier d'une affectation : un cours (classe + matière) par établissement. */
function assignmentScopeKey(row: Row): string {
  const school = normalize(String(row.schoolCode ?? ""));
  const className = normalize(String(row.className ?? ""));
  const subject = normalize(String(row.subject ?? row.course ?? row.name ?? ""));
  return `${school}|${className}|${subject}`;
}

/**
 * Déduplique les affectations par (établissement, classe, matière) — miroir de la
 * règle backend `dedupeAssignmentsBySchoolClassSubject`. Empêche l'apparition de
 * doublons lorsqu'une même affectation existe sous deux identifiants (création
 * locale + version régénérée par la synchronisation).
 */
export function dedupeAssignments(assignments: Row[] = []): Row[] {
  const byKey = new Map<string, Row>();
  const passthrough: Row[] = [];

  for (const assignment of assignments) {
    const className = normalize(String(assignment.className ?? ""));
    const subject = normalize(String(assignment.subject ?? assignment.course ?? ""));
    if (!className || !subject) {
      passthrough.push(assignment);
      continue;
    }
    const key = assignmentScopeKey(assignment);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, assignment);
      continue;
    }
    // On conserve l'identifiant existant (stabilité des clés React) et on complète
    // les informations manquantes avec la nouvelle occurrence.
    byKey.set(key, {
      ...existing,
      ...assignment,
      id: existing.id ?? assignment.id,
      teacherId: existing.teacherId || assignment.teacherId,
      teacherName: existing.teacherName || assignment.teacherName,
      schoolCode: existing.schoolCode ?? assignment.schoolCode,
    });
  }

  return [...byKey.values(), ...passthrough];
}

function appendTeacherAssignmentLink(teacher: Row, link: SubjectLink): Row {
  if (!link.subject.trim()) return teacher;
  const current = Array.isArray(teacher.assignments) ? [...(teacher.assignments as Row[])] : [];
  const exists = current.some(
    (entry) =>
      normalize(String(entry.course ?? entry.subject ?? "")) === normalize(link.subject) &&
      normalize(String(entry.className ?? "")) === normalize(link.className),
  );
  if (exists) return teacher;
  return {
    ...teacher,
    assignments: [...current, { className: link.className, course: link.subject }],
  };
}

/** Enregistrement enseignant → matières, affectations et tableau assignments backend. */
export function syncTeacherPedagogy(
  state: BackOfficeState,
  teacher: Row,
  schoolCode?: string,
): { courses: Row[]; assignments: Row[]; teacher: Row } {
  const scopedTeacher = applySchoolCode(teacher, schoolCode);
  const links = extractTeacherSubjectLinks(scopedTeacher);
  const teacherId = String(scopedTeacher.id ?? "");
  const teacherName = getTeacherDisplayName(scopedTeacher);

  let courses = [...((state.courses ?? []) as Row[])];
  let assignments = [...((state.assignments ?? []) as Row[])];

  const teacherAssignments = links.map((link) => ({
    className: link.className,
    course: link.subject,
  }));

  const enrichedTeacher: Row = {
    ...scopedTeacher,
    assignments: teacherAssignments,
    assignedClasses: [...new Set(links.map((link) => link.className).filter(Boolean))],
  };

  for (const link of links) {
    courses = upsertCourse(courses, link, teacherId, teacherName, schoolCode);
    assignments = upsertAssignment(assignments, link, teacherId, teacherName, schoolCode);
  }

  return { courses, assignments: dedupeAssignments(assignments), teacher: enrichedTeacher };
}

/** Enregistrement matière → affectation + lien enseignant. */
export function syncCoursePedagogy(
  state: BackOfficeState,
  course: Row,
  schoolCode?: string,
): { courses: Row[]; assignments: Row[]; teachers: Row[] } {
  const scopedCourse = applySchoolCode(course, schoolCode);
  const subject = String(scopedCourse.name ?? "").trim();
  const className = String(scopedCourse.className ?? "").trim();
  const teacherName = String(scopedCourse.teacherName ?? "").trim();

  let courses = [...((state.courses ?? []) as Row[])];
  let assignments = [...((state.assignments ?? []) as Row[])];
  let teachers = [...((state.teachers ?? []) as Row[])];

  if (!subject) {
    return { courses, assignments, teachers };
  }

  const teacher = teacherName ? findTeacherByName(teachers, teacherName) : undefined;
  const teacherId = String(teacher?.id ?? scopedCourse.teacherId ?? "");
  const resolvedTeacherName = teacher ? getTeacherDisplayName(teacher) : teacherName;

  const link: SubjectLink = { subject, className };
  courses = upsertCourse(courses, link, teacherId, resolvedTeacherName, schoolCode);
  const courseIdx = courses.findIndex(
    (row) =>
      normalize(row.name) === normalize(subject) &&
      normalize(String(row.className ?? "")) === normalize(className) &&
      (String(row.teacherId ?? "") === teacherId ||
        normalize(row.teacherName) === normalize(resolvedTeacherName)),
  );
  if (courseIdx >= 0) {
    courses[courseIdx] = { ...courses[courseIdx], ...scopedCourse };
  }
  if (resolvedTeacherName) {
    assignments = upsertAssignment(assignments, link, teacherId, resolvedTeacherName, schoolCode);
  }

  if (teacher) {
    const synced = syncTeacherPedagogy(
      { ...state, courses, assignments, teachers },
      appendTeacherAssignmentLink(teacher, link),
      schoolCode,
    );
    teachers = teachers.map((row) => (String(row.id) === String(teacher.id) ? synced.teacher : row));
    courses = synced.courses;
    assignments = synced.assignments;
  }

  return { courses, assignments: dedupeAssignments(assignments), teachers };
}

/** Enregistrement affectation → mise à jour du cours existant (sans doublon inter-établissements). */
export function syncAssignmentPedagogy(
  state: BackOfficeState,
  assignment: Row,
  schoolCode?: string,
): { courses: Row[]; assignments: Row[]; teachers: Row[] } {
  const scopedAssignment = applySchoolCode(assignment, schoolCode);
  const subject = String(scopedAssignment.subject ?? scopedAssignment.course ?? "").trim();
  const className = String(scopedAssignment.className ?? "").trim();
  const teacherName = String(scopedAssignment.teacherName ?? "").trim();
  const teacherId = String(scopedAssignment.teacherId ?? "");
  const assignmentId = String(scopedAssignment.id ?? "");

  let courses = [...((state.courses ?? []) as Row[])];
  let assignments = [...((state.assignments ?? []) as Row[])];
  let teachers = [...((state.teachers ?? []) as Row[])];

  if (!subject) {
    return { courses, assignments, teachers };
  }

  const teacher =
    (teacherId ? teachers.find((row) => String(row.id) === teacherId) : undefined) ??
    (teacherName ? findTeacherByName(teachers, teacherName) : undefined);
  const resolvedTeacherId = String(teacher?.id ?? teacherId);
  const resolvedTeacherName = teacher ? getTeacherDisplayName(teacher) : teacherName;
  const link: SubjectLink = { subject, className };

  courses = upsertCourse(courses, link, resolvedTeacherId, resolvedTeacherName, schoolCode);

  if (assignmentId) {
    const existingIdx = assignments.findIndex((row) => String(row.id) === assignmentId);
    if (existingIdx >= 0) {
      assignments[existingIdx] = {
        ...assignments[existingIdx],
        ...scopedAssignment,
        subject,
        course: subject,
        teacherId: resolvedTeacherId,
        teacherName: resolvedTeacherName,
      };
    } else {
      assignments = upsertAssignment(
        assignments,
        link,
        resolvedTeacherId,
        resolvedTeacherName,
        schoolCode,
        assignmentId,
      );
    }
  } else if (resolvedTeacherName) {
    assignments = upsertAssignment(assignments, link, resolvedTeacherId, resolvedTeacherName, schoolCode);
  }

  if (teacher) {
    const synced = syncTeacherPedagogy(
      { ...state, courses, assignments, teachers },
      appendTeacherAssignmentLink(teacher, link),
      schoolCode,
    );
    teachers = teachers.map((row) => (String(row.id) === String(teacher.id) ? synced.teacher : row));
    courses = synced.courses;
    assignments = synced.assignments;
  }

  return { courses, assignments: dedupeAssignments(assignments), teachers };
}
