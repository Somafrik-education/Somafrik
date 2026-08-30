"use strict";

/**
 * Lectures d'export établissement.
 *
 * PostgreSQL : toutes les lectures passent par le même exécuteur (client tx).
 * Isolation = REPEATABLE READ READ ONLY — voir DATA_EXPORT_SNAPSHOT_ISOLATION.
 * Aucune écriture ici (pas de ensureSettingsRow / seed).
 */

const { DATA_EXPORT_ERROR } = require("./dataExportManagement");
const { BusinessError } = require("../services/authService");
const { mapSettingsRow } = require("./schoolSettingsManagement");
const { canonicalSchoolLoginOrNull } = require("./schoolCodeV2");

function createExportError(status, message, code) {
  const error = new BusinessError(status, message);
  error.code = code;
  return error;
}

function canUsePgExportSnapshot(executor) {
  return typeof executor?.one === "function" && typeof executor?.all === "function";
}

async function maybeBarrier(options, name, executor) {
  if (typeof options?.onBarrier === "function") {
    await options.onBarrier(name, executor);
  }
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0"),
  ].join("-");
}

function mapStudent(row) {
  const studentCode = row.student_code;
  return {
    id: row.id,
    publicId: studentCode,
    studentCode,
    matricule: studentCode,
    loginCode: studentCode,
    identityCode: studentCode,
    identifier: studentCode,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(),
    className: row.class_name ?? "",
    classCode: row.class_code ?? "",
    classId: row.class_id ?? row.classId ?? null,
    schoolCode: row.school_login_code ?? row.login_code ?? row.school_code ?? "",
    status: row.status ?? "active",
    academicYearName: row.academic_year_name ?? "",
  };
}

function mapClass(row) {
  const classCode = row.class_code;
  const classId = row.id ?? row.class_id ?? null;
  return {
    id: classId,
    classId,
    publicId: classCode,
    classCode,
    name: row.name,
    className: row.name,
    status: row.status,
    schoolCode: row.school_code,
    academicYearName: row.academic_year_name,
    students: Number(row.enrollment_count ?? 0),
  };
}

function mapTeacher(row) {
  const teacherCode = String(row.user_code ?? "").trim();
  const firstName = row.first_name ?? "";
  const lastName = row.last_name ?? "";
  return {
    id: row.id,
    userId: row.user_id ?? null,
    teacherCode,
    publicId: teacherCode,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || teacherCode,
    email: row.email ?? "",
    phone: row.phone ?? "",
    speciality: row.speciality ?? "",
    schoolCode: row.login_code ?? "",
    status: row.status ?? "active",
  };
}

async function requireSchoolInSnapshot(executor, schoolCode) {
  const code = canonicalSchoolLoginOrNull(schoolCode);
  if (!code) {
    throw createExportError(404, "Établissement introuvable.", DATA_EXPORT_ERROR.SCHOOL_NOT_FOUND);
  }
  const school = await executor.one(
    `SELECT id, login_code, school_code, status
     FROM schools
     WHERE upper(login_code) = $1`,
    [code],
  );
  if (!school) {
    throw createExportError(404, "Établissement introuvable.", DATA_EXPORT_ERROR.SCHOOL_NOT_FOUND);
  }
  return school;
}

async function loadSchoolSettingsDomain(executor, school) {
  const settingsRow = await executor.one(`SELECT * FROM school_settings WHERE school_id = $1`, [school.id]);
  const year = await executor.one(
    `SELECT *
     FROM academic_years
     WHERE school_id = $1 AND status IN ('active', 'open')
     ORDER BY is_current DESC, created_at DESC
     LIMIT 1`,
    [school.id],
  );
  const termRows = year
    ? await executor.all(
        `SELECT name, start_date, end_date
         FROM terms
         WHERE academic_year_id = $1
         ORDER BY start_date NULLS LAST, created_at, name`,
        [year.id],
      )
    : [];
  const periods = termRows.map((row) => ({
    name: row.name,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
  }));
  const mapped = settingsRow
    ? mapSettingsRow(settingsRow, school.login_code)
    : { schoolCode: school.login_code };
  return {
    ...mapped,
    periods,
    schoolYear: year?.name ?? "",
  };
}

async function loadStudentsDomain(executor, school) {
  const rows = await executor.all(
    `SELECT st.student_code,
            st.first_name,
            st.last_name,
            st.status,
            s.login_code AS school_code,
            cl.id AS class_id,
            cl.class_code,
            cl.name AS class_name,
            ay.name AS academic_year_name
     FROM students st
     JOIN schools s ON s.id = st.school_id
     LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
     LEFT JOIN classes cl ON cl.id = e.class_id
     LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
     WHERE st.school_id = $1
     ORDER BY st.last_name ASC, st.first_name ASC, st.student_code ASC`,
    [school.id],
  );
  return rows.map(mapStudent);
}

async function loadClassesDomain(executor, school) {
  const rows = await executor.all(
    `SELECT cl.id,
            cl.class_code,
            cl.name,
            cl.status,
            s.login_code AS school_code,
            ay.name AS academic_year_name,
            COUNT(e.id) FILTER (WHERE e.status = 'active')::int AS enrollment_count
     FROM classes cl
     JOIN schools s ON s.id = cl.school_id
     JOIN academic_years ay ON ay.id = cl.academic_year_id
     LEFT JOIN enrollments e ON e.class_id = cl.id
     WHERE cl.school_id = $1
     GROUP BY cl.id, s.login_code, ay.name
     ORDER BY cl.name ASC, cl.class_code ASC`,
    [school.id],
  );
  return rows.map(mapClass);
}

async function loadTeachersDomain(executor, school) {
  const rows = await executor.all(
    `SELECT t.teacher_code,
            t.speciality,
            t.status,
            s.login_code,
            u.user_code,
            u.first_name,
            u.last_name,
            u.email,
            u.phone
     FROM teachers t
     JOIN schools s ON s.id = t.school_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.school_id = $1
       AND COALESCE(t.status, 'active') NOT IN ('deleted', 'archived')
       AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')
     ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, t.teacher_code ASC`,
    [school.id],
  );
  return rows.map(mapTeacher);
}

async function loadAuditDomain(executor, schoolCode) {
  const rows = await executor.all(
    `SELECT a.action,
            a.entity_type,
            a.created_at,
            u.user_code
     FROM audit_logs a
     LEFT JOIN schools s ON s.id = a.school_id
     LEFT JOIN users u ON u.id = a.user_id
     WHERE upper(s.login_code) = $1
     ORDER BY a.created_at DESC
     LIMIT 200`,
    [schoolCode],
  );
  return rows.map((row) => ({
    action: row.action,
    entityType: row.entity_type,
    createdAt: row.created_at,
    userCode: row.user_code ?? null,
  }));
}

/**
 * Charge tous les domaines d'export depuis un unique snapshot PostgreSQL.
 * @param {{ one: Function, all: Function }} executor client tx (REPEATABLE READ)
 */
async function loadPgExportDomains(executor, { schoolCode, includeAudit = false, onBarrier } = {}) {
  const options = { onBarrier };
  const school = await requireSchoolInSnapshot(executor, schoolCode);
  await maybeBarrier(options, "school", executor);

  const domains = {};
  domains.schoolSettings = await loadSchoolSettingsDomain(executor, school);
  await maybeBarrier(options, "schoolSettings", executor);

  domains.students = await loadStudentsDomain(executor, school);
  await maybeBarrier(options, "students", executor);

  domains.classes = await loadClassesDomain(executor, school);
  await maybeBarrier(options, "classes", executor);

  domains.teachers = await loadTeachersDomain(executor, school);
  await maybeBarrier(options, "teachers", executor);

  if (includeAudit) {
    domains.audit = await loadAuditDomain(executor, school.login_code);
  }

  return { school, domains };
}

async function loadDelegatedExportDomains(repo, { schoolCode, includeAudit = false, principal, onBarrier } = {}) {
  const options = { onBarrier };
  const resolveSchool =
    typeof repo.getSchoolByCode === "function"
      ? (code) => repo.getSchoolByCode(code)
      : typeof repo.getPlatformSchoolByCode === "function"
        ? (code) => repo.getPlatformSchoolByCode(code)
        : null;
  if (resolveSchool) {
    const school = await resolveSchool(schoolCode);
    if (!school) {
      throw createExportError(404, "Établissement introuvable.", DATA_EXPORT_ERROR.SCHOOL_NOT_FOUND);
    }
  }
  await maybeBarrier(options, "school", repo);

  const domains = {};
  if (typeof repo.getSchoolSettings === "function") {
    domains.schoolSettings = await repo.getSchoolSettings(principal, schoolCode);
  }
  await maybeBarrier(options, "schoolSettings", repo);

  if (typeof repo.listSchoolStudents === "function") {
    domains.students = await repo.listSchoolStudents(schoolCode);
  }
  await maybeBarrier(options, "students", repo);

  if (typeof repo.listSchoolClasses === "function") {
    domains.classes = await repo.listSchoolClasses(schoolCode);
  }
  await maybeBarrier(options, "classes", repo);

  if (typeof repo.listSchoolTeachers === "function") {
    domains.teachers = await repo.listSchoolTeachers(schoolCode);
  }
  await maybeBarrier(options, "teachers", repo);

  if (includeAudit && typeof repo.getAuditLogs === "function") {
    const rows = await repo.getAuditLogs({ schoolCode, limit: 200 });
    domains.audit = (rows ?? []).map((row) => ({
      action: row.action,
      entityType: row.entityType ?? row.entity_type,
      createdAt: row.createdAt ?? row.created_at,
      userCode: row.userCode ?? row.user_code ?? null,
    }));
  }

  return { domains };
}

async function loadExportDomains(executor, options = {}) {
  if (canUsePgExportSnapshot(executor)) {
    return loadPgExportDomains(executor, options);
  }
  return loadDelegatedExportDomains(executor, options);
}

module.exports = {
  canUsePgExportSnapshot,
  loadExportDomains,
  loadPgExportDomains,
  loadDelegatedExportDomains,
  requireSchoolInSnapshot,
};
