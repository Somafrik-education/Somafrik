import type { SessionUser, StudentFee, StudentGrade } from "../types";
import { getPresenceStats, type PresenceRow } from "./presenceMetrics";
import { isParentNotesRole, parentGradesKpis, parentLinkedStudents } from "./parentNotes";
import { formatPaymentOverviewAmounts } from "./paymentAmountBreakdown";
import { formatPaymentCashAmounts, type CashPaymentRow } from "./paymentCashKpi";

export type ParentDashboardStudent = Record<string, unknown>;
export type ParentDashboardRow = Record<string, unknown>;

function normalizeRef(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function parentDashboardStudentKeys(student: ParentDashboardStudent | null | undefined) {
  if (!student) return [];
  return [
    student.id,
    student.studentId,
    student.student_id,
    student.publicId,
    student.matricule,
    student.studentCode,
    student.studentUuid,
  ]
    .map(normalizeRef)
    .filter(Boolean);
}

function rowStudentKeys(row: ParentDashboardRow) {
  return [
    row.studentId,
    row.student_id,
    row.studentUuid,
    row.studentCode,
    row.matricule,
  ]
    .map(normalizeRef)
    .filter(Boolean);
}

export function isParentDashboardRole(user: SessionUser | null | undefined) {
  return isParentNotesRole(user);
}

export function resolveParentDashboardStudent(
  user: SessionUser | null,
  studentsState: { students: unknown[] },
  requestedStudentId: string,
): ParentDashboardStudent | null {
  const children = parentLinkedStudents(user, studentsState as { students: any[] });
  if (!children.length) return null;

  const requested = normalizeRef(requestedStudentId);
  if (requested) {
    const matched = children.find((child) =>
      parentDashboardStudentKeys(child).includes(requested),
    );
    if (matched) return matched;
  }

  return children[0] ?? null;
}

export function filterParentDashboardRows<T extends ParentDashboardRow>(
  rows: readonly T[],
  student: ParentDashboardStudent | null,
): T[] {
  const allowed = new Set(parentDashboardStudentKeys(student));
  if (!allowed.size) return [];
  return rows.filter((row) => rowStudentKeys(row).some((key) => allowed.has(key)));
}

export type ParentDashboardMetrics = {
  presenceRate: number | null;
  presenceRecorded: number;
  average: number | null;
  evaluationCount: number;
  expectedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentAmount: number;
  paymentCount: number;
  currency: string;
  expectedLabel: string;
  paidLabel: string;
  remainingLabel: string;
  paymentLabel: string;
};

export function buildParentDashboardMetrics(input: {
  student: ParentDashboardStudent | null;
  notes: readonly ParentDashboardRow[];
  presences: readonly ParentDashboardRow[];
  studentFees: readonly ParentDashboardRow[];
  payments: readonly ParentDashboardRow[];
}): ParentDashboardMetrics {
  if (!input.student) {
    return {
      presenceRate: null,
      presenceRecorded: 0,
      average: null,
      evaluationCount: 0,
      expectedAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentAmount: 0,
      paymentCount: 0,
      currency: "",
      expectedLabel: "—",
      paidLabel: "—",
      remainingLabel: "—",
      paymentLabel: "—",
    };
  }

  const presenceRows = filterParentDashboardRows(
    input.presences,
    input.student,
  ) as PresenceRow[];
  const presence = getPresenceStats(presenceRows);

  const gradeRows = filterParentDashboardRows(
    input.notes,
    input.student,
  ) as unknown as StudentGrade[];
  const grades = parentGradesKpis(gradeRows);

  const fees = filterParentDashboardRows(
    input.studentFees,
    input.student,
  ) as unknown as StudentFee[];
  const payments = filterParentDashboardRows(input.payments, input.student);

  const feeOverview = formatPaymentOverviewAmounts(fees);
  const cashOverview = formatPaymentCashAmounts(payments as CashPaymentRow[]);
  const expectedAmount = feeOverview.buckets.reduce((sum, row) => sum + row.expectedAmount, 0);
  const paidAmount = feeOverview.buckets.reduce((sum, row) => sum + row.collectedAmount, 0);
  const remainingAmount = feeOverview.buckets.reduce((sum, row) => sum + row.remainingAmount, 0);
  const paymentAmount = cashOverview.buckets.reduce((sum, row) => sum + row.collectedAmount, 0);
  const currency =
    feeOverview.buckets.length === 1
      ? feeOverview.buckets[0].currencyKey
      : cashOverview.buckets.length === 1
        ? cashOverview.buckets[0].currencyKey
        : "";

  return {
    presenceRate: presence.total ? presence.rate : null,
    presenceRecorded: presence.total,
    average: grades.average,
    evaluationCount: grades.evaluationCount,
    expectedAmount,
    paidAmount,
    remainingAmount,
    paymentAmount,
    paymentCount: payments.length,
    currency,
    expectedLabel: feeOverview.expectedLabel,
    paidLabel: feeOverview.collectedLabel,
    remainingLabel: feeOverview.remainingLabel,
    paymentLabel: cashOverview.collectedLabel,
  };
}
