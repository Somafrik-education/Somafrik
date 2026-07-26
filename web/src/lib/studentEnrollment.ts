import type { Student, StudentEnrollment as DomainStudentEnrollment } from "./studentDomain";
import {
  isActiveEnrollmentStatus,
  normalizeStudentEnrollmentStatus,
  type StudentEnrollmentStatus,
} from "./studentEnrollmentStatus";
import { parseCivilDate } from "./studentWorkspaceDates";

export type {
  StudentEnrollmentStatus,
  EnrollmentStatusTone,
  EnrollmentStatusPresentation,
} from "./studentEnrollmentStatus";

export type StudentEnrollmentSource =
  | "PUBLIC_WEBSITE"
  | "SCHOOL_ADMINISTRATION"
  | "IMPORT"
  | "MOBILE"
  | "PARTNER_API"
  | "MIGRATION";

export const STUDENT_ENROLLMENT_SOURCES = [
  "PUBLIC_WEBSITE",
  "SCHOOL_ADMINISTRATION",
  "IMPORT",
  "MOBILE",
  "PARTNER_API",
  "MIGRATION",
] as const satisfies readonly StudentEnrollmentSource[];

const SOURCE_LABELS: Record<StudentEnrollmentSource, string> = {
  PUBLIC_WEBSITE: "Préinscription en ligne",
  SCHOOL_ADMINISTRATION: "Administration",
  IMPORT: "Import",
  MOBILE: "Application mobile",
  PARTNER_API: "API partenaire",
  MIGRATION: "Migration",
};

/**
 * Modèle métier d'inscription annuelle (C1.2).
 * Une inscription appartient à un élève + établissement + année scolaire.
 */
export interface StudentEnrollmentRecord {
  id: string;
  studentId: string;
  schoolCode: string;
  academicYear: string;

  classId: string | null;
  className: string | null;
  programId: string | null;
  programName: string | null;

  status: StudentEnrollmentStatus;
  source: StudentEnrollmentSource;

  applicationReference: string | null;

  requestedAt: string | null;
  enrolledAt: string | null;
  validatedAt: string | null;
  endedAt: string | null;

  /** C1.8b — champs structurés de fin d'inscription. */
  transferDate: string | null;
  destinationSchoolName: string | null;
  closureDate: string | null;

  previousSchoolName: string | null;
  notes: string | null;

  schoolName: string | null;

  createdAt: string;
  updatedAt: string;
}

export type FutureStudentEnrollmentPermission =
  | "student.enrollments.read"
  | "student.enrollments.create"
  | "student.enrollments.update"
  | "student.enrollments.validate"
  | "student.enrollments.assign-class"
  | "student.enrollments.transfer"
  | "student.enrollments.close";

export const FUTURE_STUDENT_ENROLLMENT_PERMISSIONS: readonly FutureStudentEnrollmentPermission[] =
  [
    "student.enrollments.read",
    "student.enrollments.create",
    "student.enrollments.update",
    "student.enrollments.validate",
    "student.enrollments.assign-class",
    "student.enrollments.transfer",
    "student.enrollments.close",
  ];

function normalizeOptional(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function isStudentEnrollmentSource(
  value: unknown,
): value is StudentEnrollmentSource {
  return (
    typeof value === "string" &&
    (STUDENT_ENROLLMENT_SOURCES as readonly string[]).includes(value)
  );
}

export function normalizeStudentEnrollmentSource(
  value: unknown,
): StudentEnrollmentSource {
  if (isStudentEnrollmentSource(value)) {
    return value;
  }

  const folded = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!folded) return "SCHOOL_ADMINISTRATION";
  if (folded.includes("public") || folded.includes("vitrine") || folded.includes("website")) {
    return "PUBLIC_WEBSITE";
  }
  if (folded.includes("import")) return "IMPORT";
  if (folded.includes("mobile")) return "MOBILE";
  if (folded.includes("partner") || folded.includes("api")) return "PARTNER_API";
  if (folded.includes("migr")) return "MIGRATION";
  return "SCHOOL_ADMINISTRATION";
}

export function getEnrollmentSourceLabel(
  source: StudentEnrollmentSource | null | undefined,
): string {
  if (!source) return "Origine non renseignée";
  return SOURCE_LABELS[source];
}

export function listEnrollmentSourceLabels(): Record<
  StudentEnrollmentSource,
  string
> {
  return { ...SOURCE_LABELS };
}

function resolveProgramName(
  enrollment: DomainStudentEnrollment,
): string | null {
  return (
    normalizeOptional(
      (enrollment as DomainStudentEnrollment & { programName?: string })
        .programName,
    ) ??
    normalizeOptional(enrollment.trackName) ??
    normalizeOptional(enrollment.optionName) ??
    normalizeOptional(enrollment.levelName)
  );
}

function resolveProgramId(
  enrollment: DomainStudentEnrollment,
): string | null {
  return (
    normalizeOptional(
      (enrollment as DomainStudentEnrollment & { programId?: string }).programId,
    ) ??
    normalizeOptional(enrollment.trackId) ??
    normalizeOptional(enrollment.optionId) ??
    normalizeOptional(enrollment.levelId)
  );
}

/**
 * Convertit une inscription domaine (éventuellement partielle / legacy)
 * vers le modèle métier C1.2.
 */
export function toStudentEnrollmentRecord(
  enrollment: DomainStudentEnrollment,
  options: { schoolName?: string | null } = {},
): StudentEnrollmentRecord {
  const raw = enrollment as DomainStudentEnrollment & {
    source?: unknown;
    applicationReference?: unknown;
    requestedAt?: unknown;
    enrolledAt?: unknown;
    validatedAt?: unknown;
    endedAt?: unknown;
    transferDate?: unknown;
    destinationSchoolName?: unknown;
    closureDate?: unknown;
    notes?: unknown;
    previousSchoolName?: unknown;
  };

  const enrolledAt =
    normalizeOptional(raw.enrolledAt) ??
    normalizeOptional(enrollment.enrollmentDate) ??
    normalizeOptional(enrollment.startDate);

  const endedAt =
    normalizeOptional(raw.endedAt) ?? normalizeOptional(enrollment.endDate);

  const createdAt =
    normalizeOptional(enrollment.createdAt) ??
    enrolledAt ??
    new Date(0).toISOString();
  const updatedAt = normalizeOptional(enrollment.updatedAt) ?? createdAt;

  const source = normalizeStudentEnrollmentSource(raw.source);
  const applicationReference = normalizeOptional(raw.applicationReference);

  return {
    id: enrollment.id,
    studentId: enrollment.studentId,
    schoolCode: enrollment.schoolCode,
    academicYear: enrollment.academicYear,
    classId: normalizeOptional(enrollment.classId),
    className: normalizeOptional(enrollment.className),
    programId: resolveProgramId(enrollment),
    programName: resolveProgramName(enrollment),
    status: normalizeStudentEnrollmentStatus(enrollment.status),
    source,
    applicationReference,
    requestedAt: normalizeOptional(raw.requestedAt),
    enrolledAt,
    validatedAt: normalizeOptional(raw.validatedAt),
    endedAt,
    transferDate: normalizeOptional(raw.transferDate),
    destinationSchoolName: normalizeOptional(raw.destinationSchoolName),
    closureDate: normalizeOptional(raw.closureDate),
    previousSchoolName:
      normalizeOptional(raw.previousSchoolName) ??
      normalizeOptional(enrollment.previousSchool),
    notes:
      normalizeOptional(raw.notes) ??
      normalizeOptional(enrollment.exitReason),
    schoolName: normalizeOptional(options.schoolName),
    createdAt,
    updatedAt,
  };
}

/**
 * Pont compatibilité : dérive une inscription annuelle depuis la fiche élève legacy
 * lorsque `studentEnrollments` est vide ou incomplet.
 */
export function deriveEnrollmentFromLegacyStudent(
  student: Student,
  options: { schoolName?: string | null } = {},
): StudentEnrollmentRecord | null {
  const academicYear = normalizeOptional(student.schoolYear);
  const className = normalizeOptional(student.className);
  const schoolStatus = normalizeOptional(student.schoolStatus);
  const enrollmentDate = normalizeOptional(student.enrollmentDate);

  if (!academicYear && !className && !schoolStatus && !enrollmentDate) {
    return null;
  }

  const year = academicYear ?? "N/A";
  const schoolCode = String(student.schoolCode ?? "").trim();
  const id = ["ENROLLMENT", student.id, schoolCode, year]
    .filter(Boolean)
    .join("-");

  return {
    id,
    studentId: student.id,
    schoolCode,
    academicYear: year === "N/A" ? "" : year,
    classId: null,
    className,
    programId: null,
    programName: null,
    status: normalizeStudentEnrollmentStatus(schoolStatus, {
      // Fiche élève historique sans statut : conserver le comportement « Inscrit ».
      fallback: "ENROLLED",
    }),
    source: "MIGRATION",
    applicationReference: null,
    requestedAt: null,
    enrolledAt: enrollmentDate,
    validatedAt: null,
    endedAt: normalizeOptional(student.exitDate),
    transferDate: null,
    destinationSchoolName: null,
    closureDate: null,
    previousSchoolName: normalizeOptional(student.previousSchool),
    notes: normalizeOptional(student.observations),
    schoolName: normalizeOptional(options.schoolName),
    createdAt: normalizeOptional(student.createdAt) ?? enrollmentDate ?? new Date(0).toISOString(),
    updatedAt: normalizeOptional(student.updatedAt) ?? enrollmentDate ?? new Date(0).toISOString(),
  };
}

export function collectStudentEnrollmentRecords(input: {
  student: Student;
  enrollments?: readonly DomainStudentEnrollment[];
  schoolName?: string | null;
}): StudentEnrollmentRecord[] {
  const { student, enrollments = [], schoolName = null } = input;
  const fromDomain = enrollments
    .filter((enrollment) => enrollment.studentId === student.id)
    .map((enrollment) => toStudentEnrollmentRecord(enrollment, { schoolName }));

  if (fromDomain.length > 0) {
    return fromDomain;
  }

  const legacy = deriveEnrollmentFromLegacyStudent(student, { schoolName });
  return legacy ? [legacy] : [];
}

export interface EnrollmentDateConsistencyResult {
  ok: boolean;
  violations: string[];
}

/** Vérifie requestedAt ≤ validatedAt ≤ enrolledAt ≤ endedAt (dates présentes uniquement). */
export function validateEnrollmentDateOrder(
  enrollment: Pick<
    StudentEnrollmentRecord,
    "requestedAt" | "validatedAt" | "enrolledAt" | "endedAt"
  >,
): EnrollmentDateConsistencyResult {
  const sequence: Array<{ key: string; value: string | null }> = [
    { key: "requestedAt", value: enrollment.requestedAt },
    { key: "validatedAt", value: enrollment.validatedAt },
    { key: "enrolledAt", value: enrollment.enrolledAt },
    { key: "endedAt", value: enrollment.endedAt },
  ];

  const present = sequence
    .map((item) => ({
      key: item.key,
      date: item.value ? parseCivilDate(item.value) : null,
      raw: item.value,
    }))
    .filter((item) => item.raw && item.date);

  const violations: string[] = [];
  for (let index = 1; index < present.length; index += 1) {
    const previous = present[index - 1];
    const current = present[index];
    if (
      previous.date &&
      current.date &&
      previous.date.getTime() > current.date.getTime()
    ) {
      violations.push(`${previous.key} > ${current.key}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

export function findDuplicateActiveEnrollments(
  enrollments: readonly StudentEnrollmentRecord[],
): StudentEnrollmentRecord[][] {
  const groups = new Map<string, StudentEnrollmentRecord[]>();

  for (const enrollment of enrollments) {
    if (!isActiveEnrollmentStatus(enrollment.status)) continue;
    const key = [
      enrollment.studentId,
      enrollment.schoolCode.trim().toLowerCase(),
      enrollment.academicYear.trim(),
    ].join("|");
    const bucket = groups.get(key) ?? [];
    bucket.push(enrollment);
    groups.set(key, bucket);
  }

  return [...groups.values()].filter((group) => group.length > 1);
}

export function assertSingleActiveEnrollmentPerYear(
  enrollments: readonly StudentEnrollmentRecord[],
): { ok: boolean; duplicates: StudentEnrollmentRecord[][] } {
  const duplicates = findDuplicateActiveEnrollments(enrollments);
  return { ok: duplicates.length === 0, duplicates };
}

export function isClassOptionalForStatus(
  status: StudentEnrollmentStatus,
): boolean {
  return (
    status === "PRE_REGISTERED" ||
    status === "PENDING_REVIEW" ||
    status === "INCOMPLETE" ||
    status === "APPROVED" ||
    status === "REJECTED"
  );
}

export function requiresClassWhenEnrolled(
  enrollment: Pick<StudentEnrollmentRecord, "status" | "classId" | "className">,
): boolean {
  return (
    enrollment.status === "ENROLLED" &&
    !enrollment.classId &&
    !enrollment.className
  );
}
