import type { Course, NoteItem, PaymentItem, PresenceItem, Student } from "../../data/catalog";
import { isCancelledStatus, isPaidStatus, paymentTotal } from "../../lib/dataTruth";
import { GradeBookService } from "../academics/GradeBookService";

export type PresenceStatus = "Présent" | "Absent" | "Retard" | "Justifié";

export type PresenceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  justified: number;
  attended: number;
  rate: number;
};

export type PaymentStats = {
  total: number;
  paid: number;
  pending: number;
  paidAmount: number;
  pendingAmount: number;
  rate: number;
};

export function normalizePresenceStatus(presence?: Pick<PresenceItem, "present" | "status">): PresenceStatus {
  if (!presence) return "Absent";

  const status = String(presence.status ?? "").trim().toLowerCase();
  if (["present", "présent", "present."].includes(status)) return "Présent";
  if (["late", "retard"].includes(status)) return "Retard";
  if (["excused", "justifié", "justifie"].includes(status)) return "Justifié";
  if (["absent", "absence"].includes(status)) return "Absent";

  return presence.present ? "Présent" : "Absent";
}

/**
 * Hydratation d'un appel : aucune ligne du jour ≠ Présent confirmé.
 * Le bouton « Tout présent » reste l'action explicite.
 */
export function rollCallInitialStatus(
  presence?: Pick<PresenceItem, "present" | "status">,
): PresenceStatus | null {
  if (!presence) return null;
  return normalizePresenceStatus(presence);
}

export function isAttendedPresence(presence: Pick<PresenceItem, "present" | "status">) {
  const status = normalizePresenceStatus(presence);
  return status === "Présent" || status === "Retard";
}

/**
 * Scope élève : `undefined` = dataset global autorisé ;
 * `[]` = zéro ligne (jamais un fallback global) ;
 * `[...]` = uniquement ces élèves.
 */
export const EMPTY_SCOPED_IDS_MUST_NOT_FALLBACK_TO_GLOBAL =
  "empty scoped ids MUST NOT fallback to global dataset";

export function scopeRowsByStudentIds<T extends { studentId: string }>(
  rows: T[],
  studentIds?: string[],
): T[] {
  if (studentIds === undefined) return rows;
  return rows.filter((row) => studentIds.includes(row.studentId));
}

export function getPresenceStats(presences: PresenceItem[], studentIds?: string[]): PresenceStats {
  const scopedRows = scopeRowsByStudentIds(presences, studentIds);
  const present = scopedRows.filter((presence) => normalizePresenceStatus(presence) === "Présent").length;
  const absent = scopedRows.filter((presence) => normalizePresenceStatus(presence) === "Absent").length;
  const late = scopedRows.filter((presence) => normalizePresenceStatus(presence) === "Retard").length;
  const justified = scopedRows.filter((presence) => normalizePresenceStatus(presence) === "Justifié").length;
  const attended = present + late;

  return {
    total: scopedRows.length,
    present,
    absent,
    late,
    justified,
    attended,
    rate: scopedRows.length ? Math.round((attended / scopedRows.length) * 100) : 0,
  };
}

export function isPaidPayment(payment: Pick<PaymentItem, "status">) {
  return isPaidStatus(payment.status);
}

export function isCancelledPayment(payment: Pick<PaymentItem, "status">) {
  return isCancelledStatus(payment.status);
}

/**
 * Cartes Payés / Impayés = reçus encore dans le cycle d'encaissement.
 * Un reçu Annulé n'est ni payé ni impayé — ce n'est plus une créance.
 */
export function getPaymentStats(payments: PaymentItem[], studentIds?: string[]): PaymentStats {
  const scopedRows = scopeRowsByStudentIds(payments, studentIds);
  const countableRows = scopedRows.filter((payment) => !isCancelledPayment(payment));
  const paidRows = countableRows.filter(isPaidPayment);
  const pendingRows = countableRows.filter((payment) => !isPaidPayment(payment));

  return {
    total: countableRows.length,
    paid: paidRows.length,
    pending: pendingRows.length,
    paidAmount: paidRows.reduce((sum, payment) => sum + paymentTotal(payment), 0),
    pendingAmount: pendingRows.reduce((sum, payment) => sum + paymentTotal(payment), 0),
    rate: countableRows.length ? Math.round((paidRows.length / countableRows.length) * 100) : 0,
  };
}

export function getStudentAcademicSummary(
  studentId: string,
  students: Student[],
  notes: NoteItem[],
  courses: Course[]
) {
  const gradeBook = new GradeBookService(students, notes, courses);
  return gradeBook.getStudentAverage(studentId);
}
