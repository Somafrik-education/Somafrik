import type { StudentEnrollmentStatus } from "./studentDomain";
import type { StudentWorkspace } from "./studentWorkspaceService";

export interface StudentWorkspaceViewModel {
  studentId: string;
  displayName: string;
  matriculeLabel: string;
    genderLabel: string;
  birthDateLabel: string;
  birthPlaceLabel: string;
  nationalityLabel: string;
  phoneLabel: string;
  emailLabel: string;
  addressLabel: string;
  enrollmentStatus: StudentEnrollmentStatus | null;
  enrollmentStatusLabel: string;
  academicYearLabel: string;
  classLabel: string;
  hasGuardians: boolean;
  hasDocuments: boolean;
  hasMedicalProfile: boolean;
}

export interface BuildStudentWorkspaceViewModelOptions {
  missingValueLabel?: string;
  missingEnrollmentLabel?: string;
}

const DEFAULT_MISSING_VALUE_LABEL = "Non renseigné";
const DEFAULT_MISSING_ENROLLMENT_LABEL = "Non inscrit";

function normalizeLabel(value: string | null, fallback: string): string {
  const normalizedValue = value?.trim();
  return normalizedValue || fallback;
}
function formatDateLabel(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function buildStudentWorkspaceViewModel(
  workspace: StudentWorkspace,
  options: BuildStudentWorkspaceViewModelOptions = {},
): StudentWorkspaceViewModel {
  const missingValueLabel =
    options.missingValueLabel?.trim() || DEFAULT_MISSING_VALUE_LABEL;
  const missingEnrollmentLabel =
    options.missingEnrollmentLabel?.trim() ||
    DEFAULT_MISSING_ENROLLMENT_LABEL;
  const { overview } = workspace;

  return {
    studentId: overview.studentId,
    displayName: normalizeLabel(overview.fullName, missingValueLabel),
    matriculeLabel: normalizeLabel(overview.matricule, missingValueLabel),
      genderLabel: normalizeLabel(overview.gender, missingValueLabel),
  birthDateLabel: formatDateLabel(
    overview.birthDate,
    missingValueLabel,
  ),
  birthPlaceLabel: normalizeLabel(
    overview.birthPlace,
    missingValueLabel,
  ),
  nationalityLabel: normalizeLabel(
    overview.nationality,
    missingValueLabel,
  ),
  phoneLabel: normalizeLabel(overview.phone, missingValueLabel),
  emailLabel: normalizeLabel(overview.email, missingValueLabel),
  addressLabel: normalizeLabel(overview.address, missingValueLabel),
    enrollmentStatus: overview.enrollmentStatus,
    enrollmentStatusLabel:
      overview.enrollmentStatus ?? missingEnrollmentLabel,
    academicYearLabel: normalizeLabel(
      overview.currentAcademicYear,
      missingValueLabel,
    ),
    classLabel: normalizeLabel(
      overview.currentClassName,
      missingValueLabel,
    ),
    hasGuardians: overview.hasGuardians,
    hasDocuments: overview.hasDocuments,
    hasMedicalProfile: overview.hasMedicalProfile,
  };
}
