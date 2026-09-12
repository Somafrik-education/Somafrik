"use strict";

const { mapClassRow, CLASS_SELECT, CLASS_GROUP_BY } = require("./classesRepository");
const { writeTransactionalAudit, resolveTransactionalScope } = require("../lib/teacherTransactionalAudit");
const {
  HEAD_TEACHER_ERROR,
  CLASS_HEAD_TEACHERS_SCHEMA_SQL,
  ACTIVE_TEACHER_STATUS_SQL,
  formatHeadTeacherDisplayName,
  formatAlreadyHeadTeacherHint,
  validateAssignHeadTeacherInput,
  assertClassAcceptsHeadTeacherAssignment,
  assertTeacherEligibleForHeadTeacher,
  requireClassCodeParam,
  sqlTeacherPublicCodeEquals,
  createHttpError,
  asTrimmedString,
} = require("../lib/classHeadTeachersManagement");

/**
 * @param {{
 *   one: Function,
 *   all: Function,
 *   query: Function,
 *   getSchoolByCode: Function,
 *   withTransaction?: Function,
 *   createTxScope?: Function,
 *   recordAudit?: Function,
 *   getClassesRepository?: Function,
 * }} db
 */
function createClassHeadTeachersRepository(db) {
  async function requireSchool(schoolCode, executor = db) {
    const code = asTrimmedString(schoolCode);
    if (!code || code === "*") {
      throw createHttpError(400, "schoolCode établissement requis.");
    }
    const school = await executor.getSchoolByCode(code);
    if (!school) {
      throw createHttpError(404, "Établissement introuvable.");
    }
    return school;
  }

  function auditScope(tx) {
    return resolveTransactionalScope(
      db,
      tx,
      createHttpError(500, "Audit professeur principal indisponible dans la transaction."),
    );
  }

  async function loadClassByCode(executor, schoolId, classCode) {
    return executor.one(
      `SELECT cl.id,
              cl.class_code,
              cl.name,
              cl.status,
              cl.school_id,
              cl.academic_year_id
       FROM classes cl
       WHERE cl.class_code = $1 AND cl.school_id = $2
       LIMIT 1`,
      [classCode, schoolId],
    );
  }

  async function loadMappedClass(executor, schoolId, classCode) {
    const row = await executor.one(
      `${CLASS_SELECT}
       WHERE cl.class_code = $1 AND cl.school_id = $2
       GROUP BY ${CLASS_GROUP_BY}
       LIMIT 1`,
      [classCode, schoolId],
    );
    if (!row) {
      throw createHttpError(404, "Classe introuvable.");
    }
    return mapClassRow(row);
  }

  async function findTeacherByPublicCode(executor, teacherCode) {
    return executor.one(
      `SELECT t.id,
              t.school_id,
              t.teacher_code,
              t.status,
              u.status AS user_status,
              u.first_name,
              u.last_name
       FROM teachers t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE ${sqlTeacherPublicCodeEquals("t", "$1")}
          OR t.id::text = $1
       LIMIT 1`,
      [teacherCode],
    );
  }

  function mapCandidate(row) {
    const firstName = row.first_name ?? "";
    const lastName = row.last_name ?? "";
    const otherClassNames = Array.isArray(row.other_class_names)
      ? row.other_class_names.filter(Boolean)
      : [];
    return {
      teacherCode: row.teacher_code,
      firstName,
      lastName,
      displayName: formatHeadTeacherDisplayName(firstName, lastName) || row.teacher_code,
      assignedToCurrentClass: Boolean(row.assigned_to_current_class),
      otherClassNames,
      alreadyHeadTeacherHint: formatAlreadyHeadTeacherHint(otherClassNames),
    };
  }

  return {
    /**
     * @param {string} classCodeParam
     * @param {string} schoolCode
     * @param {{ q?: string }} [options]
     */
    async listCandidates(classCodeParam, schoolCode, options = {}) {
      const classCode = requireClassCodeParam(classCodeParam);
      const school = await requireSchool(schoolCode);
      const schoolClass = await loadClassByCode(db, school.id, classCode);
      if (!schoolClass) {
        throw createHttpError(404, "Classe introuvable.");
      }

      const q = asTrimmedString(options.q);
      const params = [school.id, schoolClass.id];
      let searchSql = "";
      if (q) {
        params.push(`%${q.replace(/[%_]/g, "\\$&")}%`);
        const idx = params.length;
        searchSql = ` AND (
          COALESCE(u.first_name, '') ILIKE $${idx} ESCAPE '\\'
          OR COALESCE(u.last_name, '') ILIKE $${idx} ESCAPE '\\'
          OR t.teacher_code ILIKE $${idx} ESCAPE '\\'
        )`;
      }

      const rows = await db.all(
        `SELECT t.teacher_code,
                t.status,
                u.first_name,
                u.last_name,
                BOOL_OR(cht.class_id = $2) AS assigned_to_current_class,
                COALESCE(
                  ARRAY_AGG(DISTINCT cl.name)
                    FILTER (WHERE cht.status = 'active' AND cht.class_id IS DISTINCT FROM $2 AND cl.name IS NOT NULL),
                  ARRAY[]::text[]
                ) AS other_class_names
         FROM teachers t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN class_head_teachers cht
           ON cht.teacher_id = t.id AND cht.status = 'active' AND cht.school_id = t.school_id
         LEFT JOIN classes cl ON cl.id = cht.class_id AND cl.school_id = t.school_id
         WHERE t.school_id = $1
           AND ${ACTIVE_TEACHER_STATUS_SQL}
           ${searchSql}
         GROUP BY t.id, t.teacher_code, t.status, u.first_name, u.last_name
         ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, t.teacher_code ASC`,
        params,
      );
      return rows.map(mapCandidate);
    },

    /**
     * @param {string} classCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     * @param {object} [principal]
     * @param {object} [auditMeta]
     */
    async assign(classCodeParam, schoolCode, body, principal = null, auditMeta = null) {
      const classCode = requireClassCodeParam(classCodeParam);
      const input = validateAssignHeadTeacherInput(body);
      const school = await requireSchool(schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);

      const run = async (executor, tx = executor) => {
        const schoolClass = await loadClassByCode(executor, school.id, classCode);
        assertClassAcceptsHeadTeacherAssignment(schoolClass);
        const teacher = await findTeacherByPublicCode(executor, input.teacherCode);
        assertTeacherEligibleForHeadTeacher(teacher, school.id);

        const previous = await executor.one(
          `SELECT id, teacher_id FROM class_head_teachers
           WHERE class_id = $1 AND status = 'active'
           LIMIT 1`,
          [schoolClass.id],
        );

        if (previous && String(previous.teacher_id) === String(teacher.id)) {
          return loadMappedClass(executor, school.id, classCode);
        }

        if (previous) {
          await executor.one(
            `UPDATE class_head_teachers
             SET status = 'inactive', ended_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [previous.id],
          );
        }

        await executor.one(
          `INSERT INTO class_head_teachers (
             school_id, class_id, teacher_id, academic_year_id, status
           ) VALUES ($1, $2, $3, $4, 'active')
           RETURNING id`,
          [school.id, schoolClass.id, teacher.id, schoolClass.academic_year_id],
        );

        const mapped = await loadMappedClass(executor, school.id, classCode);
        if (wantsAudit) {
          await writeTransactionalAudit(auditScope(tx), tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: previous ? "replace_class_head_teacher" : "assign_class_head_teacher",
            entityType: "class_head_teacher",
            entityId: classCode,
            oldValue: previous ? { teacherId: previous.teacher_id } : null,
            newValue: { teacherCode: teacher.teacher_code, teacherId: teacher.id },
            schoolCode: school.school_code ?? schoolCode,
          });
        }
        return mapped;
      };

      if (typeof db.withTransaction === "function") {
        return db.withTransaction(async (tx) => {
          const executor = {
            one: (sql, params) => tx.one(sql, params),
            all: (sql, params) => tx.all(sql, params),
            query: (sql, params) => tx.query(sql, params),
            getSchoolByCode: (code) => db.getSchoolByCode(code),
          };
          return run(executor, tx);
        });
      }
      return run(db);
    },

    /**
     * @param {string} classCodeParam
     * @param {string} schoolCode
     * @param {object} [principal]
     * @param {object} [auditMeta]
     */
    async remove(classCodeParam, schoolCode, principal = null, auditMeta = null) {
      const classCode = requireClassCodeParam(classCodeParam);
      const school = await requireSchool(schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);

      const run = async (executor, tx = executor) => {
        const schoolClass = await loadClassByCode(executor, school.id, classCode);
        if (!schoolClass) {
          throw createHttpError(404, "Classe introuvable.");
        }
        const previous = await executor.one(
          `SELECT id, teacher_id FROM class_head_teachers
           WHERE class_id = $1 AND status = 'active'
           LIMIT 1`,
          [schoolClass.id],
        );
        if (previous) {
          await executor.one(
            `UPDATE class_head_teachers
             SET status = 'inactive', ended_at = NOW(), updated_at = NOW()
             WHERE id = $1
             RETURNING id`,
            [previous.id],
          );
        }
        const mapped = await loadMappedClass(executor, school.id, classCode);
        if (wantsAudit && previous) {
          await writeTransactionalAudit(auditScope(tx), tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "remove_class_head_teacher",
            entityType: "class_head_teacher",
            entityId: classCode,
            oldValue: { teacherId: previous.teacher_id },
            newValue: null,
            schoolCode: school.school_code ?? schoolCode,
          });
        }
        return mapped;
      };

      if (typeof db.withTransaction === "function") {
        return db.withTransaction(async (tx) => {
          const executor = {
            one: (sql, params) => tx.one(sql, params),
            all: (sql, params) => tx.all(sql, params),
            query: (sql, params) => tx.query(sql, params),
            getSchoolByCode: (code) => db.getSchoolByCode(code),
          };
          return run(executor, tx);
        });
      }
      return run(db);
    },
  };
}

module.exports = {
  createClassHeadTeachersRepository,
  CLASS_HEAD_TEACHERS_SCHEMA_SQL,
  HEAD_TEACHER_ERROR,
};
