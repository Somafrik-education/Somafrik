"use strict";

/**
 * LOT 0 GREEN — GET /api/v2/school-setup/status
 * Tenant établissement : principal.sub → users.school_id → schools (jamais JWT leftover).
 * READY dérivé PostgreSQL : année courante/open + niveau actif + groupe actif + classe.
 * Les périodes sont hors gate READY.
 */

const { BusinessError } = require("../services/authService");
const { attachUsersMembershipScope } = require("./usersSchoolScope");

const CORE_TOTAL = 3;

function failClosed(statusCode, message) {
  throw new BusinessError(statusCode, message || "Accès refusé: établissement hors périmètre.");
}

function asCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function membershipSchoolId(principal) {
  for (const value of [
    principal?.usersSchoolId,
    principal?.effectiveSchoolId,
    principal?.academicYearSchoolId,
  ]) {
    const id = String(value ?? "").trim();
    if (id && id !== "*") return id;
  }
  return "";
}

function membershipLoginCode(principal) {
  for (const value of [
    principal?.usersLoginCode,
    principal?.effectiveSchoolCode,
    principal?.academicYearLoginCode,
  ]) {
    const code = String(value ?? "").trim();
    if (code && code !== "*") return code;
  }
  return "";
}

function deriveSchoolSetupStatus(raw = {}) {
  const academicYear = Boolean(raw.hasCurrentOrOpenAcademicYear);
  const structure = asCount(raw.activatedLevelCount) >= 1 && asCount(raw.activatedGroupCount) >= 1;
  const classes = asCount(raw.classCount) >= 1;
  const coreDone = [academicYear, structure, classes].filter(Boolean).length;
  let status = "NOT_STARTED";
  if (academicYear && structure && classes) status = "READY";
  else if (coreDone > 0) status = "IN_PROGRESS";

  return {
    status,
    core: { academicYear, structure, classes },
    optional: {
      periods: asCount(raw.termCount) >= 1,
      subjects: asCount(raw.subjectCount) >= 1,
      teachers: asCount(raw.teacherCount) >= 1,
      students: asCount(raw.studentCount) >= 1,
      feeGrids: asCount(raw.feeGridCount) >= 1,
      notifications: Boolean(raw.notificationsConfigured),
    },
    progress: { coreDone, coreTotal: CORE_TOTAL },
  };
}

async function resolveSchoolSetupTenant({ principal, one } = {}) {
  if (!principal) {
    failClosed(401, "Authentification requise.");
  }

  let scoped = principal;
  if (typeof one === "function") {
    scoped = await attachUsersMembershipScope(principal, one);
  }

  const schoolId = membershipSchoolId(scoped);
  if (!schoolId) {
    const statusCode = String(principal.sub ?? "").trim() ? 403 : 401;
    failClosed(statusCode, "Accès refusé: établissement hors périmètre.");
  }

  return {
    schoolId,
    loginCode: membershipLoginCode(scoped),
  };
}

async function countOrZero(one, sql, params) {
  if (typeof one !== "function") return 0;
  try {
    const row = await one(sql, params);
    return asCount(row?.c ?? row?.count ?? 0);
  } catch {
    return 0;
  }
}

async function loadSchoolSetupSnapshot(one, schoolId) {
  const id = String(schoolId ?? "").trim();
  if (!id || typeof one !== "function") {
    return {};
  }
  const params = [id];
  const [
    yearCount,
    activatedLevelCount,
    activatedGroupCount,
    classCount,
    termCount,
    subjectCount,
    teacherCount,
    studentCount,
    feeGridCount,
    notificationCount,
  ] = await Promise.all([
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c
       FROM academic_years
       WHERE school_id::text = $1
         AND (is_current = TRUE OR lower(btrim(COALESCE(status, ''))) IN ('open', 'active'))`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c
       FROM school_levels
       WHERE school_id::text = $1 AND status = 'active'`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c
       FROM school_class_groups
       WHERE school_id::text = $1 AND status = 'active'`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM classes WHERE school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c
       FROM terms t
       INNER JOIN academic_years y ON y.id = t.academic_year_id
       WHERE y.school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM subjects WHERE school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM teachers WHERE school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM students WHERE school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM fee_grids WHERE school_id::text = $1`,
      params,
    ),
    countOrZero(
      one,
      `SELECT COUNT(*)::int AS c FROM school_notification_settings WHERE school_id::text = $1`,
      params,
    ),
  ]);

  return {
    hasCurrentOrOpenAcademicYear: yearCount >= 1,
    activatedLevelCount,
    activatedGroupCount,
    classCount,
    termCount,
    subjectCount,
    teacherCount,
    studentCount,
    feeGridCount,
    notificationsConfigured: notificationCount >= 1,
  };
}

async function getSchoolSetupStatus(input = {}) {
  const tenant = await resolveSchoolSetupTenant(input);
  const snapshot =
    typeof input.loadSnapshot === "function"
      ? await input.loadSnapshot(tenant)
      : await loadSchoolSetupSnapshot(input.one, tenant.schoolId);
  return deriveSchoolSetupStatus(snapshot || {});
}

module.exports = {
  CORE_TOTAL,
  deriveSchoolSetupStatus,
  resolveSchoolSetupTenant,
  loadSchoolSetupSnapshot,
  getSchoolSetupStatus,
};
