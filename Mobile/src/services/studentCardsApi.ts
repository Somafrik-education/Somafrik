/**
 * Scan carte élève — online-only. Le cardToken n’est jamais persisté ni loggé.
 */
import { httpRequest } from "./httpClient";

export type StudentCardScanAttendanceStatus = "present" | "late";

export type StudentCardScanRequest = {
  cardToken: string;
  attendance?: {
    date: string;
    status: StudentCardScanAttendanceStatus;
    teacherId?: string;
  };
  finance?: boolean;
};

export type StudentCardScanStudent = {
  id: string;
  studentCode: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
};

export type StudentCardScanClass = {
  id: string;
  classCode: string;
  className: string;
};

export type StudentCardScanFinance = {
  code: string;
  label: string;
};

export type StudentCardScanResponse = {
  card?: {
    id: string;
    publicId: string;
    medium: string;
    status: string;
  };
  student?: StudentCardScanStudent;
  class?: StudentCardScanClass;
  attendance?: {
    status?: string;
    date?: string;
  };
  finance?: StudentCardScanFinance;
};

export function scanStudentCard(
  payload: StudentCardScanRequest,
  options?: { idempotencyKey?: string },
) {
  return httpRequest<StudentCardScanResponse>("/student-cards/scan", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
  });
}
