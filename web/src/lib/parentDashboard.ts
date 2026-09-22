import type { SessionUser, StudentFee, StudentGrade } from "../types";
import { getPresenceStats, type PresenceRow } from "./presenceMetrics";
import { isParentNotesRole, parentGradesKpis, parentLinkedStudents } from "./parentNotes";

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

  const expectedAmount = fees.reduce((sum, row) => sum + Number(row.amountDue ?? 0), 0);
  const paidAmount = fees.reduce((sum, row) => sum + Number(row.amountPaid ?? 0), 0);
  const remainingAmount = fees.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
  const paymentAmount = payments.reduce(
    (sum, row) => sum + Number(row.totalAmount ?? row.amount ?? 0),
    0,
  );
  const currency = String(
    fees.find((row) => String(row.currency ?? "").trim())?.currency ??
      payments.find((row) => String(row.currency ?? "").trim())?.currency ??
      "",
  ).trim();

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
  };
}
