import {
  type Guardian,
  type Person,
  type Student,
  type StudentDocument,
  type StudentEnrollment,
  type StudentGuardianRelation,
  type StudentMedicalProfile,
} from "./studentDomain";
import {
  collectStudentEnrollmentRecords,
  type StudentEnrollmentRecord,
} from "./studentEnrollment";
import {
  buildStudentWorkspaceOverview,
  type StudentWorkspaceOverview,
} from "./studentWorkspaceOverview";

export interface StudentWorkspace {
  overview: StudentWorkspaceOverview;
  enrollments: StudentEnrollmentRecord[];
}

export interface StudentWorkspaceDataSource {
  students: readonly Student[];
  persons?: readonly Person[];
  schools?: readonly { code: string; name: string }[];
  enrollments?: readonly StudentEnrollment[];
  guardians?: readonly Guardian[];
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

  const schoolName =
    data.schools?.find(
      (school) =>
        school.code.trim().toLowerCase() ===
        student.schoolCode.trim().toLowerCase(),
    )?.name ?? null;

  const enrollments = collectStudentEnrollmentRecords({
    student,
    enrollments: data.enrollments,
    schoolName,
  });

  return {
    overview: buildStudentWorkspaceOverview({
      student,
      person,
      academicYear: normalizedAcademicYear,
      schoolName,
      enrollments: data.enrollments,
      enrollmentRecords: enrollments,
      guardians: data.guardians,
      guardianRelations: data.guardianRelations,
      persons: data.persons,
      documents: data.documents,
      medicalProfile,
    }),
    enrollments,
  };
}
