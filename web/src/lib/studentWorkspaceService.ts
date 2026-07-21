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
  collectStudentGuardianRelationRecords,
  type StudentGuardianRelationRecord,
} from "./studentGuardian";
import {
  collectStudentMedicalRecord,
  type StudentMedicalRecord,
} from "./studentMedical";
import {
  collectStudentDocumentRecord,
  type StudentDocumentRecord,
} from "./studentDocuments";
import {
  buildStudentWorkspaceOverview,
  type StudentWorkspaceOverview,
} from "./studentWorkspaceOverview";

export interface StudentWorkspace {
  overview: StudentWorkspaceOverview;
  enrollments: StudentEnrollmentRecord[];
  guardians: StudentGuardianRelationRecord[];
  medical: StudentMedicalRecord;
  documents: StudentDocumentRecord;
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
  referenceDate?: Date;
}

export function buildStudentWorkspace({
  studentId,
  academicYear,
  data,
  referenceDate,
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

  const medical = collectStudentMedicalRecord({
    studentId: student.id,
    medicalProfiles: data.medicalProfiles,
  });

  const documents = collectStudentDocumentRecord({
    studentId: student.id,
    documents: data.documents,
    referenceDate,
  });

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

  const guardians = collectStudentGuardianRelationRecords({
    student,
    guardians: data.guardians,
    guardianRelations: data.guardianRelations,
    persons: data.persons,
    referenceDate,
  });

  return {
    overview: buildStudentWorkspaceOverview({
      student,
      person,
      academicYear: normalizedAcademicYear,
      schoolName,
      enrollments: data.enrollments,
      enrollmentRecords: enrollments,
      guardianRecords: guardians,
      guardians: data.guardians,
      guardianRelations: data.guardianRelations,
      persons: data.persons,
      documents: data.documents,
      medicalProfile,
      medicalRecord: medical,
      documentRecord: documents,
      referenceDate,
    }),
    enrollments,
    guardians,
    medical,
    documents,
  };
}
