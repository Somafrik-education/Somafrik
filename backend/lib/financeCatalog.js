"use strict";

/**
 * Catalogue financier d'établissement — projection PostgreSQL, pas un sac JSON.
 * Moyens de paiement et types de frais canoniques (serveur), jamais hardcodés client.
 */

const { asTrimmed, normalizeKey, money } = require("./financeManagement");
const { resolveFinanceSchoolScope, schoolRecordInFinanceScope } = require("./financeSchoolScope");
const { activeFeeTypeCatalog } = require("./financeFeeTypes");

const INACTIVE_STUDENT_STATUSES = new Set(["deleted", "archived", "inactive", "transferred", "sorti"]);

const CANONICAL_PAYMENT_METHODS = Object.freeze([
  { methodCode: "cash", label: "Espèces", sortOrder: 10 },
  { methodCode: "mobile_money", label: "Mobile money", sortOrder: 20 },
  { methodCode: "bank_transfer", label: "Virement bancaire", sortOrder: 30 },
  { methodCode: "card", label: "Carte bancaire", sortOrder: 40 },
  { methodCode: "cheque", label: "Chèque", sortOrder: 50 },
  { methodCode: "other", label: "Autre", sortOrder: 60 },
]);

const CANONICAL_FEE_TYPES = activeFeeTypeCatalog();

function isActiveStudentStatus(status) {
  const key = normalizeKey(status || "active");
  return !INACTIVE_STUDENT_STATUSES.has(key);
}

function foldPaymentStudentOptions(rows = []) {
  const folded = new Map();
  for (const row of rows) {
    const studentId = String(row.student_id || row.studentId || "").trim();
    if (!studentId) continue;
    if (!isActiveStudentStatus(row.student_status || row.status || row.studentStatus)) continue;
    const enrollmentStatus = String(row.enrollment_status || row.enrollmentStatus || "active").trim() || "active";
    if (normalizeKey(enrollmentStatus) !== "active" && normalizeKey(enrollmentStatus) !== "actif") continue;

    let item = folded.get(studentId);
    if (!item) {
      const firstName = String(row.first_name || row.firstName || "").trim();
      const lastName = String(row.last_name || row.lastName || "").trim();
      item = {
        studentId,
        studentCode: String(row.student_code || row.studentCode || "").trim(),
        firstName,
        lastName,
        classId: null,
        classCode: "",
        className: "",
        studentStatus: String(row.student_status || row.status || row.studentStatus || "active"),
        enrollmentStatus: "active",
        classes: [],
      };
      folded.set(studentId, item);
    }

    const classId = String(row.class_id || row.classId || "").trim();
    if (!classId) continue;
    if (item.classes.some((entry) => entry.classId === classId)) continue;
    const classEntry = {
      classId,
      classCode: String(row.class_code || row.classCode || "").trim(),
      className: String(row.class_name || row.className || "").trim(),
    };
    item.classes.push(classEntry);
    if (!item.classId) {
      item.classId = classEntry.classId;
      item.classCode = classEntry.classCode;
      item.className = classEntry.className;
    }
  }

  return [...folded.values()]
    .filter((item) => item.classId)
    .sort((left, right) => {
      const last = left.lastName.localeCompare(right.lastName, "fr");
      if (last) return last;
      const first = left.firstName.localeCompare(right.firstName, "fr");
      if (first) return first;
      const code = left.studentCode.localeCompare(right.studentCode, "fr");
      if (code) return code;
      return left.studentId.localeCompare(right.studentId);
    });
}

function mapPaymentMethodRow(row = {}, { persisted = true } = {}) {
  return {
    id: row.id ? String(row.id) : null,
    methodCode: String(row.method_code || row.methodCode || "").trim(),
    label: String(row.label || "").trim(),
    active: row.is_active !== false && row.active !== false,
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    persisted,
  };
}

function canonicalPaymentMethods() {
  return CANONICAL_PAYMENT_METHODS.map((item) =>
    mapPaymentMethodRow(
      {
        method_code: item.methodCode,
        label: item.label,
        is_active: true,
        sort_order: item.sortOrder,
      },
      { persisted: false },
    ),
  );
}

function resolveCatalogPaymentMethods(rows = []) {
  const mapped = rows.map((row) => mapPaymentMethodRow(row, { persisted: true }));
  if (!mapped.length) return canonicalPaymentMethods();
  return mapped.sort((left, right) => left.sortOrder - right.sortOrder || left.methodCode.localeCompare(right.methodCode));
}

function mapCatalogFeeType(row = {}) {
  return {
    itemId: row.id ? String(row.id) : null,
    gridId: row.fee_grid_id || row.gridId || row.grid_code || row.gridCode || null,
    feeType: String(row.fee_type || row.feeType || "").trim(),
    label: String(row.label || row.fee_type || row.feeType || "").trim(),
    amount: money(row.amount),
    currency: String(row.currency || "").trim().toUpperCase(),
    classId: row.class_id || row.classId || null,
    classCode: String(row.class_code || row.classCode || "").trim(),
    className: String(row.class_name || row.className || "").trim(),
    academicYear: String(row.academic_year || row.academicYear || "").trim(),
    dueDate: row.due_date || row.dueDate || null,
    periodLabel: String(row.period_label || row.periodLabel || "").trim(),
    mandatory: row.mandatory !== false,
    active: normalizeKey(row.status || "actif") === "actif",
  };
}

function filterRowsByPrincipal(rows, principal, schoolCodeOf) {
  const scope = resolveFinanceSchoolScope(principal);
  if (scope.mode === "none") return [];
  if (scope.mode === "all") return rows;
  return rows.filter((row) => schoolRecordInFinanceScope(row, scope));
}

function buildFinanceCatalog({ currency, currencySource, paymentMethods, feeTypes }) {
  return {
    currency: String(currency || "").trim().toUpperCase(),
    currencySource: currencySource || "country",
    paymentMethods: resolveCatalogPaymentMethods(paymentMethods),
    feeTypes: (feeTypes || []).map(mapCatalogFeeType).filter((item) => item.feeType && item.active),
    feeTypeCatalog: CANONICAL_FEE_TYPES.map((item) => ({ ...item })),
    canonicalFeeTypes: CANONICAL_FEE_TYPES.map((item) => ({ ...item })),
    discountsDeferred: true,
    penaltiesDeferred: true,
  };
}

module.exports = {
  CANONICAL_PAYMENT_METHODS,
  CANONICAL_FEE_TYPES,
  foldPaymentStudentOptions,
  isActiveStudentStatus,
  mapPaymentMethodRow,
  canonicalPaymentMethods,
  resolveCatalogPaymentMethods,
  mapCatalogFeeType,
  filterRowsByPrincipal,
  buildFinanceCatalog,
  asTrimmed,
};
