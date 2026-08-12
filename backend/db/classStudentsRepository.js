"use strict";

const { createHttpError, asTrimmedString, requireClassCodeParam } = require("../lib/classesManagement");
const {
  validateEnrollStudentInput,
  assertClassEligibleForEnrollment,
} = require("../lib/classStudentsManagement");
const {
  allocateStudentCodeLocked,
  isStudentCodeUniquenessViolation,
  studentCodeAllocationFailed,
} = require("../lib/studentCodeAllocation");

/**
 * Repository PostgreSQL — élèves inscrits dans une classe.
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 *   getSchoolByCode: (code: string) => Promise<any>,
 *   withTransaction?: <T>(fn: () => Promise<T>) => Promise<T>,
 * }} db
 */
function createClassStudentsRepository(db) {
  async function requireSchool(schoolCode) {
    const code = asTrimmedString(schoolCode).toUpperCase();
    if (!code || code === "*") {
      throw createHttpError(400, "schoolCode établissement requis.");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) {
      throw createHttpError(404, "Établissement introuvable.");
    }
    return school;
  }

  /**
   * Lookup classe scopée établissement — 404 sans fuite inter-établissements.
   * @param {string} classCodeParam
   * @param {string} schoolCode
   */
  async function getClassForEnrollment(classCodeParam, schoolCode) {
    const classCode = requireClassCodeParam(classCodeParam);
    const school = await requireSchool(schoolCode);
    const row = await db.one(
      `SELECT cl.id,
              cl.class_code,
              cl.name,
              cl.level,
              cl.section,
              cl.status,
              cl.academic_year_id,
              s.school_code,
              ay.name AS academic_year_name,
              ay.status AS academic_year_status
       FROM classes cl
       JOIN schools s ON s.id = cl.school_id
       JOIN academic_years ay ON ay.id = cl.academic_year_id
       WHERE cl.class_code = $1 AND cl.school_id = $2
       LIMIT 1`,
      [classCode, school.id],
    );
    if (!row) {
      throw createHttpError(404, "Classe introuvable.");
    }
    return row;
  }

  /**
   * @param {any} row
   */
  function mapStudentRow(row) {
    const studentCode = row.student_code;
    return {
      id: studentCode,
      publicId: studentCode,
      studentCode,
      matricule: studentCode,
      firstName: row.first_name,
      lastName: row.last_name,
      name: `${row.first_name} ${row.last_name}`.trim(),
      gender: row.gender ?? "",
      birthDate: row.birth_date ? formatDate(row.birth_date) : "",
      className: row.class_name ?? "",
      classCode: row.class_code ?? "",
      schoolCode: row.school_code,
      parentPhone: row.parent_phone ?? "",
      parentEmail: row.parent_email ?? "",
      status: row.status ?? "active",
      enrollmentId: row.enrollment_id ?? null,
      enrollmentDate: row.enrollment_date ? formatDate(row.enrollment_date) : "",
      academicYearName: row.academic_year_name ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * @param {string | Date} value
   */
  function formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${day}-${month}-${year}`;
  }

  /**
   * @param {string | null | undefined} value
   */
  function normalizeBirthDateForStorage(value) {
    if (!value) return null;
    return String(value).trim();
  }

  const MAX_ENROLL_ATTEMPTS = 5;

  async function insertStudentWithEnrollment(school, schoolCode, classRow, input) {
    const birthDate = normalizeBirthDateForStorage(input.birthDate);

    for (let attempt = 0; attempt < MAX_ENROLL_ATTEMPTS; attempt += 1) {
      const studentCode = await allocateStudentCodeLocked(db, school.id, school.school_code ?? schoolCode);
      try {
        const student = await db.one(
          `INSERT INTO students (
             school_id, student_code, first_name, last_name, gender,
             birth_date, birth_place, photo_url, parent_phone, parent_email, status
           ) VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, 'active')
           RETURNING id, student_code, first_name, last_name, gender, birth_date,
                     parent_phone, parent_email, status, created_at, updated_at`,
          [
            school.id,
            studentCode,
            input.firstName,
            input.lastName,
            input.gender,
            birthDate,
            input.parentPhone,
            input.parentEmail,
          ],
        );
        if (!student) {
          throw createHttpError(500, "Impossible de créer l'élève.");
        }

        const enrollment = await db.one(
          `INSERT INTO enrollments (
             school_id, student_id, class_id, academic_year_id, enrollment_date, status
           ) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active')
           RETURNING id, enrollment_date`,
          [school.id, student.id, classRow.id, classRow.academic_year_id],
        );
        if (!enrollment) {
          throw createHttpError(500, "Impossible de créer l'inscription.");
        }

        return mapStudentRow({
          ...student,
          school_code: school.school_code ?? schoolCode,
          class_code: classRow.class_code,
          class_name: classRow.name,
          academic_year_name: classRow.academic_year_name,
          enrollment_id: enrollment.id,
          enrollment_date: enrollment.enrollment_date,
        });
      } catch (error) {
        if (isStudentCodeUniquenessViolation(error) && attempt < MAX_ENROLL_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }

    studentCodeAllocationFailed(MAX_ENROLL_ATTEMPTS);
  }

  return {
    /**
     * @param {string} classCodeParam
     * @param {string} schoolCode
     */
    async listByClassCode(classCodeParam, schoolCode) {
      const classRow = await getClassForEnrollment(classCodeParam, schoolCode);
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `SELECT st.student_code,
                st.first_name,
                st.last_name,
                st.gender,
                st.birth_date,
                st.parent_phone,
                st.parent_email,
                st.status,
                st.created_at,
                st.updated_at,
                s.school_code,
                cl.class_code,
                cl.name AS class_name,
                ay.name AS academic_year_name,
                e.id AS enrollment_id,
                e.enrollment_date
         FROM enrollments e
         JOIN students st ON st.id = e.student_id
         JOIN schools s ON s.id = st.school_id
         JOIN classes cl ON cl.id = e.class_id
         JOIN academic_years ay ON ay.id = e.academic_year_id
         WHERE e.class_id = $1
           AND e.status = 'active'
           AND st.school_id = $2
         ORDER BY st.last_name ASC, st.first_name ASC, st.student_code ASC`,
        [classRow.id, school.id],
      );
      return rows.map(mapStudentRow);
    },

    /**
     * @param {string} studentCodeParam
     * @param {string} schoolCode
     */
    async getByStudentCode(studentCodeParam, schoolCode) {
      const studentCode = asTrimmedString(studentCodeParam);
      if (!studentCode) {
        throw createHttpError(400, "studentCode invalide.");
      }
      const school = await requireSchool(schoolCode);
      const row = await db.one(
        `SELECT st.student_code,
                st.first_name,
                st.last_name,
                st.gender,
                st.birth_date,
                st.parent_phone,
                st.parent_email,
                st.status,
                st.created_at,
                st.updated_at,
                s.school_code,
                cl.class_code,
                cl.name AS class_name,
                ay.name AS academic_year_name,
                e.id AS enrollment_id,
                e.enrollment_date
         FROM students st
         JOIN schools s ON s.id = st.school_id
         LEFT JOIN enrollments e ON e.student_id = st.id AND e.status = 'active'
         LEFT JOIN classes cl ON cl.id = e.class_id
         LEFT JOIN academic_years ay ON ay.id = e.academic_year_id
         WHERE st.student_code = $1 AND st.school_id = $2
         LIMIT 1`,
        [studentCode, school.id],
      );
      if (!row) {
        throw createHttpError(404, "Élève introuvable.");
      }
      return mapStudentRow(row);
    },

    /**
     * Crée élève + inscription dans une transaction unique.
     * @param {string} classCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     */
    async enroll(classCodeParam, schoolCode, body) {
      const input = validateEnrollStudentInput(body, schoolCode, classCodeParam);
      const classRow = await getClassForEnrollment(classCodeParam, schoolCode);
      assertClassEligibleForEnrollment(classRow);
      const school = await requireSchool(schoolCode);

      const runEnrollment = async () =>
        insertStudentWithEnrollment(school, schoolCode, classRow, input);

      if (typeof db.withTransaction === "function") {
        return db.withTransaction(runEnrollment);
      }
      return runEnrollment();
    },
  };
}

module.exports = { createClassStudentsRepository };
