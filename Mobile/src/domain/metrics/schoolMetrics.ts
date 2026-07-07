import type { Course, NoteItem, PaymentItem, PresenceItem, Student } from "../../data/catalog";
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

/** Statut initial pour un appel : présent par défaut si aucune saisie du jour. */
export function rollCallInitialStatus(presence?: Pick<PresenceItem, "present" | "status">): PresenceStatus {
  if (!presence) return "Présent";
  return normalizePresenceStatus(presence);
}

export function isAttendedPresence(presence: Pick<PresenceItem, "present" | "status">) {
  const status = normalizePresenceStatus(presence);
  return status === "Présent" || status === "Retard";
}

export function getPresenceStats(presences: PresenceItem[], studentIds?: string[]): PresenceStats {
  const scopedRows = studentIds?.length
    ? presences.filter((presence) => studentIds.includes(presence.studentId))
    : presences;
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
  return payment.status === "PAYE";
}

export function getPaymentStats(payments: PaymentItem[], studentIds?: string[]): PaymentStats {
  const scopedRows = studentIds?.length
    ? payments.filter((payment) => studentIds.includes(payment.studentId))
    : payments;
  const paidRows = scopedRows.filter(isPaidPayment);
  const pendingRows = scopedRows.filter((payment) => !isPaidPayment(payment));

  return {
    total: scopedRows.length,
    paid: paidRows.length,
    pending: pendingRows.length,
    paidAmount: paidRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    pendingAmount: pendingRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    rate: scopedRows.length ? Math.round((paidRows.length / scopedRows.length) * 100) : 0,
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
