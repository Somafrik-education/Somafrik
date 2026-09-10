export type UnpaidStudentRow = {
  studentId: string;
  studentName: string;
  className?: string;
  schoolCode: string;
  periodLabel?: string;
  amountExpected: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  dueDate?: string;
  daysLate: number;
  severity?: string;
  status?: string;
};

export type UnpaidLedger = {
  rows: UnpaidStudentRow[];
  studentCount: number;
  totalAmountDue: number;
  currency: string;
  totalsByCurrency: Array<{ currency: string; amount: number }>;
};

export type UnpaidLedgerStatus =
  | "hidden"
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "unauthenticated"
  | "forbidden"
  | "offline"
  | "error";

export type UnpaidLedgerState = UnpaidLedger & {
  status: UnpaidLedgerStatus;
  errorMessage?: string;
};

export const EMPTY_UNPAID_LEDGER: UnpaidLedger = {
  rows: [],
  studentCount: 0,
  totalAmountDue: 0,
  currency: "",
  totalsByCurrency: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function schoolCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeUnpaidStudentRow(value: unknown): UnpaidStudentRow | null {
  const row = asRecord(value);
  const studentId = String(row.studentId ?? row.student_id ?? "").trim();
  const rowSchoolCode = schoolCode(row.schoolCode ?? row.school_code);
  if (!studentId || !rowSchoolCode) return null;

  return {
    studentId,
    studentName: String(row.studentName ?? row.student_name ?? studentId).trim() || studentId,
    className: String(row.className ?? row.class_name ?? "").trim() || undefined,
    schoolCode: rowSchoolCode,
    periodLabel: String(row.periodLabel ?? row.period_label ?? "").trim() || undefined,
    amountExpected: finiteNumber(row.amountExpected ?? row.amount_expected),
    amountPaid: finiteNumber(row.amountPaid ?? row.amount_paid),
    amountDue: Math.max(0, finiteNumber(row.amountDue ?? row.amount_due ?? row.balance)),
    currency: String(row.currency ?? "").trim().toUpperCase(),
    dueDate: String(row.dueDate ?? row.due_date ?? "").trim() || undefined,
    daysLate: Math.max(0, finiteNumber(row.daysLate ?? row.days_late)),
    severity: String(row.severity ?? "").trim() || undefined,
    status: String(row.status ?? "").trim() || undefined,
  };
}

/**
 * Défense en profondeur tenant : le serveur reste l'autorité, mais une ligne
 * d'une autre école n'est jamais présentée si un scope explicite est actif.
 */
export function normalizeUnpaidLedger(payload: unknown, requestedSchoolCode?: string | null): UnpaidLedger {
  const body = asRecord(payload);
  const requested = schoolCode(requestedSchoolCode);
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .map(normalizeUnpaidStudentRow)
    .filter((row): row is UnpaidStudentRow => Boolean(row))
    .filter((row) => !requested || row.schoolCode === requested)
    .filter((row) => row.amountDue > 0);

  const groupedTotals = new Map<string, number>();
  for (const row of rows) {
    groupedTotals.set(row.currency, (groupedTotals.get(row.currency) ?? 0) + row.amountDue);
  }
  const totalsByCurrency = [...groupedTotals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency, "fr"));
  const singleCurrencyTotal = totalsByCurrency.length === 1 ? totalsByCurrency[0] : undefined;

  return {
    rows,
    studentCount: new Set(rows.map((row) => row.studentId)).size,
    totalAmountDue: singleCurrencyTotal?.amount ?? 0,
    currency: singleCurrencyTotal?.currency ?? "",
    totalsByCurrency,
  };
}

export function classifyUnpaidLedgerFailure(error: unknown): Pick<UnpaidLedgerState, "status" | "errorMessage"> {
  const statusCode =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;

  if (statusCode === 401) {
    return {
      status: "unauthenticated",
      errorMessage: "Session expirée. Reconnectez-vous pour consulter les impayés.",
    };
  }
  if (statusCode === 403) {
    return {
      status: "forbidden",
      errorMessage: "Accès refusé. Le droit Impayés:READ est requis.",
    };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const offline =
    statusCode === 0 ||
    normalized.includes("hors ligne") ||
    normalized.includes("network") ||
    normalized.includes("connexion") ||
    normalized.includes("serveur injoignable");

  return offline
    ? { status: "offline", errorMessage: "Connexion requise pour actualiser les impayés." }
    : { status: "error", errorMessage: message.trim() || "Impossible de charger les impayés." };
}

export function unpaidLedgerMetricValue(state: UnpaidLedgerState): string {
  return state.status === "success" || state.status === "empty" ? String(state.studentCount) : "—";
}

export function unpaidLedgerStateMessage(state: UnpaidLedgerState): string | null {
  if (["unauthenticated", "forbidden", "offline", "error"].includes(state.status)) {
    return state.errorMessage ?? "Impossible de charger les impayés.";
  }
  return null;
}
