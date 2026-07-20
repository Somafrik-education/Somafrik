import { useMemo } from "react";
import { useData } from "../context/DataContext";
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

export function useStudentWorkspace(
  studentId: string,
): UseStudentWorkspaceResult {
  const { state, loading, error } = useData();

  const workspace = useMemo(() => {
    const normalizedStudentId = studentId.trim();
    if (!normalizedStudentId) return null;

    const student = state.students.find(
      (candidate) => candidate.id === normalizedStudentId,
    );
    if (!student) return null;

    const enrollments = state.studentEnrollments ?? [];
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
        enrollments,
        guardianRelations: state.studentGuardianRelations,
        documents: state.studentDocuments,
        medicalProfiles: state.studentMedicalProfiles,
      },
    });

    return domainWorkspace
      ? buildStudentWorkspaceViewModel(domainWorkspace)
      : null;
  }, [studentId, state]);

  return {
    workspace,
    loading,
    error,
  };
}
