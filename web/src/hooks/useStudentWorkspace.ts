import { useMemo } from "react";
import { useData } from "../context/DataContext";
import type { StudentEnrollment } from "../lib/studentDomain";
import type { StudentEnrollmentRecord } from "../lib/studentEnrollment";
import { buildStudentWorkspace } from "../lib/studentWorkspaceService";
import {
  buildStudentWorkspaceViewModel,
  type StudentWorkspaceViewModel,
} from "../lib/studentWorkspaceViewModel";

export interface UseStudentWorkspaceResult {
  workspace: StudentWorkspaceViewModel | null;
  loading: boolean;
  error: string | null;
}

export interface UseStudentWorkspaceOptions {
  /** Remplace les inscriptions domaine (overlay C1.8a depuis le store d'édition). */
  enrollmentOverride?: readonly StudentEnrollmentRecord[] | null;
}

function resolveAcademicYear(
  studentId: string,
  studentSchoolYear: unknown,
  enrollments: readonly { studentId: string; academicYear: string }[],
): string {
  const matchingYears = enrollments
    .filter((enrollment) => enrollment.studentId === studentId)
    .map((enrollment) => enrollment.academicYear.trim())
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left));

  return matchingYears[0] ?? String(studentSchoolYear ?? "").trim();
}

function toDomainEnrollment(
  record: StudentEnrollmentRecord,
): StudentEnrollment {
  return {
    id: record.id,
    studentId: record.studentId,
    schoolCode: record.schoolCode,
    academicYear: record.academicYear,
    classId: record.classId,
    className: record.className,
    programId: record.programId,
    programName: record.programName,
    status: record.status,
    source: record.source,
    applicationReference: record.applicationReference,
    requestedAt: record.requestedAt,
    enrolledAt: record.enrolledAt,
    validatedAt: record.validatedAt,
    endedAt: record.endedAt,
    transferDate: record.transferDate,
    destinationSchoolName: record.destinationSchoolName,
    closureDate: record.closureDate,
    previousSchool: record.previousSchoolName ?? undefined,
    notes: record.notes,
    enrollmentDate: record.enrolledAt ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function useStudentWorkspace(
  studentId: string,
  options: UseStudentWorkspaceOptions = {},
): UseStudentWorkspaceResult {
  const { state, loading, error } = useData();

  const workspace = useMemo(() => {
    const normalizedStudentId = studentId.trim();
    if (!normalizedStudentId) return null;

    const student = state.students.find(
      (candidate) => candidate.id === normalizedStudentId,
    );
    if (!student) return null;

    const baseEnrollments = state.studentEnrollments ?? [];
    const enrollments =
      options.enrollmentOverride && options.enrollmentOverride.length > 0
        ? options.enrollmentOverride.map(toDomainEnrollment)
        : baseEnrollments;

    const academicYear = resolveAcademicYear(
      student.id,
      student.schoolYear,
      enrollments,
    );

    const domainWorkspace = buildStudentWorkspace({
      studentId: student.id,
      academicYear,
      data: {
        students: state.students,
        persons: state.persons,
        schools: state.schools,
        enrollments,
        guardians: state.guardians,
        guardianRelations: state.studentGuardianRelations,
        documents: state.studentDocuments,
        medicalProfiles: state.studentMedicalProfiles,
      },
    });

    return domainWorkspace
      ? buildStudentWorkspaceViewModel(domainWorkspace)
      : null;
  }, [studentId, state, options.enrollmentOverride]);

  return {
    workspace,
    loading,
    error,
  };
}
