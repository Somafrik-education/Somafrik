const TEACHER_PROFILE = "ENS";
const STUDENT_CANONICAL_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-EL-([0-9]{2})-([0-9]{3})$/;
const SCHOOL_YEAR_BASE = 2025;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSchoolCodeSegments(schoolCode: string): {
  country: string;
  year: string;
  establishment: string;
  yearIndex: string;
} {
  const normalized = schoolCode.trim().toUpperCase();
  const match = /^([A-Z]{2})-(\d{4})-(\d{4})$/.exec(normalized);
  if (match) {
    const country = match[1];
    const year = match[2];
    const establishment = match[3];
    const yearIndex = Math.max(1, Number.parseInt(year, 10) - SCHOOL_YEAR_BASE);
    return {
      country,
      year,
      establishment,
      yearIndex: String(yearIndex).padStart(4, "0"),
    };
  }
  const digits = normalized.replace(/\D/g, "");
  return {
    country: "",
    year: (digits.slice(0, 4) || "0000").padStart(4, "0").slice(-4),
    establishment: (digits.slice(-4) || "0000").padStart(4, "0"),
    yearIndex: "0001",
  };
}

export function isStudentCanonicalCode(value: string): boolean {
  return STUDENT_CANONICAL_RE.test(String(value ?? "").trim().toUpperCase());
}

export function isLegacyStudentMatricule(value: string): boolean {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return true;
  return !isStudentCanonicalCode(normalized);
}

/** Matricule élève = identifiant de connexion. Généré uniquement par PostgreSQL. */
export function generateStudentMatricule(
  _schoolCode: string,
  _students: Record<string, unknown>[] = [],
): string {
  throw new Error(
    "Le matricule élève est attribué par PostgreSQL (CD-IN-EL-26-001). Pas de générateur Web.",
  );
}

/** Identifiant de connexion élève = matricule canonique. */
export function getStudentLoginIdentifier(matriculeOrIdentifier: string): string {
  const value = String(matriculeOrIdentifier ?? "").trim().toUpperCase();
  return value;
}

export function resolveStudentMatricule(
  item: Record<string, unknown>,
  _schoolCode: string,
  _students: Record<string, unknown>[] = [],
): { matricule: string; publicId: string; loginIdentifier: string } {
  const existing = String(
    item.loginCode ?? item.identityCode ?? item.matricule ?? item.studentCode ?? item.publicId ?? "",
  )
    .trim()
    .toUpperCase();
  if (!existing || isLegacyStudentMatricule(existing)) {
    return { matricule: "", publicId: "", loginIdentifier: "" };
  }
  return {
    matricule: existing,
    publicId: existing,
    loginIdentifier: existing,
  };
}

/** Plus de réparation côté client : PostgreSQL est l'autorité. */
export function repairStudentMatricules(
  students: Record<string, unknown>[],
  _schoolCode?: string,
): Record<string, unknown>[] {
  return students;
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
