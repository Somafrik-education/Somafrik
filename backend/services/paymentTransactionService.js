/**
 * Transaction atomique paiement : paiement + soldes + notification + audit (un seul save).
 */
const { BusinessError } = require("./authService");
const { assertPaymentWrite } = require("./dataIntegrityService");
const { isPaymentCounted, normalize } = require("../lib/dataIntegrityRules");

const DEFAULT_FEE_AMOUNTS = {
  Inscription: 50_000,
  "Réinscription": 40_000,
  "Minerval / scolarité": 100_000,
  "Frais d'examen": 15_000,
  "Frais de bulletin": 10_000,
  "Frais de transport": 30_000,
  "Frais de cantine": 25_000,
  "Autre frais": 20_000,
};

function findStudent(students, studentId) {
  const key = String(studentId ?? "").trim();
  return (students ?? []).find((item) =>
    [item.id, item.publicId, item.matricule].some((value) => String(value ?? "").trim() === key),
  );
}

function computeFeeBalance(studentId, feeType, payments, currency, studentFees = []) {
  const matchingFees = studentFees.filter(
    (fee) =>
      String(fee.studentId ?? "") === String(studentId) &&
      fee.status !== "Annulé" &&
      normalize(String(fee.feeType ?? fee.label ?? "")) === normalize(feeType),
  );

  const paymentTotal = payments
    .filter(
      (payment) =>
        String(payment.studentId ?? "") === String(studentId) &&
        normalize(String(payment.feeType ?? payment.label ?? "")) === normalize(feeType) &&
        isPaymentCounted(payment),
    )
    .reduce((total, payment) => total + Number(payment.amount ?? 0), 0);

  if (matchingFees.length) {
    const amountDue = matchingFees.reduce((sum, fee) => sum + Number(fee.amountDue ?? 0), 0);
    const balanceFromFees = matchingFees.reduce((sum, fee) => sum + Number(fee.balance ?? 0), 0);
    const paidFromFees = amountDue - balanceFromFees;
    const amountPaid = Math.max(paidFromFees, paymentTotal);
    return {
      amountDue,
      amountPaid,
      remaining: Math.max(0, amountDue - amountPaid),
      currency,
    };
  }

  const amountDue = DEFAULT_FEE_AMOUNTS[feeType] ?? 0;
  return {
    amountDue,
    amountPaid: paymentTotal,
    remaining: Math.max(0, amountDue - paymentTotal),
    currency,
  };
}

function generatePaymentReference(schoolCode, payments = []) {
  const year = new Date().getFullYear();
  const prefix = `${String(schoolCode ?? "ETAB").trim().toUpperCase()}-${year}-PAY-`;
  let max = 0;
  for (const payment of payments) {
    for (const candidate of [payment.publicId, payment.reference, payment.id]) {
      const raw = String(candidate ?? "");
      if (!raw.startsWith(prefix)) continue;
      const sequence = Number(raw.slice(prefix.length));
      if (Number.isFinite(sequence)) max = Math.max(max, sequence);
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function resolvePaymentStatus(amount, remainingBefore, method) {
  if (method === "Mobile money") return "En attente de confirmation";
  if (remainingBefore <= 0) return "Payé";
  if (amount >= remainingBefore) return "Payé";
  return "Partiel";
}

function applyPaymentToStudentFees(studentFees = [], payment) {
  if (!isPaymentCounted(payment)) return studentFees;
  const studentId = String(payment.studentId ?? "");
  const feeType = normalize(String(payment.feeType ?? payment.label ?? ""));
  const amount = Number(payment.amount ?? 0);

  return studentFees.map((fee) => {
    if (String(fee.studentId ?? "") !== studentId) return fee;
    if (normalize(String(fee.feeType ?? fee.label ?? "")) !== feeType) return fee;
    const amountPaid = Number(fee.amountPaid ?? 0) + amount;
    const amountDue = Number(fee.amountDue ?? 0);
    const exemption = Number(fee.exemption ?? 0);
    const balance = Math.max(0, amountDue - amountPaid - exemption);
    return { ...fee, amountPaid, balance, updatedAt: new Date().toISOString() };
  });
}

function buildParentNotification(payment, student) {
  const amount = Number(payment.amount ?? 0);
  const currency = String(payment.currency ?? "CDF");
  const formatted = new Intl.NumberFormat("fr-FR").format(amount);
  const name = `${student.firstName ?? ""} ${student.lastName ?? student.name ?? ""}`.trim();
  return {
    id: `NOTIF-PAY-${String(payment.id ?? Date.now())}`,
    audience: "Parents",
    schoolCode: student.schoolCode,
    title: "Paiement enregistré",
    message: `Paiement de ${formatted} ${currency} (${String(payment.feeType ?? payment.label ?? "frais")}) enregistré pour ${name}. Réf. ${String(payment.reference ?? "")}.`,
    type: "Paiement",
    priority: "Normal",
    channels: ["Somafrik"],
    status: "Non lu",
    date: String(payment.date ?? ""),
    createdBy: String(payment.createdByName ?? "Système"),
  };
}

function buildAuditEntry(payment, principal) {
  return {
    id: `AUDIT-PAY-${Date.now()}`,
    action: "payment.create",
    entityType: "payment",
    entityId: String(payment.id ?? ""),
    entityLabel: String(payment.reference ?? ""),
    schoolCode: payment.schoolCode,
    actorId: principal?.sub,
    actorRole: principal?.role,
    date: new Date().toISOString(),
  };
}

/**
 * Applique un paiement de façon atomique sur l'état (rollback implicite si save échoue).
 */
function applyAtomicPayment(state, payload, principal) {
  const student = findStudent(state.students, payload.studentId);
  if (!student) throw new BusinessError(404, "Élève introuvable");

  const school = (state.schools ?? []).find(
    (item) => String(item.code ?? "").toUpperCase() === String(student.schoolCode ?? "").toUpperCase(),
  );
  const currency = String(school?.currency ?? payload.currency ?? "CDF");
  const payments = state.payments ?? [];
  const studentFees = state.studentFees ?? [];

  const balance = computeFeeBalance(
    student.id,
    payload.feeType,
    payments,
    currency,
    studentFees,
  );

  const reference = payload.reference?.trim() || generatePaymentReference(student.schoolCode, payments);
  const amount = Number(payload.amount);
  const remainingBefore = balance.remaining;
  const overpayment = Math.max(0, amount - remainingBefore);
  const now = new Date().toISOString();
  const actorName = `${principal?.firstName ?? ""} ${principal?.lastName ?? ""}`.trim() || principal?.identifier;

  const payment = {
    id: reference,
    publicId: reference,
    reference,
    schoolCode: student.schoolCode,
    studentId: student.id,
    studentName: `${student.firstName ?? ""} ${student.lastName ?? student.name ?? ""}`.trim(),
    className: student.className,
    feeType: payload.feeType,
    label: payload.feeType,
    amount,
    currency,
    method: payload.method,
    date: payload.date,
    status: resolvePaymentStatus(amount, remainingBefore, payload.method),
    comment: String(payload.comment ?? "").trim(),
    schoolYear: payload.schoolYear ?? "",
    verificationCode: `VF-${reference.replace(/[^A-Z0-9]/gi, "").slice(-12)}`,
    amountDue: balance.amountDue,
    amountPaidBefore: balance.amountPaid,
    remainingAfter: Math.max(0, remainingBefore - amount),
    overpaymentAmount: overpayment > 0 ? overpayment : 0,
    overpaymentAction: overpayment > 0 ? payload.overpaymentAction ?? "À confirmer" : "",
    createdAt: now,
    createdBy: principal?.sub,
    createdByName: actorName,
    recordedAt: now,
  };

  assertPaymentWrite(state, payment);

  const nextStudentFees = applyPaymentToStudentFees(studentFees, payment);
  const notification = buildParentNotification(payment, student);
  const auditEntry = buildAuditEntry(payment, principal);

  return {
    payment,
    nextState: {
      ...state,
      payments: [payment, ...payments],
      studentFees: nextStudentFees,
      notifications: [notification, ...(state.notifications ?? [])],
      auditLog: [auditEntry, ...(state.auditLog ?? [])].slice(0, 200),
    },
  };
}

module.exports = {
  applyAtomicPayment,
  computeFeeBalance,
  generatePaymentReference,
};
