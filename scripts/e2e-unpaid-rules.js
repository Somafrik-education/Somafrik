/**
 * Règles métier impayés & relances (alignées web/src/lib/unpaidModule.ts).
 */
const { normalize } = require("./e2e-api-helpers");

const REMINDER_COOLDOWN_DAYS = 3;
const UNPAID_FEE_STATUSES = new Set(["À payer", "Partiellement payé", "En retard"]);

function parsePeriodDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isPeriodDateBefore(value, now = new Date()) {
  const date = parsePeriodDate(value);
  if (!date) return false;
  return startOfDay(date).getTime() < startOfDay(now).getTime();
}

function computeDaysLate(dueDate, now = new Date()) {
  if (!dueDate) return 0;
  const due = parsePeriodDate(dueDate);
  if (!due) return 0;
  const diff = startOfDay(now).getTime() - startOfDay(due).getTime();
  return diff > 0 ? Math.floor(diff / (1000 * 60 * 60 * 24)) : 0;
}

function refreshStudentFeeStatuses(fees, now = new Date()) {
  return fees.map((fee) => {
    const balance = Math.max(0, Number(fee.amountDue) - Number(fee.amountPaid) - Number(fee.exemption ?? 0));
    let status = fee.status;
    if (balance <= 0) status = "Payé";
    else if (fee.dueDate && isPeriodDateBefore(fee.dueDate, now) && balance > 0 && status === "À payer") {
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
  return isPeriodDateBefore(fee.dueDate, now);
}

function isPaymentCounted(payment) {
  const status = normalize(String(payment.status ?? ""));
  if (status.includes("annul")) return false;
  return !status.includes("echou") && !status.includes("brouillon");
}

function listUnpaidStudentFees(state, filters = {}, now = new Date()) {
  let fees = refreshStudentFeeStatuses(state.studentFees ?? [], now).filter((fee) => {
    if (!UNPAID_FEE_STATUSES.has(fee.status) || fee.balance <= 0) return false;
    return isOverdueStudentFee(fee, now) || fee.status === "En retard" || fee.status === "Partiellement payé";
  });

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
      const haystack = [fee.studentName, fee.studentId, fee.className, fee.label, fee.periodLabel]
        .map((value) => normalize(value))
        .join(" ");
      return haystack.includes(q);
    });
  }
  return fees;
}

function aggregateUnpaidByStudent(fees, reminders = [], now = new Date()) {
  const map = new Map();
  for (const fee of fees) {
    const list = map.get(fee.studentId) ?? [];
    list.push(fee);
    map.set(fee.studentId, list);
  }

  return [...map.entries()]
    .map(([studentId, studentFees]) => {
      const amountExpected = studentFees.reduce((sum, fee) => sum + fee.amountDue, 0);
      const amountPaid = studentFees.reduce((sum, fee) => sum + fee.amountPaid, 0);
      const amountDue = studentFees.reduce((sum, fee) => sum + fee.balance, 0);
      const primary = studentFees.sort(
        (a, b) => computeDaysLate(b.dueDate, now) - computeDaysLate(a.dueDate, now),
      )[0];
      const studentReminders = reminders.filter((row) => row.studentId === studentId);
      const periods = [...new Set(studentFees.map((fee) => fee.periodLabel ?? fee.academicYear).filter(Boolean))];

      return {
        studentId,
        studentName: primary.studentName,
        className: primary.className,
        schoolCode: primary.schoolCode,
        periodLabel: periods.length === 1 ? String(periods[0]) : periods.length > 1 ? "Plusieurs périodes" : "—",
        amountExpected,
        amountPaid,
        amountDue,
        currency: primary.currency,
        dueDate: primary.dueDate,
        reminderCount: studentReminders.length,
      };
    })
    .filter((row) => row.amountDue > 0)
    .sort((a, b) => b.amountDue - a.amountDue);
}

function filterRowsByMinAmount(rows, minAmount) {
  return rows.filter((row) => Number(row.amountDue ?? 0) >= Number(minAmount ?? 0));
}

function verifyAmountDueConsistency(row) {
  const expected = Number(row.amountExpected ?? 0) - Number(row.amountPaid ?? 0);
  const actual = Number(row.amountDue ?? 0);
  return { expected, actual, ok: expected === actual };
}

function settleStudentFees(studentFees, studentId, paymentAmount) {
  let remaining = paymentAmount;
  return studentFees.map((fee) => {
    if (fee.studentId !== studentId || fee.balance <= 0 || remaining <= 0) return fee;
    const pay = Math.min(remaining, fee.balance);
    remaining -= pay;
    const amountPaid = Number(fee.amountPaid ?? 0) + pay;
    const balance = Math.max(0, Number(fee.amountDue) - amountPaid - Number(fee.exemption ?? 0));
    return {
      ...fee,
      amountPaid,
      balance,
      status: balance <= 0 ? "Payé" : "Partiellement payé",
    };
  });
}

function scopedNotificationsForParent(state, schoolCode) {
  return (state.notifications ?? []).filter(
    (notification) => normalize(notification.schoolCode) === normalize(schoolCode),
  );
}

module.exports = {
  REMINDER_COOLDOWN_DAYS,
  listUnpaidStudentFees,
  aggregateUnpaidByStudent,
  filterRowsByMinAmount,
  verifyAmountDueConsistency,
  settleStudentFees,
  isPaymentCounted,
  scopedNotificationsForParent,
  refreshStudentFeeStatuses,
};
