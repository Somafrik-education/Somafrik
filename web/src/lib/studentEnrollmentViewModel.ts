import {
  getEnrollmentSourceLabel,
  requiresClassWhenEnrolled,
  type StudentEnrollmentRecord,
  type StudentEnrollmentSource,
} from "./studentEnrollment";
import {
  getEnrollmentStatusPresentation,
  type EnrollmentStatusTone,
  type StudentEnrollmentStatus,
} from "./studentEnrollmentStatus";
import {
  selectCurrentStudentEnrollment,
  sortEnrollmentHistory,
} from "./studentEnrollmentSelection";
import { formatCivilDateLabel } from "./studentWorkspaceDates";

export interface StudentEnrollmentViewModel {
  id: string;
  academicYearLabel: string;
  schoolNameLabel: string;
  classLabel: string;
  programLabel: string;
  status: StudentEnrollmentStatus;
  statusLabel: string;
  statusTone: EnrollmentStatusTone;
  source: StudentEnrollmentSource;
  sourceLabel: string;
  applicationReferenceLabel: string;
  requestedAtLabel: string;
  validatedAtLabel: string;
  enrolledAtLabel: string;
  endedAtLabel: string;
  previousSchoolLabel: string;
  notesLabel: string;
  isCurrent: boolean;
  hasClass: boolean;
  hasApplicationReference: boolean;
  missingEnrolledAt: boolean;
  enrolledWithoutClass: boolean;
}

export type EnrollmentTimelineStepKey =
  | "request_received"
  | "dossier_review"
  | "validation"
  | "enrollment"
  | "class_assignment";

export type EnrollmentTimelineStepState =
  | "completed"
  | "current"
  | "upcoming";

export interface EnrollmentTimelineStep {
  key: EnrollmentTimelineStepKey;
  label: string;
  state: EnrollmentTimelineStepState;
}

const TIMELINE_LABELS: Record<EnrollmentTimelineStepKey, string> = {
  request_received: "Demande reçue",
  dossier_review: "Examen du dossier",
  validation: "Validation",
  enrollment: "Inscription",
  class_assignment: "Affectation en classe",
};

const ADMISSION_TIMELINE_STATUSES: readonly StudentEnrollmentStatus[] = [
  "PRE_REGISTERED",
  "PENDING_REVIEW",
  "INCOMPLETE",
  "APPROVED",
  "ENROLLED",
];

const MISSING_VALUE = "Non renseigné";
const MISSING_CLASS = "Classe non affectée";
const MISSING_PROGRAM = "Filière non renseignée";
const MISSING_DATE = "Date non renseignée";
const MISSING_SOURCE = "Origine non renseignée";
const MISSING_REFERENCE = "Aucune référence";

function normalizeLabel(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}

/**
 * Progression administrative dérivée explicitement du statut + classe.
 * Ne déduit pas une étape « terminée » par proximité approximative.
 */
export function buildEnrollmentTimeline(
  enrollment: StudentEnrollmentRecord | null,
): EnrollmentTimelineStep[] {
  if (!enrollment || !ADMISSION_TIMELINE_STATUSES.includes(enrollment.status)) {
    return [];
  }

  const hasClass = Boolean(enrollment.classId || enrollment.className);
  let current: EnrollmentTimelineStepKey | null = null;
  const completed = new Set<EnrollmentTimelineStepKey>();

  switch (enrollment.status) {
    case "PRE_REGISTERED":
      current = "request_received";
      break;
    case "PENDING_REVIEW":
    case "INCOMPLETE":
      completed.add("request_received");
      current = "dossier_review";
      break;
    case "APPROVED":
      completed.add("request_received");
      completed.add("dossier_review");
      current = "validation";
      break;
    case "ENROLLED":
      completed.add("request_received");
      completed.add("dossier_review");
      completed.add("validation");
      completed.add("enrollment");
      if (hasClass) {
        completed.add("class_assignment");
        current = null;
      } else {
        current = "class_assignment";
      }
      break;
    default:
      break;
  }

  const order: EnrollmentTimelineStepKey[] = [
    "request_received",
    "dossier_review",
    "validation",
    "enrollment",
    "class_assignment",
  ];

  return order.map((key) => {
    let state: EnrollmentTimelineStepState = "upcoming";
    if (completed.has(key)) state = "completed";
    else if (current === key) state = "current";
    return { key, label: TIMELINE_LABELS[key], state };
  });
}

export function buildStudentEnrollmentViewModel(
  enrollment: StudentEnrollmentRecord,
  options: { isCurrent?: boolean } = {},
): StudentEnrollmentViewModel {
  const presentation = getEnrollmentStatusPresentation(enrollment.status);
  const hasClass = Boolean(enrollment.classId || enrollment.className);
  const hasApplicationReference = Boolean(enrollment.applicationReference);

  return {
    id: enrollment.id,
    academicYearLabel: normalizeLabel(
      enrollment.academicYear,
      MISSING_VALUE,
    ),
    schoolNameLabel: normalizeLabel(enrollment.schoolName, MISSING_VALUE),
    classLabel: hasClass
      ? normalizeLabel(enrollment.className ?? enrollment.classId, MISSING_CLASS)
      : MISSING_CLASS,
    programLabel: normalizeLabel(enrollment.programName, MISSING_PROGRAM),
    status: enrollment.status,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    source: enrollment.source,
    sourceLabel: enrollment.source
      ? getEnrollmentSourceLabel(enrollment.source)
      : MISSING_SOURCE,
    applicationReferenceLabel: hasApplicationReference
      ? String(enrollment.applicationReference)
      : MISSING_REFERENCE,
    requestedAtLabel: formatCivilDateLabel(
      enrollment.requestedAt,
      MISSING_DATE,
    ),
    validatedAtLabel: formatCivilDateLabel(
      enrollment.validatedAt,
      MISSING_DATE,
    ),
    enrolledAtLabel: formatCivilDateLabel(
      enrollment.enrolledAt,
      MISSING_DATE,
    ),
    endedAtLabel: formatCivilDateLabel(enrollment.endedAt, MISSING_DATE),
    previousSchoolLabel: normalizeLabel(
      enrollment.previousSchoolName,
      MISSING_VALUE,
    ),
    notesLabel: normalizeLabel(enrollment.notes, MISSING_VALUE),
    isCurrent: Boolean(options.isCurrent),
    hasClass,
    hasApplicationReference,
    missingEnrolledAt:
      enrollment.status === "ENROLLED" && !enrollment.enrolledAt,
    enrolledWithoutClass: requiresClassWhenEnrolled(enrollment),
  };
}

export function buildStudentEnrollmentViewModels(input: {
  enrollments: readonly StudentEnrollmentRecord[];
  academicYear?: string | null;
  schoolCode?: string | null;
}): {
  currentEnrollment: StudentEnrollmentViewModel | null;
  enrollmentHistory: StudentEnrollmentViewModel[];
  timeline: EnrollmentTimelineStep[];
} {
  const current = selectCurrentStudentEnrollment({
    enrollments: input.enrollments,
    academicYear: input.academicYear,
    schoolCode: input.schoolCode,
  });

  const history = sortEnrollmentHistory(input.enrollments).map((enrollment) =>
    buildStudentEnrollmentViewModel(enrollment, {
      isCurrent: current?.id === enrollment.id,
    }),
  );

  return {
    currentEnrollment: current
      ? buildStudentEnrollmentViewModel(current, { isCurrent: true })
      : null,
    enrollmentHistory: history,
    timeline: buildEnrollmentTimeline(current),
  };
}
