const TEACHER_PROFILE = "ENS";
const STUDENT_PROFILE = "ELE";
const SCHOOL_YEAR_BASE = 2025;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSchoolCodeSegments(schoolCode: string): { year: string; establishment: string; yearIndex: string } {
  const normalized = schoolCode.trim().toUpperCase();
  const match = /^[A-Z]{2}-(\d{4})-(\d{4})$/.exec(normalized);
  if (match) {
    const year = match[1];
    const establishment = match[2];
    const yearIndex = Math.max(1, Number.parseInt(year, 10) - SCHOOL_YEAR_BASE);
    return {
      year,
      establishment,
      yearIndex: String(yearIndex).padStart(4, "0"),
    };
  }
  const digits = normalized.replace(/\D/g, "");
  return {
    year: (digits.slice(0, 4) || "0000").padStart(4, "0").slice(-4),
    establishment: (digits.slice(-4) || "0000").padStart(4, "0"),
    yearIndex: "0001",
  };
}

export function isLegacyStudentMatricule(value: string): boolean {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return true;
  if (normalized.startsWith("STUDENTS-")) return true;
  return !new RegExp(`^${STUDENT_PROFILE}-\\d{4}-\\d{4}-\\d{6}$`, "i").test(normalized);
}

function extractStudentSequence(
  value: string,
  segments: ReturnType<typeof parseSchoolCodeSegments>,
): number | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;

  const fullPattern = new RegExp(
    `^${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-(\\d+)$`,
    "i",
  );
  const fullMatch = fullPattern.exec(normalized);
  if (fullMatch?.[1]) return Number(fullMatch[1]);

  const legacyYearPattern = new RegExp(
    `^${STUDENT_PROFILE}-${segments.establishment}-${segments.year}-(\\d+)$`,
    "i",
  );
  const legacyYearMatch = legacyYearPattern.exec(normalized);
  if (legacyYearMatch?.[1]) return Number(legacyYearMatch[1]);

  const shortPattern = new RegExp(`^${STUDENT_PROFILE}-(\\d+)$`, "i");
  const shortMatch = shortPattern.exec(normalized);
  if (shortMatch?.[1]) return Number(shortMatch[1]);

  return null;
}

function nextStudentSequence(
  schoolCode: string,
  students: Record<string, unknown>[],
): number {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  const segments = parseSchoolCodeSegments(normalizedSchool);
  let max = 0;

  for (const student of students) {
    const studentSchool = String(student.schoolCode ?? "").trim().toUpperCase();
    if (studentSchool && studentSchool !== normalizedSchool) continue;

    for (const candidate of [student.matricule, student.publicId, student.id]) {
      const sequence = extractStudentSequence(String(candidate ?? ""), segments);
      if (sequence !== null) {
        max = Math.max(max, sequence);
      }
    }
  }

  return max + 1;
}

/** Matricule élève : ELE-établissement-année-séquence (ex. ELE-0001-0001-000001). */
export function generateStudentMatricule(
  schoolCode: string,
  students: Record<string, unknown>[] = [],
): string {
  const segments = parseSchoolCodeSegments(schoolCode);
  const sequence = nextStudentSequence(schoolCode, students);
  return `${STUDENT_PROFILE}-${segments.establishment}-${segments.yearIndex}-${String(sequence).padStart(6, "0")}`;
}

/** Identifiant court de connexion élève (ex. ELE-0001). */
export function getStudentLoginIdentifier(matriculeOrIdentifier: string): string {
  const value = String(matriculeOrIdentifier ?? "").trim().toUpperCase();
  const fullMatch = /^ELE-\d{4}-\d{4}-(\d+)$/i.exec(value);
  if (fullMatch?.[1]) {
    return `${STUDENT_PROFILE}-${String(Number(fullMatch[1])).padStart(4, "0")}`;
  }
  const shortMatch = /^ELE-(\d+)$/i.exec(value);
  if (shortMatch?.[1]) {
    return `${STUDENT_PROFILE}-${String(Number(shortMatch[1])).padStart(4, "0")}`;
  }
  return value;
}

export function resolveStudentMatricule(
  item: Record<string, unknown>,
  schoolCode: string,
  students: Record<string, unknown>[] = [],
): { matricule: string; publicId: string; loginIdentifier: string } {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  const existing = String(item.matricule ?? item.publicId ?? "").trim();
  if (existing && !isLegacyStudentMatricule(existing)) {
    const matricule = existing.toUpperCase();
    return {
      matricule,
      publicId: String(item.publicId ?? matricule),
      loginIdentifier: getStudentLoginIdentifier(matricule),
    };
  }
  const matricule = generateStudentMatricule(
    normalizedSchool,
    students.filter((row) => String(row.id ?? "") !== String(item.id ?? "")),
  );
  return {
    matricule,
    publicId: matricule,
    loginIdentifier: getStudentLoginIdentifier(matricule),
  };
}

/** Réattribue les matricules legacy (STUDENTS-…) pour un établissement. */
export function repairStudentMatricules(
  students: Record<string, unknown>[],
  schoolCode?: string,
): Record<string, unknown>[] {
  const normalizedSchool = schoolCode?.trim().toUpperCase();
  const scoped = normalizedSchool
    ? students.filter((row) => String(row.schoolCode ?? "").trim().toUpperCase() === normalizedSchool)
    : students;

  const repairedBySchool = new Map<string, Record<string, unknown>[]>();
  for (const student of scoped) {
    const code = String(student.schoolCode ?? "").trim().toUpperCase();
    if (!code) continue;
    if (!repairedBySchool.has(code)) repairedBySchool.set(code, []);
    repairedBySchool.get(code)!.push(student);
  }

  const nextById = new Map<string, Record<string, unknown>>();
  for (const [code, group] of repairedBySchool) {
    const ordered = [...group].sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
    const rebuilt: Record<string, unknown>[] = [];
    for (const student of ordered) {
      const matricule = generateStudentMatricule(code, rebuilt);
      rebuilt.push({ ...student, matricule, publicId: matricule });
      nextById.set(String(student.id ?? ""), rebuilt[rebuilt.length - 1]);
    }
  }

  return students.map((student) => {
    const id = String(student.id ?? "");
    const matricule = String(student.matricule ?? student.publicId ?? "");
    if (!isLegacyStudentMatricule(matricule)) return student;
    return nextById.get(id) ?? student;
  });
}

function extractTeacherSequence(value: string, schoolCode: string): number | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;

  const fullPattern = new RegExp(`^${escapeRegExp(schoolCode)}-${TEACHER_PROFILE}-(\\d+)$`, "i");
  const fullMatch = fullPattern.exec(normalized);
  if (fullMatch?.[1]) return Number(fullMatch[1]);

  const shortPattern = new RegExp(`^${TEACHER_PROFILE}-(\\d+)$`, "i");
  const shortMatch = shortPattern.exec(normalized);
  if (shortMatch?.[1]) return Number(shortMatch[1]);

  return null;
}

function nextTeacherSequence(schoolCode: string, teachers: Record<string, unknown>[]): number {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  let max = 0;

  for (const teacher of teachers) {
    const teacherSchool = String(teacher.schoolCode ?? "").trim().toUpperCase();
    if (teacherSchool && teacherSchool !== normalizedSchool) continue;

    for (const candidate of [teacher.publicId, teacher.identifier, teacher.matricule, teacher.id]) {
      const sequence = extractTeacherSequence(String(candidate ?? ""), normalizedSchool);
      if (sequence !== null) {
        max = Math.max(max, sequence);
      }
    }
  }

  return max + 1;
}

/** Identifiant court de connexion (ex. ENS-0001). */
export function getTeacherLoginIdentifier(publicIdOrIdentifier: string): string {
  const value = String(publicIdOrIdentifier ?? "").trim().toUpperCase();
  const match = value.match(/ENS-(\d+)$/i);
  if (!match?.[1]) return value;
  return `${TEACHER_PROFILE}-${String(Number(match[1])).padStart(4, "0")}`;
}

/** Identifiant complet : code_pays-année-n°_établissement-ENS-n° (ex. CD-2026-0001-ENS-0001). */
export function generateTeacherIdentifiers(
  schoolCode: string,
  teachers: Record<string, unknown>[] = [],
): { publicId: string; identifier: string } {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  const sequence = nextTeacherSequence(normalizedSchool, teachers);
  const identifier = `${TEACHER_PROFILE}-${String(sequence).padStart(4, "0")}`;
  return {
    publicId: `${normalizedSchool}-${identifier}`,
    identifier,
  };
}

export function resolveTeacherIdentifiers(
  item: Record<string, unknown>,
  schoolCode: string,
  teachers: Record<string, unknown>[] = [],
): { publicId: string; identifier: string } {
  const normalizedSchool = schoolCode.trim().toUpperCase();
  const existingPublicId = String(item.publicId ?? "").trim();

  if (existingPublicId) {
    const loginId = getTeacherLoginIdentifier(existingPublicId);
    const hasFullPrefix = existingPublicId.toUpperCase().startsWith(`${normalizedSchool}-`);
    return {
      publicId: hasFullPrefix ? existingPublicId : `${normalizedSchool}-${loginId}`,
      identifier: String(item.identifier ?? loginId),
    };
  }

  return generateTeacherIdentifiers(normalizedSchool, teachers);
}
