"use strict";

const { randomUUID } = require("node:crypto");
const seedData = require("../data");
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
  normalizeKey,
} = require("../lib/financeManagement");
const { decoratePaymentWithItems } = require("../lib/financePaymentItems");
const { projectObligationPaidAmounts } = require("../lib/financeObligationPaid");
const { projectPaymentsWithAllocations, projectPaymentCash } = require("../lib/financeUnallocatedCash");
const { resolveFinanceSchoolScope, schoolCodeInScope } = require("../lib/financeSchoolScope");
const {
  foldPaymentStudentOptions,
  resolveCatalogPaymentMethods,
  mapCatalogFeeType,
  buildFinanceCatalog,
  CANONICAL_PAYMENT_METHODS,
} = require("../lib/financeCatalog");
const financeService = require("../lib/financeService");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFinanceMemoryStore({
  getSchoolByCode,
  findStudent,
  listStudentsInClass,
  getClassById: lookupClassById,
  listSchoolStudents,
} = {}) {
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
    paymentMethods: [],
    auditLogs: [],
  };

  async function classFromSeedCatalogById(classId) {
    const key = asTrimmed(classId);
    if (!key) return null;
    const row = (seedData.classes ?? []).find(
      (item) => asTrimmed(item.classId) === key,
    );
    if (!row) return null;
    const school = await getSchoolByCode?.(row.schoolCode);
    return {
      classId: asTrimmed(row.classId),
      schoolId: school?.id || row.schoolId,
      classCode: asTrimmed(row.classCode || row.publicId || row.id),
      className: asTrimmed(row.className || row.name),
      schoolCode: row.schoolCode,
    };
  }

  async function classFromSeedCatalogByCode(classCode, expectedSchoolId) {
    const key = asTrimmed(classCode).toUpperCase();
    if (!key) return null;
    const candidates = (seedData.classes ?? []).filter((item) =>
      [item.classCode, item.publicId, item.id]
        .map((value) => asTrimmed(value).toUpperCase())
        .filter(Boolean)
        .includes(key),
    );
    for (const row of candidates) {
      const school = await getSchoolByCode?.(row.schoolCode);
      const resolvedSchoolId = school?.id || row.schoolId;
      if (expectedSchoolId && resolvedSchoolId && String(resolvedSchoolId) !== String(expectedSchoolId)) {
        continue;
      }
      return {
        classId: asTrimmed(row.classId),
        schoolId: resolvedSchoolId || expectedSchoolId,
        classCode: asTrimmed(row.classCode || row.publicId || row.id),
        className: asTrimmed(row.className || row.name),
        schoolCode: row.schoolCode || school?.code || school?.schoolCode,
      };
    }
    return null;
  }

  async function uniqueClassFromSeedCatalog(schoolId, academicYear, className, schoolCode) {
    const name = asTrimmed(className).toLowerCase();
    const year = asTrimmed(academicYear).toLowerCase();
    const code = asTrimmed(schoolCode).toUpperCase();
    if (!name) return null;
    const candidates = [];
    for (const row of seedData.classes ?? []) {
      if (asTrimmed(row.className || row.name).toLowerCase() !== name) continue;
      if (code && asTrimmed(row.schoolCode).toUpperCase() !== code) continue;
      const rowYear = asTrimmed(row.academicYearName || row.schoolYear).toLowerCase();
      if (year && rowYear && rowYear !== year) continue;
      const school = await getSchoolByCode?.(row.schoolCode);
      const resolvedSchoolId = school?.id || row.schoolId || schoolId;
      if (schoolId && resolvedSchoolId && String(resolvedSchoolId) !== String(schoolId)) continue;
      candidates.push({
        classId: asTrimmed(row.classId),
        schoolId: resolvedSchoolId,
        classCode: asTrimmed(row.classCode || row.publicId || row.id),
        className: asTrimmed(row.className || row.name),
        schoolCode: row.schoolCode || code,
      });
    }
    const dedup = new Map();
    for (const row of candidates) {
      const key = row.classId || row.classCode;
      if (key) dedup.set(key, row);
    }
    return dedup.size === 1 ? [...dedup.values()][0] : null;
  }

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
              academicYear: asTrimmed(row.academicYear || row.academicYearName || row.schoolYear),
              enrollmentDate: row.enrollmentDate || row.enrollment_date || null,
              classEffectiveDate: row.classEffectiveDate || row.class_effective_date || row.enrollmentDate || null,
            }));
        }
        if (asTrimmed(student.classId)) {
          return [
            {
              schoolId,
              classId: String(student.classId),
              classCode: asTrimmed(student.classCode),
              className: asTrimmed(student.className),
              academicYear: asTrimmed(student.academicYear || student.academicYearName || student.schoolYear),
              enrollmentDate: student.enrollmentDate || null,
              classEffectiveDate: student.classEffectiveDate || student.enrollmentDate || null,
            },
          ];
        }
        return [];
      },
      async listApplicableFeeGrids({ schoolId, classId, className, academicYear }) {
        const year = asTrimmed(academicYear).toLowerCase();
        const name = asTrimmed(className).toLowerCase();
        return tables.feeGrids
          .filter((row) => {
            if (String(row.school_id) !== String(schoolId)) return false;
            if (row.status !== "Active") return false;
            if (year && asTrimmed(row.academic_year).toLowerCase() !== year) return false;
            if (classId && row.class_id && String(row.class_id) === String(classId)) return true;
            return name && asTrimmed(row.class_name).toLowerCase() === name;
          })
          .map((row) => ({ ...mapGridRow(row), schoolId: row.school_id }));
      },
      async getClassById(classId) {
        if (typeof lookupClassById === "function") {
          const resolved = await lookupClassById(classId);
          if (resolved) return resolved;
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
        return classFromSeedCatalogById(key);
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
        if (match) {
          return {
            classId: asTrimmed(match.classId),
            schoolId: match.schoolId || schoolId,
            classCode: asTrimmed(match.classCode),
            className: asTrimmed(match.className),
            schoolCode: match.schoolCode,
          };
        }
        return classFromSeedCatalogByCode(key, schoolId);
      },
      async findUniqueClassBySchoolYearName(schoolId, academicYear, className, schoolCode) {
        const name = asTrimmed(className);
        if (!name) return null;
        const catalogMatch = await uniqueClassFromSeedCatalog(schoolId, academicYear, name, schoolCode);
        if (catalogMatch) return catalogMatch;
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
        return raw.filter((student) => {
          if (spec.classId && [student.classId, student.class_id].some((value) => String(value ?? "") === spec.classId)) {
            return true;
          }
          if (spec.classCode && asTrimmed(student.classCode || student.class_code).toUpperCase() === spec.classCode.toUpperCase()) {
            return true;
          }
          if (!spec.classId && !spec.classCode && spec.className) {
            return studentMatchesClassScope(student, { className: spec.className });
          }
          return false;
        });
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
        if (fee.archived) {
          row.archived_at = row.archived_at || new Date().toISOString();
          row.cancel_reason = fee.cancelReason || row.cancel_reason || "";
          row.cancelled_at = row.cancelled_at || new Date().toISOString();
          row.cancelled_by = fee.cancelledBy || row.cancelled_by || "";
        }
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
        const periodKey = asTrimmed(input.periodKey);
        const academicYear = input.academicYear || input.grid.academicYear || "";
        const studentId = String(input.student.dbId || input.student.id);
        const exists = tables.studentFees.some((row) => {
          if (row.archived_at) return false;
          if (String(row.student_id) !== studentId) return false;
          if (periodKey && input.feeTypeCode) {
            return (
              asTrimmed(row.academic_year) === asTrimmed(academicYear) &&
              asTrimmed(row.fee_type_code) === asTrimmed(input.feeTypeCode) &&
              asTrimmed(row.period_key) === periodKey
            );
          }
          return (
            row.fee_grid_id === input.grid.id &&
            row.school_fee_item_id === input.item.id &&
            (row.period_label || "") === period
          );
        });
        if (exists) return false;
        const amount = money(input.item.amount);
        const amounts = obligationStatus({ amountDue: amount, amountPaid: 0, exemption: 0, dueDate: input.item.dueDate });
        tables.studentFees.push({
          id: randomUUID(),
          school_id: input.schoolId,
          school_code: input.schoolCode,
          student_id: input.student.dbId || input.student.id,
          student_code: input.student.publicId || input.student.studentCode || input.student.id,
          class_id: input.classId || input.grid.classId || null,
          fee_grid_id: input.grid.id,
          school_fee_item_id: input.item.id,
          source_fee_item_uuid: input.sourceFeeItemId || input.item.dbId || null,
          source_enrollment_id: input.sourceEnrollmentId || null,
          fee_type: input.item.feeType,
          fee_type_code: input.feeTypeCode || null,
          label: period ? `${input.item.label} — ${period}` : input.item.label,
          currency: input.currency || input.grid.currency,
          academic_year: academicYear,
          period_label: period,
          period_key: periodKey || null,
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
            className: input.className || input.grid.className,
            classId: input.classId || input.grid.classId || null,
            schoolCode: input.schoolCode,
            feeTypeCode: input.feeTypeCode || null,
            periodKey: periodKey || null,
            sourceEnrollmentId: input.sourceEnrollmentId || null,
            createdReason: input.reason || null,
            createdBy: input.createdBy || null,
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
        tables.paymentMethods = snapshot.paymentMethods;
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
    ensureEnrollmentObligations: (input, principal, auditMeta) =>
      financeService.ensureEnrollmentFinanceObligations(api, input, principal, auditMeta),
    ensureEnrollmentObligationsInTx: async (tx, input, principal, auditMeta) => {
      const financeTx = tx || txApi();
      let school = input.school;
      if (!school && input.schoolCode && typeof financeTx.getSchoolByCode === "function") {
        school = await financeTx.getSchoolByCode(input.schoolCode);
      }
      let students = input.students;
      if (!students && input.student) students = [input.student];
      if (!students && input.studentKey && typeof financeTx.findStudent === "function") {
        const found = await financeTx.findStudent(input.studentKey, principal);
        students = found ? [found] : [];
      }
      return financeService.ensureEnrollmentFinanceObligationsInTx(
        financeTx,
        { ...input, school, students },
        principal,
        auditMeta,
      );
    },
    listFinanceFeeGrids: async (principal) => {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return [];
      return tables.feeGrids.map(mapGridRow).filter((row) => schoolCodeInScope(row.schoolCode, scope));
    },
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
    listFinancePaymentStatuses: async (principal) => {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return [];
      return tables.paymentStatuses
        .map(mapStatusRow)
        .filter((row) => !row.schoolCode || schoolCodeInScope(row.schoolCode, scope));
    },
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
    async listPaymentStudentOptions(principal) {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return [];
      const students = typeof listSchoolStudents === "function" ? await listSchoolStudents(principal) : [];
      const rows = [];
      for (const student of students) {
        const schoolCode = String(student.schoolCode || "").trim();
        if (!schoolCodeInScope(schoolCode, scope)) continue;
        const enrollments = Array.isArray(student.enrollments) && student.enrollments.length
          ? student.enrollments
          : [
              {
                classId: student.classId,
                classCode: student.classCode,
                className: student.className,
                status: "active",
              },
            ];
        for (const enrollment of enrollments) {
          rows.push({
            student_id: student.id || student.studentId || student.dbId,
            student_code: student.studentCode || student.student_code || student.publicId || student.matricule,
            first_name: student.firstName || student.first_name,
            last_name: student.lastName || student.last_name,
            student_status: student.status || "active",
            enrollment_status: enrollment.status || "active",
            class_id: enrollment.classId || enrollment.class_id,
            class_code: enrollment.classCode || enrollment.class_code,
            class_name: enrollment.className || enrollment.class_name,
            school_code: schoolCode,
          });
        }
      }
      return foldPaymentStudentOptions(rows);
    },
    async listSchoolPaymentMethods(principal) {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return resolveCatalogPaymentMethods([]);
      const rows = tables.paymentMethods.filter((row) => schoolCodeInScope(row.school_code, scope));
      return resolveCatalogPaymentMethods(rows);
    },
    async replaceSchoolPaymentMethods(methods, principal) {
      const school = await getSchoolByCode?.(principal?.schoolCode);
      const schoolCode = String(school?.code || principal?.schoolCode || "").trim().toUpperCase();
      tables.paymentMethods = tables.paymentMethods.filter((row) => String(row.school_code).toUpperCase() !== schoolCode);
      const allowed = new Map(CANONICAL_PAYMENT_METHODS.map((item) => [item.methodCode, item]));
      const saved = [];
      for (const item of Array.isArray(methods) ? methods : []) {
        const methodCode = String(item.methodCode || item.method_code || "").trim();
        const canonical = allowed.get(methodCode);
        if (!canonical) continue;
        const row = {
          id: randomUUID(),
          school_id: school?.id || schoolCode,
          school_code: schoolCode,
          method_code: canonical.methodCode,
          label: String(item.label || canonical.label).trim() || canonical.label,
          is_active: item.active !== false && item.is_active !== false,
          sort_order: Number(item.sortOrder ?? item.sort_order ?? canonical.sortOrder),
        };
        tables.paymentMethods.push(row);
        saved.push(row);
      }
      return resolveCatalogPaymentMethods(saved);
    },
    async listCatalogFeeTypes(principal) {
      const scope = resolveFinanceSchoolScope(principal);
      if (scope.mode === "none") return [];
      const grids = tables.feeGrids.filter(
        (row) => schoolCodeInScope(row.school_code || mapGridRow(row).schoolCode, scope) && normalizeKey(row.status) === "active",
      );
      const gridIds = new Set(grids.map((row) => String(row.id)));
      return tables.schoolFeeItems
        .filter((row) => gridIds.has(String(row.fee_grid_id)) && normalizeKey(row.status || "Actif") === "actif")
        .map((row) => {
          const grid = grids.find((item) => String(item.id) === String(row.fee_grid_id));
          return mapCatalogFeeType({
            ...row,
            currency: grid?.currency,
            class_id: grid?.class_id,
            class_name: grid?.class_name || grid?.className,
            academic_year: grid?.academic_year || grid?.academicYear,
          });
        });
    },
    async getFinanceCatalog(principal) {
      const school =
        principal?.schoolCode && principal.schoolCode !== "*"
          ? await getSchoolByCode?.(principal.schoolCode)
          : null;
      const [paymentMethods, feeTypes] = await Promise.all([
        api.listSchoolPaymentMethods(principal),
        api.listCatalogFeeTypes(principal),
      ]);
      return buildFinanceCatalog({
        currency: school?.currency,
        currencySource: school?.currency ? "school" : "country",
        paymentMethods,
        feeTypes,
      });
    },
  };

  return api;
}

module.exports = { createFinanceMemoryStore };
