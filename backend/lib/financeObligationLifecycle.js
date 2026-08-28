"use strict";

/**
 * F3 — unique moteur de naissance des obligations.
 * Tarif (grille) ≠ dette. Le paiement ne crée jamais d'obligation.
 */

const {
  FINANCE_ERROR,
  createFinanceError,
  asTrimmed,
  money,
  obligationStatus,
  toIsoDate,
  studentMatches,
} = require("./financeManagement");
const { persistableFeeType, resolveFeeType } = require("./financeFeeTypes");
const { PRESENTATION_CURRENCY_ALIASES } = require("./financeDomainInvariants");
const { expandFeeItemPeriods, isPeriodAfterEffectiveMonth } = require("./financeObligationPeriod");

const OBLIGATION_LIFECYCLE_REASON = Object.freeze({
  ENROLLMENT_ACTIVE: "enrollment_active",
  GRID_APPLY: "grid_apply",
  CATCH_UP: "catch_up",
  CLASS_TRANSFER: "class_transfer",
});

const OBLIGATION_CANCEL_REASON = Object.freeze({
  CLASS_TRANSFER: "CLASS_TRANSFER",
});

const NO_APPLICABLE_GRID = "NO_APPLICABLE_FINANCE_GRID";

function snapshotCurrency(school) {
  const raw = asTrimmed(school?.currency).toUpperCase();
  if (!raw) {
    throw createFinanceError(
      400,
      "Devise de l'établissement introuvable — aucun repli CDF/USD/EUR.",
      FINANCE_ERROR.TENANT_MISMATCH,
    );
  }
  if (raw === "FC") return PRESENTATION_CURRENCY_ALIASES.FC || "CDF";
  return PRESENTATION_CURRENCY_ALIASES[raw] || raw;
}

function enrollmentYearOf(row) {
  return asTrimmed(row?.academicYear || row?.academicYearName || row?.schoolYear);
}

function sameId(left, right) {
  return asTrimmed(left) && asTrimmed(left) === asTrimmed(right);
}

function assertSameTenant(ids) {
  const unique = new Set((ids || []).map((value) => String(value ?? "").trim()).filter(Boolean));
  if (unique.size > 1) {
    throw createFinanceError(
      403,
      "Génération d'obligation refusée : établissements incompatibles.",
      FINANCE_ERROR.TENANT_MISMATCH,
      { schoolIds: [...unique] },
    );
  }
  return [...unique][0] || null;
}

function canonicalFeeSnapshot(item) {
  const feeType = persistableFeeType(item.feeType || item.fee_type || item.label);
  const resolved = resolveFeeType(feeType, { mode: "read" });
  return {
    feeType,
    feeTypeCode: resolved?.code || "",
    feeTypeLabelSnapshot: feeType,
  };
}

function isImmutableObligation(obligation) {
  if (obligation.archivedAt || obligation.archived) return true;
  if (["Payé", "Annulé", "Exonéré"].includes(obligation.status)) return true;
  if (money(obligation.amountPaid) > 0) return true;
  return false;
}

function originatesFromClass(obligation, classRef) {
  if (!classRef) return false;
  if (obligation.classId && sameId(obligation.classId, classRef.classId || classRef.id)) return true;
  const name = asTrimmed(classRef.className || classRef.name).toLowerCase();
  if (name && asTrimmed(obligation.className).toLowerCase() === name) return true;
  return false;
}

function isFutureUnpaidFromOldClass(obligation, { previousClass, effectiveDate }) {
  if (isImmutableObligation(obligation)) return false;
  if (!originatesFromClass(obligation, previousClass)) return false;
  if (isPeriodAfterEffectiveMonth(obligation.periodKey, effectiveDate)) return true;
  if (obligation.dueDate && effectiveDate && toIsoDate(obligation.dueDate) > toIsoDate(effectiveDate)) {
    if (!obligation.periodKey || obligation.periodKey === "ONCE" || String(obligation.periodKey).startsWith("ONCE:")) {
      return true;
    }
  }
  return false;
}

async function writeLifecycleAudit(tx, principal, auditMeta, entry) {
  if (typeof tx.recordFinanceAudit !== "function") return;
  await tx.recordFinanceAudit({
    schoolCode: entry.schoolCode || principal?.schoolCode,
    userId: principal?.sub || principal?.id || "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId ?? ""),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    ipAddress: auditMeta?.ipAddress,
    userAgent: auditMeta?.userAgent,
  });
}

function gridMatchesEnrollment(grid, enrollment, school) {
  if (!grid || grid.status !== "Active") return false;
  const enrollmentSchoolId = enrollment.schoolId || school?.id;
  if (grid.schoolId && enrollmentSchoolId && !sameId(grid.schoolId, enrollmentSchoolId)) return false;
  if (grid.schoolCode && enrollment.schoolCode) {
    if (asTrimmed(grid.schoolCode).toUpperCase() !== asTrimmed(enrollment.schoolCode).toUpperCase()) {
      return false;
    }
  }
  const year = asTrimmed(grid.academicYear).toLowerCase();
  const expectedYear = asTrimmed(enrollment.academicYear).toLowerCase();
  if (year && !expectedYear) return false;
  if (year && expectedYear && year !== expectedYear) return false;
  if (grid.classId) {
    return sameId(grid.classId, enrollment.classId);
  }
  const gridName = asTrimmed(grid.className).toLowerCase();
  const className = asTrimmed(enrollment.className).toLowerCase();
  return Boolean(gridName && className && gridName === className);
}

async function loadEnrollmentForStudent(tx, { student, school, classId, academicYear }) {
  const fromStudent = Array.isArray(student?.enrollments)
    ? student.enrollments
        .filter((row) => !row.status || String(row.status).toLowerCase() === "active")
        .filter((row) => asTrimmed(row.classId))
        .map((row) => ({
          enrollmentId: row.id || row.enrollmentId,
          schoolId: row.schoolId || school.id,
          classId: String(row.classId),
          classCode: asTrimmed(row.classCode),
          className: asTrimmed(row.className),
          academicYear: enrollmentYearOf(row),
          classEffectiveDate: row.classEffectiveDate || null,
        }))
    : [];
  if (fromStudent.length) return fromStudent;
  if (typeof tx.listActiveEnrollmentsForStudent !== "function") {
    if (!asTrimmed(student.classId) && !asTrimmed(classId)) return [];
    return [
      {
        enrollmentId: student.enrollmentId || null,
        schoolId: school.id,
        classId: student.classId,
        classCode: student.classCode || "",
        className: student.className || "",
        academicYear: enrollmentYearOf(student),
        classEffectiveDate: student.classEffectiveDate || student.enrollmentDate || null,
      },
    ];
  }
  const rows = await tx.listActiveEnrollmentsForStudent(student.dbId || student.id, school.id);
  return rows.map((row) => ({
    ...row,
    schoolId: row.schoolId || school.id,
    academicYear: enrollmentYearOf(row),
  }));
}

function pickEnrollment(enrollments, { classId, academicYear }) {
  const year = asTrimmed(academicYear).toLowerCase();
  let scoped = enrollments.filter((row) => asTrimmed(row.classId));
  if (year) {
    scoped = scoped.filter((row) => asTrimmed(row.academicYear).toLowerCase() === year);
    if (!scoped.length) {
      throw createFinanceError(
        404,
        "Aucune inscription active pour l'année académique demandée.",
        FINANCE_ERROR.ENROLLMENT_NOT_FOUND,
        { academicYear },
      );
    }
  }
  if (classId) {
    scoped = scoped.filter((row) => sameId(row.classId, classId));
    if (!scoped.length) {
      throw createFinanceError(
        409,
        "Aucune inscription active pour la classe demandée.",
        FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH,
        { classId },
      );
    }
  }
  const uniqueClasses = new Set(scoped.map((row) => asTrimmed(row.classId)));
  if (uniqueClasses.size > 1) {
    throw createFinanceError(
      409,
      "Plusieurs inscriptions actives incompatibles pour cet élève et cette année.",
      FINANCE_ERROR.ENROLLMENT_AMBIGUOUS,
      { classIds: [...uniqueClasses] },
    );
  }
  return scoped[0] || null;
}

function resolveClassTransferEffectiveDate(input) {
  const requested = asTrimmed(input?.effectiveDate);
  if (requested) return requested;
  throw createFinanceError(
    409,
    "Date effective du changement de classe obligatoire : aucune obligation n'a été annulée.",
    FINANCE_ERROR.NEEDS_EFFECTIVE_DATE,
  );
}

function isUnswallowableFinanceSyncError(error) {
  const code = error?.code;
  return (
    code === FINANCE_ERROR.TENANT_MISMATCH ||
    code === FINANCE_ERROR.ENROLLMENT_AMBIGUOUS ||
    code === FINANCE_ERROR.CLASS_TENANT_MISMATCH ||
    code === FINANCE_ERROR.FEE_ITEM_TENANT_MISMATCH ||
    code === FINANCE_ERROR.OBLIGATION_TENANT_MISMATCH ||
    code === FINANCE_ERROR.NEEDS_EFFECTIVE_DATE ||
    code === FINANCE_ERROR.ENROLLMENT_NOT_FOUND ||
    code === FINANCE_ERROR.CLASS_ENROLLMENT_MISMATCH ||
    code === FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH
  );
}

async function persistObligationSyncFailure(store, input, principal, auditMeta, error) {
  if (typeof store?.withTransaction !== "function") return;
  try {
    await store.withTransaction(async (tx) => {
      await writeLifecycleAudit(tx, principal, auditMeta, {
        action: "finance_obligation_sync_failed",
        entityType: "enrollment",
        entityId: input.enrollmentId || input.classId || input.studentKey || input.student?.id || "",
        schoolCode: input.schoolCode || input.school?.code || input.school?.schoolCode || principal?.schoolCode,
        newValue: {
          reason: FINANCE_ERROR.OBLIGATION_SYNC_FAILED,
          errorCode: error?.code || error?.message || "UNKNOWN",
          message: error?.message || String(error),
          enrollmentId: input.enrollmentId || null,
          studentId: input.studentKey || input.student?.studentCode || input.student?.publicId || input.student?.dbId || null,
          studentKey: input.studentKey || input.student?.studentCode || null,
          previousClassId: input.previousClass?.classId || input.previousClass?.id || null,
          previousClassCode: input.previousClass?.classCode || null,
          previousClassName: input.previousClass?.className || input.previousClass?.name || null,
          targetClassId: input.classId || input.student?.classId || null,
          targetClassCode: input.student?.classCode || input.targetClass?.classCode || null,
          targetClassName: input.student?.className || input.targetClass?.className || null,
          effectiveDate: input.effectiveDate || null,
          academicYear: input.academicYear || null,
          lifecycleReason: input.reason || null,
          retryStatus: "pending",
        },
      });
    });
  } catch {
    /* l'échec d'audit ne doit pas masquer l'erreur métier d'origine */
  }
}

async function supersedeOldClassObligations(tx, {
  obligations,
  previousClass,
  effectiveDate,
  principal,
  auditMeta,
  schoolCode,
}) {
  let superseded = 0;
  for (const obligation of obligations) {
    if (!isFutureUnpaidFromOldClass(obligation, { previousClass, effectiveDate })) continue;
    obligation.status = "Annulé";
    obligation.archived = true;
    obligation.cancelReason = OBLIGATION_CANCEL_REASON.CLASS_TRANSFER;
    obligation.cancelledAt = new Date().toISOString();
    obligation.cancelledBy = principal?.sub || principal?.id || "system";
    await tx.updateObligation(obligation);
    await writeLifecycleAudit(tx, principal, auditMeta, {
      action: "supersede_obligation_class_transfer",
      entityType: "student_fee_obligation",
      entityId: obligation.dbId || obligation.id,
      schoolCode,
      oldValue: { status: "À payer", classId: obligation.classId },
      newValue: { status: "Annulé", cancelReason: OBLIGATION_CANCEL_REASON.CLASS_TRANSFER },
    });
    superseded += 1;
  }
  return superseded;
}

async function insertObligationFromItem(tx, {
  school,
  student,
  enrollment,
  grid,
  item,
  period,
  reason,
  principal,
}) {
  const fee = canonicalFeeSnapshot(item);
  const amount = money(item.amount);
  if (!(amount > 0)) return false;
  const currency = snapshotCurrency(school);
  return tx.insertObligationIfAbsent({
    schoolId: school.id,
    schoolCode: school.code || school.schoolCode || enrollment.schoolCode,
    student,
    grid,
    item: {
      ...item,
      feeType: fee.feeType,
    },
    periodLabel: period.periodLabel,
    periodKey: period.periodKey,
    feeTypeCode: fee.feeTypeCode,
    classId: enrollment.classId || grid.classId || null,
    className: enrollment.className || grid.className || "",
    academicYear: enrollment.academicYear || grid.academicYear,
    sourceEnrollmentId: enrollment.enrollmentId || enrollment.id || null,
    sourceFeeItemId: item.dbId || null,
    currency,
    reason,
    createdBy: principal?.sub || principal?.id || "system",
  });
}

async function ensureEnrollmentFinanceObligationsInTx(tx, input, principal, auditMeta) {
  const reason = input.reason || OBLIGATION_LIFECYCLE_REASON.CATCH_UP;
  const school = input.school;
  if (!school?.id) {
    throw createFinanceError(404, "Établissement introuvable", FINANCE_ERROR.TENANT_MISMATCH);
  }
  const schoolCode = school.code || school.schoolCode || input.schoolCode;
  const students = Array.isArray(input.students) ? input.students : input.student ? [input.student] : [];
  if (!students.length) {
    return { created: 0, skipped: 0, superseded: 0, reason: "NO_STUDENTS" };
  }

  let grids = Array.isArray(input.grids) ? input.grids : input.grid ? [input.grid] : null;
  const targetIds = Array.isArray(input.studentIds) ? input.studentIds.map(String) : null;
  let created = 0;
  let skipped = 0;
  let superseded = 0;
  const noGridStudents = [];

  for (const student of students) {
    if (targetIds && !targetIds.some((id) => studentMatches(student, id))) continue;
    const studentSchoolId = student.schoolId || school.id;
    if (student.schoolCode && schoolCode && asTrimmed(student.schoolCode).toUpperCase() !== asTrimmed(schoolCode).toUpperCase()) {
      throw createFinanceError(403, "Élève hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
    }
    if (studentSchoolId && String(studentSchoolId) !== String(school.id)) {
      throw createFinanceError(403, "Élève hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
    }

    const enrollments = await loadEnrollmentForStudent(tx, {
      student,
      school,
      classId: input.classId || student.classId,
      academicYear: input.academicYear,
    });
    const requestedClassId = input.classId || student.classId;
    const requestedYear = input.academicYear || input.grid?.academicYear;
    const enrollment = pickEnrollment(enrollments, {
      classId: requestedClassId,
      academicYear: requestedYear,
    });
    if (!enrollment || !asTrimmed(enrollment.classId)) {
      skipped += 1;
      continue;
    }
    enrollment.schoolCode = enrollment.schoolCode || schoolCode;

    if (reason === OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER || input.previousClass) {
      const transferEffectiveDate = resolveClassTransferEffectiveDate(input);
      const obligations =
        typeof tx.listObligationsByStudent === "function"
          ? await tx.listObligationsByStudent(school.id, student.dbId || student.id, { lock: true })
          : [];
      const yearObligations = obligations.filter(
        (row) =>
          !asTrimmed(enrollment.academicYear) ||
          asTrimmed(row.academicYear).toLowerCase() === asTrimmed(enrollment.academicYear).toLowerCase(),
      );
      superseded += await supersedeOldClassObligations(tx, {
        obligations: yearObligations,
        previousClass: input.previousClass,
        effectiveDate: transferEffectiveDate,
        principal,
        auditMeta,
        schoolCode,
      });
    }

    let studentGrids = grids;
    if (!studentGrids) {
      if (typeof tx.listApplicableFeeGrids !== "function") {
        studentGrids = [];
      } else {
        studentGrids = await tx.listApplicableFeeGrids({
          schoolId: school.id,
          classId: enrollment.classId,
          className: enrollment.className,
          academicYear: enrollment.academicYear,
        });
      }
    }
    if (input.grid) {
      if (input.grid.schoolId && String(input.grid.schoolId) !== String(school.id)) {
        throw createFinanceError(403, "Grille hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
      }
      if (input.grid.schoolCode && asTrimmed(input.grid.schoolCode).toUpperCase() !== asTrimmed(schoolCode).toUpperCase()) {
        throw createFinanceError(403, "Grille hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
      }
      if (!gridMatchesEnrollment(input.grid, enrollment, school)) {
        throw createFinanceError(
          409,
          "La grille tarifaire ne correspond pas à l'inscription (classe ou année).",
          FINANCE_ERROR.GRID_ENROLLMENT_MISMATCH,
          {
            gridClassId: input.grid.classId,
            enrollmentClassId: enrollment.classId,
            gridYear: input.grid.academicYear,
            enrollmentYear: enrollment.academicYear,
          },
        );
      }
      studentGrids = [input.grid];
    } else {
      studentGrids = (studentGrids || []).filter((grid) => gridMatchesEnrollment(grid, enrollment, school));
    }

    if (!studentGrids.length) {
      noGridStudents.push(student.dbId || student.id);
      await writeLifecycleAudit(tx, principal, auditMeta, {
        action: "no_applicable_finance_grid",
        entityType: "enrollment",
        entityId: enrollment.enrollmentId || enrollment.id || student.dbId || student.id,
        schoolCode,
        newValue: {
          reason: NO_APPLICABLE_GRID,
          studentId: student.publicId || student.studentCode || student.id,
          classId: enrollment.classId,
          academicYear: enrollment.academicYear,
        },
      });
      continue;
    }

    for (const grid of studentGrids) {
      const gridSchoolId = grid.schoolId || school.id;
      assertSameTenant([school.id, gridSchoolId, enrollment.schoolId || school.id]);
      const items =
        grid === input.grid && Array.isArray(input.items)
          ? input.items
          : typeof tx.listItemsByGrid === "function"
            ? await tx.listItemsByGrid(grid.dbId)
            : [];
      const activeItems = items.filter((item) => item.status === "Actif" || !item.status);
      for (const item of activeItems) {
        if (item.schoolId && String(item.schoolId) !== String(school.id)) {
          throw createFinanceError(403, "Ligne tarifaire hors établissement.", FINANCE_ERROR.FEE_ITEM_TENANT_MISMATCH);
        }
        const periods = expandFeeItemPeriods(item, enrollment.academicYear || grid.academicYear);
        for (const period of periods) {
          const inserted = await insertObligationFromItem(tx, {
            school,
            student,
            enrollment,
            grid,
            item,
            period,
            reason,
            principal,
          });
          if (inserted) created += 1;
          else skipped += 1;
        }
      }
    }
  }

  await writeLifecycleAudit(tx, principal, auditMeta, {
    action: "ensure_enrollment_obligations",
    entityType: "student_fee_obligation",
    entityId: input.grid?.id || school.id,
    schoolCode,
    newValue: {
      reason,
      created,
      skipped,
      superseded,
      noApplicableGrid: noGridStudents.length ? NO_APPLICABLE_GRID : null,
      noGridCount: noGridStudents.length,
    },
  });

  return {
    created,
    skipped,
    superseded,
    reason: noGridStudents.length && created === 0 ? NO_APPLICABLE_GRID : reason,
    noApplicableGrid: noGridStudents.length ? NO_APPLICABLE_GRID : null,
  };
}

async function ensureEnrollmentFinanceObligations(store, input, principal, auditMeta) {
  try {
    return await store.withTransaction(async (tx) => {
      let school = input.school;
      if (!school && input.schoolCode && typeof tx.getSchoolByCode === "function") {
        school = await tx.getSchoolByCode(input.schoolCode);
      }
      let students = input.students;
      if (!students && input.student) students = [input.student];
      if (!students && input.studentKey && typeof tx.findStudent === "function") {
        const student = await tx.findStudent(input.studentKey, principal);
        students = student ? [student] : [];
      }
      return ensureEnrollmentFinanceObligationsInTx(
        tx,
        { ...input, school, students },
        principal,
        auditMeta,
      );
    });
  } catch (error) {
    await persistObligationSyncFailure(store, input, principal, auditMeta, error);
    throw error;
  }
}

module.exports = {
  OBLIGATION_LIFECYCLE_REASON,
  OBLIGATION_CANCEL_REASON,
  NO_APPLICABLE_GRID,
  FINANCE_OBLIGATION_SYNC_FAILED: FINANCE_ERROR.OBLIGATION_SYNC_FAILED,
  snapshotCurrency,
  expandFeeItemPeriods,
  pickEnrollment,
  gridMatchesEnrollment,
  resolveClassTransferEffectiveDate,
  isUnswallowableFinanceSyncError,
  persistObligationSyncFailure,
  ensureEnrollmentFinanceObligations,
  ensureEnrollmentFinanceObligationsInTx,
};
