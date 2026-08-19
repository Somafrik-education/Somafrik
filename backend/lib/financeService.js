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
  normalizeKey,
  money,
  isPaymentCancelled,
  isPaymentCounted,
  obligationStatus,
  generatePaymentReference,
  resolvePaymentStatus,
  toIsoDate,
  studentMatches,
  canForceReminder,
  isSuperAdminPrincipal,
} = require("./financeManagement");
const {
  resolvePaymentMethod,
  resolvePaidAt,
  decoratePaymentWithItems,
  normalizeWriteItems,
  assertItemAmount,
} = require("./financePaymentItems");

const REMINDER_COOLDOWN_DAYS = 3;

function ignoreClientScope(payload = {}) {
  const next = { ...payload };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.country;
  delete next.createdBy;
  delete next.triggeredBy;
  return next;
}

function assertTenant(principal, schoolCode) {
  const scope = asTrimmed(principal?.schoolCode);
  if (!scope || scope === "*") return;
  if (asTrimmed(schoolCode).toUpperCase() !== scope.toUpperCase()) {
    throw createFinanceError(403, "Accès refusé : établissement hors périmètre.", FINANCE_ERROR.TENANT_MISMATCH);
  }
}

function actorName(principal) {
  return `${principal?.firstName ?? ""} ${principal?.lastName ?? ""}`.trim() || principal?.identifier || principal?.role;
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
    schoolCode: entry.schoolCode || principal?.schoolCode,
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
    assertTenant(principal, student.schoolCode);
    const school = await tx.getSchoolByCode(student.schoolCode);
    if (!school) {
      throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
    }

    const resolvedItems = [];
    for (const item of writeItems) {
      assertItemAmount(item.amount);
      const feeTypeId = asTrimmed(item.feeTypeId || item.schoolFeeItemId);
      let feeType = asTrimmed(item.feeType || item.feeLabel || item.label);
      let feeLabel = asTrimmed(item.feeLabel || item.feeType || item.label);
      let catalogId = null;
      if (feeTypeId) {
        const catalog = await resolveCatalogFeeItem(tx, school.id, feeTypeId);
        feeType = catalog.feeType || catalog.label;
        feeLabel = catalog.label || catalog.feeType;
        catalogId = catalog.dbId || null;
      }
      if (!feeType) {
        throw createFinanceError(400, "Chaque libellé doit indiquer un type de frais.", FINANCE_ERROR.PAYMENT_FEE_TYPE_REQUIRED);
      }
      resolvedItems.push({
        feeTypeId: catalogId,
        feeType,
        feeLabel: feeLabel || feeType,
        amount: money(item.amount),
      });
    }

    const totalAmount = money(resolvedItems.reduce((sum, item) => sum + item.amount, 0));
    if (!(totalAmount > 0)) {
      throw createFinanceError(400, "Le montant doit être strictement positif.", FINANCE_ERROR.PAYMENT_AMOUNT_INVALID);
    }

    let obligations = await tx.listObligationsByStudent(school.id, student.dbId || student.id, { lock: true });
    const allocations = [];
    let leftoverTotal = 0;
    let remainingBefore = 0;
    for (const item of resolvedItems) {
      const open = obligations.filter(
        (fee) =>
          !["Annulé", "Payé", "Exonéré"].includes(fee.status) &&
          normalizeKey(fee.feeType) === normalizeKey(item.feeType),
      );
      remainingBefore += open.reduce((sum, fee) => sum + money(fee.balance), 0);
      const { updated, allocations: itemAllocations, leftover } = allocateAmount(open, item.amount);
      leftoverTotal += leftover;
      allocations.push(...itemAllocations);
      const byId = new Map(updated.map((fee) => [String(fee.dbId || fee.id), fee]));
      obligations = obligations.map((fee) => byId.get(String(fee.dbId || fee.id)) || fee);
    }
    if (leftoverTotal < 0) {
      throw createFinanceError(400, "Solde négatif interdit.", FINANCE_ERROR.NEGATIVE_BALANCE_FORBIDDEN);
    }

    const existingCodes = await tx.listPaymentCodes(school.id);
    const reference = generatePaymentReference(student.schoolCode, existingCodes);
    const now = new Date().toISOString();
    const status = resolvePaymentStatus(totalAmount, remainingBefore, method);
    const payment = {
      reference,
      schoolId: school.id,
      schoolCode: student.schoolCode,
      studentDbId: student.dbId || student.id,
      studentId: student.publicId || student.studentCode || student.id,
      studentName: `${student.firstName ?? ""} ${student.lastName ?? student.name ?? ""}`.trim(),
      className: student.className || "",
      feeType: resolvedItems.length === 1 ? resolvedItems[0].feeType : `${resolvedItems.length} libellés`,
      label: resolvedItems.length === 1 ? resolvedItems[0].feeLabel : `${resolvedItems.length} libellés`,
      amount: totalAmount,
      currency: school.currency || "CDF",
      method,
      date: toIsoDate(paidAt) || paidAt,
      status,
      comment: asTrimmed(payload.comment),
      verificationCode: `VF-${reference.replace(/[^A-Z0-9]/gi, "").slice(-12)}`,
      amountDue: remainingBefore + obligations.reduce((sum, fee) => sum + money(fee.amountPaid), 0),
      remainingAfter: Math.max(0, remainingBefore - totalAmount),
      overpaymentAmount: leftoverTotal,
      overpaymentAction: leftoverTotal > 0 ? payload.overpaymentAction || "À confirmer" : "",
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
    const result = decoratePaymentWithItems(saved, insertedItems);
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
  const motif = asTrimmed(reason);
  if (!motif) {
    throw createFinanceError(400, "Le motif d'annulation est obligatoire.", FINANCE_ERROR.CANCEL_REASON_REQUIRED);
  }
  return store.withTransaction(async (tx) => {
    const payment = await tx.getPaymentByCode(paymentId, principal, { lock: true });
    if (!payment) {
      throw createFinanceError(404, "Paiement introuvable.", FINANCE_ERROR.PAYMENT_NOT_FOUND);
    }
    assertTenant(principal, payment.schoolCode);
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

async function upsertFeeGrid(store, rawPayload, principal) {
  const payload = ignoreClientScope(rawPayload);
  let schoolCode = asTrimmed(principal?.schoolCode);
  if (!schoolCode || schoolCode === "*") {
    if (!isSuperAdminPrincipal(principal)) {
      throw createFinanceError(400, "Établissement requis.", FINANCE_ERROR.TENANT_MISMATCH);
    }
    schoolCode = asTrimmed(rawPayload.schoolCode);
    if (!schoolCode) {
      throw createFinanceError(400, "Établissement requis.", FINANCE_ERROR.TENANT_MISMATCH);
    }
  }
  assertTenant(principal, schoolCode);
  const className = asTrimmed(payload.className);
  const academicYear = asTrimmed(payload.academicYear);
  const currency = asTrimmed(payload.currency);
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!className || !academicYear || !currency) {
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
    const grid = await tx.upsertGrid({
      id: payload.id,
      schoolId: school.id,
      schoolCode,
      className,
      academicYear,
      periodName: asTrimmed(payload.periodName),
      currency,
      status: payload.status || "Brouillon",
      name: payload.name || className,
      createdBy: actorName(principal),
      periodStart: payload.periodStart || "",
      periodEnd: payload.periodEnd || "",
    });
    await tx.replaceGridItems(grid, activeItems.map((item) => ({
      ...item,
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
    assertTenant(principal, grid.schoolCode);
    return tx.setGridStatus(grid.dbId, status);
  });
}

async function applyFeeGrid(store, gridId, principal, options = {}) {
  return store.withTransaction(async (tx) => {
    const grid = await tx.getGrid(gridId, principal);
    if (!grid) throw createFinanceError(404, "Grille introuvable.", FINANCE_ERROR.FEE_GRID_NOT_FOUND);
    assertTenant(principal, grid.schoolCode);
    if (grid.status !== "Active") {
      throw createFinanceError(409, "Seule une grille active peut être appliquée aux élèves.", FINANCE_ERROR.FEE_GRID_NOT_ACTIVE);
    }
    const items = await tx.listItemsByGrid(grid.dbId);
    const activeItems = items.filter((item) => item.status === "Actif");
    const students = await tx.listStudentsInClass(grid.schoolCode, grid.className);
    const targetIds = Array.isArray(options.studentIds) ? options.studentIds.map(String) : null;
    const scopedStudents = students.filter((student) => {
      if (targetIds && !targetIds.some((id) => studentMatches(student, id))) return false;
      return true;
    });
    let created = 0;
    let skipped = 0;
    for (const student of scopedStudents) {
      for (const item of activeItems) {
        const periods = item.feeType === "Mensualité" && Array.isArray(item.monthlyMonths) && item.monthlyMonths.length
          ? item.monthlyMonths
          : [item.periodLabel || null];
        for (const periodLabel of periods) {
          const inserted = await tx.insertObligationIfAbsent({
            schoolId: grid.schoolId || (await tx.getSchoolByCode(grid.schoolCode)).id,
            schoolCode: grid.schoolCode,
            student,
            grid,
            item,
            periodLabel,
          });
          if (inserted) created += 1;
          else skipped += 1;
        }
      }
    }
    await tx.insertTariffHistory({
      schoolId: (await tx.getSchoolByCode(grid.schoolCode)).id,
      feeGridId: grid.dbId,
      action: "apply",
      actorId: principal?.sub || principal?.identifier,
      payload: { created, skipped },
    });
    return { created, skipped, grid };
  });
}

async function adjustStudentFee(store, obligationId, patch, principal) {
  return store.withTransaction(async (tx) => {
    const fee = await tx.getObligationByPublicId(obligationId, principal);
    if (!fee) throw createFinanceError(404, "Obligation introuvable.", FINANCE_ERROR.OBLIGATION_NOT_FOUND);
    assertTenant(principal, fee.schoolCode);
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
    assertTenant(principal, student.schoolCode);
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
    const school = await tx.getSchoolByCode(student.schoolCode);
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
      message: asTrimmed(body.message) || `Relance de paiement : ${amountDue} ${school.currency || "CDF"} restants.`,
      summary: `Relance ${amountDue} ${school.currency || "CDF"}`,
      sendStatus: body.sendStatus || "Envoyée",
      sentAt: new Date().toISOString(),
      triggeredByName: actorName(principal),
    };
    return tx.insertReminder(reminder);
  });
}

module.exports = {
  REMINDER_COOLDOWN_DAYS,
  ignoreClientScope,
  createPayment,
  cancelPayment,
  upsertFeeGrid,
  setFeeGridStatus,
  applyFeeGrid,
  adjustStudentFee,
  createReminder,
  isPaymentCounted,
};
