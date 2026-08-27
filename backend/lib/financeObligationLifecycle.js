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
  const raw = asTrimmed(school?.currency || "CDF").toUpperCase();
  if (!raw || raw === "FC") return PRESENTATION_CURRENCY_ALIASES.FC || "CDF";
  return PRESENTATION_CURRENCY_ALIASES[raw] || raw;
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

function gridMatchesEnrollment(grid, enrollment) {
  if (!grid || grid.status !== "Active") return false;
  const year = asTrimmed(grid.academicYear).toLowerCase();
  const expectedYear = asTrimmed(enrollment.academicYear).toLowerCase();
  if (year && expectedYear && year !== expectedYear) return false;
  if (grid.classId && enrollment.classId && sameId(grid.classId, enrollment.classId)) return true;
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
          academicYear: asTrimmed(row.academicYear) || academicYear || "",
          classEffectiveDate: row.classEffectiveDate || row.enrollmentDate || null,
        }))
    : [];
  if (fromStudent.length) return fromStudent;
  if (typeof tx.listActiveEnrollmentsForStudent !== "function") {
    if (!asTrimmed(student.classId) && !asTrimmed(classId)) return [];
    return [
      {
        enrollmentId: student.enrollmentId || null,
        schoolId: school.id,
        classId: classId || student.classId,
        classCode: student.classCode || "",
        className: student.className || "",
        academicYear: academicYear || "",
        classEffectiveDate: student.classEffectiveDate || student.enrollmentDate || null,
      },
    ];
  }
  const rows = await tx.listActiveEnrollmentsForStudent(student.dbId || student.id, school.id);
  return rows.map((row) => ({
    ...row,
    schoolId: row.schoolId || school.id,
    academicYear: row.academicYear || academicYear || "",
  }));
}

function pickEnrollment(enrollments, { classId, academicYear }) {
  const year = asTrimmed(academicYear).toLowerCase();
  let scoped = enrollments.filter((row) => asTrimmed(row.classId));
  if (year) {
    const byYear = scoped.filter((row) => asTrimmed(row.academicYear).toLowerCase() === year);
    if (byYear.length) scoped = byYear;
  }
  if (classId) {
    const byClass = scoped.filter((row) => sameId(row.classId, classId));
    if (byClass.length) scoped = byClass;
  }
  const uniqueClasses = new Set(scoped.map((row) => asTrimmed(row.classId)));
  if (uniqueClasses.size > 1) {
    throw createFinanceError(
      409,
      "Plusieurs inscriptions actives incompatibles pour cet élève et cette année.",
      "FINANCE_ENROLLMENT_AMBIGUOUS",
      { classIds: [...uniqueClasses] },
    );
  }
  return scoped[0] || null;
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
    const enrollment = pickEnrollment(enrollments, {
      classId: input.classId || student.classId,
      academicYear: input.academicYear || input.grid?.academicYear,
    });
    if (!enrollment || !asTrimmed(enrollment.classId)) {
      skipped += 1;
      continue;
    }
    enrollment.academicYear = enrollment.academicYear || input.academicYear || input.grid?.academicYear || "";
    enrollment.schoolCode = schoolCode;

    if (input.previousClass && (reason === OBLIGATION_LIFECYCLE_REASON.CLASS_TRANSFER || input.previousClass)) {
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
        effectiveDate: input.effectiveDate || enrollment.classEffectiveDate || enrollment.enrollmentDate,
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
    studentGrids = (studentGrids || []).filter((grid) => gridMatchesEnrollment(grid, enrollment) || input.grid);
    if (input.grid) {
      studentGrids = studentGrids.length ? studentGrids : [input.grid];
      for (const grid of studentGrids) {
        if (grid.schoolId && String(grid.schoolId) !== String(school.id)) {
          throw createFinanceError(403, "Grille hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
        }
        if (grid.schoolCode && asTrimmed(grid.schoolCode).toUpperCase() !== asTrimmed(schoolCode).toUpperCase()) {
          throw createFinanceError(403, "Grille hors établissement.", FINANCE_ERROR.TENANT_MISMATCH);
        }
      }
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
  return store.withTransaction(async (tx) => {
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
}

module.exports = {
  OBLIGATION_LIFECYCLE_REASON,
  OBLIGATION_CANCEL_REASON,
  NO_APPLICABLE_GRID,
  snapshotCurrency,
  expandFeeItemPeriods,
  ensureEnrollmentFinanceObligations,
  ensureEnrollmentFinanceObligationsInTx,
};
