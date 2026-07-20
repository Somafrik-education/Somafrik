import {
  getActiveEnrollment,
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
}

export interface BuildStudentWorkspaceOverviewInput {
  student: Student;
  person?: Person | null;
  academicYear: string;
  schoolName?: string | null;
  enrollments?: readonly StudentEnrollment[];
  guardians?: readonly Guardian[];
  guardianRelations?: readonly StudentGuardianRelation[];
  persons?: readonly Person[];
  documents?: readonly StudentDocument[];
  medicalProfile?: StudentMedicalProfile | null;
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
  return !["inactif", "archivé", "archivÃ©", "sorti", "transféré", "transfÃ©rÃ©"].includes(
    status,
  );
}

export function buildStudentWorkspaceOverview({
  student,
  person,
  academicYear,
  schoolName = null,
  enrollments = [],
  guardians = [],
  guardianRelations = [],
  persons = [],
  documents = [],
  medicalProfile = null,
}: BuildStudentWorkspaceOverviewInput): StudentWorkspaceOverview {
  const activeEnrollment = getActiveEnrollment(
    enrollments,
    student.id,
    student.schoolCode,
    academicYear,
  );

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
    enrollmentStatus: activeEnrollment?.status ?? null,
    enrollmentDate: normalizeOptionalValue(
      activeEnrollment?.enrollmentDate ??
        activeEnrollment?.startDate ??
        student.admissionDate ??
        student.enrollmentDate,
    ),
    currentAcademicYear: activeEnrollment?.academicYear ?? null,
    currentClassId: activeEnrollment?.classId ?? null,
    currentClassName: activeEnrollment?.className ?? null,
    schoolCode: normalizeOptionalValue(student.schoolCode),
    schoolName: normalizeOptionalValue(schoolName),
    studentStatus: student.status ?? null,
    isActive: resolveStudentIsActive(student),
    guardiansCount: activeRelations.length,
    primaryGuardianName: buildPersonFullName(primaryGuardianPerson),
    primaryGuardianPhone: normalizeOptionalValue(primaryGuardianPerson?.phone),
    hasGuardians: activeRelations.length > 0,
    hasDocuments: documents.some(
      (document) => document.studentId === student.id,
    ),
    hasMedicalProfile: medicalProfile?.studentId === student.id,
  };
}
