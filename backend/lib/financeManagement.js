"use strict";

const {
  isPaymentFinanciallyActive,
  obligationStatusFromBalance,
  toMoney,
} = require("./financeDomainInvariants");

const FINANCE_ERROR = Object.freeze({
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  PAYMENT_ALREADY_CANCELLED: "PAYMENT_ALREADY_CANCELLED",
  PAYMENT_REFERENCE_DUPLICATE: "PAYMENT_REFERENCE_DUPLICATE",
  PAYMENT_AMOUNT_INVALID: "PAYMENT_AMOUNT_INVALID",
  PAYMENT_ITEMS_REQUIRED: "PAYMENT_ITEMS_REQUIRED",
  PAYMENT_ITEM_AMOUNT_INVALID: "PAYMENT_ITEM_AMOUNT_INVALID",
  PAYMENT_FEE_TYPE_REQUIRED: "PAYMENT_FEE_TYPE_REQUIRED",
  FEE_ITEM_NOT_FOUND: "FEE_ITEM_NOT_FOUND",
  FEE_ITEM_TENANT_MISMATCH: "FEE_ITEM_TENANT_MISMATCH",
  CANCEL_REASON_REQUIRED: "CANCEL_REASON_REQUIRED",
  STUDENT_NOT_FOUND: "STUDENT_NOT_FOUND",
  ENROLLMENT_REQUIRED: "ENROLLMENT_REQUIRED",
  CLASS_REQUIRED: "CLASS_REQUIRED",
  CLASS_NOT_FOUND: "CLASS_NOT_FOUND",
  CLASS_STUDENT_MISMATCH: "CLASS_STUDENT_MISMATCH",
  CLASS_TENANT_MISMATCH: "CLASS_TENANT_MISMATCH",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  FEE_GRID_NOT_FOUND: "FEE_GRID_NOT_FOUND",
  FEE_GRID_NOT_ACTIVE: "FEE_GRID_NOT_ACTIVE",
  FEE_GRID_DUPLICATE: "FEE_GRID_DUPLICATE",
  OBLIGATION_NOT_FOUND: "OBLIGATION_NOT_FOUND",
  OBLIGATION_STUDENT_MISMATCH: "OBLIGATION_STUDENT_MISMATCH",
  OBLIGATION_TENANT_MISMATCH: "OBLIGATION_TENANT_MISMATCH",
  OBLIGATION_FEE_TYPE_MISMATCH: "OBLIGATION_FEE_TYPE_MISMATCH",
  ENROLLMENT_AMBIGUOUS: "FINANCE_ENROLLMENT_AMBIGUOUS",
  ENROLLMENT_NOT_FOUND: "FINANCE_ENROLLMENT_NOT_FOUND",
  CLASS_ENROLLMENT_MISMATCH: "FINANCE_CLASS_ENROLLMENT_MISMATCH",
  GRID_ENROLLMENT_MISMATCH: "FINANCE_GRID_ENROLLMENT_MISMATCH",
  NEEDS_EFFECTIVE_DATE: "FINANCE_NEEDS_EFFECTIVE_DATE",
  OBLIGATION_SYNC_FAILED: "FINANCE_OBLIGATION_SYNC_FAILED",
  REMINDER_COOLDOWN: "REMINDER_COOLDOWN",
  REMINDER_FORCE_FORBIDDEN: "REMINDER_FORCE_FORBIDDEN",
  NEGATIVE_BALANCE_FORBIDDEN: "NEGATIVE_BALANCE_FORBIDDEN",
});

function createFinanceError(statusCode, message, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return asTrimmed(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function money(value) {
  return toMoney(value);
}

function isPaymentCancelled(payment) {
  return !isPaymentFinanciallyActive(payment);
}

function isPaymentCounted(payment) {
  if (isPaymentCancelled(payment)) return false;
  const status = normalizeKey(payment?.status);
  return status !== "refuse" && status !== "échoué" && status !== "echoue";
}

function obligationStatus({ amountDue, amountPaid, exemption, dueDate, now = new Date() }) {
  return obligationStatusFromBalance({
    amountDue,
    paidAmount: amountPaid,
    exemptionAmount: exemption,
    dueDate,
    now,
  });
}

function generatePaymentReference(schoolCode, existingCodes = []) {
  const year = new Date().getFullYear();
  const prefix = `${asTrimmed(schoolCode || "ETAB").toUpperCase()}-${year}-PAY-`;
  let max = 0;
  for (const candidate of existingCodes) {
    const raw = asTrimmed(candidate);
    if (!raw.startsWith(prefix)) continue;
    const sequence = Number(raw.slice(prefix.length));
    if (Number.isFinite(sequence)) max = Math.max(max, sequence);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function resolvePaymentStatus(amount, remainingBefore, method, leftover = 0) {
  return require("./financeUnallocatedCash").resolvePaymentStatus(
    amount,
    remainingBefore,
    method,
    leftover,
  );
}

function mapDbStatusToBo(status) {
  const value = asTrimmed(status);
  if (value === "paid") return "PAYE";
  if (value === "pending") return "EN_ATTENTE";
  if (value === "cancelled") return "Annulé";
  return value || "EN_ATTENTE";
}

function mapBoStatusToDb(status) {
  const key = normalizeKey(status);
  if (key === "paye" || key === "payé" || key === "partiel" || key === "non impute" || key === "a imputer") {
    return "paid";
  }
  if (key === "annule" || key === "annulé") return "cancelled";
  if (key.includes("attente")) return "pending";
  return "pending";
}

function toIsoDate(value) {
  const raw = asTrimmed(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapPaymentRow(row) {
  const profile = parsePayload(row.profile_payload);
  const code = row.payment_code || profile.reference || row.id;
  const cancelled = Boolean(row.cancelled_at);
  return {
    id: code,
    publicId: code,
    reference: code,
    dbId: row.id,
    schoolCode: row.school_code || profile.schoolCode,
    studentId: profile.studentId || row.student_code || row.student_id,
    studentName: profile.studentName || "",
    classId: profile.classId || "",
    classCode: profile.classCode || "",
    className: profile.className || "",
    feeType: row.fee_type || profile.feeType || "",
    label: profile.label || row.fee_type || "",
    amount: money(row.amount),
    totalAmount: money(row.amount),
    currency: row.currency || profile.currency || "CDF",
    method: row.payment_method || profile.method || "",
    date: toIsoDate(row.payment_date) || profile.date || "",
    status: cancelled ? "Annulé" : profile.status || mapDbStatusToBo(row.payment_status),
    comment: profile.comment || row.description || "",
    verificationCode: profile.verificationCode || "",
    amountDue: profile.amountDue,
    remainingAfter: profile.remainingAfter,
    overpaymentAmount: profile.overpaymentAmount || 0,
    allocatedAmount: money(profile.allocatedAmount || 0),
    unallocatedAmount: money(profile.unallocatedAmount || profile.overpaymentAmount || 0),
    overpaymentAction: profile.overpaymentAction || "",
    receiptId: profile.receiptId || `REC-${code}`,
    createdAt: row.created_at,
    createdBy: profile.createdBy,
    createdByName: profile.createdByName,
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || profile.cancelReason || "",
    cancelledBy: row.cancelled_by || profile.cancelledBy || null,
    ...profile.extra,
  };
}

function mapObligationRow(row) {
  const profile = parsePayload(row.profile_payload);
  const amounts = obligationStatus({
    amountDue: row.amount_due,
    amountPaid: row.amount_paid,
    exemption: row.exemption,
    dueDate: row.due_date,
  });
  return {
    id: profile.publicId || row.id,
    dbId: row.id,
    studentId: profile.studentId || row.student_code || row.student_id,
    studentDbId: row.student_id,
    studentName: profile.studentName || "",
    schoolId: row.school_id,
    schoolCode: row.school_code || profile.schoolCode,
    className: profile.className || "",
    schoolFeeItemId: row.school_fee_item_id,
    sourceFeeItemId: row.source_fee_item_uuid || row.sourceFeeItemId || null,
    sourceEnrollmentId: row.source_enrollment_id || profile.sourceEnrollmentId || null,
    feeGridId: row.fee_grid_id,
    feeType: row.fee_type,
    feeTypeCode: row.fee_type_code || profile.feeTypeCode || "",
    label: row.label,
    currency: row.currency,
    academicYear: row.academic_year,
    periodLabel: row.period_label,
    periodKey: row.period_key || profile.periodKey || "",
    classId: row.class_id || profile.classId || "",
    initialAmount: money(row.initial_amount),
    discount: money(row.discount),
    exemption: money(row.exemption),
    amountDue: money(row.amount_due),
    amountPaid: money(row.amount_paid),
    balance: amounts.balance,
    status: row.archived_at ? "Annulé" : amounts.status,
    dueDate: toIsoDate(row.due_date),
    lastReminderAt: row.last_reminder_at,
    reminderCount: Number(row.reminder_count || 0),
    createdAt: row.created_at,
    archivedAt: row.archived_at || null,
    cancelReason: row.cancel_reason || profile.cancelReason || "",
    cancelledAt: row.cancelled_at || profile.cancelledAt || null,
    cancelledBy: row.cancelled_by || profile.cancelledBy || null,
  };
}

function mapGridRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.grid_code,
    dbId: row.id,
    schoolId: row.school_id || profile.schoolId || "",
    schoolCode: row.school_code || profile.schoolCode,
    name: row.name || profile.name || row.class_name,
    className: row.class_name,
    classId: row.class_id || profile.classId || "",
    classCode: row.class_code || profile.classCode || "",
    academicYear: row.academic_year,
    periodName: row.period_name,
    periodStart: profile.periodStart || "",
    periodEnd: profile.periodEnd || "",
    currency: row.currency,
    status: row.status,
    createdBy: profile.createdBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItemRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.item_code,
    dbId: row.id,
    feeGridId: profile.gridCode || row.grid_code,
    schoolCode: row.school_code || profile.schoolCode,
    feeType: row.fee_type,
    label: row.label,
    amount: money(row.amount),
    dueDate: toIsoDate(row.due_date),
    periodLabel: row.period_label,
    monthlyMonths: Array.isArray(row.monthly_months) ? row.monthly_months : parsePayload(row.monthly_months),
    mandatory: row.mandatory !== false,
    status: row.status,
  };
}

function mapReminderRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: profile.publicId || row.id,
    dbId: row.id,
    studentId: profile.studentId || row.student_code || row.student_id,
    schoolCode: row.school_code || profile.schoolCode,
    recipient: row.recipient,
    channel: row.channel,
    message: row.message,
    summary: row.summary,
    sendStatus: row.send_status,
    sentAt: row.sent_at,
    triggeredBy: profile.triggeredBy || row.triggered_by,
    triggeredByName: profile.triggeredByName,
  };
}

function mapStatusRow(row) {
  const profile = parsePayload(row.profile_payload);
  return {
    id: row.status_code,
    dbId: row.id,
    schoolCode: row.school_code || profile.schoolCode || "",
    code: row.status_code,
    label: row.label,
    status: row.is_active ? "Actif" : "Inactif",
    sortOrder: row.sort_order,
  };
}

function studentMatches(student, key) {
  const needle = asTrimmed(key);
  if (!needle) return false;
  const hay = [
    student.id,
    student.publicId,
    student.matricule,
    student.studentCode,
    student.student_code,
    student.loginCode,
    student.login_code,
    student.identityCode,
    student.identity_code,
  ]
    .map((value) => asTrimmed(value))
    .filter(Boolean);
  return hay.some((value) => value === needle || value.toUpperCase() === needle.toUpperCase());
}

function permissionSet(principal) {
  return new Set(
    (Array.isArray(principal?.permissions) ? principal.permissions : [])
      .map((value) => asTrimmed(value))
      .filter(Boolean),
  );
}

function hasAnyPermission(principal, expected) {
  const permissions = permissionSet(principal);
  return expected.some((permission) => permissions.has(permission));
}

function isSuperAdminPrincipal(principal) {
  const role = asTrimmed(principal?.role);
  return role === "Super Administrateur Somafrik" || role === "Super Administrateur OKAFRIK";
}

function canManageFeeGrids(principal) {
  return hasAnyPermission(principal, ["Frais & tarifs:CREATE", "Frais & tarifs:UPDATE"]);
}

function canManagePaymentMethods(principal) {
  return hasAnyPermission(principal, ["Frais & tarifs:UPDATE", "Paramètres Établissement:UPDATE"]);
}

function canAdjustStudentFee(principal) {
  return hasAnyPermission(principal, ["Paiements:UPDATE", "Frais & tarifs:UPDATE"]);
}

function canManagePaymentStatuses(principal) {
  return hasAnyPermission(principal, ["Paiements:UPDATE"]);
}

function canForceReminder(principal) {
  return hasAnyPermission(principal, ["Impayés:CREATE"]);
}

function classScopeSpec(classRef) {
  if (classRef && typeof classRef === "object") {
    return {
      classId: asTrimmed(classRef.classId || classRef.class_id),
      classCode: asTrimmed(classRef.classCode || classRef.class_code),
      className: asTrimmed(classRef.className || classRef.class_name),
    };
  }
  return { classId: "", classCode: "", className: asTrimmed(classRef) };
}

function studentMatchesClassScope(student, classRef) {
  const spec = classScopeSpec(classRef);
  if (spec.classId) {
    return [student.classId, student.class_id].some((value) => String(value ?? "") === spec.classId);
  }
  if (spec.classCode) {
    return normalizeKey(student.classCode || student.class_code) === normalizeKey(spec.classCode);
  }
  if (spec.className) {
    return normalizeKey(student.className || student.class_name) === normalizeKey(spec.className);
  }
  return false;
}

function financeAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? "",
    userAgent: typeof req?.get === "function" ? req.get("user-agent") : "",
  };
}

module.exports = {
  FINANCE_ERROR,
  createFinanceError,
  asTrimmed,
  normalizeKey,
  money,
  isPaymentCancelled,
  isPaymentCounted,
  obligationStatus,
  generatePaymentReference,
  resolvePaymentStatus,
  mapBoStatusToDb,
  toIsoDate,
  parsePayload,
  mapPaymentRow,
  mapObligationRow,
  mapGridRow,
  mapItemRow,
  mapReminderRow,
  mapStatusRow,
  studentMatches,
  studentMatchesClassScope,
  classScopeSpec,
  permissionSet,
  hasAnyPermission,
  isSuperAdminPrincipal,
  canManageFeeGrids,
  canManagePaymentMethods,
  canAdjustStudentFee,
  canManagePaymentStatuses,
  canForceReminder,
  financeAuditMetaFromRequest,
};