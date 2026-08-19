const TEACHER_PROFILE = "ENS";
const STUDENT_CANONICAL_RE = /^([A-Z]{2})-([A-Z0-9]{2,5})-EL-([0-9]{2})-([0-9]{3})$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse le code public V2 `{ISO}-{INITIALES}-{YY}-{SEQ3}` (ex. CD-IN-26-001). */
export function parseSchoolCodeSegments(schoolCode: string): {
  country: string;
  year: string;
  establishment: string;
  yearIndex: string;
} {
  const normalized = schoolCode.trim().toUpperCase();
  const v2 = /^([A-Z]{2})-([A-Z0-9]{2,5})-(\d{2})-(\d{3})$/.exec(normalized);
  if (v2) {
    const country = v2[1];
    const initials = v2[2];
    const yy = v2[3];
    const seq = v2[4];
    const fullYear = String(2000 + Number.parseInt(yy, 10));
    return {
      country,
      year: fullYear,
      establishment: initials,
      yearIndex: seq.padStart(4, "0"),
    };
  }
  return {
    country: "",
    year: "0000",
    establishment: "",
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
export function generateStudentMatricule(): string {
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

/** Identifiant complet : {login_code}-{ENS-n°} (ex. CD-IN-26-001-ENS-0001). */
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
