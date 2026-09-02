"use strict";

const {
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  requireClassCodeParam,
  composeClassDisplayName,
  createHttpError,
  asTrimmedString,
  CLASS_WRITE_ERROR,
} = require("../lib/classesManagement");
const {
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
  isClassStructuralUniquenessViolation,
} = require("../lib/classesUniqueness");
const { writeTransactionalAudit, resolveTransactionalScope } = require("../lib/teacherTransactionalAudit");

/**
 * Dedicated PostgreSQL repository for establishment classes.
 * Does not read or write backoffice_state JSON.
 *
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 *   getSchoolByCode: (code: string) => Promise<any>,
 *   withTransaction?: (fn: (tx: any) => Promise<any>) => Promise<any>,
 *   createTxScope?: (tx: any) => any,
 *   recordAudit?: Function,
 * }} db
 */
function createClassesRepository(db) {
  /**
   * @param {any} row
   */
  function mapClassRow(row) {
    const classCode = row.class_code;
    const classId = row.id ?? row.class_id ?? null;
    const levelName = row.level_name ?? row.level ?? "";
    const trackName = row.stream_name ?? "";
    const groupCode = row.group_code ?? "";
    return {
      id: classId,
      classId,
      publicId: classCode,
      classCode,
      name: row.name,
      className: row.name,
      level: levelName,
      track: trackName,
      groupCode,
      section: groupCode || (row.section ?? ""),
      levelId: row.level_id ?? null,
      streamId: row.stream_id ?? null,
      groupId: row.group_id ?? null,
      status: row.status,
      schoolCode: row.school_code,
      academicYearId: row.academic_year_id,
      academicYearName: row.academic_year_name,
      schoolYear: row.academic_year_name,
      students: Number(row.enrollment_count ?? 0),
      teacher: "Non assigne",
      presenceRate: 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Projection L1 mobile-sync : identifiants + statut + updatedAt.
   * Tombstone = status terminal canonique `inactive` (pas de DELETE physique).
   * @param {any} row
   */
  function mapMobileSyncClassRow(row) {
    const status = row.status;
    const updatedAt =
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
    return {
      id: row.id,
      classCode: row.class_code,
      name: row.name,
      academicYearId: row.academic_year_id ?? null,
      levelId: row.level_id ?? null,
      streamId: row.stream_id ?? null,
      groupId: row.group_id ?? null,
      status,
      updatedAt,
      tombstone: status !== "active",
    };
  }

  function nameConflictError(name) {
    return createHttpError(
      409,
      `La classe « ${name} » existe déjà pour cette année scolaire dans l'établissement.`,
      CLASS_WRITE_ERROR.STRUCTURAL_DUPLICATE,
    );
  }

  function structuralConflictError() {
    return createHttpError(
      409,
      "Une classe existe déjà pour ce niveau, cette filière et ce groupe sur cette année scolaire.",
      CLASS_WRITE_ERROR.STRUCTURAL_DUPLICATE,
    );
  }

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

  async function resolveAcademicYearById(executor, schoolId, academicYearId) {
    const year = await executor.one(
      `SELECT id, name
       FROM academic_years
       WHERE school_id = $1 AND id::text = $2
       LIMIT 1`,
      [schoolId, academicYearId],
    );
    if (!year) {
      throw createHttpError(400, "Année scolaire introuvable pour cet établissement.");
    }
    return year;
  }

  async function resolveActivatedOffering(executor, school, levelId, streamId, groupId) {
    const level = await executor.one(
      `SELECT el.id, el.name, el.country_id, el.status AS level_status, sl.status AS school_status
       FROM education_levels el
       LEFT JOIN school_levels sl ON sl.level_id = el.id AND sl.school_id = $1
       WHERE el.id::text = $2
       LIMIT 1`,
      [school.id, levelId],
    );
    if (!level) {
      throw createHttpError(400, "Niveau introuvable.", CLASS_WRITE_ERROR.OFFERING_REQUIRED);
    }
    if (school.country_id && String(level.country_id) !== String(school.country_id)) {
      throw createHttpError(403, "Niveau hors pays de l'établissement.", CLASS_WRITE_ERROR.OFFERING_REQUIRED);
    }
    if (level.level_status !== "active" || level.school_status !== "active") {
      throw createHttpError(
        400,
        "Ce niveau n'est pas activé pour l'établissement.",
        CLASS_WRITE_ERROR.LEVEL_NOT_ACTIVATED,
      );
    }

    let streamName = null;
    let resolvedStream = null;
    if (streamId) {
      const stream = await executor.one(
        `SELECT es.id, es.name, es.country_id, es.level_id, es.status AS stream_status, ss.status AS school_status
         FROM education_streams es
         LEFT JOIN school_streams ss ON ss.stream_id = es.id AND ss.school_id = $1
         WHERE es.id::text = $2
         LIMIT 1`,
        [school.id, streamId],
      );
      if (!stream) {
        throw createHttpError(400, "Filière introuvable.", CLASS_WRITE_ERROR.OFFERING_REQUIRED);
      }
      if (school.country_id && String(stream.country_id) !== String(school.country_id)) {
        throw createHttpError(403, "Filière hors pays de l'établissement.", CLASS_WRITE_ERROR.OFFERING_REQUIRED);
      }
      if (stream.stream_status !== "active" || stream.school_status !== "active") {
        throw createHttpError(
          400,
          "Cette filière n'est pas activée pour l'établissement.",
          CLASS_WRITE_ERROR.STREAM_NOT_ACTIVATED,
        );
      }
      if (stream.level_id && String(stream.level_id) !== String(level.id)) {
        throw createHttpError(
          400,
          "Cette filière n'est pas rattachée au niveau choisi.",
          CLASS_WRITE_ERROR.STREAM_LEVEL_MISMATCH,
        );
      }
      streamName = stream.name;
      resolvedStream = stream;
    }

    const group = await executor.one(
      `SELECT eg.id, eg.group_code, eg.name, eg.country_id, eg.status AS group_status, sg.status AS school_status
       FROM education_class_groups eg
       LEFT JOIN school_class_groups sg ON sg.group_id = eg.id AND sg.school_id = $1
       WHERE eg.id::text = $2
       LIMIT 1`,
      [school.id, groupId],
    );
    if (!group) {
      throw createHttpError(400, "Groupe introuvable.", CLASS_WRITE_ERROR.GROUP_NOT_ACTIVATED);
    }
    if (school.country_id && String(group.country_id) !== String(school.country_id)) {
      throw createHttpError(403, "Groupe hors pays de l'établissement.", CLASS_WRITE_ERROR.GROUP_NOT_ACTIVATED);
    }
    if (group.group_status !== "active" || group.school_status !== "active") {
      throw createHttpError(
        400,
        "Ce groupe n'est pas activé pour l'établissement.",
        CLASS_WRITE_ERROR.GROUP_NOT_ACTIVATED,
      );
    }

    return {
      levelName: level.name,
      streamName,
      stream: resolvedStream,
      groupCode: group.group_code,
      groupId: group.id,
    };
  }

  const CLASS_SELECT = `SELECT cl.id,
                cl.class_code,
                cl.name,
                cl.level,
                cl.section,
                cl.status,
                cl.academic_year_id,
                cl.level_id,
                cl.stream_id,
                cl.group_id,
                cl.group_code,
                cl.created_at,
                cl.updated_at,
                s.school_code,
                ay.name AS academic_year_name,
                el.name AS level_name,
                es.name AS stream_name,
                COUNT(e.id) FILTER (WHERE e.status = 'active')::int AS enrollment_count
         FROM classes cl
         JOIN schools s ON s.id = cl.school_id
         JOIN academic_years ay ON ay.id = cl.academic_year_id
         LEFT JOIN education_levels el ON el.id = cl.level_id
         LEFT JOIN education_streams es ON es.id = cl.stream_id
         LEFT JOIN enrollments e ON e.class_id = cl.id`;

  async function insertClass(executor, school, academicYear, offering, input) {
    const displayName = composeClassDisplayName({
      levelName: offering.levelName,
      streamName: offering.streamName,
      groupCode: offering.groupCode,
    });
    let classCode = generateClassCode(input.schoolCode);
    let inserted = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        inserted = await executor.one(
          `INSERT INTO classes (
             school_id, academic_year_id, class_code, name, level, section, status,
             level_id, stream_id, group_id, group_code
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING id, class_code, name, level, section, status,
                     academic_year_id, level_id, stream_id, group_id, group_code, created_at, updated_at`,
          [
            school.id,
            academicYear.id,
            classCode,
            displayName,
            offering.levelName,
            null,
            input.status,
            input.levelId,
            input.streamId,
            offering.groupId,
            offering.groupCode,
          ],
        );
        break;
      } catch (error) {
        if (isClassStructuralUniquenessViolation(error)) {
          throw structuralConflictError();
        }
        if (isClassNameUniquenessViolation(error)) {
          throw nameConflictError(displayName);
        }
        if (isClassCodeUniquenessViolation(error)) {
          classCode = generateClassCode(input.schoolCode);
          continue;
        }
        throw error;
      }
    }
    if (!inserted) {
      throw createHttpError(500, "Impossible de générer un classCode unique.");
    }
    return {
      ...inserted,
      school_code: school.school_code ?? input.schoolCode,
      academic_year_name: academicYear.name,
      level_name: offering.levelName,
      stream_name: offering.streamName,
      enrollment_count: 0,
    };
  }

  function classAuditScope(tx) {
    return resolveTransactionalScope(
      db,
      tx,
      createHttpError(500, "Audit classe indisponible dans la transaction."),
    );
  }

  return {
    /**
     * @param {string} schoolCode
     */
    async listBySchoolCode(schoolCode) {
      const school = await requireSchool(schoolCode);
      const rows = await db.all(
        `${CLASS_SELECT}
         WHERE cl.school_id = $1
         GROUP BY cl.id, s.school_code, ay.name, el.name, es.name
         ORDER BY cl.name ASC, cl.class_code ASC`,
        [school.id],
      );
      return rows.map(mapClassRow);
    },

    /**
     * Keyset L1 : ORDER BY updated_at ASC, id ASC — pas d'OFFSET.
     * Inclut active et inactive (tombstones). Filtre enseignant en SQL si classIds/classCodes.
     *
     * @param {string} schoolCode
     * @param {{
     *   limit: number,
     *   afterUpdatedAt?: string | Date | null,
     *   afterId?: string | null,
     *   classIds?: string[] | null,
     *   classCodes?: string[] | null,
     * }} options
     */
    async listForMobileSync(schoolCode, options = {}) {
      const school = await requireSchool(schoolCode);
      const limit = Math.max(1, Number(options.limit) || 1);
      const params = [school.id];
      const conditions = ["cl.school_id = $1"];

      if (Array.isArray(options.classIds) || Array.isArray(options.classCodes)) {
        const ids = (options.classIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
        const codes = (options.classCodes ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
        if (!ids.length && !codes.length) {
          return [];
        }
        params.push(ids);
        const idsIdx = params.length;
        params.push(codes);
        const codesIdx = params.length;
        conditions.push(`(cl.id = ANY($${idsIdx}::uuid[]) OR cl.class_code = ANY($${codesIdx}::text[]))`);
      }

      const afterUpdatedAt = options.afterUpdatedAt ?? null;
      const afterId = options.afterId ? String(options.afterId).trim() : "";
      if (afterUpdatedAt && afterId) {
        params.push(afterUpdatedAt);
        const tsIdx = params.length;
        params.push(afterId);
        const idIdx = params.length;
        conditions.push(
          `(cl.updated_at > $${tsIdx}::timestamptz OR (cl.updated_at = $${tsIdx}::timestamptz AND cl.id > $${idIdx}::uuid))`,
        );
      }

      params.push(limit);
      const rows = await db.all(
        `SELECT cl.id,
                cl.class_code,
                cl.name,
                cl.status,
                cl.academic_year_id,
                cl.level_id,
                cl.stream_id,
                cl.group_id,
                cl.updated_at
         FROM classes cl
         WHERE ${conditions.join(" AND ")}
         ORDER BY cl.updated_at ASC, cl.id ASC
         LIMIT $${params.length}`,
        params,
      );
      return rows.map(mapMobileSyncClassRow);
    },

    /**
     * Affectations enseignant actives (PostgreSQL) pour scopeHash + filtre SQL.
     * Jamais le tableau JWT `principal.assignments`.
     *
     * @param {string} userId
     * @param {string} schoolId
     */
    async listLiveTeacherClassAssignmentsForSync(userId, schoolId) {
      const uid = String(userId ?? "").trim();
      const sid = String(schoolId ?? "").trim();
      if (!uid || !sid) return [];
      const rows = await db.all(
        `SELECT DISTINCT cl.id::text AS class_id, cl.class_code, ta.status
         FROM teacher_assignments ta
         JOIN teachers t ON t.id = ta.teacher_id
         JOIN classes cl ON cl.id = ta.class_id
          AND cl.school_id = ta.school_id
         WHERE t.user_id::text = $1
           AND ta.school_id::text = $2
           AND t.school_id::text = $2
           AND cl.school_id::text = $2
           AND lower(btrim(ta.status)) IN ('active', 'actif', 'open', 'ouverte')
           AND COALESCE(lower(btrim(t.status)), 'active') NOT IN ('deleted', 'archived', 'inactive')`,
        [uid, sid],
      );
      return rows.map((row) => ({
        classId: row.class_id,
        classCode: row.class_code,
        status: row.status,
      }));
    },

    /**
     * @param {unknown} body
     * @param {string} schoolCode
     * @param {object} [principal]
     * @param {object} [auditMeta]
     */
    async create(body, schoolCode, principal = null, auditMeta = null) {
      const input = validateCreateClassInput(body, schoolCode);
      const school = await requireSchool(input.schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);

      const run = async (executor, tx = executor) => {
        const academicYear = await resolveAcademicYearById(executor, school.id, input.academicYearId);
        const offering = await resolveActivatedOffering(executor, school, input.levelId, input.streamId, input.groupId);
        const inserted = await insertClass(executor, school, academicYear, offering, input);
        if (wantsAudit) {
          const mapped = mapClassRow(inserted);
          await writeTransactionalAudit(classAuditScope(tx), tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "create_class",
            entityType: "class",
            entityId: mapped.classCode,
            oldValue: null,
            newValue: mapped,
            schoolCode: school.school_code ?? input.schoolCode,
          });
        }
        return mapClassRow(inserted);
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
     * @param {unknown} classCodeParam
     * @param {string} schoolCode
     * @param {unknown} body
     * @param {object} [principal]
     * @param {object} [auditMeta]
     */
    async update(classCodeParam, schoolCode, body, principal = null, auditMeta = null) {
      const classCode = requireClassCodeParam(classCodeParam);
      const patch = validateUpdateClassInput(body);
      const school = await requireSchool(schoolCode);
      const wantsAudit = Boolean(principal || auditMeta);

      const run = async (executor, tx = executor) => {
        const current = await executor.one(
          `${CLASS_SELECT}
           WHERE cl.class_code = $1 AND cl.school_id = $2
           GROUP BY cl.id, s.school_code, ay.name, el.name, es.name
           LIMIT 1`,
          [classCode, school.id],
        );
        if (!current) {
          throw createHttpError(404, "Classe introuvable.");
        }

        const structuralTouched =
          Object.hasOwn(patch, "levelId") || Object.hasOwn(patch, "streamId") || Object.hasOwn(patch, "groupId");
        const nextStatus = patch.status ?? current.status;

        let displayName = current.name;
        let levelName = current.level_name ?? current.level;
        let streamName = current.stream_name ?? null;
        let nextLevelId = current.level_id;
        let nextStreamId = current.stream_id;
        let nextGroupId = current.group_id;
        let nextGroupCode = current.group_code;

        if (structuralTouched) {
          nextLevelId = Object.hasOwn(patch, "levelId") ? patch.levelId : current.level_id;
          nextStreamId = Object.hasOwn(patch, "streamId") ? patch.streamId : current.stream_id;
          nextGroupId = Object.hasOwn(patch, "groupId") ? patch.groupId : current.group_id;
          if (!nextLevelId || !nextGroupId) {
            throw createHttpError(
              400,
              "Les classes existantes sans rattachement catalogue se gèrent au lot E. Fournissez levelId et groupId.",
              CLASS_WRITE_ERROR.OFFERING_REQUIRED,
            );
          }
          const offering = await resolveActivatedOffering(executor, school, nextLevelId, nextStreamId || null, nextGroupId);
          levelName = offering.levelName;
          streamName = offering.streamName;
          nextGroupCode = offering.groupCode;
          displayName = composeClassDisplayName({
            levelName: offering.levelName,
            streamName: offering.streamName,
            groupCode: offering.groupCode,
          });
        }

        let updated;
        try {
          updated = await executor.one(
            `UPDATE classes
             SET name = $1,
                 level = $2,
                 section = $3,
                 status = $4,
                 level_id = $5,
                 stream_id = $6,
                 group_id = $7,
                 group_code = $8,
                 updated_at = NOW()
             WHERE class_code = $9 AND school_id = $10
             RETURNING id, class_code, name, level, section, status,
                       academic_year_id, level_id, stream_id, group_id, group_code, created_at, updated_at`,
            [
              displayName,
              levelName,
              structuralTouched ? null : current.section,
              nextStatus,
              nextLevelId,
              nextStreamId || null,
              nextGroupId,
              nextGroupCode,
              classCode,
              school.id,
            ],
          );
        } catch (error) {
          if (isClassStructuralUniquenessViolation(error)) {
            throw structuralConflictError();
          }
          if (isClassNameUniquenessViolation(error)) {
            throw nameConflictError(displayName);
          }
          throw error;
        }
        if (!updated) {
          throw createHttpError(404, "Classe introuvable.");
        }

        const enrollment = await executor.one(
          `SELECT COUNT(*)::int AS enrollment_count
           FROM enrollments
           WHERE class_id = $1 AND status = 'active'`,
          [updated.id],
        );

        const mapped = mapClassRow({
          ...updated,
          school_code: current.school_code,
          academic_year_name: current.academic_year_name,
          level_name: levelName,
          stream_name: streamName,
          enrollment_count: enrollment?.enrollment_count ?? 0,
        });

        if (wantsAudit) {
          await writeTransactionalAudit(classAuditScope(tx), tx, {
            principal: principal ?? {},
            auditMeta: auditMeta ?? {},
            action: "update_class",
            entityType: "class",
            entityId: mapped.classCode,
            oldValue: mapClassRow(current),
            newValue: mapped,
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

module.exports = { createClassesRepository };
