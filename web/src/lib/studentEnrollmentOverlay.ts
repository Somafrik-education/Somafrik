import type { StudentEnrollment } from "./studentDomain";
import type { StudentEnrollmentRecord } from "./studentEnrollment";
import { selectCurrentStudentEnrollment } from "./studentEnrollmentSelection";
import { collectStudentHistoryRecord } from "./studentHistory";
import type { StudentWorkspace } from "./studentWorkspaceService";

function toDomainEnrollment(record: StudentEnrollmentRecord): StudentEnrollment {
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

/**
 * Superpose uniquement l'historique d'inscription sur la fiche PostgreSQL.
 * Ne reconstruit / n'efface pas responsables, documents ni médical.
 */
export function applyEnrollmentOverrideToWorkspace(
  baseWorkspace: StudentWorkspace,
  enrollmentOverride: readonly StudentEnrollmentRecord[],
): StudentWorkspace {
  if (!enrollmentOverride.length) {
    return baseWorkspace;
  }

  const enrollments = [...enrollmentOverride];
  const history = collectStudentHistoryRecord({
    studentId: baseWorkspace.overview.studentId,
    enrollments,
    guardians: baseWorkspace.guardians,
    medical: baseWorkspace.medical,
    documents: baseWorkspace.documents,
  });

  const current = selectCurrentStudentEnrollment({
    enrollments,
    academicYear: baseWorkspace.overview.currentAcademicYear,
    schoolCode: baseWorkspace.overview.schoolCode,
  });

  return {
    ...baseWorkspace,
    enrollments,
    history,
    overview: {
      ...baseWorkspace.overview,
      enrollmentStatus: current?.status ?? baseWorkspace.overview.enrollmentStatus,
      enrollmentDate:
        current?.enrolledAt ??
        current?.validatedAt ??
        baseWorkspace.overview.enrollmentDate,
      currentAcademicYear:
        current?.academicYear ?? baseWorkspace.overview.currentAcademicYear,
      currentClassId: current?.classId ?? baseWorkspace.overview.currentClassId,
      currentClassName:
        current?.className ?? baseWorkspace.overview.currentClassName,
      hasActiveEnrollment: Boolean(
        current &&
          (current.status === "ENROLLED" ||
            current.status === "APPROVED" ||
            current.status === "SUSPENDED"),
      ),
      // Domaines hors inscription : strictement ceux de la fiche PG.
      hasGuardians: baseWorkspace.overview.hasGuardians,
      hasDocuments: baseWorkspace.overview.hasDocuments,
      hasMedicalProfile: baseWorkspace.overview.hasMedicalProfile,
      guardiansCount: baseWorkspace.overview.guardiansCount,
      primaryGuardianName: baseWorkspace.overview.primaryGuardianName,
      primaryGuardianPhone: baseWorkspace.overview.primaryGuardianPhone,
    },
  };
}

export { toDomainEnrollment };
