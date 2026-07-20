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

function compareAcademicYearDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function enrollmentRecencyScore(enrollment: StudentEnrollmentRecord): number {
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

function rankEnrollment(
  enrollment: StudentEnrollmentRecord,
  academicYear: string,
  schoolCode: string,
): number {
  let score = 0;

  if (
    academicYear &&
    enrollment.academicYear.trim() === academicYear.trim()
  ) {
    score += 1_000_000;
  }

  if (
    schoolCode &&
    enrollment.schoolCode.trim().toLowerCase() === schoolCode.trim().toLowerCase()
  ) {
    score += 100_000;
  }

  if (isActiveEnrollmentStatus(enrollment.status)) {
    score += 10_000;
  } else if (isCurrentCandidateStatus(enrollment.status)) {
    score += 5_000;
  }

  score += Math.min(enrollmentRecencyScore(enrollment) / 1_000, 9_999);

  return score;
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

  const sorted = [...enrollments].sort((left, right) => {
    const rankDelta =
      rankEnrollment(right, year, school) - rankEnrollment(left, year, school);
    if (rankDelta !== 0) return rankDelta;

    const yearDelta = compareAcademicYearDesc(
      left.academicYear,
      right.academicYear,
    );
    if (yearDelta !== 0) return yearDelta;

    return left.id.localeCompare(right.id);
  });

  const preferredActive = sorted.find(
    (enrollment) =>
      (!year || enrollment.academicYear.trim() === year) &&
      (!school ||
        enrollment.schoolCode.trim().toLowerCase() === school.toLowerCase()) &&
      isActiveEnrollmentStatus(enrollment.status),
  );

  if (preferredActive) {
    return preferredActive;
  }

  const preferredAdmission = sorted.find(
    (enrollment) =>
      (!year || enrollment.academicYear.trim() === year) &&
      (!school ||
        enrollment.schoolCode.trim().toLowerCase() === school.toLowerCase()) &&
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
