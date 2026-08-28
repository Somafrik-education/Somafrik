"use strict";

/**
 * LOT 4 — opérations Finance autoritatives (paiement, annulation, grilles, reminders).
 * Le store (PostgreSQL ou mémoire) fournit la persistance transactionnelle.
 * Tenant dérivé du principal + élève ; les champs client schoolId/createdBy/triggeredBy sont ignorés.
 */

const {
  FINANCE_ERROR,
  createFinanceError,
  asTrimmed,
  money,
  isPaymentCancelled,
  isPaymentCounted,
  obligationStatus,
  generatePaymentReference,
  toIsoDate,
  studentMatches,
  canForceReminder,
  requireSchoolCurrency,
} = require("./financeManagement");
const {
  resolvePaymentMethod,
  resolvePaidAt,
  decoratePaymentWithItems,
  normalizeWriteItems,
  assertItemAmount,
} = require("./financePaymentItems");
const { obligationMatchesPaymentFeeType } = require("./financeFeeTypeMatch");
const { persistableFeeType, isUnallocatedFeeTypeInput } = require("./financeFeeTypes");
const { projectPaymentCash, resolvePaymentStatus: resolveUnallocatedPaymentStatus } = require("./financeUnallocatedCash");
const {
  assertPaymentConservation,
  assertCompatibleCurrency,
} = require("./financeDomainInvariants");
const {
  OBLIGATION_LIFECYCLE_REASON,
  ensureEnrollmentFinanceObligations,
  ensureEnrollmentFinanceObligationsInTx,
} = require("./financeObligationLifecycle");
const {
  resolveFinanceSchoolScope,
  schoolCodeInScope,
  schoolRecordInFinanceScope,
  primaryFinanceSchoolCode,
} = require("./financeSchoolScope");

const REMINDER_COOLDOWN_DAYS = 3;

const F4_ERROR = Object.freeze({
  OBLIGATION_ID_REQUIRED: "FINANCE_OBLIGATION_ID_REQUIRED",
  OBLIGATION_NOT_OPEN: "FINANCE_OBLIGATION_NOT_OPEN",
  LEGACY_RECONCILE_DISABLED: "FINANCE_LEGACY_RECONCILE_DISABLED",
});

function ignoreClientScope(payload = {}) {
  const next = { ...payload };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.country;
  delete next.createdBy;
  delete next.triggeredBy;
  return next;
}

function assertTenant(principal, target) {
  const scope = resolveFinanceSchoolScope(principal);
  if (target && typeof target === "object") {
    if (!schoolRecordInFinanceScope(target, scope)) {
      throw createFinanceError(403, "Accès refusé : établissement hors périmètre.", FINANCE_ERROR.TENANT_MISMATCH);
    }
    return;
  }
  if (scope.mode === "country") {
    throw createFinanceError(403, "Accès refusé : établissement hors périmètre.", FINANCE_ERROR.TENANT_MISMATCH);
  }
  if (!schoolCodeInScope(target, scope)) {
    throw createFinanceError(403, "Accès refusé : établissement hors périmètre.", FINANCE_ERROR.TENANT_MISMATCH);
  }
}

function resolveActorSchoolCode(principal, rawPayload = {}) {
  const scope = resolveFinanceSchoolScope(principal);
  if (scope.mode === "none") {
    throw createFinanceError(403, "Accès refusé : établissement hors périmètre.", FINANCE_ERROR.TENANT_MISMATCH);
  }
  if (scope.mode === "schools") {
    return primaryFinanceSchoolCode(principal);
  }
  const requested = asTrimmed(rawPayload.schoolCode);
  if (!requested) {
    throw createFinanceError(400, "Établissement requis.", FINANCE_ERROR.TENANT_MISMATCH);
  }
  return requested;
}

function actorName(principal) {
  return `${principal?.firstName ?? ""} ${principal?.lastName ?? ""}`.trim() || principal?.identifier || principal?.role;
}

function canCancelPayment(principal) {
  const permissions = new Set(principal?.permissions ?? []);
  return (
    permissions.has("Paiements:UPDATE") ||
    permissions.has("Gérer paiements") ||
    permissions.has("ALL_PRIVILEGES")
  );
}

function assertCanCancelPayment(principal) {
  if (canCancelPayment(principal)) return;
  throw createFinanceError(403, "Permission Paiements:UPDATE requise pour annuler un paiement.");
}

async function resolvePaymentEnrollment(tx, student, payload, school) {
  const requestedClassId = asTrimmed(payload.classId);
  const enrollments =
    typeof tx.listActiveEnrollmentsForStudent === "function"
      ? await tx.listActiveEnrollmentsForStudent(student.dbId || student.id, school.id)
      : [];

  if (requestedClassId) {
    const match = enrollments.find((row) => String(row.classId) === requestedClassId);
    if (match) {
      if (match.schoolId && String(match.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Classe hors établissement.", FINANCE_ERROR.CLASS_TENANT_MISMATCH);
      }
      return match;
    }
    if (typeof tx.getClassById === "function") {
      const klass = await tx.getClassById(requestedClassId);
      if (!klass) {
        throw createFinanceError(404, "Classe introuvable.", FINANCE_ERROR.CLASS_NOT_FOUND);
      }
      if (String(klass.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Classe hors établissement.", FINANCE_ERROR.CLASS_TENANT_MISMATCH);
      }
    }
    throw createFinanceError(403, "Classe non rattachée à cet élève.", FINANCE_ERROR.CLASS_STUDENT_MISMATCH);
  }

  if (!enrollments.length) {
    throw createFinanceError(400, "Cet élève n'a aucune inscription active.", FINANCE_ERROR.ENROLLMENT_REQUIRED);
  }
  if (enrollments.length > 1) {
    throw createFinanceError(
      400,
      "Classe obligatoire : plusieurs inscriptions actives.",
      FINANCE_ERROR.CLASS_REQUIRED,
    );
  }
  return enrollments[0];
}

function identityKeys(...values) {
  return [...new Set(values.map((value) => asTrimmed(value)).filter(Boolean))];
}

function catalogKeysForItem(item) {
  return new Set(identityKeys(item.feeTypeId, item.catalogItemId, item.schoolFeeItemId));
}

function findObligationInList(obligations, obligationId) {
  const key = asTrimmed(obligationId);
  return (
    obligations.find((fee) => identityKeys(fee.dbId, fee.id).includes(key)) || null
  );
}

function obligationBelongsToSchool(obligation, school) {
  if (obligation.schoolId && String(obligation.schoolId) !== String(school.id)) return false;
  const code = asTrimmed(obligation.schoolCode).toUpperCase();
  const expected = asTrimmed(school.code).toUpperCase();
  if (code && expected && code !== expected) return false;
  return true;
}

function obligationBelongsToStudent(obligation, student) {
  const studentKeys = new Set(identityKeys(student.dbId, student.id, student.publicId, student.studentCode));
  const obligationKeys = identityKeys(obligation.studentDbId, obligation.studentId);
  if (!obligationKeys.length || !studentKeys.size) return false;
  return obligationKeys.some((key) => studentKeys.has(key));
}

function obligationMatchesResolvedCatalog(obligation, item) {
  const keys = catalogKeysForItem(item);
  if (!keys.size) return true;
  const oblKey = asTrimmed(obligation.schoolFeeItemId);
  if (!oblKey) return obligationMatchesPaymentFeeType(obligation, item.feeType);
  return keys.has(oblKey);
}

function throwObligationConflict(message, code) {
  throw createFinanceError(409, message, code);
}

async function lookupObligation(tx, obligationId) {
  if (typeof tx.getObligationByPublicId === "function") {
    const byPublic = await tx.getObligationByPublicId(obligationId);
    if (byPublic) return byPublic;
  }
  if (typeof tx.getObligation === "function") {
    const byId = await tx.getObligation(obligationId);
    if (byId) return byId;
  }
  return null;
}

function isOpenObligation(fee) {
  if (!fee) return false;
  if (fee.archivedAt || fee.archived_at || fee.archived) return false;
  if (["Annulé", "Payé", "Exonéré"].includes(fee.status)) return false;
  return money(fee.balance) > 0;
}

async function openObligationsForItem(tx, obligations, item, student, school) {
  const obligationId = asTrimmed(item.obligationId);
  if (!obligationId) {
    if (!asTrimmed(item.feeType) || isUnallocatedFeeTypeInput(item.feeType)) return [];
    throw createFinanceError(
      400,
      "obligationId est requis pour imputer un paiement à une dette. Sans obligationId, utilisez Non imputé.",
      F4_ERROR.OBLIGATION_ID_REQUIRED,
    );
  }

  let target = findObligationInList(obligations, obligationId);
  if (!target) {
    target = await lookupObligation(tx, obligationId);
  }
  if (!target) {
    throw createFinanceError(404, "Frais introuvable pour cet élève.", FINANCE_ERROR.OBLIGATION_NOT_FOUND);
  }
  if (!obligationBelongsToSchool(target, school)) {
    throwObligationConflict(
      "Cette obligation n'appartient pas à l'établissement courant.",
      FINANCE_ERROR.OBLIGATION_TENANT_MISMATCH,
    );
  }
  if (!obligationBelongsToStudent(target, student)) {
    throwObligationConflict(
      "Cette obligation n'appartient pas à l'élève courant.",
      FINANCE_ERROR.OBLIGATION_STUDENT_MISMATCH,
    );
  }
  assertCompatibleCurrency({
    payment: { currency: requireSchoolCurrency(school) },
    obligation: target,
  });
  if (asTrimmed(item.feeTypeId) || asTrimmed(item.catalogItemId)) {
    if (!obligationMatchesResolvedCatalog(target, item)) {
      throwObligationConflict(
        "Cette obligation ne correspond pas au type de frais indiqué.",
        FINANCE_ERROR.OBLIGATION_FEE_TYPE_MISMATCH,
      );
    }
  } else if (item.feeType && !isUnallocatedFeeTypeInput(item.feeType) && !obligationMatchesPaymentFeeType(target, item.feeType)) {
    throwObligationConflict(
      "Cette obligation ne correspond pas au type de frais indiqué.",
      FINANCE_ERROR.OBLIGATION_FEE_TYPE_MISMATCH,
    );
  }
  if (!item.feeType && target.feeType) {
    item.feeType = persistableFeeType(target.feeType);
    if (!item.feeLabel || isUnallocatedFeeTypeInput(item.feeLabel) || item.feeLabel === "Non imputé") {
      item.feeLabel = target.label || item.feeType;
    }
  }
  if (!isOpenObligation(target)) {
    throw createFinanceError(
      409,
      "Cette obligation n'est plus ouverte et ne peut pas recevoir une nouvelle imputation.",
      F4_ERROR.OBLIGATION_NOT_OPEN,
      { obligationId },
    );
  }
  return [target];
}

function allocateAmount(obligations, amount) {
  let remaining = money(amount);
  const allocations = [];
  const updated = obligations.map((fee) => {
    if (remaining <= 0) return fee;
    const open = money(fee.balance);
    if (open <= 0) return fee;
    const applied = Math.min(open, remaining);
    remaining = money(remaining - applied);
    const amountPaid = money(fee.amountPaid + applied);
    const next = obligationStatus({
      amountDue: fee.amountDue,
      amountPaid,
      exemption: fee.exemption,
      dueDate: fee.dueDate,
    });
    allocations.push({ obligationId: fee.dbId || fee.id, amount: applied });
    return { ...fee, amountPaid, balance: next.balance, status: next.status };
  });
  return { updated, allocations, leftover: remaining };
}

function reverseAllocationsOnFees(obligations, allocations) {
  const byId = new Map(allocations.map((row) => [String(row.obligationId), money(row.amount)]));
  return obligations.map((fee) => {
    const applied = byId.get(String(fee.dbId || fee.id));
    if (!applied) return fee;
    const amountPaid = Math.max(0, money(fee.amountPaid - applied));
    const next = obligationStatus({
      amountDue: fee.amountDue,
      amountPaid,
      exemption: fee.exemption,
      dueDate: fee.dueDate,
    });
    return { ...fee, amountPaid, balance: next.balance, status: next.status };
  });
}

async function writeFinanceAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordFinanceAudit !== "function") {
    throw createFinanceError(500, "Audit Finance indisponible dans la transaction.");
  }
  await tx.recordFinanceAudit({
    schoolCode: entry.schoolCode || primaryFinanceSchoolCode(principal) || principal?.schoolCode,
    userId: principal?.sub || principal?.id,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

async function resolveCatalogFeeItem(tx, schoolId, feeTypeId) {
  const key = asTrimmed(feeTypeId);
  if (!key) return null;
  if (typeof tx.getSchoolFeeItemById !== "function") {
    throw createFinanceError(404, "Type de frais introuvable.", FINANCE_ERROR.FEE_ITEM_NOT_FOUND);
  }
  const catalog = await tx.getSchoolFeeItemById(key, schoolId);
  if (catalog) return catalog;
  if (typeof tx.getSchoolFeeItemByIdAnySchool === "function") {
    const foreign = await tx.getSchoolFeeItemByIdAnySchool(key);
    if (foreign) {
      throw createFinanceError(
        403,
        "Type de frais hors établissement.",
        FINANCE_ERROR.FEE_ITEM_TENANT_MISMATCH,
      );
    }
  }
  throw createFinanceError(404, "Type de frais introuvable.", FINANCE_ERROR.FEE_ITEM_NOT_FOUND);
}

async function reconcileHistoricalPaymentAllocations(_store, _principal, _auditMeta, _options = {}) {
  throw createFinanceError(
    409,
    "La réconciliation automatique par type de frais est désactivée. Une imputation F4 exige une obligationId explicite.",
    F4_ERROR.LEGACY_RECONCILE_DISABLED,
  );
}

async function createPayment(store, rawPayload, principal, auditMeta) {
  const payload = ignoreClientScope(rawPayload);
  const writeItems = normalizeWriteItems(payload);
  const studentKey = asTrimmed(payload.studentId);
  const method = resolvePaymentMethod(payload);
  const paidAt = resolvePaidAt(payload);
  if (!studentKey || !method || !asTrimmed(paidAt)) {
    throw createFinanceError(400, "Champs obligatoires manquants : studentId, items, method, date.");
  }

  return store.withTransaction(async (tx) => {
    const student = await tx.findStudent(studentKey, principal);
    if (!student) {
      throw createFinanceError(404, "Élève introuvable", FINANCE_ERROR.STUDENT_NOT_FOUND);
    }
    assertTenant(principal, student);
    const school = await tx.getSchoolByCode(student.schoolCode);
    if (!school) {
      throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
    }
    assertTenant(principal, school);
    const enrollment = await resolvePaymentEnrollment(tx, student, payload, school);

    const resolvedItems = [];
    for (const item of writeItems) {
      assertItemAmount(item.amount);
      const feeTypeId = asTrimmed(item.feeTypeId || item.schoolFeeItemId);
      const obligationId = asTrimmed(item.obligationId);
      let feeType = asTrimmed(item.feeType || item.feeLabel || item.label);
      let feeLabel = asTrimmed(item.feeLabel || item.feeType || item.label);
      let catalogId = null;
      let catalogItemId = null;
      if (feeTypeId) {
        const catalog = await resolveCatalogFeeItem(tx, school.id, feeTypeId);
        feeType = persistableFeeType(catalog.feeType || catalog.label);
        feeLabel = catalog.label || catalog.feeType;
        catalogId = catalog.dbId || null;
        catalogItemId = catalog.id || null;
      } else if (isUnallocatedFeeTypeInput(feeType)) {
        feeType = "";
        feeLabel = feeLabel && !isUnallocatedFeeTypeInput(feeLabel) ? feeLabel : "Non imputé";
      } else if (feeType) {
        feeType = persistableFeeType(feeType);
        feeLabel = feeLabel || feeType;
      }

      if (!obligationId && feeType) {
        throw createFinanceError(
          400,
          "obligationId est requis pour imputer un paiement. Utilisez Non imputé pour un encaissement sans dette cible.",
          F4_ERROR.OBLIGATION_ID_REQUIRED,
        );
      }
      if (!obligationId) {
        feeType = "";
        feeLabel = "Non imputé";
      }

      resolvedItems.push({
        feeTypeId: catalogId,
        catalogItemId,
        feeType,
        feeLabel: feeLabel || feeType || "Non imputé",
        amount: money(item.amount),
        obligationId,
      });
    }

    const totalAmount = money(resolvedItems.reduce((sum, item) => sum + item.amount, 0));
    if (!(totalAmount > 0)) {
      throw createFinanceError(400, "Le montant doit être strictement positif.", FINANCE_ERROR.PAYMENT_AMOUNT_INVALID);
    }

    let obligations = await tx.listObligationsByStudent(school.id, student.dbId || student.id, { lock: true });
    const allocations = [];
    const targetedBalances = new Map();
    let leftoverTotal = 0;
    for (const item of resolvedItems) {
      const open = await openObligationsForItem(tx, obligations, item, student, school);
      for (const fee of open) {
        const key = String(fee.dbId || fee.id);
        if (!targetedBalances.has(key)) targetedBalances.set(key, money(fee.balance));
      }
      const { updated, allocations: itemAllocations, leftover } = allocateAmount(open, item.amount);
      leftoverTotal = money(leftoverTotal + leftover);
      allocations.push(...itemAllocations);
      const byId = new Map(updated.map((fee) => [String(fee.dbId || fee.id), fee]));
      obligations = obligations.map((fee) => byId.get(String(fee.dbId || fee.id)) || fee);
    }

    const remainingBefore = money([...targetedBalances.values()].reduce((sum, value) => sum + money(value), 0));
    const conservation = assertPaymentConservation({
      amount: totalAmount,
      allocations,
      unallocatedAmount: leftoverTotal,
    });

    const existingCodes = await tx.listPaymentCodes(school.id);
    const reference = generatePaymentReference(student.schoolCode, existingCodes);
    const now = new Date().toISOString();
    const status = resolveUnallocatedPaymentStatus(totalAmount, remainingBefore, method, conservation.unallocated);
    const payment = {
      reference,
      schoolId: school.id,
      schoolCode: student.schoolCode,
      studentDbId: student.dbId || student.id,
      studentId: student.publicId || student.studentCode || student.id,
      studentName: `${student.firstName ?? ""} ${student.lastName ?? student.name ?? ""}`.trim(),
      classId: enrollment.classId,
      classCode: enrollment.classCode || "",
      className: enrollment.className || "",
      feeType: resolvedItems.length === 1 ? resolvedItems[0].feeType : `${resolvedItems.length} libellés`,
      label: resolvedItems.length === 1 ? resolvedItems[0].feeLabel : `${resolvedItems.length} libellés`,
      amount: totalAmount,
      currency: requireSchoolCurrency(school),
      method,
      date: toIsoDate(paidAt) || paidAt,
      status,
      comment: asTrimmed(payload.comment),
      verificationCode: `VF-${reference.replace(/[^A-Z0-9]/gi, "").slice(-12)}`,
      amountDue: remainingBefore,
      remainingAfter: Math.max(0, money(remainingBefore - conservation.allocated)),
      overpaymentAmount: conservation.unallocated,
      allocatedAmount: conservation.allocated,
      unallocatedAmount: conservation.unallocated,
      overpaymentAction: conservation.unallocated > 0 ? payload.overpaymentAction || "À confirmer" : "",
      createdAt: now,
      createdByName: actorName(principal),
    };

    const saved = await tx.insertPayment(payment);
    const insertedItems = [];
    for (let index = 0; index < resolvedItems.length; index += 1) {
      const item = resolvedItems[index];
      insertedItems.push(
        await tx.insertPaymentItem({
          schoolId: school.id,
          paymentId: saved.dbId,
          schoolFeeItemId: item.feeTypeId || null,
          feeType: item.feeType,
          feeLabel: item.feeLabel,
          amount: item.amount,
          sortOrder: index,
        }),
      );
    }
    for (const allocation of allocations) {
      await tx.insertAllocation({
        schoolId: school.id,
        paymentId: saved.dbId,
        obligationId: allocation.obligationId,
        amount: allocation.amount,
      });
    }
    for (const fee of obligations) {
      if (allocations.some((row) => String(row.obligationId) === String(fee.dbId || fee.id))) {
        await tx.updateObligation(fee);
      }
    }
    const result = decoratePaymentWithItems(
      projectPaymentCash(saved, allocations),
      insertedItems,
    );
    await writeFinanceAudit(tx, principal, auditMeta, {
      action: "create_payment",
      entityType: "payment",
      entityId: result.id,
      schoolCode: result.schoolCode,
      newValue: result,
    });
    return result;
  });
}

async function cancelPayment(store, paymentId, reason, principal, auditMeta) {
  assertCanCancelPayment(principal);
  const motif = asTrimmed(reason);
  if (!motif) {
    throw createFinanceError(400, "Le motif d'annulation est obligatoire.", FINANCE_ERROR.CANCEL_REASON_REQUIRED);
  }
  return store.withTransaction(async (tx) => {
    const payment = await tx.getPaymentByCode(paymentId, principal, { lock: true });
    if (!payment) {
      throw createFinanceError(404, "Paiement introuvable.", FINANCE_ERROR.PAYMENT_NOT_FOUND);
    }
    assertTenant(principal, payment);
    if (isPaymentCancelled(payment)) {
      return payment;
    }
    const allocations = await tx.listAllocations(payment.dbId);
    const active = allocations.filter((row) => !row.reversedAt);
    if (active.length) {
      const obligationIds = [...new Set(active.map((row) => row.obligationId))];
      const fees = [];
      for (const obligationId of obligationIds) {
        const fee = await tx.getObligation(obligationId);
        if (fee) fees.push(fee);
      }
      const reversedFees = reverseAllocationsOnFees(fees, active);
      for (const fee of reversedFees) {
        await tx.updateObligation(fee);
      }
      await tx.reverseAllocations(payment.dbId);
    }
    const result = await tx.cancelPayment(payment.dbId, motif, principal);
    if (!result.cancelledNow) {
      const existingItems =
        typeof tx.listPaymentItems === "function" ? await tx.listPaymentItems(result.payment.dbId) : payment.items || [];
      return decoratePaymentWithItems(result.payment, existingItems);
    }
    await writeFinanceAudit(tx, principal, auditMeta, {
      action: "cancel_payment",
      entityType: "payment",
      entityId: result.payment.id,
      schoolCode: result.payment.schoolCode,
      newValue: { reason: result.payment.cancelReason, cancelledBy: result.payment.cancelledBy },
    });
    const items =
      typeof tx.listPaymentItems === "function" ? await tx.listPaymentItems(result.payment.dbId) : payment.items || [];
    return decoratePaymentWithItems(result.payment, items);
  });
}

async function resolveGridClass(tx, school, payload) {
  const classId = asTrimmed(payload.classId);
  const classCode = asTrimmed(payload.classCode);
  let canonicalLookupAttempted = false;

  if (classId && typeof tx.getClassById === "function") {
    canonicalLookupAttempted = true;
    const klass = await tx.getClassById(classId);
    if (klass) {
      if (klass.schoolId && String(klass.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Classe hors établissement.", FINANCE_ERROR.CLASS_TENANT_MISMATCH);
      }
      return klass;
    }
  }

  if (classCode && typeof tx.getClassByCode === "function") {
    canonicalLookupAttempted = true;
    const klass = await tx.getClassByCode(classCode, school.id);
    if (klass) {
      if (klass.schoolId && String(klass.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Classe hors établissement.", FINANCE_ERROR.CLASS_TENANT_MISMATCH);
      }
      return klass;
    }
  }

  const className = asTrimmed(payload.className);
  if (className && typeof tx.findUniqueClassBySchoolYearName === "function") {
    const klass = await tx.findUniqueClassBySchoolYearName(
      school.id,
      asTrimmed(payload.academicYear),
      className,
      school.code || school.school_code,
    );
    if (klass) {
      if (klass.schoolId && String(klass.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Classe hors établissement.", FINANCE_ERROR.CLASS_TENANT_MISMATCH);
      }
      return klass;
    }
  }

  if (canonicalLookupAttempted) {
    throw createFinanceError(404, "Classe introuvable.", FINANCE_ERROR.CLASS_NOT_FOUND);
  }
  throw createFinanceError(
    400,
    "Identifiant de classe canonique requis (classId ou classCode).",
    FINANCE_ERROR.CLASS_REQUIRED,
  );
}

async function upsertFeeGrid(store, rawPayload, principal) {
  const payload = ignoreClientScope(rawPayload);
  const schoolCode = resolveActorSchoolCode(principal, rawPayload);
  const className = asTrimmed(payload.className);
  const academicYear = asTrimmed(payload.academicYear);
  const currency = asTrimmed(payload.currency);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!academicYear || !currency) {
    throw createFinanceError(400, "Classe, année scolaire et devise sont obligatoires.");
  }
  if (!asTrimmed(payload.classId) && !asTrimmed(payload.classCode) && !className) {
    throw createFinanceError(400, "Classe, année scolaire et devise sont obligatoires.");
  }
  const activeItems = items.filter((item) => item.status !== "Désactivé");
  if (!activeItems.length) {
    throw createFinanceError(400, "Ajoutez au moins un frais (inscription, mensualité ou annexe).");
  }
  for (const item of activeItems) {
    if (!(money(item.amount) > 0) || !asTrimmed(item.label)) {
      throw createFinanceError(400, "Chaque frais doit avoir un libellé et un montant strictement positif.");
    }
  }

  return store.withTransaction(async (tx) => {
    const school = await tx.getSchoolByCode(schoolCode);
    if (!school) throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
    assertTenant(principal, school);
    const klass = await resolveGridClass(tx, school, payload);
    const grid = await tx.upsertGrid({
      id: payload.id,
      schoolId: school.id,
      schoolCode,
      classId: klass.classId,
      classCode: klass.classCode || "",
      className: klass.className || className,
      academicYear,
      periodName: asTrimmed(payload.periodName),
      currency,
      status: payload.status || "Brouillon",
      name: payload.name || klass.className || className,
      createdBy: actorName(principal),
      periodStart: payload.periodStart || "",
      periodEnd: payload.periodEnd || "",
    });
    await tx.replaceGridItems(grid, activeItems.map((item) => ({
      ...item,
      feeType: persistableFeeType(item.feeType || item.fee_type),
      schoolId: school.id,
      schoolCode,
    })));
    await tx.insertTariffHistory({
      schoolId: school.id,
      feeGridId: grid.dbId,
      action: payload.id ? "update" : "create",
      actorId: principal?.sub || principal?.identifier,
      payload: { className, academicYear, itemCount: activeItems.length },
    });
    return tx.getGrid(grid.id, principal);
  });
}

async function setFeeGridStatus(store, gridId, status, principal) {
  return store.withTransaction(async (tx) => {
    const grid = await tx.getGrid(gridId, principal);
    if (!grid) throw createFinanceError(404, "Grille introuvable.", FINANCE_ERROR.FEE_GRID_NOT_FOUND);
    assertTenant(principal, grid);
    return tx.setGridStatus(grid.dbId, status);
  });
}

async function applyFeeGrid(store, gridId, principal, options = {}) {
  return store.withTransaction(async (tx) => {
    const grid = await tx.getGrid(gridId, principal);
    if (!grid) throw createFinanceError(404, "Grille introuvable.", FINANCE_ERROR.FEE_GRID_NOT_FOUND);
    assertTenant(principal, grid);
    if (grid.status !== "Active") {
      throw createFinanceError(409, "Seule une grille active peut être appliquée aux élèves.", FINANCE_ERROR.FEE_GRID_NOT_ACTIVE);
    }

    const school = await tx.getSchoolByCode(grid.schoolCode);
    if (!school) {
      throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
    }

    let resolvedClass = {
      classId: asTrimmed(grid.classId),
      classCode: asTrimmed(grid.classCode),
      className: asTrimmed(grid.className),
      schoolId: grid.schoolId || school.id,
      schoolCode: grid.schoolCode,
    };
    if (!resolvedClass.classId && !resolvedClass.classCode) {
      resolvedClass = await resolveGridClass(tx, school, {
        className: grid.className,
        academicYear: grid.academicYear,
      });
    }

    const gridForApply = {
      ...grid,
      classId: resolvedClass.classId || "",
      classCode: resolvedClass.classCode || "",
      className: resolvedClass.className || grid.className,
      schoolId: grid.schoolId || school.id,
    };
    const items = await tx.listItemsByGrid(grid.dbId);
    const activeItems = items.filter((item) => item.status === "Actif");
    const students = await tx.listStudentsInClass(grid.schoolCode, {
      classId: gridForApply.classId,
      classCode: gridForApply.classCode,
    });
    const targetIds = Array.isArray(options.studentIds) ? options.studentIds.map(String) : null;
    const scopedStudents = students.filter((student) => {
      if (targetIds && !targetIds.some((id) => studentMatches(student, id))) return false;
      return true;
    });
    const result = await ensureEnrollmentFinanceObligationsInTx(
      tx,
      {
        reason: OBLIGATION_LIFECYCLE_REASON.GRID_APPLY,
        school,
        grid: gridForApply,
        items: activeItems,
        students: scopedStudents,
        studentIds: options.studentIds,
        academicYear: grid.academicYear,
        classId: gridForApply.classId,
      },
      principal,
      options.auditMeta,
    );
    await tx.insertTariffHistory({
      schoolId: school.id,
      feeGridId: grid.dbId,
      action: "apply",
      actorId: principal?.sub || principal?.identifier,
      payload: {
        created: result.created,
        skipped: result.skipped,
        superseded: result.superseded || 0,
        resolvedClassId: gridForApply.classId || null,
        resolvedClassCode: gridForApply.classCode || null,
        reason: result.reason,
      },
    });
    return {
      created: result.created,
      skipped: result.skipped,
      superseded: result.superseded || 0,
      grid: gridForApply,
      reason: result.reason,
    };
  });
}

async function adjustStudentFee(store, obligationId, patch, principal) {
  return store.withTransaction(async (tx) => {
    const fee = await tx.getObligationByPublicId(obligationId, principal);
    if (!fee) throw createFinanceError(404, "Obligation introuvable.", FINANCE_ERROR.OBLIGATION_NOT_FOUND);
    assertTenant(principal, fee);
    const next = { ...fee };
    if (patch.cancel) {
      next.status = "Annulé";
      next.archived = true;
    }
    if (patch.discount != null) next.discount = money(patch.discount);
    if (patch.exemption != null) next.exemption = money(patch.exemption);
    const amounts = obligationStatus({
      amountDue: next.amountDue,
      amountPaid: next.amountPaid,
      exemption: next.exemption,
      dueDate: next.dueDate,
    });
    next.balance = amounts.balance;
    next.status = next.archived ? "Annulé" : amounts.status;
    return tx.updateObligation(next);
  });
}

async function createReminder(store, studentId, payload, principal, { force = false } = {}) {
  const body = ignoreClientScope(payload);
  return store.withTransaction(async (tx) => {
    const student = await tx.findStudent(studentId, principal);
    if (!student) throw createFinanceError(404, "Élève introuvable", FINANCE_ERROR.STUDENT_NOT_FOUND);
    assertTenant(principal, student);
    const school = await tx.getSchoolByCode(student.schoolCode);
    if (!school) throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
    assertTenant(principal, school);
    const reminders = await tx.listRemindersByStudent(student.dbId || student.id);
    const latest = reminders.filter((row) => row.sendStatus !== "Échouée")[0];
    if (latest) {
      const daysSince = Math.floor((Date.now() - new Date(latest.sentAt).getTime()) / (86400000));
      if (daysSince < REMINDER_COOLDOWN_DAYS) {
        if (!force) {
          throw createFinanceError(
            409,
            `Relance récente (${latest.sentAt}). Attendez ${REMINDER_COOLDOWN_DAYS - daysSince} jour(s) ou confirmez.`,
            FINANCE_ERROR.REMINDER_COOLDOWN,
            { lastReminderAt: latest.sentAt, daysRemaining: REMINDER_COOLDOWN_DAYS - daysSince },
          );
        }
        if (!canForceReminder(principal)) {
          throw createFinanceError(403, "Le forçage de relance n'est pas autorisé.", FINANCE_ERROR.REMINDER_FORCE_FORBIDDEN);
        }
      }
    }
    const fees = (await tx.listObligationsByStudent(school.id, student.dbId || student.id)).filter(
      (fee) => money(fee.balance) > 0 && fee.status !== "Annulé",
    );
    const amountDue = fees.reduce((sum, fee) => sum + money(fee.balance), 0);
    const reminder = {
      studentId: student.publicId || student.studentCode || student.id,
      studentDbId: student.dbId || student.id,
      schoolId: school.id,
      schoolCode: student.schoolCode,
      recipient: body.recipient || "Parent",
      channel: body.channel || "notification",
      message: asTrimmed(body.message) || `Relance de paiement : ${amountDue} ${requireSchoolCurrency(school)} restants.`,
      summary: `Relance ${amountDue} ${requireSchoolCurrency(school)}`,
      sendStatus: body.sendStatus || "Envoyée",
      sentAt: new Date().toISOString(),
      triggeredByName: actorName(principal),
    };
    return tx.insertReminder(reminder);
  });
}

module.exports = {
  REMINDER_COOLDOWN_DAYS,
  F4_ERROR,
  ignoreClientScope,
  assertTenant,
  canCancelPayment,
  assertCanCancelPayment,
  createPayment,
  cancelPayment,
  reconcileHistoricalPaymentAllocations,
  upsertFeeGrid,
  setFeeGridStatus,
  applyFeeGrid,
  ensureEnrollmentFinanceObligations,
  ensureEnrollmentFinanceObligationsInTx,
  adjustStudentFee,
  createReminder,
  isPaymentCounted,
};