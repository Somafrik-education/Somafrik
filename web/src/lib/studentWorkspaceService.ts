import {
  type Person,
  type Student,
  type StudentDocument,
  type StudentEnrollment,
  type StudentGuardianRelation,
  type StudentMedicalProfile,
} from "./studentDomain";
import {
  buildStudentWorkspaceOverview,
  type StudentWorkspaceOverview,
} from "./studentWorkspaceOverview";

export interface StudentWorkspace {
  overview: StudentWorkspaceOverview;
}

export interface StudentWorkspaceDataSource {
  students: readonly Student[];
  persons?: readonly Person[];
  enrollments?: readonly StudentEnrollment[];
  guardianRelations?: readonly StudentGuardianRelation[];
  documents?: readonly StudentDocument[];
  medicalProfiles?: readonly StudentMedicalProfile[];
}

export interface BuildStudentWorkspaceInput {
  studentId: string;
  academicYear: string;
  data: StudentWorkspaceDataSource;
}

export function buildStudentWorkspace({
  studentId,
  academicYear,
  data,
}: BuildStudentWorkspaceInput): StudentWorkspace | null {
  const normalizedStudentId = studentId.trim();
  const normalizedAcademicYear = academicYear.trim();

  const student = data.students.find(
    (candidate) => candidate.id === normalizedStudentId,
  );

  if (!student) {
    return null;
  }

  const person = student.personId
    ? data.persons?.find((candidate) => candidate.id === student.personId)
    : undefined;

  const medicalProfile = data.medicalProfiles?.find(
    (candidate) => candidate.studentId === student.id,
  );

  return {
    overview: buildStudentWorkspaceOverview({
      student,
      person,
      academicYear: normalizedAcademicYear,
      enrollments: data.enrollments,
      guardianRelations: data.guardianRelations,
      documents: data.documents,
      medicalProfile,
    }),
  };
}
