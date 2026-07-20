import {
  type StudentEnrollmentRecord,
} from "./studentEnrollment";
import {
  isActiveEnrollmentStatus,
  type StudentEnrollmentStatus,
} from "./studentEnrollmentStatus";
import { parseCivilDate } from "./studentWorkspaceDates";

/** Statuts affichables comme « inscription courante » (actifs + pipeline d'admission). */
const CURRENT_CANDIDATE_STATUSES: readonly StudentEnrollmentStatus[] = [
  "APPROVED",
  "ENROLLED",
  "SUSPENDED",
  "PRE_REGISTERED",
  "PENDING_REVIEW",
  "INCOMPLETE",
];

export interface SelectCurrentStudentEnrollmentInput {
  enrollments: readonly StudentEnrollmentRecord[];
  academicYear?: string | null;
  schoolCode?: string | null;
}

function isCurrentCandidateStatus(status: StudentEnrollmentStatus): boolean {
  return CURRENT_CANDIDATE_STATUSES.includes(status);
}

function matchesYear(
  enrollment: StudentEnrollmentRecord,
  academicYear: string,
): boolean {
  return Boolean(academicYear) && enrollment.academicYear.trim() === academicYear;
}

function matchesSchool(
  enrollment: StudentEnrollmentRecord,
  schoolCode: string,
): boolean {
  return (
    Boolean(schoolCode) &&
    enrollment.schoolCode.trim().toLowerCase() === schoolCode.toLowerCase()
  );
}

function getStatusPriority(status: StudentEnrollmentStatus): number {
  if (isActiveEnrollmentStatus(status)) return 2;
  if (isCurrentCandidateStatus(status)) return 1;
  return 0;
}

function compareAcademicYearDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

export function enrollmentRecencyScore(
  enrollment: StudentEnrollmentRecord,
): number {
  const candidates = [
    enrollment.enrolledAt,
    enrollment.validatedAt,
    enrollment.requestedAt,
    enrollment.updatedAt,
    enrollment.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const civil = parseCivilDate(candidate);
    if (civil) return civil.getTime();
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) return timestamp;
  }

  return 0;
}

/**
 * Comparateur lexicographique explicite :
 * année demandée → établissement → priorité de statut → récence → id.
 */
export function compareEnrollmentPriority(
  left: StudentEnrollmentRecord,
  right: StudentEnrollmentRecord,
  academicYear: string,
  schoolCode: string,
): number {
  const yearDelta =
    Number(matchesYear(right, academicYear)) -
    Number(matchesYear(left, academicYear));
  if (yearDelta !== 0) return yearDelta;

  const schoolDelta =
    Number(matchesSchool(right, schoolCode)) -
    Number(matchesSchool(left, schoolCode));
  if (schoolDelta !== 0) return schoolDelta;

  const statusDelta =
    getStatusPriority(right.status) - getStatusPriority(left.status);
  if (statusDelta !== 0) return statusDelta;

  const recencyDelta =
    enrollmentRecencyScore(right) - enrollmentRecencyScore(left);
  if (recencyDelta !== 0) return recencyDelta;

  return left.id.localeCompare(right.id);
}

/**
 * Sélection déterministe de l'inscription courante.
 * Priorité : année demandée → établissement → statut actif → date récente → id.
 */
export function selectCurrentStudentEnrollment({
  enrollments,
  academicYear = null,
  schoolCode = null,
}: SelectCurrentStudentEnrollmentInput): StudentEnrollmentRecord | null {
  if (enrollments.length === 0) {
    return null;
  }

  const year = String(academicYear ?? "").trim();
  const school = String(schoolCode ?? "").trim();

  const sorted = [...enrollments].sort((left, right) =>
    compareEnrollmentPriority(left, right, year, school),
  );

  const preferredActive = sorted.find(
    (enrollment) =>
      (!year || matchesYear(enrollment, year)) &&
      (!school || matchesSchool(enrollment, school)) &&
      isActiveEnrollmentStatus(enrollment.status),
  );

  if (preferredActive) {
    return preferredActive;
  }

  const preferredAdmission = sorted.find(
    (enrollment) =>
      (!year || matchesYear(enrollment, year)) &&
      (!school || matchesSchool(enrollment, school)) &&
      isCurrentCandidateStatus(enrollment.status),
  );

  if (preferredAdmission) {
    return preferredAdmission;
  }

  const activeAnyYear = sorted.find((enrollment) =>
    isActiveEnrollmentStatus(enrollment.status),
  );
  if (activeAnyYear) {
    return activeAnyYear;
  }

  return (
    sorted.find((enrollment) => isCurrentCandidateStatus(enrollment.status)) ??
    null
  );
}

/** Historique trié du plus récent au plus ancien (année, puis récence, puis id). */
export function sortEnrollmentHistory(
  enrollments: readonly StudentEnrollmentRecord[],
): StudentEnrollmentRecord[] {
  return [...enrollments].sort((left, right) => {
    const yearDelta = compareAcademicYearDesc(
      left.academicYear,
      right.academicYear,
    );
    if (yearDelta !== 0) return yearDelta;

    const recencyDelta =
      enrollmentRecencyScore(right) - enrollmentRecencyScore(left);
    if (recencyDelta !== 0) return recencyDelta;

    return left.id.localeCompare(right.id);
  });
}
