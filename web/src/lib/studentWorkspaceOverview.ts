import {
  type Guardian,
  type Person,
  type Student,
  type StudentDocument,
  type StudentEnrollment,
  type StudentEnrollmentStatus,
  type StudentGuardianRelation,
  type StudentMedicalProfile,
  type StudentStatus,
} from "./studentDomain";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import {
  findDuplicateActiveEnrollments,
} from "./studentEnrollment";
import { selectCurrentStudentEnrollment } from "./studentEnrollmentSelection";
import type { StudentGuardianRelationRecord } from "./studentGuardian";
import {
  diagnoseGuardianRelations,
  selectPrimaryGuardian,
} from "./studentGuardianSelection";
import {
  diagnoseMedicalRecord,
  toStudentMedicalRecord,
  type StudentMedicalRecord,
} from "./studentMedical";

export interface StudentWorkspaceOverview {
  studentId: string;
  fullName: string;
  matricule: string | null;
  gender: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  nationality: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  enrollmentStatus: StudentEnrollmentStatus | null;
  enrollmentDate: string | null;
  currentAcademicYear: string | null;
  currentClassId: string | null;
  currentClassName: string | null;
  schoolCode: string | null;
  schoolName: string | null;
  studentStatus: StudentStatus | null;
  isActive: boolean;
  guardiansCount: number;
  primaryGuardianName: string | null;
  primaryGuardianPhone: string | null;
  hasGuardians: boolean;
  hasDocuments: boolean;
  hasMedicalProfile: boolean;
  /** Champs C1.2 pour alertes inscription. */
  hasActiveEnrollment: boolean;
  enrollmentIsIncomplete: boolean;
  enrollmentApprovedWithoutClass: boolean;
  enrollmentActiveWithoutDate: boolean;
  hasDuplicateActiveEnrollments: boolean;
  enrollmentYearMismatch: boolean;
  /** Champs C1.3 pour alertes responsables. */
  hasLegalGuardian: boolean;
  hasGuardianPhone: boolean;
  hasEmergencyContact: boolean;
  hasFinancialResponsible: boolean;
  multiplePriorityOneGuardians: boolean;
  multipleFinancialResponsibles: boolean;
  hasExpiredGuardianRelation: boolean;
  /** Champs C1.4 pour alertes médicales. */
  hasCriticalAllergy: boolean;
  hasCriticalCondition: boolean;
  hasPhysician: boolean;
  hasBloodType: boolean;
  hasMedicalUpdate: boolean;
}

export interface BuildStudentWorkspaceOverviewInput {
  student: Student;
  person?: Person | null;
  academicYear: string;
  schoolName?: string | null;
  enrollments?: readonly StudentEnrollment[];
  enrollmentRecords?: readonly StudentEnrollmentRecord[];
  guardianRecords?: readonly StudentGuardianRelationRecord[];
  guardians?: readonly Guardian[];
  guardianRelations?: readonly StudentGuardianRelation[];
  persons?: readonly Person[];
  documents?: readonly StudentDocument[];
  medicalProfile?: StudentMedicalProfile | null;
  medicalRecord?: StudentMedicalRecord | null;
}

function buildStudentFullName(
  student: Student,
  person?: Person | null,
): string {
  const parts = [
    person?.lastName ?? student.lastName ?? student.name,
    person?.firstName ?? student.firstName,
    person?.middleName,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);

  return parts.join(" ");
}

function buildPersonFullName(person?: Person | null): string | null {
  if (!person) return null;
  const parts = [person.lastName, person.firstName, person.middleName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeOptionalValue(value: unknown): string | null {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || null;
}

function resolveActiveGuardianRelations(
  studentId: string,
  guardianRelations: readonly StudentGuardianRelation[],
): StudentGuardianRelation[] {
  return guardianRelations.filter(
    (relation) =>
      relation.studentId === studentId && relation.status !== "Inactif",
  );
}

function resolvePrimaryGuardianRelation(
  relations: readonly StudentGuardianRelation[],
): StudentGuardianRelation | undefined {
  return (
    relations.find((relation) => relation.isPrimaryContact) ??
    [...relations].sort(
      (left, right) => (left.priority ?? 999) - (right.priority ?? 999),
    )[0]
  );
}

function resolveStudentIsActive(student: Student): boolean {
  if (student.archived) return false;
  const status = String(student.status ?? "").trim().toLowerCase();
  if (!status) return true;
  return ![
    "inactif",
    "archivé",
    "archivÃ©",
    "sorti",
    "transféré",
    "transfÃ©rÃ©",
  ].includes(status);
}

export function buildStudentWorkspaceOverview({
  student,
  person,
  academicYear,
  schoolName = null,
  enrollmentRecords = [],
  guardianRecords = [],
  guardians = [],
  guardianRelations = [],
  persons = [],
  documents = [],
  medicalProfile = null,
  medicalRecord = null,
}: BuildStudentWorkspaceOverviewInput): StudentWorkspaceOverview {
  const currentEnrollment = selectCurrentStudentEnrollment({
    enrollments: enrollmentRecords,
    academicYear,
    schoolCode: student.schoolCode,
  });

  const resolvedGuardianRecords = guardianRecords;
  const primaryFromRecords = selectPrimaryGuardian(resolvedGuardianRecords);
  const guardianDiagnostics = diagnoseGuardianRelations(resolvedGuardianRecords);

  // Repli compat si aucun record C1.3 n'est fourni.
  const activeRelations = resolveActiveGuardianRelations(
    student.id,
    guardianRelations,
  );
  const primaryRelation = resolvePrimaryGuardianRelation(activeRelations);
  const primaryGuardian = primaryRelation
    ? guardians.find((guardian) => guardian.id === primaryRelation.guardianId)
    : undefined;
  const primaryGuardianPerson = primaryGuardian?.personId
    ? persons.find((candidate) => candidate.id === primaryGuardian.personId)
    : undefined;

  const primaryGuardianName =
    primaryFromRecords?.displayName ??
    buildPersonFullName(primaryGuardianPerson);
  const primaryGuardianPhone =
    primaryFromRecords?.phone ??
    normalizeOptionalValue(primaryGuardianPerson?.phone);

  const activeGuardianCount =
    resolvedGuardianRecords.length > 0
      ? resolvedGuardianRecords.filter((relation) => relation.isActive).length
      : activeRelations.length;

  const duplicates = findDuplicateActiveEnrollments(enrollmentRecords);
  const hasActiveEnrollment = Boolean(currentEnrollment);
  const enrollmentIsIncomplete =
    currentEnrollment?.status === "INCOMPLETE";
  const enrollmentApprovedWithoutClass =
    currentEnrollment?.status === "APPROVED" &&
    !currentEnrollment.classId &&
    !currentEnrollment.className;
  const enrollmentActiveWithoutDate =
    Boolean(currentEnrollment) &&
    (currentEnrollment?.status === "ENROLLED" ||
      currentEnrollment?.status === "APPROVED") &&
    !currentEnrollment?.enrolledAt;
  const enrollmentYearMismatch = Boolean(
    currentEnrollment &&
      academicYear.trim() &&
      currentEnrollment.academicYear.trim() &&
      currentEnrollment.academicYear.trim() !== academicYear.trim(),
  );

  const resolvedMedicalRecord =
    medicalRecord ??
    toStudentMedicalRecord(medicalProfile, student.id);
  const medicalDiagnostics = diagnoseMedicalRecord(resolvedMedicalRecord);

  return {
    studentId: student.id,
    fullName: buildStudentFullName(student, person),
    matricule: student.matricule.trim() || null,
    gender: normalizeOptionalValue(person?.gender ?? student.gender),
    birthDate: normalizeOptionalValue(person?.birthDate ?? student.birthDate),
    birthPlace: normalizeOptionalValue(person?.birthPlace),
    nationality: normalizeOptionalValue(person?.nationality),
    phone: normalizeOptionalValue(person?.phone ?? student.phone),
    email: normalizeOptionalValue(person?.email ?? student.email),
    address: normalizeOptionalValue(person?.address),
    enrollmentStatus: currentEnrollment?.status ?? null,
    enrollmentDate: normalizeOptionalValue(
      currentEnrollment?.enrolledAt ??
        student.admissionDate ??
        student.enrollmentDate,
    ),
    currentAcademicYear:
      currentEnrollment?.academicYear ??
      normalizeOptionalValue(academicYear),
    currentClassId: currentEnrollment?.classId ?? null,
    currentClassName: currentEnrollment?.className ?? null,
    schoolCode: normalizeOptionalValue(student.schoolCode),
    schoolName: normalizeOptionalValue(schoolName),
    studentStatus: student.status ?? null,
    isActive: resolveStudentIsActive(student),
    guardiansCount: activeGuardianCount,
    primaryGuardianName: normalizeOptionalValue(primaryGuardianName),
    primaryGuardianPhone,
    hasGuardians: activeGuardianCount > 0,
    hasDocuments: documents.some(
      (document) => document.studentId === student.id,
    ),
    hasMedicalProfile: resolvedMedicalRecord.hasProfile,
    hasActiveEnrollment,
    enrollmentIsIncomplete,
    enrollmentApprovedWithoutClass,
    enrollmentActiveWithoutDate,
    hasDuplicateActiveEnrollments: duplicates.length > 0,
    enrollmentYearMismatch,
    hasLegalGuardian: guardianDiagnostics.hasLegalGuardian,
    hasGuardianPhone: guardianDiagnostics.hasPhone,
    hasEmergencyContact: guardianDiagnostics.hasEmergencyContact,
    hasFinancialResponsible: guardianDiagnostics.hasFinancialResponsible,
    multiplePriorityOneGuardians: guardianDiagnostics.multiplePriorityOne,
    multipleFinancialResponsibles:
      guardianDiagnostics.multipleFinancialResponsible,
    hasExpiredGuardianRelation: guardianDiagnostics.hasExpiredRelation,
    hasCriticalAllergy: medicalDiagnostics.hasCriticalAllergy,
    hasCriticalCondition: medicalDiagnostics.hasCriticalCondition,
    hasPhysician: medicalDiagnostics.hasPhysician,
    hasBloodType: medicalDiagnostics.hasBloodType,
    hasMedicalUpdate: medicalDiagnostics.hasMedicalUpdate,
  };
}
