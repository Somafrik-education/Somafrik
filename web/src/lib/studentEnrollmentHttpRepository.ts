import { ApiError } from "../api/client";
import type {
  EditableEnrollment,
  StudentCommandFailure,
  StudentCommandResult,
} from "./studentEditing";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import { studentEnrollmentC18Api, type C18Enrollment } from "./studentEnrollmentC18Api";
import { normalizeStudentEnrollmentStatus } from "./studentEnrollmentStatus";

function deriveVersion(updatedAt: string | null | undefined): number {
  if (!updatedAt) return 1;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return 1;
  return Math.max(1, Math.floor(ts / 1000) % 1_000_000_000);
}

export function mapC18EnrollmentToEditable(
  row: C18Enrollment,
  studentId: string,
  schoolCode: string,
): EditableEnrollment {
  const status = normalizeStudentEnrollmentStatus(row.status, { fallback: "PENDING_REVIEW" });
  const endedAt = row.transferredAt || row.closedAt || null;
  return {
    enrollmentId: row.id,
    studentId,
    schoolCode,
    academicYear: row.academicYearName || "",
    version: deriveVersion(row.updatedAt),
    updatedAt: row.updatedAt || new Date().toISOString(),
    status,
    classId: row.classId,
    className: row.className || null,
    programId: null,
    programName: null,
    source: "SCHOOL_ADMINISTRATION",
    applicationReference: null,
    requestedAt: row.createdAt ?? null,
    validatedAt: row.validatedAt ?? null,
    enrolledAt: row.assignedAt ?? (status === "ENROLLED" ? row.updatedAt ?? null : null),
    endedAt,
    transferDate: row.transferredAt ? row.transferredAt.slice(0, 10) : null,
    destinationSchoolName: row.transferDestination ?? null,
    closureDate: row.closedAt ? row.closedAt.slice(0, 10) : null,
    previousSchoolName: null,
    notes: row.transferNotes || row.closeNotes || null,
    schoolName: null,
    createdAt: row.createdAt || row.updatedAt || new Date().toISOString(),
  };
}

function httpFailure(error: unknown): StudentCommandFailure {
  const status = error instanceof ApiError ? error.status : 0;
  const message =
    error instanceof Error ? error.message : "Transition C18 refusée par le serveur.";
  const errors = [{ field: null, code: "C18_HTTP", message }];
  if (status === 403) return { success: false, code: "PERMISSION_DENIED", errors };
  if (status === 404) return { success: false, code: "NOT_FOUND", errors };
  return { success: false, code: "VALIDATION_ERROR", errors };
}

function success(data: EditableEnrollment): StudentCommandResult<EditableEnrollment> {
  return {
    success: true,
    updatedAggregate: data,
    newVersion: data.version,
    updatedAt: data.updatedAt,
    changeSet: {
      commandType: "VALIDATE_ENROLLMENT",
      isEmpty: false,
      occurredAt: data.updatedAt,
      changes: [],
    } as never,
    auditEvent: {
      id: `c18-${data.enrollmentId}-${data.updatedAt}`,
      studentId: data.studentId,
      commandType: "VALIDATE_ENROLLMENT",
      actorId: "backend",
      actorRole: "backend",
      occurredAt: data.updatedAt,
      changedFields: ["status"],
      reason: null,
      visibility: "ADMIN",
    },
  };
}

export function wrapRepositoryWithHttpC18(
  base: StudentWorkspaceCommandRepository,
  options: {
    studentId: string;
    schoolCode: string;
    onUpdated?: (enrollment: EditableEnrollment) => void;
  },
): StudentWorkspaceCommandRepository {
  const map = (row: C18Enrollment) =>
    mapC18EnrollmentToEditable(row, options.studentId, options.schoolCode);

  async function run(
    fn: () => Promise<C18Enrollment>,
  ): Promise<StudentCommandResult<EditableEnrollment>> {
    try {
      const editable = map(await fn());
      options.onUpdated?.(editable);
      return success(editable);
    } catch (error) {
      return httpFailure(error);
    }
  }

  return {
    ...base,
    validateEnrollment: (command) =>
      run(() =>
        studentEnrollmentC18Api.validate(command.studentId, command.enrollmentId, {
          reason: command.reason ?? undefined,
        }),
      ),
    assignEnrollmentClass: (command) => {
      const classRef = String(command.changes.classId ?? "").trim();
      const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        classRef,
      );
      return run(() =>
        studentEnrollmentC18Api.assignClass(command.studentId, command.enrollmentId, {
          classId: looksUuid ? classRef : undefined,
          classCode: looksUuid ? undefined : classRef || undefined,
        }),
      );
    },
    transferEnrollment: (command) =>
      run(() =>
        studentEnrollmentC18Api.transfer(command.studentId, command.enrollmentId, {
          destinationSchoolName: command.changes.destinationSchoolName,
          reason: command.reason ?? undefined,
        }),
      ),
    closeEnrollment: (command) =>
      run(() =>
        studentEnrollmentC18Api.close(command.studentId, command.enrollmentId, {
          reason: command.reason ?? undefined,
        }),
      ),
  };
}

export function shouldUseHttpC18Repository(): boolean {
  try {
    const env = import.meta.env as { VITEST?: boolean; MODE?: string };
    if (env?.VITEST) return false;
    if (env?.MODE === "test") return false;
  } catch {
    /* import.meta may be unavailable in some runners */
  }
  return true;
}
