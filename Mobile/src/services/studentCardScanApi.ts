/**
 * Scan carte élève — online-only. Le cardToken n’est jamais persisté ni loggé.
 * resolve / attendance / finance restent des requêtes séparées.
 */
import { httpRequest } from "./httpClient";

export type StudentCardCapabilities = {
  studentCardEnabled: boolean;
  studentCardQrEnabled: boolean;
  studentCardNfcEnabled: boolean;
  studentCardAttendanceEnabled: boolean;
  studentCardFinanceCheckEnabled: boolean;
};

export function getStudentCardCapabilities() {
  return httpRequest<StudentCardCapabilities>("/student-cards/capabilities");
}

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

function postScan(
  payload: Record<string, unknown>,
  options?: { idempotencyKey?: string },
) {
  return httpRequest<StudentCardScanResponse>("/student-cards/scan", {
    method: "POST",
    body: JSON.stringify(payload),
    idempotencyKey: options?.idempotencyKey,
  });
}

export function resolveStudentCard(cardToken: string) {
  return postScan({ cardToken });
}

export function recordStudentCardAttendance(
  cardToken: string,
  attendance: { date: string; status: "present"; teacherId?: string },
  options: { idempotencyKey: string },
) {
  return postScan({ cardToken, attendance }, { idempotencyKey: options.idempotencyKey });
}

export function readStudentCardFinance(cardToken: string) {
  return postScan({ cardToken, finance: true });
}
