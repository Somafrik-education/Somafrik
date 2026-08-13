"use strict";

const { randomUUID } = require("node:crypto");
const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
} = require("../lib/pedagogyManagement");
const pedagogyService = require("../lib/pedagogyService");

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function createPedagogyPgStore(repo) {
  function bind(scopedRepo) {
    const one = (sql, params) => scopedRepo.one(sql, params);
    const all = (sql, params) => scopedRepo.all(sql, params);
    const query = (sql, params) => scopedRepo.query(sql, params);

    return {
      async getSchoolByCode(code) {
        const row = await one("SELECT * FROM schools WHERE school_code = $1", [asTrimmed(code).toUpperCase()]);
        if (!row) return null;
        return { ...row, code: row.school_code };
      },
      async resolveActorUserId(principal) {
        const normalized = asTrimmed(principal?.sub || principal?.id);
        if (!normalized) return null;
        if (/^[0-9a-f-]{36}$/i.test(normalized)) {
          const row = await one("SELECT id FROM users WHERE id = $1::uuid", [normalized]);
          return row?.id ?? null;
        }
        const byCode = await one("SELECT id FROM users WHERE user_code = $1", [normalized]);
        return byCode?.id ?? null;
      },
      async recordPedagogyAudit({ schoolCode, userId, action, entityType, entityId, oldValue, newValue, ipAddress, userAgent }) {
        const school = schoolCode && schoolCode !== "*" ? await this.getSchoolByCode(schoolCode) : null;
        const actorId = await this.resolveActorUserId({ sub: userId });
        await query(
          `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
          [
            school?.id ?? null,
            actorId,
            action,
            entityType,
            entityId ?? null,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            ipAddress ?? "",
            userAgent ?? "",
          ],
        );
      },
      async findClass(schoolId, className) {
        const row = await one(
          `SELECT c.* FROM classes c
           WHERE c.school_id = $1 AND lower(btrim(c.name)) = lower(btrim($2))
           ORDER BY c.updated_at DESC NULLS LAST
           LIMIT 1`,
          [schoolId, className],
        );
        return row ?? null;
      },
      async findSubject(schoolId, name) {
        const row = await one(
          `SELECT * FROM subjects
           WHERE school_id = $1 AND lower(btrim(name)) = lower(btrim($2))
           LIMIT 1`,
          [schoolId, name],
        );
        return row ?? null;
      },
      async ensureSubject(schoolId, name, coefficient = 1) {
        const existing = await this.findSubject(schoolId, name);
        if (existing) return existing;
        const code = `SUB-${String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`;
        return one(
          `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
           VALUES ($1, $2, $3, $4, 'active')
           ON CONFLICT (subject_code) DO UPDATE SET name = EXCLUDED.name
           RETURNING *`,
          [schoolId, code, name, coefficient],
        );
      },
      async findTeacher(schoolId, teacherKey) {
        const key = asTrimmed(teacherKey);
        if (!key) return null;
        return one(
          `SELECT * FROM teachers
           WHERE school_id = $1 AND (teacher_code = $2 OR id::text = $2)
           LIMIT 1`,
          [schoolId, key],
        );
      },
      async getCourseByCode(code, principal) {
        const params = [asTrimmed(code)];
        let sql = `
          SELECT sc.*, s.school_code, c.name AS class_name, sub.name AS subject_name, t.teacher_code
          FROM school_courses sc
          JOIN schools s ON s.id = sc.school_id
          JOIN classes c ON c.id = sc.class_id
          JOIN subjects sub ON sub.id = sc.subject_id
          LEFT JOIN teachers t ON t.id = sc.teacher_id
          WHERE sc.course_code = $1 OR sc.id::text = $1 OR sc.legacy_json_id = $1
        `;
        const schoolCode = asTrimmed(principal?.schoolCode);
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $2";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        const row = await one(sql, params);
        return row ? mapCourseRow(row) : null;
      },
      async insertCourse(payload) {
        const row = await one(
          `INSERT INTO school_courses
             (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status, legacy_json_id, profile_payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           RETURNING *`,
          [
            payload.schoolId,
            payload.classId,
            payload.subjectId,
            payload.teacherId ?? null,
            payload.courseCode,
            payload.coefficient,
            payload.status ?? "active",
            payload.legacyJsonId ?? null,
            JSON.stringify(payload.profile ?? {}),
          ],
        );
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [row.school_id]);
        const klass = await one("SELECT name FROM classes WHERE id = $1", [row.class_id]);
        const subject = await one("SELECT name FROM subjects WHERE id = $1", [row.subject_id]);
        const teacher = row.teacher_id
          ? await one("SELECT teacher_code FROM teachers WHERE id = $1", [row.teacher_id])
          : null;
        return mapCourseRow({
          ...row,
          school_code: school?.school_code,
          class_name: klass?.name,
          subject_name: subject?.name,
          teacher_code: teacher?.teacher_code,
        });
      },
      async updateCourse(dbId, patch) {
        const row = await one(
          `UPDATE school_courses
           SET teacher_id = COALESCE($2, teacher_id),
               coefficient = COALESCE($3, coefficient),
               status = COALESCE($4, status),
               profile_payload = COALESCE($5::jsonb, profile_payload),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            dbId,
            patch.teacherId ?? null,
            patch.coefficient ?? null,
            patch.status ?? null,
            patch.profile ? JSON.stringify(patch.profile) : null,
          ],
        );
        if (!row) return null;
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [row.school_id]);
        const klass = await one("SELECT name FROM classes WHERE id = $1", [row.class_id]);
        const subject = await one("SELECT name FROM subjects WHERE id = $1", [row.subject_id]);
        const teacher = row.teacher_id
          ? await one("SELECT teacher_code FROM teachers WHERE id = $1", [row.teacher_id])
          : null;
        return mapCourseRow({
          ...row,
          school_code: school?.school_code,
          class_name: klass?.name,
          subject_name: subject?.name,
          teacher_code: teacher?.teacher_code,
        });
      },
      async archiveCourse(dbId) {
        return this.updateCourse(dbId, { status: "archived" });
      },
      async listScheduleConflicts(schoolId, slot, excludeId) {
        const rows = await all(
          `SELECT * FROM course_schedule_slots
           WHERE school_id = $1
             AND ($4::uuid IS NULL OR id <> $4)
             AND tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
             AND (
               lower(btrim(class_name)) = lower(btrim($5))
               OR teacher_id = $6
             )`,
          [schoolId, slot.startsAt, slot.endsAt, excludeId ?? null, slot.className, slot.teacherId ?? null],
        );
        return rows;
      },
      async insertScheduleSlot(payload) {
        const row = await one(
          `INSERT INTO course_schedule_slots
             (school_id, class_id, class_name, subject_name, teacher_id, slot_kind, starts_at, ends_at,
              room, exam_name, exam_type, exam_id, period_name, period_start, period_end, legacy_json_id, profile_payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
           RETURNING *`,
          [
            payload.schoolId,
            payload.classId ?? null,
            payload.className,
            payload.subjectName,
            payload.teacherId ?? null,
            payload.kind ?? "course",
            payload.startsAt,
            payload.endsAt,
            payload.room ?? "",
            payload.examName ?? "",
            payload.examType ?? "",
            payload.examId ?? null,
            payload.periodName ?? "",
            payload.periodStart ?? null,
            payload.periodEnd ?? null,
            payload.legacyJsonId ?? null,
            JSON.stringify(payload.profile ?? {}),
          ],
        );
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [row.school_id]);
        return mapScheduleRow({ ...row, school_code: school?.school_code });
      },
      async updateScheduleSlot(dbId, patch) {
        const row = await one(
          `UPDATE course_schedule_slots
           SET class_name = COALESCE($2, class_name),
               subject_name = COALESCE($3, subject_name),
               teacher_id = COALESCE($4, teacher_id),
               starts_at = COALESCE($5, starts_at),
               ends_at = COALESCE($6, ends_at),
               room = COALESCE($7, room),
               profile_payload = COALESCE($8::jsonb, profile_payload),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            dbId,
            patch.className ?? null,
            patch.subjectName ?? null,
            patch.teacherId ?? null,
            patch.startsAt ?? null,
            patch.endsAt ?? null,
            patch.room ?? null,
            patch.profile ? JSON.stringify(patch.profile) : null,
          ],
        );
        if (!row) return null;
        const school = await one("SELECT school_code FROM schools WHERE id = $1", [row.school_id]);
        return mapScheduleRow({ ...row, school_code: school?.school_code });
      },
      async deleteScheduleSlot(dbId) {
        await query("DELETE FROM course_schedule_slots WHERE id = $1", [dbId]);
      },
      async getScheduleById(id, principal) {
        const params = [asTrimmed(id)];
        let sql = `
          SELECT css.*, s.school_code
          FROM course_schedule_slots css
          JOIN schools s ON s.id = css.school_id
          WHERE css.id::text = $1 OR css.legacy_json_id = $1
        `;
        const schoolCode = asTrimmed(principal?.schoolCode);
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $2";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        const row = await one(sql, params);
        return row ? mapScheduleRow(row) : null;
      },
      async upsertEvaluation(payload, principal) {
        return scopedRepo.upsertEvaluationFromLegacy(payload, { principal });
      },
      async upsertGrade(payload, principal) {
        return scopedRepo.upsertGrade(payload, principal);
      },
      async upsertAttendanceBatch(payload, principal) {
        return scopedRepo.upsertAttendanceBatch(payload, principal);
      },
    };
  }

  const api = {
    async withTransaction(fn) {
      return repo.withTransaction(async (tx) => {
        const scopedRepo = repo.createTxScope(tx);
        return fn(bind(scopedRepo));
      });
    },
    async listProjection() {
      const [evaluationRows, gradeRows, attendanceRows, courseRows, scheduleRows] = await Promise.all([
        repo.all(`
          SELECT e.*, s.school_code, c.name AS class_name, sub.name AS subject_name,
                 t.teacher_code, tm.name AS term_name
          FROM evaluations e
          JOIN schools s ON s.id = e.school_id
          JOIN classes c ON c.id = e.class_id
          JOIN subjects sub ON sub.id = e.subject_id
          LEFT JOIN teachers t ON t.id = e.teacher_id
          JOIN terms tm ON tm.id = e.term_id
          ORDER BY e.created_at DESC
        `),
        repo.all(`
          SELECT g.*, s.school_code, st.student_code, c.name AS class_name, sub.name AS subject_name,
                 t.teacher_code, tm.name AS term_name, e.title AS evaluation_title,
                 e.max_score AS evaluation_max_score, e.coefficient AS evaluation_coefficient,
                 e.evaluation_type AS evaluation_type_pg, e.legacy_json_id AS evaluation_legacy_id,
                 e.id AS evaluation_uuid
          FROM grades g
          JOIN schools s ON s.id = g.school_id
          JOIN students st ON st.id = g.student_id
          JOIN classes c ON c.id = g.class_id
          JOIN subjects sub ON sub.id = g.subject_id
          JOIN teachers t ON t.id = g.teacher_id
          JOIN terms tm ON tm.id = g.term_id
          LEFT JOIN evaluations e ON e.id = g.evaluation_id
          ORDER BY g.updated_at DESC
        `),
        repo.all(`
          SELECT a.*, s.school_code, st.student_code, c.name AS class_name, t.teacher_code
          FROM attendance a
          JOIN schools s ON s.id = a.school_id
          JOIN students st ON st.id = a.student_id
          JOIN classes c ON c.id = a.class_id
          LEFT JOIN teachers t ON t.id = a.teacher_id
          ORDER BY a.attendance_date DESC
        `),
        repo.all(`
          SELECT sc.*, s.school_code, c.name AS class_name, sub.name AS subject_name, t.teacher_code
          FROM school_courses sc
          JOIN schools s ON s.id = sc.school_id
          JOIN classes c ON c.id = sc.class_id
          JOIN subjects sub ON sub.id = sc.subject_id
          LEFT JOIN teachers t ON t.id = sc.teacher_id
          WHERE sc.status = 'active'
          ORDER BY sc.created_at
        `),
        repo.all(`
          SELECT css.*, s.school_code
          FROM course_schedule_slots css
          JOIN schools s ON s.id = css.school_id
          ORDER BY css.starts_at
        `),
      ]);

      const courses = courseRows.length
        ? courseRows.map(mapCourseRow)
        : repo.buildCourses([], [], gradeRows);

      return {
        courses,
        courseSchedules: scheduleRows.map(mapScheduleRow),
        evaluations: evaluationRows.map((row) => repo.mapEvaluation(row)),
        notes: gradeRows.map((row) => repo.mapGrade(row)),
        presences: attendanceRows.map((row) => repo.mapAttendance(row)),
      };
    },
    createSchoolCourse: (payload, principal, auditMeta) =>
      pedagogyService.createCourse(api, payload, principal, auditMeta),
    updateSchoolCourse: (id, patch, principal, auditMeta) =>
      pedagogyService.updateCourse(api, id, patch, principal, auditMeta),
    deleteSchoolCourse: (id, principal, auditMeta) =>
      pedagogyService.deleteCourse(api, id, principal, auditMeta),
    getSchoolCourse: (id, principal) => bind(repo).getCourseByCode(id, principal),
    createCourseSchedule: (payload, principal, auditMeta) =>
      pedagogyService.createCourseSchedule(api, payload, principal, auditMeta),
    updateCourseSchedule: (id, patch, principal, auditMeta) =>
      pedagogyService.updateCourseSchedule(api, id, patch, principal, auditMeta),
    deleteCourseSchedule: (id, principal, auditMeta) =>
      pedagogyService.deleteCourseSchedule(api, id, principal, auditMeta),
    getCourseSchedule: (id, principal) => bind(repo).getScheduleById(id, principal),
    createEvaluation: (payload, principal, auditMeta) =>
      pedagogyService.createEvaluation(api, payload, principal, auditMeta),
    updateEvaluation: (id, patch, principal, auditMeta) =>
      pedagogyService.updateEvaluation(api, id, patch, principal, auditMeta),
    upsertSchoolGrade: (payload, principal, auditMeta) =>
      pedagogyService.upsertGrade(api, payload, principal, auditMeta),
    upsertSchoolAttendanceBatch: (payload, principal, auditMeta) =>
      pedagogyService.upsertAttendanceBatch(api, payload, principal, auditMeta),
  };

  return api;
}

function mapCourseRow(row) {
  const profile = parsePayload(row.profile_payload);
  const id = row.legacy_json_id || row.course_code || row.id;
  return {
    id,
    publicId: id,
    dbId: row.id,
    schoolId: row.school_id,
    schoolCode: row.school_code,
    className: row.class_name,
    name: row.subject_name,
    coefficient: Number(row.coefficient ?? 1),
    teacherId: row.teacher_code || profile.teacherId || "",
    status: row.status === "archived" ? "Archivé" : "Actif",
    ...profile,
  };
}

function mapScheduleRow(row) {
  const profile = parsePayload(row.profile_payload);
  const id = row.legacy_json_id || row.id;
  return {
    id,
    schoolCode: row.school_code,
    className: row.class_name,
    subject: row.subject_name,
    teacherId: profile.teacherId,
    teacherName: profile.teacherName,
    start: row.starts_at,
    end: row.ends_at,
    room: row.room || profile.room,
    kind: row.slot_kind || "course",
    examName: row.exam_name || profile.examName,
    examType: row.exam_type || profile.examType,
    examId: row.exam_id || profile.examId,
    periodName: row.period_name || profile.periodName,
    periodStart: row.period_start || profile.periodStart,
    periodEnd: row.period_end || profile.periodEnd,
    ...profile,
  };
}

module.exports = { createPedagogyPgStore };
