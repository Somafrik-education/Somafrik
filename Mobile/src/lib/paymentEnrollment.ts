/**
 * Résolution canonique classe pour un paiement scolaire Mobile.
 * Source d'autorité : inscriptions PostgreSQL actives de l'élève (classId UUID).
 * Jamais un className libre, ni la première classe de l'établissement.
 */

export type PaymentClassOption = {
  classId: string;
  classCode: string;
  className: string;
};

export type PaymentStudent = {
  id: string;
  name?: string;
  classId?: string | null;
  classCode?: string;
  className?: string;
  schoolCode?: string;
  enrollments?: Array<{
    status?: string;
    classId?: string | null;
    classCode?: string;
    className?: string;
  }>;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function isActiveEnrollment(status?: string): boolean {
  const normalized = trim(status).toLowerCase();
  return !normalized || normalized === "active" || normalized === "actif";
}

function pushClass(acc: PaymentClassOption[], input: { classId?: string | null; classCode?: string; className?: string }) {
  const classId = trim(input.classId);
  if (!classId) return;
  if (acc.some((row) => row.classId === classId)) return;
  acc.push({
    classId,
    classCode: trim(input.classCode),
    className: trim(input.className) || trim(input.classCode) || classId,
  });
}

/** Classes actives de l'élève, y compris lignes dupliquées du listing GET /students. */
export function collectActivePaymentClasses(studentId: string, students: PaymentStudent[]): PaymentClassOption[] {
  const wanted = trim(studentId);
  if (!wanted) return [];
  const acc: PaymentClassOption[] = [];
  for (const student of students) {
    if (trim(student.id) !== wanted) continue;
    const enrollments = Array.isArray(student.enrollments) ? student.enrollments : [];
    for (const enrollment of enrollments) {
      if (!isActiveEnrollment(enrollment.status)) continue;
      pushClass(acc, enrollment);
    }
    pushClass(acc, student);
  }
  return acc;
}

export function preselectPaymentClassId(studentId: string, students: PaymentStudent[]): string {
  const options = collectActivePaymentClasses(studentId, students);
  return options.length === 1 ? options[0].classId : "";
}

export function paymentClassBelongsToStudent(
  studentId: string,
  classId: string,
  students: PaymentStudent[],
): boolean {
  const wanted = trim(classId);
  if (!wanted) return false;
  return collectActivePaymentClasses(studentId, students).some((row) => row.classId === wanted);
}

export const UNALLOCATED_FEE_TYPE = "Non imputé";
export const UNALLOCATED_TARGET = "__unallocated__";

export type PaymentFeeOption = {
  obligationId: string;
  schoolFeeItemId: string;
  feeType: string;
  label: string;
  balance: number;
};

export type PaymentFeeRow = {
  id?: string;
  obligationId?: string;
  studentId?: string;
  status?: string;
  archivedAt?: string | null;
  archived_at?: string | null;
  balance?: number;
  amountDue?: number;
  amountPaid?: number;
  exemption?: number;
  feeType?: string;
  label?: string;
  schoolFeeItemId?: string;
};

export type FinancePaymentWriteLine = {
  obligationId?: string;
  amount: number | string;
  feeType?: string;
  feeLabel?: string;
  label?: string;
};

export function isUnallocatedTarget(value: unknown): boolean {
  return trim(value) === UNALLOCATED_TARGET;
}

function financeObligationIdRequired(): Error & { code: string } {
  const error = new Error("FINANCE_OBLIGATION_ID_REQUIRED") as Error & { code: string };
  error.code = "FINANCE_OBLIGATION_ID_REQUIRED";
  return error;
}

function isOpenObligation(fee: PaymentFeeRow): boolean {
  if (fee.archivedAt || fee.archived_at) return false;
  const status = trim(fee.status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

/** Dettes ouvertes de l'élève : l'identité métier est obligationId, jamais le libellé seul. */
export function collectOpenPaymentFees(studentId: string, fees: PaymentFeeRow[]): PaymentFeeOption[] {
  const wanted = trim(studentId).toUpperCase();
  if (!wanted) return [];
  return fees.flatMap((fee) => {
    if (trim(fee.studentId).toUpperCase() !== wanted) return [];
    if (!isOpenObligation(fee)) return [];
    const obligationId = trim(fee.id || fee.obligationId);
    if (!obligationId) return [];
    if (isUnallocatedTarget(obligationId)) return [];
    const balance = Number(fee.balance);
    const label = trim(fee.label) || trim(fee.feeType) || "Frais";
    return [
      {
        obligationId,
        schoolFeeItemId: trim(fee.schoolFeeItemId),
        feeType: trim(fee.feeType) || label,
        label,
        balance,
      },
    ];
  });
}

export function preselectPaymentObligationId(studentId: string, fees: PaymentFeeRow[]): string {
  const options = collectOpenPaymentFees(studentId, fees);
  if (options.length === 1) return options[0].obligationId;
  return UNALLOCATED_TARGET;
}

export function buildFinancePaymentItems(lines: FinancePaymentWriteLine[]): Array<Record<string, unknown>> {
  return lines.map((line) => {
    const amount = typeof line.amount === "number" ? line.amount : Number(line.amount);
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

function assertNoFeeTypeOnlyImputation(items: Array<Record<string, unknown>>) {
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
  method: string;
  date: string;
  comment?: string;
  items?: Array<Record<string, unknown>>;
  lines?: FinancePaymentWriteLine[];
}): Record<string, unknown> {
  const items = Array.isArray(input.items)
    ? input.items
    : buildFinancePaymentItems(input.lines ?? []);
  assertNoFeeTypeOnlyImputation(items);
  const method = trim(input.method);
  const date = trim(input.date);
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

/** Compat F4 : un reçu d'une ligne. Jamais feeType comme clé d'imputation. */
export function buildSchoolPaymentPayload(input: {
  studentId: string;
  classId: string;
  amount: number;
  feeType: string;
  method: string;
  date: string;
  obligationId?: string;
  schoolFeeItemId?: string;
}): Record<string, unknown> {
  return buildFinancePaymentWritePayload({
    studentId: input.studentId,
    classId: input.classId,
    method: input.method,
    date: input.date,
    lines: [
      {
        obligationId: input.obligationId,
        amount: input.amount,
        feeType: input.feeType,
        feeLabel: input.feeType,
      },
    ],
  });
}

export function paymentSubmitErrorMessage(outcome: "queued" | "failed" | string, error?: unknown): string {
  if (outcome === "queued" || outcome === "in_flight") {
    return "Paiement hors connexion refusé. Aucune file Finance.";
  }
  if (outcome === "blocked_sending") {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Cet envoi est déjà en cours de synchronisation. Attendez la confirmation avant un nouvel enregistrement.";
  }
  const message = error instanceof Error ? error.message.trim() : "";
  if (/OUTBOX_PERSIST_FAILED|OUTBOX_READ_FAILED/.test(message)) {
    return "Paiement hors connexion refusé. Aucune file Finance.";
  }
  if (message) return message;
  return "Enregistrement refusé.";
}

export function paymentStudentsFromOptions(
  rows: Array<{
    studentId?: string;
    firstName?: string;
    lastName?: string;
    classId?: string | null;
    classCode?: string;
    className?: string;
    classes?: Array<{ classId: string; classCode?: string; className?: string }>;
  }> = [],
): PaymentStudent[] {
  const students: PaymentStudent[] = [];
  for (const row of rows) {
    const id = trim(row.studentId);
    if (!id) continue;
    students.push({
      id,
      name: `${trim(row.firstName)} ${trim(row.lastName)}`.trim() || id,
      classId: row.classId ?? null,
      classCode: trim(row.classCode),
      className: trim(row.className),
      enrollments: (row.classes ?? []).map((klass) => ({
        status: "active",
        classId: klass.classId,
        classCode: klass.classCode,
        className: klass.className,
      })),
    });
  }
  return students;
}
