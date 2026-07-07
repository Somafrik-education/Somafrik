import { normalize } from "./format";

type Row = Record<string, unknown>;

function teacherMatchesReference(teacher: Row, reference: string, nameKeys: Set<string>): boolean {
  const target = String(reference ?? "").trim();
  if (!target) return false;
  if ([teacher.id, teacher.publicId].some((value) => String(value ?? "") === target)) return true;
  return nameKeys.size > 0 && nameKeys.has(normalize(String(teacher.name ?? "")));
}

function buildTeacherNameKeys(teacher: Row): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    const key = normalize(String(value ?? ""));
    if (key) keys.add(key);
  };
  [teacher.name, teacher.firstName, teacher.lastName].forEach(add);
  const first = normalize(teacher.firstName);
  const last = normalize(teacher.name ?? teacher.lastName);
  if (first && last) {
    keys.add(`${first} ${last}`.trim());
    keys.add(`${last} ${first}`.trim());
  }
  return keys;
}

function extractAssignmentClassNames(teacher: Row): string[] {
  const names = new Set<string>();
  const assignedClass = String(teacher.assignedClass ?? "").trim();
  if (assignedClass) names.add(assignedClass);

  if (Array.isArray(teacher.assignedClasses)) {
    for (const name of teacher.assignedClasses as string[]) {
      const value = String(name ?? "").trim();
      if (value) names.add(value);
    }
  }

  if (Array.isArray(teacher.assignments)) {
    for (const entry of teacher.assignments as Row[]) {
      const className = String(entry.className ?? "").trim();
      if (className) names.add(className);
    }
  }

  return [...names];
}

export function getTeacherAssignedClassNames(
  teacher: Row,
  state?: { assignments?: Row[]; classes?: Row[] },
): string[] {
  const names = new Set(extractAssignmentClassNames(teacher));
  const nameKeys = buildTeacherNameKeys(teacher);

  if (state?.assignments) {
    for (const assignment of state.assignments) {
      const teacherRef = String(assignment.teacherId ?? "").trim();
      const matchesId = teacherRef && teacherMatchesReference(teacher, teacherRef, nameKeys);
      const matchesName = nameKeys.size > 0 && nameKeys.has(normalize(String(assignment.teacherName ?? "")));
      if (!matchesId && !matchesName) continue;
      const className = String(assignment.className ?? "").trim();
      if (className) names.add(className);
    }
  }

  if (state?.classes) {
    for (const schoolClass of state.classes) {
      const responsible = String(schoolClass.teacherId ?? "").trim();
      if (!responsible || !teacherMatchesReference(teacher, responsible, nameKeys)) continue;
      const className = String(schoolClass.name ?? "").trim();
      if (className) names.add(className);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b, "fr"));
}

export function formatTeacherClasses(
  teacher: Row,
  state?: { assignments?: Row[]; classes?: Row[] },
): string {
  const list = getTeacherAssignedClassNames(teacher, state);
  return list.length ? list.join(", ") : "Aucune classe";
}
