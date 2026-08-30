"use strict";

const { asTrimmedString } = require("../lib/classesManagement");
const {
  createTeacherHttpError,
  validateCreateTeacherInput,
  isExactTeacherCivilIdentity,
} = require("../lib/teachersManagement");
const {
  allocateTeacherCodesLocked,
  acquireTeacherSchoolCreationLock,
  isTeacherOrUserCodeUniquenessViolation,
  sqlTeacherPublicCodeEquals,
  teacherPublicCodesMatch,
} = require("../lib/teacherCodeAllocation");
const { isTeachersSchoolUserUniquenessViolation } = require("../lib/teachersUniqueness");
const { hashSecret } = require("../services/credentialService");
const { teacherAuditScope, writeTransactionalAudit } = require("../lib/teacherTransactionalAudit");

/**
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 * }} db
 */
function createTeachersDb(db) {
  return {
    one: (sql, params) => db.one(sql, params),
    all: (sql, params) => db.all(sql, params),
    query: (sql, params) => db.query(sql, params),
  };
}

/**
 * @param {string | Date | null | undefined} value
 * @returns {string}
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
 * @param {string | Date | null | undefined} value
 * @returns {string}
 */
function formatIsoDate(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * @param {any[]} assignmentRows
 * @param {string} teacherCode
 */
function mapActiveAssignments(assignmentRows, teacherCode) {
  const code = String(teacherCode ?? "");
  return (assignmentRows ?? [])
    .filter((row) => teacherPublicCodesMatch(row.teacher_code, code))
    .map((row) => ({
      id: row.id ?? null,
      classId: row.class_id ?? row.classId ?? null,
      className: row.class_name ?? "",
      classCode: row.class_code ?? "",
      course: row.subject_name ?? "",
      subjectCode: row.subject_code ?? "",
      status: row.status ?? "active",
    }))
    .filter((item) => item.classId || item.classCode || item.className || item.course);
}

/**
 * @param {any} row
 * @param {any[]} [assignmentRows]
 */
function mapTeacherRow(row, assignmentRows = []) {
  const teacherCode = row.teacher_code;
  const firstName = row.first_name ?? "";
  const lastName = row.last_name ?? "";
  const identifierMatch = String(teacherCode ?? "").match(/(ENS-\d+)$/i);
  const identifier = identifierMatch ? identifierMatch[1].toUpperCase() : "";
  const assignments = mapActiveAssignments(assignmentRows, teacherCode);
  return {
    id: teacherCode,
    teacherCode,
    publicId: teacherCode,
    identifier,
    userId: row.user_id ?? null,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim() || teacherCode,
    gender: row.gender ?? "",
    birthDate: row.birth_date ? formatDate(row.birth_date) : "",
    entryDate: row.hire_date ? formatDate(row.hire_date) : "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    speciality: row.speciality ?? "",
    mainSubject: row.speciality ?? "",
    schoolCode: row.school_code,
    status: row.status === "active" || row.status === "Actif" ? "Actif" : row.status ?? "Actif",
    mustChangePassword: Boolean(row.must_change_password),
    assignments,
    assignedClasses: [...new Set(assignments.map((item) => item.className).filter(Boolean))],
    assignedClassCodes: [...new Set(assignments.map((item) => item.classCode).filter(Boolean))],
    assignedClassIds: [...new Set(assignments.map((item) => item.classId).filter(Boolean))],
    courses: [...new Set(assignments.map((item) => item.course).filter(Boolean))],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Repository PostgreSQL — enseignants (compte + fiche canonique).
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 *   getSchoolByCode: (code: string) => Promise<any>,
 *   withTransaction?: <T>(fn: (tx: object) => Promise<T>) => Promise<T>,
 *   onTeacherCreated?: (teacher: object) => void | Promise<void>,
 * }} db
 */
function createTeachersRepository(db) {
  async function requireSchool(schoolCode) {
    const code = asTrimmedString(schoolCode).toUpperCase();
    if (!code || code === "*") {
      throw createTeacherHttpError(400, "schoolCode établissement requis.");
    }
    const school = await db.getSchoolByCode(code);
    if (!school) {
      throw createTeacherHttpError(404, "Établissement introuvable.");
    }
    return school;
  }

  /**
   * Affectations actives de l'établissement (ou d'un enseignant).
   * @param {{ all: Function }} reader
   * @param {string} schoolId
   * @param {string} [teacherCode]
   */
  async function loadActiveAssignments(reader, schoolId, teacherCode) {
    if (teacherCode) {
      return reader.all(
        `SELECT ta.id,
                t.teacher_code,
                cl.id AS class_id,
                cl.name AS class_name,
                cl.class_code,
                sub.name AS subject_name,
                sub.subject_code,
                ta.status
         FROM teacher_assignments ta
         JOIN teachers t ON t.id = ta.teacher_id
         JOIN classes cl ON cl.id = ta.class_id
         JOIN subjects sub ON sub.id = ta.subject_id
         WHERE t.school_id = $1
           AND ${sqlTeacherPublicCodeEquals("t", "$2")}
           AND ta.status = 'active'
         ORDER BY cl.name, sub.name`,
        [schoolId, teacherCode],
      );
    }
    return reader.all(
      `SELECT ta.id,
              t.teacher_code,
              cl.id AS class_id,
              cl.name AS class_name,
              cl.class_code,
              sub.name AS subject_name,
              sub.subject_code,
              ta.status
       FROM teacher_assignments ta
       JOIN teachers t ON t.id = ta.teacher_id
       JOIN classes cl ON cl.id = ta.class_id
       JOIN subjects sub ON sub.id = ta.subject_id
       WHERE t.school_id = $1
         AND ta.status = 'active'
       ORDER BY t.teacher_code, cl.name, sub.name`,
      [schoolId],
    );
  }

  /**
   * @param {ReturnType<typeof createTeachersDb>} tx
   * @param {string} schoolId
   * @param {{ firstName: string, lastName: string, birthDate: string, gender: string | null }} input
   */
  async function assertNoAmbiguousCanon(tx, schoolId, input) {
    const rows = await tx.all(
      `SELECT t.teacher_code,
              u.first_name,
              u.last_name,
              u.birth_date,
              u.gender
       FROM teachers t
       JOIN users u ON u.id = t.user_id
       WHERE t.school_id = $1
         AND COALESCE(t.status, 'active') NOT IN ('deleted', 'Deleted', 'archived')
         AND COALESCE(u.status, 'active') NOT IN ('deleted', 'Deleted', 'archived')`,
      [schoolId],
    );

    const matches = rows.filter((row) =>
      isExactTeacherCivilIdentity(input, {
        firstName: row.first_name,
        lastName: row.last_name,
        birthDate: formatIsoDate(row.birth_date),
        gender: row.gender,
      }),
    );

    if (matches.length >= 1) {
      throw createTeacherHttpError(
        409,
        "Plusieurs fiches enseignant correspondent à cette identité dans l'établissement, ou une fiche canonique existe déjà.",
        "TEACHER_CANON_AMBIGUOUS",
      );
    }
  }

  /**
   * @param {ReturnType<typeof createTeachersDb>} tx
   * @param {{ id: string, school_code?: string }} school
   * @param {string} schoolCode
   * @param {object} input
   */
  async function insertUserAndTeacher(tx, school, schoolCode, input) {
    // Verrou établissement AVANT le contrôle d'identité canonique (anti-course).
    await acquireTeacherSchoolCreationLock(tx, school.id);
    await assertNoAmbiguousCanon(tx, school.id, input);

    const codes = await allocateTeacherCodesLocked(tx, school.id, school, {
      alreadyLocked: true,
      firstName: input.firstName,
      lastName: input.lastName,
    });
    const secretHash = hashSecret(input.temporaryPassword);

    let user;
    try {
      user = await tx.one(
        `INSERT INTO users (
           school_id, user_code, first_name, last_name, email, phone,
           password_hash, pin_hash, must_change_password, role, status,
           birth_date, gender
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $7, TRUE, 'TEACHER', 'active',
           $8, $9
         )
         RETURNING id, user_code, first_name, last_name, email, phone,
                   must_change_password, birth_date, gender, status, created_at, updated_at`,
        [
          school.id,
          codes.userCode,
          input.firstName,
          input.lastName,
          input.email,
          input.phone,
          secretHash,
          input.birthDate,
          input.gender,
        ],
      );
    } catch (error) {
      if (isTeacherOrUserCodeUniquenessViolation(error)) {
        throw createTeacherHttpError(409, "Conflit d'identifiant de compte enseignant.", "TEACHER_USER_CODE_CONFLICT");
      }
      throw error;
    }
    if (!user) {
      throw createTeacherHttpError(500, "Impossible de créer le compte enseignant.");
    }

    let teacher;
    try {
      teacher = await tx.one(
        `INSERT INTO teachers (
           school_id, user_id, teacher_code, speciality, hire_date, status
         ) VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id, school_id, user_id, teacher_code, speciality, hire_date, status, created_at, updated_at`,
        [school.id, user.id, codes.teacherCode, input.speciality, input.entryDate],
      );
    } catch (error) {
      if (isTeacherOrUserCodeUniquenessViolation(error)) {
        throw createTeacherHttpError(409, "Conflit de code enseignant.", "TEACHER_CODE_CONFLICT");
      }
      if (isTeachersSchoolUserUniquenessViolation(error)) {
        throw createTeacherHttpError(
          409,
          "Une fiche enseignant est déjà liée à ce compte dans l'établissement.",
          "TEACHER_ACCOUNT_FICHE_UNIQUE",
        );
      }
      throw error;
    }
    if (!teacher) {
      throw createTeacherHttpError(500, "Impossible de créer la fiche enseignant.");
    }

    return mapTeacherRow({
      ...teacher,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      birth_date: user.birth_date,
      gender: user.gender,
      must_change_password: user.must_change_password,
      school_code: school.school_code ?? schoolCode,
    });
  }

  return {
    /**
     * @param {string} schoolCode
     */
    async listBySchoolCode(schoolCode) {
      const school = await requireSchool(schoolCode);
      const [rows, assignmentRows] = await Promise.all([
        db.all(
          `SELECT t.teacher_code,
                  t.user_id,
                  t.speciality,
                  t.hire_date,
                  t.status,
                  t.created_at,
                  t.updated_at,
                  s.school_code,
                  u.first_name,
                  u.last_name,
                  u.email,
                  u.phone,
                  u.birth_date,
                  u.gender,
                  u.must_change_password
           FROM teachers t
           JOIN schools s ON s.id = t.school_id
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.school_id = $1
             AND COALESCE(t.status, 'active') NOT IN ('deleted', 'archived')
             AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')
           ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, t.teacher_code ASC`,
          [school.id],
        ),
        loadActiveAssignments(db, school.id),
      ]);
      return rows.map((row) => mapTeacherRow(row, assignmentRows));
    },

    /**
     * @param {string} teacherCodeParam
     * @param {string} schoolCode
     */
    async getByTeacherCode(teacherCodeParam, schoolCode) {
      const teacherCode = asTrimmedString(teacherCodeParam);
      if (!teacherCode) {
        throw createTeacherHttpError(400, "teacherCode invalide.");
      }
      const school = await requireSchool(schoolCode);
      const row = await db.one(
        `SELECT t.teacher_code,
                t.user_id,
                t.speciality,
                t.hire_date,
                t.status,
                t.created_at,
                t.updated_at,
                s.school_code,
                u.first_name,
                u.last_name,
                u.email,
                u.phone,
                u.birth_date,
                u.gender,
                u.must_change_password
         FROM teachers t
         JOIN schools s ON s.id = t.school_id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE (${sqlTeacherPublicCodeEquals("t", "$1")} OR t.id::text = $1) AND t.school_id = $2
           AND COALESCE(t.status, 'active') NOT IN ('deleted', 'archived')
           AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')
         LIMIT 1`,
        [teacherCode, school.id],
      );
      if (!row) {
        throw createTeacherHttpError(404, "Enseignant introuvable.");
      }
      const assignmentRows = await loadActiveAssignments(db, school.id, teacherCode);
      return mapTeacherRow(row, assignmentRows);
    },

    /**
     * @param {object} body
     * @param {string} schoolCode
     */
    async create(body, schoolCode, principal = null, auditMeta = null) {
      const school = await requireSchool(schoolCode);
      const input = validateCreateTeacherInput(body, schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);

      const created =
        typeof db.withTransaction === "function"
          ? await db.withTransaction(async (tx) => {
              const writer = createTeachersDb(tx);
              const inserted = await insertUserAndTeacher(writer, school, schoolCode, input);
              if (wantsAudit) {
                const scope = teacherAuditScope(db, tx);
                await writeTransactionalAudit(scope, tx, {
                  principal: principal ?? {},
                  auditMeta: auditMeta ?? {},
                  action: "create_teacher",
                  entityType: "teacher",
                  entityId: inserted.teacherCode,
                  oldValue: null,
                  newValue: {
                    teacherCode: inserted.teacherCode,
                    identifier: inserted.identifier,
                    schoolCode: inserted.schoolCode,
                    userId: inserted.userId,
                  },
                  schoolCode: school.school_code ?? schoolCode,
                });
              }
              return inserted;
            })
          : await insertUserAndTeacher(createTeachersDb(db), school, schoolCode, input);

      if (typeof db.onTeacherCreated === "function") {
        await db.onTeacherCreated(created);
      }
      return created;
    },
  };
}

module.exports = {
  createTeachersRepository,
  createTeachersDb,
  mapTeacherRow,
  mapActiveAssignments,
  formatDate,
  formatIsoDate,
};
