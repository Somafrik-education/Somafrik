import type { StudentStatus } from "./studentDomain";
import type { StudentEnrollmentStatus } from "./studentEnrollmentStatus";
import { getEnrollmentStatusPresentation } from "./studentEnrollmentStatus";
import type { StudentWorkspace } from "./studentWorkspaceService";
import {
  formatAgeLabel,
  formatCivilDateLabel,
} from "./studentWorkspaceDates";
import {
  buildStudentWorkspaceAlerts,
  type StudentWorkspaceAlert,
} from "./studentWorkspaceAlerts";
import {
  buildStudentEnrollmentViewModels,
  type EnrollmentTimelineStep,
  type StudentEnrollmentViewModel,
} from "./studentEnrollmentViewModel";
import {
  buildStudentGuardiansModuleViewModel,
  type StudentGuardianViewModel,
  type StudentGuardiansModuleViewModel,
} from "./studentGuardianViewModel";
import { buildStudentMedicalViewModel } from "./studentMedicalViewModel";
import type { StudentMedicalViewModel } from "./studentMedicalViewModel";
import { buildStudentDocumentViewModel } from "./studentDocumentsViewModel";
import type { StudentDocumentViewModel } from "./studentDocumentsViewModel";
import { buildStudentHistoryViewModel } from "./studentHistoryViewModel";
import type { StudentHistoryViewModel } from "./studentHistoryViewModel";

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
  ageLabel: string;
  enrollmentStatus: StudentEnrollmentStatus | null;
  enrollmentStatusLabel: string;
  enrollmentDateLabel: string;
  academicYearLabel: string;
  classLabel: string;
  schoolNameLabel: string;
  studentStatus: StudentStatus | null;
  isActive: boolean;
  activeStatusLabel: string;
  guardiansCount: number;
  guardiansCountLabel: string;
  primaryGuardianNameLabel: string;
  primaryGuardianPhoneLabel: string;
  hasGuardians: boolean;
  hasDocuments: boolean;
  hasMedicalProfile: boolean;
  alerts: StudentWorkspaceAlert[];
  currentEnrollment: StudentEnrollmentViewModel | null;
  enrollmentHistory: StudentEnrollmentViewModel[];
  enrollmentTimeline: EnrollmentTimelineStep[];
  primaryGuardian: StudentGuardianViewModel | null;
  guardians: StudentGuardianViewModel[];
  emergencyContacts: StudentGuardianViewModel[];
  pickupAuthorizedGuardians: StudentGuardianViewModel[];
  financialResponsibles: StudentGuardianViewModel[];
  guardiansModule: StudentGuardiansModuleViewModel;
  medical: StudentMedicalViewModel;
  documentsModule: StudentDocumentViewModel;
  historyModule: StudentHistoryViewModel;
}

export interface BuildStudentWorkspaceViewModelOptions {
  missingValueLabel?: string;
  missingEnrollmentLabel?: string;
  missingGuardiansLabel?: string;
  referenceDate?: Date;
}

const DEFAULT_MISSING_VALUE_LABEL = "Non renseigné";
const DEFAULT_MISSING_ENROLLMENT_LABEL = "Aucune inscription active";
const DEFAULT_MISSING_GUARDIANS_LABEL = "Aucun responsable associé";

function normalizeLabel(value: string | null, fallback: string): string {
  const normalizedValue = value?.trim();
  return normalizedValue || fallback;
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
  const missingGuardiansLabel =
    options.missingGuardiansLabel?.trim() || DEFAULT_MISSING_GUARDIANS_LABEL;
  const { overview } = workspace;

  const enrollmentModels = buildStudentEnrollmentViewModels({
    enrollments: workspace.enrollments,
    academicYear: overview.currentAcademicYear ?? undefined,
    schoolCode: overview.schoolCode,
  });

  const guardiansModule = buildStudentGuardiansModuleViewModel(
    workspace.guardians,
  );

  const medical = buildStudentMedicalViewModel(workspace.medical, {
    missingValueLabel,
    // Bridge Élèves:READ / personnel : STAFF uniquement (pas de notes MEDICAL).
    allowedVisibility: ["STAFF"],
  });

  const documentsModule = buildStudentDocumentViewModel(workspace.documents, {
    missingValueLabel,
    // Bridge administratif : STAFF + ADMIN pour la conformité du dossier.
    allowedVisibility: ["STAFF", "ADMIN"],
  });

  const historyModule = buildStudentHistoryViewModel(workspace.history, {
    missingValueLabel,
    allowedVisibility: ["STAFF", "ADMIN"],
    referenceDate: options.referenceDate,
  });

  const statusPresentation = getEnrollmentStatusPresentation(
    overview.enrollmentStatus,
  );

  return {
    studentId: overview.studentId,
    displayName: normalizeLabel(overview.fullName, missingValueLabel),
    matriculeLabel: normalizeLabel(overview.matricule, missingValueLabel),
    genderLabel: normalizeLabel(overview.gender, missingValueLabel),
    birthDateLabel: formatCivilDateLabel(
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
    ageLabel: formatAgeLabel(
      overview.birthDate,
      missingValueLabel,
      options.referenceDate,
    ),
    enrollmentStatus: overview.enrollmentStatus,
    enrollmentStatusLabel: overview.enrollmentStatus
      ? statusPresentation.label
      : missingEnrollmentLabel,
    enrollmentDateLabel: formatCivilDateLabel(
      overview.enrollmentDate,
      missingValueLabel,
    ),
    academicYearLabel: normalizeLabel(
      overview.currentAcademicYear,
      missingValueLabel,
    ),
    classLabel: normalizeLabel(
      overview.currentClassName,
      missingValueLabel,
    ),
    schoolNameLabel: normalizeLabel(overview.schoolName, missingValueLabel),
    studentStatus: overview.studentStatus,
    isActive: overview.isActive,
    activeStatusLabel: overview.isActive ? "Actif" : "Inactif",
    guardiansCount: overview.guardiansCount,
    guardiansCountLabel:
      overview.guardiansCount > 0
        ? String(overview.guardiansCount)
        : missingGuardiansLabel,
    primaryGuardianNameLabel: normalizeLabel(
      overview.primaryGuardianName,
      missingGuardiansLabel,
    ),
    primaryGuardianPhoneLabel: normalizeLabel(
      overview.primaryGuardianPhone,
      missingValueLabel,
    ),
    hasGuardians: overview.hasGuardians,
    hasDocuments: overview.hasDocuments,
    hasMedicalProfile: overview.hasMedicalProfile,
    alerts: buildStudentWorkspaceAlerts(overview),
    currentEnrollment: enrollmentModels.currentEnrollment,
    enrollmentHistory: enrollmentModels.enrollmentHistory,
    enrollmentTimeline: enrollmentModels.timeline,
    primaryGuardian: guardiansModule.primaryGuardian,
    guardians: guardiansModule.guardians,
    emergencyContacts: guardiansModule.emergencyContacts,
    pickupAuthorizedGuardians: guardiansModule.pickupAuthorizedGuardians,
    financialResponsibles: guardiansModule.financialResponsibles,
    guardiansModule,
    medical,
    documentsModule,
    historyModule,
  };
}
