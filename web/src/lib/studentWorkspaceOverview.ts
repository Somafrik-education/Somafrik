import {
  getActiveEnrollment,
  type Person,
  type Student,
  type StudentDocument,
  type StudentEnrollment,
  type StudentEnrollmentStatus,
  type StudentGuardianRelation,
  type StudentMedicalProfile,
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
  currentAcademicYear: string | null;
  currentClassId: string | null;
  currentClassName: string | null;
  hasGuardians: boolean;
  hasDocuments: boolean;
  hasMedicalProfile: boolean;
}

export interface BuildStudentWorkspaceOverviewInput {
  student: Student;
  person?: Person | null;
  academicYear: string;
  enrollments?: readonly StudentEnrollment[];
  guardianRelations?: readonly StudentGuardianRelation[];
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
function normalizeOptionalValue(value: unknown): string | null {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || null;
}

export function buildStudentWorkspaceOverview({
  student,
  person,
  academicYear,
  enrollments = [],
  guardianRelations = [],
  documents = [],
  medicalProfile = null,
}: BuildStudentWorkspaceOverviewInput): StudentWorkspaceOverview {
  const activeEnrollment = getActiveEnrollment(
    enrollments,
    student.id,
    student.schoolCode,
    academicYear,
  );
  
  return {
    studentId: student.id,
    fullName: buildStudentFullName(student, person),
    matricule: student.matricule.trim() || null,
      gender: normalizeOptionalValue(person?.gender ?? student.gender),
  birthDate: normalizeOptionalValue(
    person?.birthDate ?? student.birthDate,
  ),
  birthPlace: normalizeOptionalValue(person?.birthPlace),
  nationality: normalizeOptionalValue(person?.nationality),
  phone: normalizeOptionalValue(person?.phone ?? student.phone),
  email: normalizeOptionalValue(person?.email ?? student.email),
  address: normalizeOptionalValue(person?.address),
    enrollmentStatus: activeEnrollment?.status ?? null,
    currentAcademicYear: activeEnrollment?.academicYear ?? null,
    currentClassId: activeEnrollment?.classId ?? null,
    currentClassName: activeEnrollment?.className ?? null,
    hasGuardians: guardianRelations.some(
      (relation) =>
        relation.studentId === student.id && relation.status !== "Inactif",
    ),
    hasDocuments: documents.some(
      (document) => document.studentId === student.id,
    ),
    hasMedicalProfile: medicalProfile?.studentId === student.id,
  };
}
