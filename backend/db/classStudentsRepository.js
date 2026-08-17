"use strict";

const { createHttpError, asTrimmedString, requireClassCodeParam } = require("../lib/classesManagement");
const {
  validateEnrollStudentInput,
  validateUpdateStudentInput,
  assertClassEligibleForEnrollment,
} = require("../lib/classStudentsManagement");
const { allocateStudentCodeLocked } = require("../lib/studentCodeAllocation");
const { hashSecret } = require("../services/credentialService");

const STUDENT_SELECT_COLUMNS = `
  st.id AS student_uuid,
  st.student_code,
  st.first_name,
  st.last_name,
  st.gender,
  st.birth_date,
  st.birth_place,
  st.photo_url,
  st.parent_phone,
  st.parent_email,
  st.status,
  st.created_at,
  st.updated_at,
  s.school_code
`;

/**
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 * }} db
 */
function createClassStudentsDb(db) {
  return {
    one: (sql, params) => db.one(sql, params),
    all: (sql, params) => db.all(sql, params),
    query: (sql, params) => db.query(sql, params),
  };
}

/**
 * Repository PostgreSQL — élèves inscrits dans une classe.
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 *   getSchoolByCode: (code: string) => Promise<any>,
 *   withTransaction?: <T>(fn: (tx: object) => Promise<T>) => Promise<T>,
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
   * Relit et verrouille la classe + année scolaire dans la transaction courante.
   * @param {ReturnType<typeof createClassStudentsDb>} tx
   * @param {string} classCodeParam
   * @param {string} schoolId
   */
  async function getClassForEnrollmentLocked(tx, classCodeParam, schoolId) {
    const classCode = requireClassCodeParam(classCodeParam);
    const row = await tx.one(
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
       FOR UPDATE OF cl, ay
       LIMIT 1`,
      [classCode, schoolId],
    );
    if (!row) {
      throw createHttpError(404, "Classe introuvable.");
    }
    return row;
  }

  /**
   * Lookup hors transaction (lecture seule).
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
    const studentCode = row.login_code || row.identity_code || row.student_code;
    return {
      id: studentCode,
      publicId: studentCode,
      studentCode,
      matricule: studentCode,
      loginCode: studentCode,
      identityCode: studentCode,
      identifier: studentCode,
      firstName: row.first_name,
      lastName: row.last_name,
      name: `${row.first_name} ${row.last_name}`.trim(),
      gender: row.gender ?? "",
      birthDate: row.birth_date ? formatDate(row.birth_date) : "",
      birthPlace: row.birth_place ?? "",
      photoUrl: row.photo_url ?? "",
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
   * @param {any} row
   */
  function mapEnrollmentRow(row) {
    return {
      id: row.enrollment_id,
      status: row.enrollment_status ?? "active",
      enrollmentDate: row.enrollment_date ? formatDate(row.enrollment_date) : "",
      classCode: row.class_code ?? "",
      className: row.class_name ?? "",
      academicYearName: row.academic_year_name ?? "",
      academicYearStatus: row.academic_year_status ?? "",
      createdAt: row.enrollment_created_at ?? null,
      updatedAt: row.enrollment_updated_at ?? null,
    };
  }

  /**
   * @param {any} row
   */
  function mapDocumentRow(row) {
    return {
      id: row.document_code,
      documentCode: row.document_code,
      documentType: row.document_type ?? "",
      title: row.title ?? "",
      format: row.format ?? "",
      version: row.version ?? "",
      status: row.status ?? "",
      fileUrl: row.storage_key ?? "",
      generatedAt: row.generated_at ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
    };
  }

  function emptyMedicalProfile() {
    return {
      allergies: [],
      conditions: [],
      medications: [],
      notes: "",
      emergencyContact: "",
      bloodType: "",
      source: "postgresql",
    };
  }

  /**
   * @param {string} studentCode
   */
  function accessLinks(studentCode) {
    const encoded = encodeURIComponent(studentCode);
    return {
      notesPath: `/api/students/${encoded}/notes`,
      presencesPath: `/api/students/${encoded}/presences`,
      paymentsPath: `/api/students/${encoded}/payments`,
      reportPath: `/api/students/${encoded}/report`,
    };
  }

  /**
   * @param {string} value
   */
  function normalizeTimestamp(value) {
    if (!value) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  /**
   * Absence explicite de la table (schéma partiel) uniquement — les autres erreurs remontent.
   * @param {unknown} error
   */
  function isMissingStudentDocumentsRelation(error) {
    const code = String(error?.code ?? "").trim();
    if (code === "42P01") {
      return true;
    }
    const message = String(error?.message ?? error ?? "").toLowerCase();
    return (
      message.includes("student_documents") &&
      (message.includes("does not exist") ||
        message.includes("n'existe pas") ||
        message.includes("undefined_table") ||
        message.includes("no such table"))
    );
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

  /**
   * Compte de connexion élève = matricule. Absent sur les schémas de test isolés (42P01).
   * @param {ReturnType<typeof createClassStudentsDb>} tx
   * @param {{ id: string }} school
   * @param {{ student_code: string }} student
   * @param {{ firstName: string, lastName: string, parentEmail?: string, parentPhone?: string }} input
   */
  async function ensureStudentLoginUser(tx, school, student, input) {
    try {
      await tx.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, 'STUDENT', 'active')
         ON CONFLICT (user_code) DO NOTHING`,
        [
          school.id,
          student.student_code,
          input.firstName,
          input.lastName,
          input.parentEmail ?? "",
          input.parentPhone ?? "",
          hashSecret("1234"),
        ],
      );
    } catch (error) {
      if (String(error.code) === "42P01") return;
      throw error;
    }
  }

  /**
   * @param {ReturnType<typeof createClassStudentsDb>} tx
   * @param {{ id: string, school_code?: string }} school
   * @param {string} schoolCode
   * @param {any} classRow
   * @param {object} input
   */
  async function insertStudentWithEnrollment(tx, school, schoolCode, classRow, input) {
    const birthDate = normalizeBirthDateForStorage(input.birthDate);
    const studentCode = await allocateStudentCodeLocked(tx, {
      id: school.id,
      school_code: school.school_code ?? schoolCode,
      login_code: school.login_code,
      short_code: school.short_code,
      name: school.name,
      country_code: school.country_code ?? school.iso_code,
    });

    const student = await tx.one(
      `INSERT INTO students (
         school_id, student_code, first_name, last_name, gender,
         birth_date, birth_place, photo_url, parent_phone, parent_email, status
       ) VALUES ($1, $2, $3, $4, $5, $6, '', '', $7, $8, 'active')
       RETURNING id, student_code, first_name, last_name, gender, birth_date,
                 birth_place, photo_url, parent_phone, parent_email, status, created_at, updated_at`,
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

    await ensureStudentLoginUser(tx, school, student, input);

    const enrollment = await tx.one(
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
  }

  /**
   * @param {ReturnType<typeof createClassStudentsDb>} tx
   * @param {string} classCodeParam
   * @param {string} schoolCode
   * @param {{ id: string, school_code?: string }} school
   * @param {object} input
   */
  async function runEnrollmentTransaction(tx, classCodeParam, schoolCode, school, input) {
    const classRow = await getClassForEnrollmentLocked(tx, classCodeParam, school.id);
    assertClassEligibleForEnrollment(classRow);
    return insertStudentWithEnrollment(tx, school, schoolCode, classRow, input);
  }

  return {
    /**
     * Annuaire établissement — lecture PostgreSQL.
     * @param {string} schoolCode
     */
    async listBySchoolCode(schoolCode) {
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `SELECT ${STUDENT_SELECT_COLUMNS},
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
         WHERE st.school_id = $1
         ORDER BY st.last_name ASC, st.first_name ASC, st.student_code ASC`,
        [school.id],
      );
      return rows.map(mapStudentRow);
    },

    /**
     * @param {string} classCodeParam
     * @param {string} schoolCode
     */
    async listByClassCode(classCodeParam, schoolCode) {
      const classRow = await getClassForEnrollment(classCodeParam, schoolCode);
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `SELECT ${STUDENT_SELECT_COLUMNS},
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
     * Fiche canonique par studentCode — isolée par établissement.
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
        `SELECT ${STUDENT_SELECT_COLUMNS},
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

      const enrollments = await db.all(
        `SELECT e.id AS enrollment_id,
                e.status AS enrollment_status,
                e.enrollment_date,
                e.created_at AS enrollment_created_at,
                e.updated_at AS enrollment_updated_at,
                cl.class_code,
                cl.name AS class_name,
                ay.name AS academic_year_name,
                ay.status AS academic_year_status
         FROM enrollments e
         JOIN classes cl ON cl.id = e.class_id
         JOIN academic_years ay ON ay.id = e.academic_year_id
         WHERE e.student_id = $1 AND e.school_id = $2
         ORDER BY e.enrollment_date DESC NULLS LAST, e.created_at DESC NULLS LAST`,
        [row.student_uuid, school.id],
      );

      let documents = [];
      try {
        documents = await db.all(
          `SELECT document_code, document_type, title, format, version, status,
                  storage_key, generated_at, created_at, updated_at
           FROM student_documents
           WHERE student_id = $1 AND school_id = $2
           ORDER BY generated_at DESC NULLS LAST, created_at DESC NULLS LAST`,
          [row.student_uuid, school.id],
        );
      } catch (error) {
        if (!isMissingStudentDocumentsRelation(error)) {
          throw error;
        }
        documents = [];
      }

      const base = mapStudentRow(row);
      return {
        ...base,
        enrollments: enrollments.map(mapEnrollmentRow),
        guardians: [],
        medical: emptyMedicalProfile(),
        documents: documents.map(mapDocumentRow),
        access: accessLinks(base.studentCode),
      };
    },

    /**
     * Modification contrôlée identité / admin — conflit via expectedUpdatedAt.
     * @param {string} studentCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     */
    async updateByStudentCode(studentCodeParam, schoolCode, body) {
      const studentCode = asTrimmedString(studentCodeParam);
      if (!studentCode) {
        throw createHttpError(400, "studentCode invalide.");
      }
      const patch = validateUpdateStudentInput(body);
      const school = await requireSchool(schoolCode);

      const current = await db.one(
        `SELECT st.id, st.student_code, st.first_name, st.last_name, st.gender,
                st.birth_date, st.birth_place, st.parent_phone, st.parent_email,
                st.updated_at
         FROM students st
         WHERE st.student_code = $1 AND st.school_id = $2
         LIMIT 1`,
        [studentCode, school.id],
      );
      if (!current) {
        throw createHttpError(404, "Élève introuvable.");
      }

      const currentUpdatedAt = normalizeTimestamp(current.updated_at);
      const expected = normalizeTimestamp(patch.expectedUpdatedAt);
      if (currentUpdatedAt !== expected) {
        throw createHttpError(
          409,
          "Conflit de modification : la fiche élève a été mise à jour par un autre utilisateur.",
        );
      }

      const nextFirstName = patch.firstName ?? current.first_name;
      const nextLastName = patch.lastName ?? current.last_name;
      const nextGender =
        patch.gender !== undefined ? patch.gender : current.gender;
      const nextBirthDate =
        patch.birthDate !== undefined ? patch.birthDate : current.birth_date;
      const nextBirthPlace =
        patch.birthPlace !== undefined ? patch.birthPlace ?? "" : current.birth_place ?? "";
      const nextParentPhone =
        patch.parentPhone !== undefined ? patch.parentPhone : current.parent_phone;
      const nextParentEmail =
        patch.parentEmail !== undefined ? patch.parentEmail : current.parent_email;

      const updated = await db.one(
        `UPDATE students
         SET first_name = $1,
             last_name = $2,
             gender = $3,
             birth_date = $4,
             birth_place = $5,
             parent_phone = $6,
             parent_email = $7,
             updated_at = NOW()
         WHERE id = $8
           AND school_id = $9
           AND updated_at = $10::timestamptz
         RETURNING id`,
        [
          nextFirstName,
          nextLastName,
          nextGender,
          nextBirthDate,
          nextBirthPlace,
          nextParentPhone,
          nextParentEmail,
          current.id,
          school.id,
          current.updated_at,
        ],
      );

      if (!updated) {
        throw createHttpError(
          409,
          "Conflit de modification : la fiche élève a été mise à jour par un autre utilisateur.",
        );
      }

      return this.getByStudentCode(studentCode, schoolCode);
    },

    /**
     * Crée élève + inscription dans une transaction unique.
     * @param {string} classCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     */
    async enroll(classCodeParam, schoolCode, body) {
      const input = validateEnrollStudentInput(body, schoolCode, classCodeParam);
      const school = await requireSchool(schoolCode);

      if (typeof db.withTransaction === "function") {
        return db.withTransaction(async (tx) =>
          runEnrollmentTransaction(createClassStudentsDb(tx), classCodeParam, schoolCode, school, input),
        );
      }

      const classRow = await getClassForEnrollment(classCodeParam, schoolCode);
      assertClassEligibleForEnrollment(classRow);
      return insertStudentWithEnrollment(
        createClassStudentsDb(db),
        school,
        schoolCode,
        classRow,
        input,
      );
    },
  };
}

module.exports = { createClassStudentsRepository, createClassStudentsDb };
