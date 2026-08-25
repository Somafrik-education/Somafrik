"use strict";

const { randomUUID } = require("node:crypto");
const {
  createFinanceError,
  FINANCE_ERROR,
  asTrimmed,
  money,
  mapPaymentRow,
  mapObligationRow,
  mapGridRow,
  mapItemRow,
  mapReminderRow,
  mapStatusRow,
  studentMatches,
  studentMatchesClassScope,
  classScopeSpec,
  obligationStatus,
  toIsoDate,
  mapBoStatusToDb,
} = require("../lib/financeManagement");
const { decoratePaymentWithItems } = require("../lib/financePaymentItems");
const { projectObligationPaidAmounts } = require("../lib/financeObligationPaid");
const { projectPaymentsWithAllocations, projectPaymentCash } = require("../lib/financeUnallocatedCash");
const { resolveFinanceSchoolScope, schoolCodeInScope } = require("../lib/financeSchoolScope");
const financeService = require("../lib/financeService");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFinanceMemoryStore({ getSchoolByCode, findStudent, listStudentsInClass, getClassById: lookupClassById } = {}) {
  const tables = {
    payments: [],
    paymentStatuses: [],
    feeGrids: [],
    schoolFeeItems: [],
    studentFees: [],
    feeTariffHistory: [],
    paymentReminders: [],
    allocations: [],
    paymentItems: [],
    auditLogs: [],
  };

  function txApi() {
    return {
      async getSchoolByCode(code) {
        const school = await getSchoolByCode?.(code);
        if (!school) return null;
        return {
          id: school.id || school.publicId || school.code,
          code: school.code || school.schoolCode,
          school_code: school.code || school.schoolCode,
          currency: school.currency || "CDF",
        };
      },
      async findStudent(studentKey, principal) {
        const student = await findStudent?.(studentKey, principal);
        if (!student) return null;
        return {
          ...student,
          dbId: student.dbId || student.id,
          schoolCode: student.schoolCode,
        };
      },
      async listActiveEnrollmentsForStudent(studentDbId, schoolId) {
        const student =
          (await findStudent?.(studentDbId, { schoolCode: "*" })) ||
          null;
        if (!student) return [];
        const rows = Array.isArray(student.enrollments) ? student.enrollments : [];
        const active = rows.filter((row) => !row.status || String(row.status).toLowerCase() === "active");
        if (active.length) {
          return active
            .filter((row) => asTrimmed(row.classId))
            .map((row) => ({
              enrollmentId: row.id || row.enrollmentId,
              schoolId: row.schoolId || schoolId,
              classId: String(row.classId),
              classCode: asTrimmed(row.classCode),
              className: asTrimmed(row.className),
            }));
        }
        if (asTrimmed(student.classId)) {
          return [
            {
              schoolId,
              classId: String(student.classId),
              classCode: asTrimmed(student.classCode),
              className: asTrimmed(student.className),
            },
          ];
        }
        return [];
      },
      async getClassById(classId) {
        if (typeof lookupClassById === "function") {
          return lookupClassById(classId);
        }
        const key = asTrimmed(classId);
        if (!key) return null;
        const student = (await findStudent?.(key, { schoolCode: "*" })) || null;
        if (student && asTrimmed(student.classId) === key) {
          return {
            classId: String(student.classId),
            schoolId: student.schoolId,
            classCode: asTrimmed(student.classCode),
            className: asTrimmed(student.className),
            schoolCode: student.schoolCode,
          };
        }
        return null;
      },
      async getClassByCode(classCode, schoolId) {
        const key = asTrimmed(classCode).toUpperCase();
        if (!key) return null;
        const student =
          (await findStudent?.(key, { schoolCode: "*" })) ||
          null;
        if (student && asTrimmed(student.classCode).toUpperCase() === key) {
          return {
            classId: String(student.classId),
            schoolId: student.schoolId || schoolId,
            classCode: asTrimmed(student.classCode),
            className: asTrimmed(student.className),
            schoolCode: student.schoolCode,
          };
        }
        const rows = (await listStudentsInClass?.("*", { classCode: key })) || [];
        const match = rows.find((row) => asTrimmed(row.classCode).toUpperCase() === key);
        if (!match) return null;
        return {
          classId: String(match.classId),
          schoolId: match.schoolId || schoolId,
          classCode: asTrimmed(match.classCode),
          className: asTrimmed(match.className),
          schoolCode: match.schoolCode,
        };
      },
      async findUniqueClassBySchoolYearName(schoolId, academicYear, className, schoolCode) {
        const name = asTrimmed(className);
        if (!name) return null;
        const code = asTrimmed(schoolCode);
        const fromNamed = code ? (await listStudentsInClass?.(code, name)) || [] : [];
        const fromSpec = code ? (await listStudentsInClass?.(code, { className: name })) || [] : [];
        const rows = [...fromNamed, ...fromSpec];
        const uniqueIds = [...new Set(rows.map((row) => String(row.classId || "")).filter(Boolean))];
        if (uniqueIds.length !== 1) return null;
        const student = rows.find((row) => String(row.classId) === uniqueIds[0]);
        return {
          classId: uniqueIds[0],
          schoolId: student.schoolId || schoolId,
          classCode: asTrimmed(student.classCode),
          className: asTrimmed(student.className) || name,
          schoolCode: student.schoolCode || code,
        };
      },
      async listStudentsInClass(schoolCode, classRef) {
        const spec = classScopeSpec(classRef);
        const raw =
          (await listStudentsInClass?.(schoolCode, spec)) ||
          (spec.className ? await listStudentsInClass?.(schoolCode, spec.className) : null) ||
          [];
        return raw.filter((student) => studentMatchesClassScope(student, spec) || (!spec.classId && !spec.classCode));
      },
      async listPaymentCodes(schoolId) {
        return tables.payments.filter((row) => row.school_id === schoolId).map((row) => row.payment_code);
      },
      async listCountedPayments(schoolId, { studentDbId } = {}) {
        return tables.payments
          .filter((row) => {
            if (String(row.school_id) !== String(schoolId)) return false;
            if (studentDbId && String(row.student_id) !== String(studentDbId)) return false;
            return true;
          })
          .map((row) => ({
            ...mapPaymentRow(row),
            studentDbId: row.student_id,
            schoolId: row.school_id,
          }));
      },
      async lockPayment(paymentId) {
        const row = tables.payments.find(
          (item) => String(item.id) === String(paymentId) || item.payment_code === paymentId,
        );
        return row ? { id: row.id } : null;
      },
      async insertPayment(payment) {
        if (tables.payments.some((row) => row.payment_code === payment.reference)) {
          throw createFinanceError(409, "Référence de paiement dupliquée.", FINANCE_ERROR.PAYMENT_REFERENCE_DUPLICATE);
        }
        const row = {
          id: randomUUID(),
          school_id: payment.schoolId,
          school_code: payment.schoolCode,
          student_id: payment.studentDbId,
          student_code: payment.studentId,
          payment_code: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          payment_method: payment.method,
          payment_status: mapBoStatusToDb(payment.status),
          payment_date: payment.date,
          description: payment.comment,
          fee_type: payment.feeType,
          profile_payload: { ...payment },
          created_at: payment.createdAt,
          cancelled_at: null,
        };
        tables.payments.push(row);
        return mapPaymentRow(row);
      },
      async insertPaymentItem(item) {
        const row = {
          id: randomUUID(),
          school_id: item.schoolId,
          payment_id: item.paymentId,
          school_fee_item_id: item.schoolFeeItemId || null,
          fee_type: item.feeType,
          fee_label: item.feeLabel,
          amount: item.amount,
          sort_order: Number(item.sortOrder || 0),
          created_at: new Date().toISOString(),
        };
        tables.paymentItems.push(row);
        return row;
      },
      async listPaymentItems(paymentId) {
        return tables.paymentItems
          .filter((row) => String(row.payment_id) === String(paymentId))
          .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      },
      async getSchoolFeeItemById(feeItemId, schoolId) {
        const row = tables.schoolFeeItems.find(
          (item) =>
            String(item.school_id) === String(schoolId) &&
            (item.id === feeItemId || item.item_code === feeItemId),
        );
        return row ? mapItemRow(row) : null;
      },
      async getSchoolFeeItemByIdAnySchool(feeItemId) {
        const row = tables.schoolFeeItems.find(
          (item) => item.id === feeItemId || item.item_code === feeItemId,
        );
        return row ? mapItemRow(row) : null;
      },
      async getPaymentByCode(code, principal, _opts) {
        const row = tables.payments.find(
          (item) => item.payment_code === code || item.id === code || item.profile_payload?.reference === code,
        );
        if (!row) return null;
        const mapped = mapPaymentRow(row);
        const scope = asTrimmed(principal?.schoolCode);
        if (scope && scope !== "*" && String(mapped.schoolCode ?? "").toUpperCase() !== scope.toUpperCase()) {
          return null;
        }
        const items = await this.listPaymentItems(row.id);
        const allocations = await this.listAllocations(row.id);
        return projectPaymentCash(decoratePaymentWithItems(mapped, items), allocations);
      },
      async cancelPayment(dbId, reason, principal) {
        const row = tables.payments.find((item) => item.id === dbId);
        if (!row) throw createFinanceError(404, "Paiement introuvable.", FINANCE_ERROR.PAYMENT_NOT_FOUND);
        if (row.cancelled_at) {
          return { payment: mapPaymentRow(row), cancelledNow: false };
        }
        row.cancelled_at = new Date().toISOString();
        row.cancel_reason = reason;
        row.cancelled_by = principal?.sub || principal?.id || null;
        row.payment_status = "cancelled";
        row.profile_payload = {
          ...row.profile_payload,
          status: "Annulé",
          cancelReason: reason,
          cancelledBy: row.cancelled_by,
        };
        return { payment: mapPaymentRow(row), cancelledNow: true };
      },
      async recordFinanceAudit(entry) {
        tables.auditLogs.push({
          id: randomUUID(),
          schoolCode: entry.schoolCode,
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValue: entry.oldValue ?? null,
          newValue: entry.newValue ?? null,
          ipAddress: entry.ipAddress ?? "",
          userAgent: entry.userAgent ?? "",
          createdAt: new Date().toISOString(),
        });
      },
      async listObligationsByStudent(schoolId, studentDbId, _opts) {
        return tables.studentFees
          .filter((row) => row.school_id === schoolId && String(row.student_id) === String(studentDbId))
          .map(mapObligationRow);
      },
      async getObligation(id) {
        const row = tables.studentFees.find((item) => item.id === id);
        return row ? mapObligationRow(row) : null;
      },
      async getObligationByPublicId(id) {
        const row = tables.studentFees.find(
          (item) => item.id === id || item.profile_payload?.publicId === id,
        );
        return row ? mapObligationRow(row) : null;
      },
      async updateObligation(fee) {
        const row = tables.studentFees.find((item) => item.id === (fee.dbId || fee.id));
        if (!row) return fee;
        row.amount_paid = fee.amountPaid;
        row.discount = fee.discount;
        row.exemption = fee.exemption;
        row.amount_due = fee.amountDue;
        row.balance = fee.balance;
        row.status = fee.status;
        row.archived_at = fee.archived ? new Date().toISOString() : row.archived_at;
        row.updated_at = new Date().toISOString();
        return mapObligationRow(row);
      },
      async insertAllocation(row) {
        tables.allocations.push({
          id: randomUUID(),
          school_id: row.schoolId,
          payment_id: row.paymentId,
          obligation_id: row.obligationId,
          amount: row.amount,
          reversed_at: null,
        });
      },
      async listAllocations(paymentId) {
        return tables.allocations
          .filter((row) => row.payment_id === paymentId)
          .map((row) => ({
            obligationId: row.obligation_id,
            amount: money(row.amount),
            reversedAt: row.reversed_at,
          }));
      },
      async reverseAllocations(paymentId) {
        for (const row of tables.allocations) {
          if (row.payment_id === paymentId && !row.reversed_at) {
            row.reversed_at = new Date().toISOString();
          }
        }
      },
      async upsertGrid(input) {
        const existingByCode = input.id
          ? tables.feeGrids.find((row) => row.grid_code === input.id)
          : null;
        const existingByNatural = tables.feeGrids.find(
          (row) =>
            row.school_id === input.schoolId &&
            row.class_name.toLowerCase() === input.className.toLowerCase() &&
            row.academic_year.toLowerCase() === input.academicYear.toLowerCase() &&
            row.period_name.toLowerCase() === (input.periodName || "").toLowerCase(),
        );
        if (existingByNatural && (!input.id || existingByNatural.grid_code !== input.id)) {
          throw createFinanceError(409, "Une grille existe déjà pour cette classe et cette année.", FINANCE_ERROR.FEE_GRID_DUPLICATE);
        }
        const existing = existingByCode || null;
        if (existing) {
          Object.assign(existing, {
            class_name: input.className,
            class_id: input.classId || existing.class_id || null,
            class_code: input.classCode || existing.class_code || "",
            academic_year: input.academicYear,
            period_name: input.periodName || "",
            currency: input.currency,
            status: input.status,
            name: input.name,
            profile_payload: input,
            updated_at: new Date().toISOString(),
          });
          return mapGridRow(existing);
        }
        const row = {
          id: randomUUID(),
          school_id: input.schoolId,
          school_code: input.schoolCode,
          grid_code: input.id || `FEEGRID-${randomUUID()}`,
          name: input.name,
          class_name: input.className,
          class_id: input.classId || null,
          class_code: input.classCode || "",
          academic_year: input.academicYear,
          period_name: input.periodName || "",
          currency: input.currency,
          status: input.status || "Brouillon",
          profile_payload: input,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        tables.feeGrids.push(row);
        return mapGridRow(row);
      },
      async getGrid(gridId) {
        const row = tables.feeGrids.find((item) => item.grid_code === gridId || item.id === gridId);
        return row ? mapGridRow(row) : null;
      },
      async setGridStatus(dbId, status) {
        const row = tables.feeGrids.find((item) => item.id === dbId);
        if (!row) throw createFinanceError(404, "Grille introuvable.", FINANCE_ERROR.FEE_GRID_NOT_FOUND);
        row.status = status;
        row.updated_at = new Date().toISOString();
        return mapGridRow(row);
      },
      async replaceGridItems(grid, items) {
        tables.schoolFeeItems = tables.schoolFeeItems.filter((row) => row.fee_grid_id !== grid.dbId);
        for (const item of items) {
          tables.schoolFeeItems.push({
            id: randomUUID(),
            school_id: item.schoolId,
            school_code: item.schoolCode,
            fee_grid_id: grid.dbId,
            grid_code: grid.id,
            item_code: item.id || `FEEITEM-${randomUUID()}`,
            fee_type: item.feeType,
            label: item.label,
            amount: money(item.amount),
            due_date: toIsoDate(item.dueDate),
            period_label: item.periodLabel || "",
            monthly_months: item.monthlyMonths || [],
            mandatory: item.mandatory !== false,
            status: item.status || "Actif",
            profile_payload: { ...item, gridCode: grid.id, schoolCode: item.schoolCode },
          });
        }
      },
      async listItemsByGrid(gridDbId) {
        return tables.schoolFeeItems.filter((row) => row.fee_grid_id === gridDbId).map(mapItemRow);
      },
      async insertObligationIfAbsent(input) {
        const period = input.periodLabel || "";
        const exists = tables.studentFees.some(
          (row) =>
            String(row.student_id) === String(input.student.dbId || input.student.id) &&
            row.fee_grid_id === input.grid.id &&
            row.school_fee_item_id === input.item.id &&
            (row.period_label || "") === period &&
            !row.archived_at,
        );
        if (exists) return false;
        const amount = money(input.item.amount);
        const amounts = obligationStatus({ amountDue: amount, amountPaid: 0, exemption: 0, dueDate: input.item.dueDate });
        tables.studentFees.push({
          id: randomUUID(),
          school_id: input.schoolId,
          school_code: input.schoolCode,
          student_id: input.student.dbId || input.student.id,
          student_code: input.student.publicId || input.student.studentCode || input.student.id,
          class_id: null,
          fee_grid_id: input.grid.id,
          school_fee_item_id: input.item.id,
          fee_type: input.item.feeType,
          label: period ? `${input.item.label} — ${period}` : input.item.label,
          currency: input.grid.currency,
          academic_year: input.grid.academicYear,
          period_label: period,
          initial_amount: amount,
          discount: 0,
          exemption: 0,
          amount_due: amount,
          amount_paid: 0,
          balance: amounts.balance,
          due_date: toIsoDate(input.item.dueDate),
          status: amounts.status,
          reminder_count: 0,
          created_at: new Date().toISOString(),
          profile_payload: {
            publicId: `STUFEE-${randomUUID()}`,
            studentId: input.student.publicId || input.student.studentCode || input.student.id,
            studentName: `${input.student.firstName ?? ""} ${input.student.lastName ?? input.student.name ?? ""}`.trim(),
            className: input.grid.className,
            schoolCode: input.schoolCode,
          },
        });
        return true;
      },
      async insertTariffHistory(row) {
        tables.feeTariffHistory.push({ id: randomUUID(), ...row, created_at: new Date().toISOString() });
      },
      async listRemindersByStudent(studentDbId) {
        return tables.paymentReminders
          .filter((row) => String(row.student_id) === String(studentDbId))
          .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
          .map(mapReminderRow);
      },
      async insertReminder(reminder) {
        const row = {
          id: randomUUID(),
          school_id: reminder.schoolId,
          school_code: reminder.schoolCode,
          student_id: reminder.studentDbId,
          student_code: reminder.studentId,
          recipient: reminder.recipient,
          channel: reminder.channel,
          message: reminder.message,
          summary: reminder.summary,
          send_status: reminder.sendStatus,
          sent_at: reminder.sentAt,
          profile_payload: reminder,
        };
        tables.paymentReminders.unshift(row);
        return mapReminderRow(row);
      },
    };
  }

  const api = {
    tables,
    async withTransaction(fn) {
      const snapshot = clone(tables);
      try {
        return await fn(txApi());
      } catch (error) {
        tables.payments = snapshot.payments;
        tables.paymentStatuses = snapshot.paymentStatuses;
        tables.feeGrids = snapshot.feeGrids;
        tables.schoolFeeItems = snapshot.schoolFeeItems;
        tables.studentFees = snapshot.studentFees;
        tables.feeTariffHistory = snapshot.feeTariffHistory;
        tables.paymentReminders = snapshot.paymentReminders;
        tables.allocations = snapshot.allocations;
        tables.paymentItems = snapshot.paymentItems;
        tables.auditLogs = snapshot.auditLogs;
        throw error;
      }
    },
    async listProjection() {
      return {
        payments: projectPaymentsWithAllocations(
          tables.payments.map((row) =>
            decoratePaymentWithItems(
              mapPaymentRow(row),
              tables.paymentItems.filter((item) => String(item.payment_id) === String(row.id)),
            ),
          ),
          tables.allocations,
        ),
        paymentStatuses: tables.paymentStatuses.map(mapStatusRow),
        feeGrids: tables.feeGrids.map(mapGridRow),
        schoolFeeItems: tables.schoolFeeItems.map(mapItemRow),
        studentFees: tables.studentFees.map(mapObligationRow),
        feeTariffHistory: tables.feeTariffHistory.map((row) => ({
          id: row.id,
          feeGridId: row.feeGridId,
          action: row.action,
          createdAt: row.created_at,
          payload: row.payload,
        })),
        paymentReminders: tables.paymentReminders.map(mapReminderRow),
      };
    },
    createSchoolPayment: (payload, principal, auditMeta) => financeService.createPayment(api, payload, principal, auditMeta),
    reconcileFinancePaymentAllocations: (principal, options, auditMeta) =>
      financeService.reconcileHistoricalPaymentAllocations(api, principal, auditMeta, options),
    getSchoolPayment: async (id, principal) => txApi().getPaymentByCode(id, principal),
    cancelSchoolPayment: (id, reason, principal, auditMeta) => financeService.cancelPayment(api, id, reason, principal, auditMeta),
    upsertFinanceFeeGrid: (payload, principal) => financeService.upsertFeeGrid(api, payload, principal),
    getFinanceFeeGrid: async (id, principal) => {
      const grid = await txApi().getGrid(id, principal);
      if (!grid) return null;
      return { grid, items: await txApi().listItemsByGrid(grid.dbId) };
    },
    setFinanceFeeGridStatus: (id, status, principal) => financeService.setFeeGridStatus(api, id, status, principal),
    applyFinanceFeeGrid: (id, principal, options) => financeService.applyFeeGrid(api, id, principal, options),
    listFinanceFeeGrids: async () => tables.feeGrids.map(mapGridRow),
    listFinanceStudentFees: async (principal) => {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return [];
      const fees = tables.studentFees
        .map(mapObligationRow)
        .filter((fee) => schoolCodeInScope(fee.schoolCode, scope));
      const feeIds = new Set(fees.map((fee) => String(fee.dbId || fee.id)));
      return projectObligationPaidAmounts({
        fees,
        allocations: tables.allocations
          .filter((row) => feeIds.has(String(row.obligation_id)))
          .map((row) => ({
            obligationId: row.obligation_id,
            paymentId: row.payment_id,
            amount: row.amount,
            reversedAt: row.reversed_at,
          })),
      });
    },
    getFinanceStudentFee: (id, principal) => txApi().getObligationByPublicId(id, principal),
    adjustFinanceStudentFee: (id, patch, principal) => financeService.adjustStudentFee(api, id, patch, principal),
    createFinanceReminder: (studentId, payload, principal, options) =>
      financeService.createReminder(api, studentId, payload, principal, options),
    listFinancePaymentStatuses: async () => tables.paymentStatuses.map(mapStatusRow),
    upsertFinancePaymentStatus: async (payload, principal) => {
      const code = asTrimmed(payload.code || payload.id);
      const existing = tables.paymentStatuses.find((row) => row.status_code === code);
      const row = existing || {
        id: randomUUID(),
        status_code: code,
        school_code: principal?.schoolCode,
        created_at: new Date().toISOString(),
      };
      row.label = payload.label || code;
      row.is_active = payload.status !== "Inactif";
      row.sort_order = Number(payload.sortOrder || 0);
      row.profile_payload = payload;
      row.updated_at = new Date().toISOString();
      if (!existing) tables.paymentStatuses.push(row);
      return mapStatusRow(row);
    },
  };

  return api;
}

module.exports = { createFinanceMemoryStore };
