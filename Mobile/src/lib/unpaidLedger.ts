/**
 * Ledger Impayés Mobile — obligations non soldées (même vérité que le Web).
 * Jamais paymentStats.pending. Classe / statut absents → « — », jamais inventés.
 */

export type UnpaidStudentRow = {
  studentId: string;
  studentName: string;
  className: string | null;
  schoolCode: string;
  amountDue: number;
  status: string;
  severity: string | null;
  daysLate: number | null;
  currency: string;
};

export type UnpaidGate = "ok" | "unauthenticated" | "forbidden";

export function parseUnpaidPayload(payload: unknown): UnpaidStudentRow[] {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rawRows = Array.isArray(root.rows) ? root.rows : Array.isArray(payload) ? payload : [];
  return rawRows
    .map(normalizeUnpaidStudentRow)
    .filter((row) => row.studentId && row.amountDue > 0);
}

export function normalizeUnpaidStudentRow(raw: unknown): UnpaidStudentRow {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const studentId = String(row.studentId ?? row.student_id ?? "").trim();
  const studentName = String(row.studentName ?? row.student_name ?? "").trim() || studentId;
  const classRaw = String(row.className ?? row.class_name ?? "").trim();
  const statusRaw = String(row.status ?? "").trim();
  const severityRaw = String(row.severity ?? "").trim();
  const daysLateRaw = row.daysLate ?? row.days_late;
  const daysLate = daysLateRaw == null || daysLateRaw === "" ? null : Number(daysLateRaw);
  return {
    studentId,
    studentName,
    className: classRaw || null,
    schoolCode: String(row.schoolCode ?? row.school_code ?? "").trim(),
    amountDue: Number(row.amountDue ?? row.amount_due ?? 0),
    status: statusRaw,
    severity: severityRaw || null,
    daysLate: Number.isFinite(daysLate) ? daysLate : null,
    currency: String(row.currency ?? "").trim(),
  };
}

export function unpaidStudentCount(rows: UnpaidStudentRow[], schoolCode?: string) {
  const scoped = schoolCode
    ? rows.filter((row) => !row.schoolCode || row.schoolCode === schoolCode)
    : rows;
  return new Set(scoped.filter((row) => row.amountDue > 0).map((row) => row.studentId)).size;
}

export function classifyUnpaidError(error: unknown): {
  gate: UnpaidGate;
  status: "error" | "offline";
  message: string;
} {
  const statusCode =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  if (statusCode === 401) {
    return { gate: "unauthenticated", status: "error", message: "Session expirée. Reconnectez-vous pour voir les impayés." };
  }
  if (statusCode === 403) {
    return { gate: "forbidden", status: "error", message: "Accès refusé — vous n'êtes pas autorisé à consulter les impayés." };
  }
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Impossible de charger les impayés.";
  const offline =
    statusCode == null || statusCode === 0
      ? /network|timeout|failed to fetch|network request failed/i.test(message)
      : false;
  return {
    gate: "ok",
    status: offline ? "offline" : "error",
    message,
  };
}

export function unpaidClassLabel(className: string | null | undefined) {
  const value = String(className ?? "").trim();
  return value || "—";
}

export function unpaidStatusLabel(row: Pick<UnpaidStudentRow, "status" | "severity">) {
  const status = String(row.status ?? "").trim();
  if (status) return status;
  const severity = String(row.severity ?? "").trim();
  if (severity) return severity;
  return "—";
}
