import type {
  BackOfficeState,
  PaymentReminder,
  SessionUser,
  StudentFee,
  StudentUnpaidRow,
  UnpaidAggregateStatus,
  UnpaidDashboardStats,
  UnpaidSeverity,
} from "../types";
import { scopedStudents } from "./establishment";
import { daysLateFromPeriodDate, isPeriodDateBefore } from "./dates";
import { normalize } from "./format";
import { isPaymentCounted } from "./quickPayment";
import { scopedStudentFees } from "./fees";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

/** Délai minimum entre deux relances pour le même élève (IMP-013). */
export const REMINDER_COOLDOWN_DAYS = 3;

const UNPAID_FEE_STATUSES = new Set(["À payer", "Partiellement payé", "En retard"]);

export function computeDaysLate(dueDate?: string, now = new Date()): number {
  return daysLateFromPeriodDate(dueDate, now);
}

/** IMP-008 — criticité selon jours de retard. */
export function computeUnpaidSeverity(daysLate: number): UnpaidSeverity {
  if (daysLate <= 0) return "Retard léger";
  if (daysLate <= 7) return "Retard léger";
  if (daysLate <= 30) return "Retard moyen";
  return "Retard critique";
}

export function isOverdueStudentFee(fee: StudentFee, now = new Date()): boolean {
  if (fee.balance <= 0 || fee.status === "Payé" || fee.status === "Exonéré" || fee.status === "Annulé") {
    return false;
  }
  if (fee.status === "En retard") return true;
  if (!fee.dueDate) return false;
  return isPeriodDateBefore(fee.dueDate, now);
}

export function scopedPaymentReminders(user: SessionUser | null, state: BackOfficeState): PaymentReminder[] {
  const rows = state.paymentReminders ?? [];
  const code = String(user?.schoolCode ?? "").trim();
  if (!code || code === "*" || isSuperAdminRole(user?.role) || user?.role === COUNTRY_ADMIN_ROLE) {
    return rows;
  }
  return rows.filter((row) => normalize(row.schoolCode) === normalize(code));
}

function studentRecord(state: BackOfficeState, studentId: string): Record<string, unknown> | undefined {
  return scopedStudents(null, state).find((row) => String(row.id ?? "") === studentId) as
    | Record<string, unknown>
    | undefined;
}

function resolveParentStudentIds(user: SessionUser | null, state: BackOfficeState): string[] {
  if (!user) return [];
  const role = normalize(user.role);
  if (!role.includes("parent") && !role.includes("eleve") && !role.includes("etudiant")) return [];

  const identifier = normalize(user.identifier ?? user.email ?? user.phone ?? "");
  const schoolCode = normalize(user.schoolCode ?? "");

  return scopedStudents(null, state)
    .filter((student) => {
      if (schoolCode && schoolCode !== "*" && normalize(student.schoolCode) !== schoolCode) return false;
      const haystack = [
        student.id,
        student.publicId,
        student.matricule,
        student.parentPhone,
        student.parentEmail,
        student.guardianPhone,
        student.guardianEmail,
      ]
        .map((value) => normalize(value))
        .join(" ");
      return haystack.includes(identifier);
    })
    .map((student) => String(student.id ?? ""))
    .filter(Boolean);
}

export interface UnpaidFilters {
  search?: string;
  className?: string;
  period?: string;
  includeSettled?: boolean;
}

/** IMP-002, IMP-003 — frais élève en retard ou avec solde > 0 après échéance. */
export function listUnpaidStudentFees(
  state: BackOfficeState,
  user: SessionUser | null,
  filters: UnpaidFilters = {},
  now = new Date(),
): StudentFee[] {
  const parentStudentIds = resolveParentStudentIds(user, state);
  const isOwnScopeOnly = parentStudentIds.length > 0;

  let fees = scopedStudentFees(user, state).filter((fee) => {
    if (filters.includeSettled) return fee.status !== "Annulé" && fee.status !== "Exonéré";
    if (!UNPAID_FEE_STATUSES.has(fee.status) || fee.balance <= 0) return false;
    return isOverdueStudentFee(fee, now) || fee.status === "En retard" || fee.status === "Partiellement payé";
  });

  if (isOwnScopeOnly) {
    fees = fees.filter((fee) => parentStudentIds.includes(fee.studentId));
  }

  if (filters.className) {
    fees = fees.filter((fee) => normalize(fee.className) === normalize(filters.className));
  }
  if (filters.period) {
    fees = fees.filter(
      (fee) =>
        normalize(fee.periodLabel ?? "") === normalize(filters.period) ||
        normalize(fee.academicYear ?? "") === normalize(filters.period),
    );
  }
  if (filters.search) {
    const q = normalize(filters.search);
    fees = fees.filter((fee) => {
      const student = studentRecord(state, fee.studentId);
      const matricule = String(student?.matricule ?? student?.publicId ?? "").trim();
      const haystack = [fee.studentName, fee.studentId, matricule, fee.className, fee.label, fee.periodLabel]
        .map((value) => normalize(value))
        .join(" ");
      return haystack.includes(q);
    });
  }

  return fees.sort((a, b) => computeDaysLate(b.dueDate, now) - computeDaysLate(a.dueDate, now));
}

function aggregateStatus(fees: StudentFee[]): UnpaidAggregateStatus {
  if (!fees.length) return "Soldé";
  if (fees.every((fee) => fee.status === "Payé" || fee.balance <= 0)) return "Soldé";
  if (fees.some((fee) => fee.status === "En retard")) return "En retard";
  if (fees.some((fee) => fee.status === "Partiellement payé")) return "Partiellement payé";
  return "En retard";
}

/** IMP-001 — agrégation par élève. */
export function aggregateUnpaidByStudent(
  fees: StudentFee[],
  reminders: PaymentReminder[],
  state: BackOfficeState,
  now = new Date(),
): StudentUnpaidRow[] {
  const map = new Map<string, StudentFee[]>();
  for (const fee of fees) {
    const list = map.get(fee.studentId) ?? [];
    list.push(fee);
    map.set(fee.studentId, list);
  }

  return [...map.entries()]
    .map(([studentId, studentFees]) => {
      const student = studentRecord(state, studentId);
      const amountExpected = studentFees.reduce((sum, fee) => sum + fee.amountDue, 0);
      const amountPaid = studentFees.reduce((sum, fee) => sum + fee.amountPaid, 0);
      const amountDue = studentFees.reduce((sum, fee) => sum + fee.balance, 0);
      const primary = studentFees.sort(
        (a, b) => computeDaysLate(b.dueDate, now) - computeDaysLate(a.dueDate, now),
      )[0];
      const daysLate = Math.max(...studentFees.map((fee) => computeDaysLate(fee.dueDate, now)), 0);
      const studentReminders = reminders.filter((row) => row.studentId === studentId);
      const lastReminderAt = studentReminders
        .map((row) => row.sentAt)
        .sort((a, b) => b.localeCompare(a))[0];
      const periods = [...new Set(studentFees.map((fee) => fee.periodLabel ?? fee.academicYear).filter(Boolean))];

      return {
        studentId,
        studentName: primary.studentName ?? String(student?.name ?? studentId),
        matricule: String(student?.matricule ?? student?.publicId ?? "").trim() || undefined,
        className: primary.className,
        schoolCode: primary.schoolCode,
        periodLabel: periods.length === 1 ? String(periods[0]) : periods.length > 1 ? "Plusieurs périodes" : "—",
        amountExpected,
        amountPaid,
        amountDue,
        currency: primary.currency,
        dueDate: primary.dueDate,
        daysLate,
        severity: computeUnpaidSeverity(daysLate),
        status: aggregateStatus(studentFees),
        feeIds: studentFees.map((fee) => fee.id),
        lastReminderAt,
        reminderCount: studentReminders.length,
      } satisfies StudentUnpaidRow;
    })
    .filter((row) => row.amountDue > 0 || fees.some((fee) => fee.studentId === row.studentId))
    .sort((a, b) => b.amountDue - a.amountDue);
}

/** IMP-017 à IMP-019 */
export function buildUnpaidDashboard(rows: StudentUnpaidRow[]): UnpaidDashboardStats {
  const byClassMap = new Map<string, { amountDue: number; studentIds: Set<string> }>();
  for (const row of rows) {
    const entry = byClassMap.get(row.className) ?? { amountDue: 0, studentIds: new Set<string>() };
    entry.amountDue += row.amountDue;
    entry.studentIds.add(row.studentId);
    byClassMap.set(row.className, entry);
  }

  return {
    totalAmountDue: rows.reduce((sum, row) => sum + row.amountDue, 0),
    studentCount: rows.length,
    overdueLineCount: rows.filter((row) => row.daysLate > 0).length,
    currency: rows[0]?.currency ? String(rows[0].currency).trim().toUpperCase() : "",
    byClass: [...byClassMap.entries()]
      .map(([className, stats]) => ({
        className,
        amountDue: stats.amountDue,
        studentCount: stats.studentIds.size,
      }))
      .sort((a, b) => b.amountDue - a.amountDue),
  };
}

export function periodOptionsFromFees(fees: StudentFee[]): string[] {
  return [
    ...new Set(
      fees.flatMap((fee) => [fee.periodLabel, fee.academicYear].filter(Boolean) as string[]),
    ),
  ].sort((a, b) => a.localeCompare(b, "fr"));
}

export function classOptionsFromUnpaid(rows: StudentUnpaidRow[]): string[] {
  return [...new Set(rows.map((row) => row.className).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

export interface UnpaidDetail {
  row: StudentUnpaidRow;
  fees: StudentFee[];
  payments: Record<string, unknown>[];
  reminders: PaymentReminder[];
}

/** IMP-004, IMP-012 */
export function getStudentUnpaidDetail(
  state: BackOfficeState,
  _user: SessionUser | null,
  studentId: string,
  fees: StudentFee[],
  reminders: PaymentReminder[],
): UnpaidDetail | null {
  const studentFees = fees.filter((fee) => fee.studentId === studentId);
  if (!studentFees.length) return null;

  const rows = aggregateUnpaidByStudent(studentFees, reminders, state);
  const row = rows[0];
  if (!row) return null;

  const payments = (state.payments ?? []).filter(
    (payment) =>
      String((payment as Record<string, unknown>).studentId ?? "") === studentId &&
      isPaymentCounted(payment as Record<string, unknown>),
  ) as Record<string, unknown>[];

  return {
    row,
    fees: studentFees,
    payments,
    reminders: reminders
      .filter((item) => item.studentId === studentId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt)),
  };
}

/** IMP-013 */
export function canSendReminder(
  reminders: PaymentReminder[],
  studentId: string,
  cooldownDays = REMINDER_COOLDOWN_DAYS,
  now = new Date(),
): { allowed: boolean; lastReminderAt?: string; message?: string } {
  const recent = reminders
    .filter((row) => row.studentId === studentId && row.sendStatus !== "Échouée")
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];

  if (!recent) return { allowed: true };

  const last = new Date(recent.sentAt);
  const daysSince = Math.floor((now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < cooldownDays) {
    return {
      allowed: false,
      lastReminderAt: recent.sentAt,
      message: `Une relance a déjà été envoyée le ${formatFrDate(recent.sentAt)}. Attendez ${cooldownDays - daysSince} jour(s) ou confirmez l'envoi.`,
    };
  }
  return { allowed: true, lastReminderAt: recent.sentAt };
}

function formatFrDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

/** IMP-009 */
export function buildReminderMessage(row: StudentUnpaidRow, schoolName?: string): string {
  const establishment = schoolName ? ` (${schoolName})` : "";
  return (
    `Bonjour,\n\n` +
    `Nous vous rappelons que des frais scolaires restent dus pour ${row.studentName}${establishment}.\n\n` +
    `Période : ${row.periodLabel}\n` +
    `Montant restant : ${row.amountDue.toLocaleString("fr-FR")} ${row.currency}\n` +
    (row.dueDate ? `Échéance dépassée depuis ${row.daysLate} jour(s).\n\n` : "\n") +
    `Merci de régulariser votre situation auprès du service comptabilité de l'établissement.\n\n` +
    `— Somafrik`
  );
}

export function newReminderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `REL-${crypto.randomUUID()}`;
  }
  return `REL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function severityTone(severity: UnpaidSeverity): "success" | "warning" | "danger" {
  if (severity === "Retard léger") return "warning";
  if (severity === "Retard moyen") return "warning";
  return "danger";
}
