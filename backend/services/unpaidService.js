const { BusinessError } = require("./authService");

const REMINDER_COOLDOWN_DAYS = 3;
const UNPAID_FEE_STATUSES = new Set(["À payer", "Partiellement payé", "En retard"]);

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const { parsePeriodDate } = require("../lib/academicPeriods");

function startOfCalendarDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function isDueDatePast(dueDate, now = new Date()) {
  const due = parsePeriodDate(dueDate);
  if (!due) return false;
  return startOfCalendarDay(due).getTime() < startOfCalendarDay(now).getTime();
}

function computeDaysLate(dueDate, now = new Date()) {
  if (!dueDate) return 0;
  const due = parsePeriodDate(dueDate);
  if (!due) return 0;
  const diff = startOfCalendarDay(now).getTime() - startOfCalendarDay(due).getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

function computeUnpaidSeverity(daysLate) {
  if (daysLate <= 7) return "Retard léger";
  if (daysLate <= 30) return "Retard moyen";
  return "Retard critique";
}

function refreshStudentFeeStatuses(fees, now = new Date()) {
  return fees.map((fee) => {
    const balance = Math.max(0, Number(fee.amountDue) - Number(fee.amountPaid) - Number(fee.exemption ?? 0));
    let status = fee.status;
    if (balance <= 0) status = "Payé";
    else if (fee.dueDate && isDueDatePast(fee.dueDate, now) && balance > 0 && status === "À payer") {
      status = "En retard";
    }
    return { ...fee, balance, status };
  });
}

function isOverdueStudentFee(fee, now = new Date()) {
  if (fee.balance <= 0 || fee.status === "Payé" || fee.status === "Exonéré" || fee.status === "Annulé") {
    return false;
  }
  if (fee.status === "En retard") return true;
  if (!fee.dueDate) return false;
  return isDueDatePast(fee.dueDate, now);
}

function scopeFees(state, principal) {
  const fees = refreshStudentFeeStatuses(state.studentFees ?? []);
  const schoolCode = String(principal?.financeLoginCode || principal?.schoolCode || "").trim().toUpperCase();
  if (!schoolCode || schoolCode === "*") return fees;
  return fees.filter((fee) => String(fee.schoolCode ?? "").trim().toUpperCase() === schoolCode);
}

function listUnpaidFees(state, principal, filters = {}, now = new Date()) {
  let fees = scopeFees(state, principal).filter((fee) => {
    if (!UNPAID_FEE_STATUSES.has(fee.status) || fee.balance <= 0) return false;
    return isOverdueStudentFee(fee, now) || fee.status === "En retard" || fee.status === "Partiellement payé";
  });

  if (filters.className) {
    fees = fees.filter((fee) => normalize(fee.className) === normalize(filters.className));
  }
  if (filters.period) {
    fees = fees.filter(
      (fee) =>
        normalize(fee.periodLabel) === normalize(filters.period) ||
        normalize(fee.academicYear) === normalize(filters.period),
    );
  }
  if (filters.search) {
    const q = normalize(filters.search);
    fees = fees.filter((fee) => {
      const haystack = [fee.studentName, fee.studentId, fee.className, fee.label, fee.periodLabel]
        .map((value) => normalize(value))
        .join(" ");
      return haystack.includes(q);
    });
  }

  return fees;
}

function aggregateByStudent(fees, reminders, state, now = new Date()) {
  const map = new Map();
  for (const fee of fees) {
    const list = map.get(fee.studentId) ?? [];
    list.push(fee);
    map.set(fee.studentId, list);
  }

  return [...map.entries()].map(([studentId, studentFees]) => {
    const amountDue = studentFees.reduce((sum, fee) => sum + fee.balance, 0);
    const primary = studentFees.sort((a, b) => computeDaysLate(b.dueDate, now) - computeDaysLate(a.dueDate, now))[0];
    const daysLate = Math.max(...studentFees.map((fee) => computeDaysLate(fee.dueDate, now)), 0);
    const studentReminders = (reminders ?? []).filter((row) => row.studentId === studentId);
    const lastReminderAt = studentReminders.map((row) => row.sentAt).sort((a, b) => b.localeCompare(a))[0];
    const periods = [...new Set(studentFees.map((fee) => fee.periodLabel ?? fee.academicYear).filter(Boolean))];

    return {
      studentId,
      studentName: primary.studentName ?? studentId,
      className: primary.className,
      schoolCode: primary.schoolCode,
      periodLabel: periods.length === 1 ? String(periods[0]) : periods.length > 1 ? "Plusieurs périodes" : "—",
      amountExpected: studentFees.reduce((sum, fee) => sum + fee.amountDue, 0),
      amountPaid: studentFees.reduce((sum, fee) => sum + fee.amountPaid, 0),
      amountDue,
      currency: primary.currency,
      dueDate: primary.dueDate,
      daysLate,
      severity: computeUnpaidSeverity(daysLate),
      status: studentFees.some((fee) => fee.status === "En retard") ? "En retard" : "Partiellement payé",
      feeIds: studentFees.map((fee) => fee.id),
      lastReminderAt,
      reminderCount: studentReminders.length,
    };
  });
}

function buildDashboard(rows) {
  const byClassMap = new Map();
  for (const row of rows) {
    const entry = byClassMap.get(row.className) ?? { amountDue: 0, studentIds: new Set() };
    entry.amountDue += row.amountDue;
    entry.studentIds.add(row.studentId);
    byClassMap.set(row.className, entry);
  }
  return {
    totalAmountDue: rows.reduce((sum, row) => sum + row.amountDue, 0),
    studentCount: rows.length,
    currency: rows[0]?.currency ? String(rows[0].currency).trim().toUpperCase() : "",
    byClass: [...byClassMap.entries()].map(([className, stats]) => ({
      className,
      amountDue: stats.amountDue,
      studentCount: stats.studentIds.size,
    })),
  };
}

function canSendReminder(reminders, studentId, cooldownDays = REMINDER_COOLDOWN_DAYS, now = new Date()) {
  const recent = (reminders ?? [])
    .filter((row) => row.studentId === studentId && row.sendStatus !== "Échouée")
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  if (!recent) return { allowed: true };
  const daysSince = Math.floor((now.getTime() - new Date(recent.sentAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < cooldownDays) {
    return { allowed: false, lastReminderAt: recent.sentAt, daysRemaining: cooldownDays - daysSince };
  }
  return { allowed: true, lastReminderAt: recent.sentAt };
}

function buildReminderMessage(row, schoolName) {
  const establishment = schoolName ? ` (${schoolName})` : "";
  return (
    `Bonjour,\n\n` +
    `Nous vous rappelons que des frais scolaires restent dus pour ${row.studentName}${establishment}.\n\n` +
    `Période : ${row.periodLabel}\n` +
    `Montant restant : ${row.amountDue} ${row.currency}\n` +
    (row.dueDate ? `Échéance dépassée depuis ${row.daysLate} jour(s).\n\n` : "\n") +
    `Merci de régulariser votre situation auprès du service comptabilité.\n\n` +
    `— Somafrik`
  );
}

class UnpaidService {
  list(state, principal, filters = {}) {
    const reminders = state.paymentReminders ?? [];
    const fees = listUnpaidFees(state, principal, filters);
    const rows = aggregateByStudent(fees, reminders, state);
    return { rows, fees, dashboard: buildDashboard(rows) };
  }

  detail(state, principal, studentId) {
    const { fees, rows } = this.list(state, principal);
    const row = rows.find((item) => item.studentId === studentId);
    if (!row) throw new BusinessError(404, "Impayé introuvable pour cet élève");
    const studentFees = fees.filter((fee) => fee.studentId === studentId);
    const reminders = (state.paymentReminders ?? [])
      .filter((item) => item.studentId === studentId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const payments = (state.payments ?? []).filter((payment) => String(payment.studentId ?? "") === studentId);
    return { row, fees: studentFees, payments, reminders };
  }

  sendReminder(state, principal, studentId, payload = {}, { force = false } = {}) {
    const { rows } = this.list(state, principal);
    const row = rows.find((item) => item.studentId === studentId);
    if (!row) throw new BusinessError(404, "Impayé introuvable pour cet élève");

    const reminders = state.paymentReminders ?? [];
    const gate = canSendReminder(reminders, studentId);
    if (!gate.allowed && !force) {
      throw new BusinessError(
        409,
        `Relance récente (${gate.lastReminderAt}). Attendez ${gate.daysRemaining} jour(s) ou confirmez.`,
        gate,
      );
    }

    const school = (state.schools ?? []).find(
      (item) => String(item.code ?? "").trim().toUpperCase() === String(row.schoolCode).trim().toUpperCase(),
    );
    const message = String(payload.message ?? "").trim() || buildReminderMessage(row, school?.name);
    const reminder = {
      id: `REL-${Date.now().toString(36).toUpperCase()}`,
      studentId,
      schoolCode: row.schoolCode,
      recipient: payload.recipient ?? "Parent",
      channel: payload.channel ?? "notification",
      message,
      summary: `Relance ${row.amountDue} ${row.currency} — ${row.periodLabel}`,
      sentAt: new Date().toISOString(),
      sendStatus: payload.sendStatus ?? "Envoyée",
      triggeredBy: principal?.sub ?? principal?.identifier,
      triggeredByName: principal?.identifier ?? principal?.role,
    };

    const notification =
      payload.channel === "notification" || !payload.channel
        ? {
            id: `NOTIF-${Date.now().toString(36).toUpperCase()}`,
            title: "Relance de paiement",
            message: reminder.summary,
            type: "payment_reminder",
            channel: "app",
            status: "sent",
            schoolCode: row.schoolCode,
            targetRole: "Parent",
            createdAt: reminder.sentAt,
          }
        : null;

    const nextState = {
      ...state,
      paymentReminders: [reminder, ...reminders].slice(0, 500),
      notifications: notification ? [notification, ...(state.notifications ?? [])] : state.notifications ?? [],
      auditLog: [
        {
          id: `AUDIT-${Date.now().toString(36).toUpperCase()}`,
          at: reminder.sentAt,
          action: "Relance impayé",
          entityType: "student_fee",
          entityId: studentId,
          entityLabel: row.studentName,
          schoolCode: row.schoolCode,
          actorId: principal?.sub,
          actorName: principal?.identifier,
          actorRole: principal?.role,
          details: `${reminder.channel} — ${reminder.summary}`,
        },
        ...(state.auditLog ?? []),
      ].slice(0, 200),
    };

    return { reminder, state: nextState };
  }
}

module.exports = { UnpaidService, REMINDER_COOLDOWN_DAYS, computeDaysLate, computeUnpaidSeverity };
