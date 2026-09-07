/**
 * F5 — contrat d'écriture Finance Web.
 * Miroir de backend/lib/financeWebMobileWriteContract.js et Mobile/src/lib/paymentEnrollment.ts.
 * Aucun calcul de solde. PostgreSQL reste l'autorité.
 */

export const UNALLOCATED_FEE_TYPE = "Non imputé";
export const UNALLOCATED_TARGET = "__unallocated__";
export const OPEN_OBLIGATION_RESOLVE_ERROR =
  "Impossible de retrouver les frais ouverts de cet élève. Actualisez les données ou contactez l'administrateur.";

export type FinancePaymentWriteLine = {
  obligationId?: string;
  amount: number | string;
  feeType?: string;
  feeLabel?: string;
  label?: string;
};

export type FinanceObligationProjection = {
  id?: string;
  obligationId?: string;
  studentId?: string;
  /** UUID interne PostgreSQL (mapObligationRow.studentDbId / student_id). */
  studentDbId?: string;
  status?: string;
  archivedAt?: string | null;
  archived_at?: string | null;
  balance?: number | string | null;
  amountDue?: number | string | null;
  amount_due?: number | string | null;
  amountPaid?: number | string | null;
  amount_paid?: number | string | null;
  exemption?: number | string | null;
  feeType?: string;
  feeTypeCode?: string;
  fee_type_code?: string;
  label?: string;
  periodLabel?: string;
  period_label?: string;
  dueDate?: string | null;
  due_date?: string | null;
  academicYear?: string;
  academic_year?: string;
  classId?: string | null;
  class_id?: string | null;
  className?: string;
  class_name?: string;
  currency?: string;
  schoolFeeItemId?: string;
  school_fee_item_id?: string;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export type FinanceStudentIdentity = {
  id?: string;
  studentId?: string;
  studentDbId?: string;
  studentCode?: string;
  matricule?: string;
  publicId?: string;
};

function identityKey(value: unknown): string {
  return trim(value).toUpperCase();
}

/** Alias canoniques uniquement : UUID, code public / matricule, publicId. Pas de nom/classe. */
export function collectFinanceStudentIdentityKeys(
  identity: string | FinanceStudentIdentity | null | undefined,
): string[] {
  if (identity == null) return [];
  if (typeof identity === "string") {
    const key = identityKey(identity);
    return key ? [key] : [];
  }
  const seen = new Set<string>();
  for (const value of [
    identity.id,
    identity.studentId,
    identity.studentDbId,
    identity.studentCode,
    identity.matricule,
    identity.publicId,
  ]) {
    const key = identityKey(value);
    if (key) seen.add(key);
  }
  return [...seen];
}

export function obligationBelongsToStudent(
  fee: FinanceObligationProjection,
  identity: string | FinanceStudentIdentity,
): boolean {
  const wanted = new Set(collectFinanceStudentIdentityKeys(identity));
  if (!wanted.size) return false;
  const feeKeys = collectFinanceStudentIdentityKeys({
    studentId: fee.studentId,
    studentDbId: fee.studentDbId,
  });
  return feeKeys.some((key) => wanted.has(key));
}

export function findFinanceStudentOption<T extends object>(
  roster: T[],
  wanted: string,
): T | undefined {
  const key = identityKey(wanted);
  if (!key) return undefined;
  return roster.find((row) => {
    const rec = row as Record<string, unknown>;
    return collectFinanceStudentIdentityKeys({
      id: rec.id as string | undefined,
      studentId: rec.studentId as string | undefined,
      studentDbId: rec.studentDbId as string | undefined,
      studentCode: rec.studentCode as string | undefined,
      matricule: rec.matricule as string | undefined,
      publicId: rec.publicId as string | undefined,
    }).includes(key);
  });
}

export function parseFinanceAmount(value: unknown): number {
  const amount = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : Number.NaN;
}

export function isUnallocatedTarget(value: unknown): boolean {
  return trim(value) === UNALLOCATED_TARGET;
}

function financeObligationIdRequired(): Error & { code: string } {
  const error = new Error("FINANCE_OBLIGATION_ID_REQUIRED") as Error & { code: string };
  error.code = "FINANCE_OBLIGATION_ID_REQUIRED";
  return error;
}

function normalizeObligationStatus(status: unknown): string {
  return trim(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isOpenObligationFromProjection(fee: FinanceObligationProjection | null | undefined): boolean {
  if (!fee) return false;
  if (fee.archivedAt || fee.archived_at) return false;
  const status = normalizeObligationStatus(fee.status);
  if (
    status === "annule" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "paye" ||
    status === "exonere"
  ) {
    return false;
  }
  const balance = Number(fee.balance);
  return Number.isFinite(balance) && balance > 0;
}

export function collectOpenObligationsFromProjection(
  student: string | FinanceStudentIdentity,
  fees: FinanceObligationProjection[],
) {
  const wanted = collectFinanceStudentIdentityKeys(student);
  if (!wanted.length) return [];
  const open = [];
  for (const fee of fees) {
    const id = trim(fee.id ?? fee.obligationId);
    if (!id) continue;
    if (isUnallocatedTarget(id)) continue;
    if (!obligationBelongsToStudent(fee, student)) continue;
    if (!isOpenObligationFromProjection(fee)) continue;
    const balance = Number(fee.balance);
    const label = trim(fee.label) || trim(fee.feeType) || "Frais";
    open.push({
      obligationId: id,
      schoolFeeItemId: trim(fee.schoolFeeItemId ?? fee.school_fee_item_id),
      feeType: trim(fee.feeType) || label,
      feeTypeCode: trim(fee.feeTypeCode ?? fee.fee_type_code),
      label,
      periodLabel: trim(fee.periodLabel ?? fee.period_label),
      amountDue: Number(fee.amountDue ?? fee.amount_due),
      amountPaid: Number(fee.amountPaid ?? fee.amount_paid),
      exemption: Number(fee.exemption ?? 0),
      balance,
      status: trim(fee.status),
      dueDate: trim(fee.dueDate ?? fee.due_date),
      academicYear: trim(fee.academicYear ?? fee.academic_year),
      classId: trim(fee.classId ?? fee.class_id),
      className: trim(fee.className ?? fee.class_name),
      currency: trim(fee.currency),
    });
  }
  return open;
}

export function buildFinancePaymentItems(lines: FinancePaymentWriteLine[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const amount = typeof line.amount === "number" ? line.amount : parseFinanceAmount(line.amount);
    if (isUnallocatedTarget(line.obligationId)) {
      return { feeType: UNALLOCATED_FEE_TYPE, amount };
    }
    const obligationId = trim(line.obligationId);
    if (!obligationId) {
      throw financeObligationIdRequired();
    }
    const item: Record<string, unknown> = {
      obligationId,
      amount,
    };
    const feeType = trim(line.feeType || line.feeLabel || line.label);
    if (feeType && feeType !== UNALLOCATED_FEE_TYPE) item.feeType = feeType;
    const feeLabel = trim(line.feeLabel || line.label || feeType);
    if (feeLabel) item.feeLabel = feeLabel;
    return item;
  });
}

export function assertNoFeeTypeOnlyImputation(items: Array<Record<string, unknown>>): void {
  for (const item of items) {
    const obligationId = trim(item.obligationId);
    const feeType = trim(item.feeType || item.feeLabel || item.label);
    if (!obligationId && feeType !== UNALLOCATED_FEE_TYPE) {
      throw financeObligationIdRequired();
    }
  }
}

export function buildFinancePaymentWritePayload(input: {
  studentId: string;
  classId: string;
  method?: string;
  paymentMethod?: string;
  date?: string;
  paidAt?: string;
  comment?: string;
  items?: Array<Record<string, unknown>>;
  lines?: FinancePaymentWriteLine[];
}): Record<string, unknown> {
  const items = Array.isArray(input.items)
    ? input.items
    : buildFinancePaymentItems(input.lines ?? []);
  assertNoFeeTypeOnlyImputation(items);
  const method = trim(input.method || input.paymentMethod);
  const date = trim(input.date || input.paidAt);
  const payload: Record<string, unknown> = {
    studentId: trim(input.studentId),
    classId: trim(input.classId),
    method,
    paymentMethod: method,
    date,
    paidAt: date,
    items,
  };
  const comment = trim(input.comment);
  if (comment) payload.comment = comment;
  return payload;
}

export function presentPaymentCashFromProjection(payment: {
  amount?: number;
  totalAmount?: number;
  allocatedAmount?: number;
  unallocatedAmount?: number;
}) {
  const received = Number(payment?.amount ?? payment?.totalAmount ?? 0);
  const allocated = Number(payment?.allocatedAmount ?? 0);
  const unallocated = Number(payment?.unallocatedAmount ?? 0);
  return {
    received: Number.isFinite(received) ? received : 0,
    allocated: Number.isFinite(allocated) ? allocated : 0,
    unallocated: Number.isFinite(unallocated) ? unallocated : 0,
  };
}

export function isPendingPaymentStatus(status: unknown): boolean {
  const key = normalizeObligationStatus(status);
  return key.includes("attente") || key === "pending";
}

export function draftLineCash(lines: Array<{ obligationId?: string; amount?: string | number }>) {
  return lines.reduce(
    (acc, line) => {
      const amount = parseFinanceAmount(line.amount);
      if (!(amount > 0)) return acc;
      acc.received += amount;
      if (isUnallocatedTarget(line.obligationId)) acc.unallocated += amount;
      else acc.allocated += amount;
      return acc;
    },
    { received: 0, allocated: 0, unallocated: 0 },
  );
}
