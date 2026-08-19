"use strict";

const { randomUUID } = require("node:crypto");
const {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
} = require("../lib/pedagogyManagement");
const pedagogyService = require("../lib/pedagogyService");
const schoolRoomsService = require("../lib/schoolRoomsService");
const replacementsService = require("../lib/courseScheduleReplacementsService");
const { mapWeeklyScheduleDto } = require("../lib/planningWeekly");
const {
  sqlTeacherIdentityEqualsAny,
  sqlTeacherPublicCodeEquals,
} = require("../lib/teacherCodeAllocation");

const WEEKLY_SLOT_SELECT = `
          SELECT w.id, w.school_id, w.academic_year_id, w.school_course_id, w.class_id, w.teacher_id,
                 w.day_of_week, w.start_time, w.end_time, w.status, w.room, w.room_id, w.created_at, w.updated_at,
                 s.school_code, c.name AS class_name, c.class_code, sc.subject_id, sc.status AS school_course_status,
                 sub.name AS subject_name, t.teacher_code,
                 NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS teacher_name,
                 ay.name AS academic_year_name, ay.status AS academic_year_status,
                 COALESCE(r.name, w.room) AS room_name, r.room_code, r.capacity AS room_capacity, r.status AS room_status
          FROM course_schedule_weekly_slots w
          JOIN schools s ON s.id = w.school_id
          JOIN classes c ON c.id = w.class_id
          JOIN school_courses sc ON sc.id = w.school_course_id
          JOIN subjects sub ON sub.id = sc.subject_id
          JOIN teachers t ON t.id = w.teacher_id
          LEFT JOIN users u ON u.id = t.user_id
          LEFT JOIN academic_years ay ON ay.id = w.academic_year_id
          LEFT JOIN school_rooms r ON r.id = w.room_id
`;

const REPLACEMENT_SELECT = `
          SELECT r.id, r.school_id, r.weekly_slot_id, r.occurrence_date, r.original_teacher_id,
                 r.substitute_teacher_id, r.reason, r.note, r.status, r.created_by, r.cancelled_by,
                 r.academic_year_id, r.start_time, r.end_time, r.created_at, r.updated_at,
                 s.school_code, w.class_id, w.day_of_week, w.room_id,
                 c.name AS class_name, sub.name AS subject_name,
                 orig.teacher_code AS original_teacher_code,
                 subste.teacher_code AS substitute_teacher_code,
                 NULLIF(TRIM(CONCAT(COALESCE(ou.first_name, ''), ' ', COALESCE(ou.last_name, ''))), '') AS original_teacher_name,
                 NULLIF(TRIM(CONCAT(COALESCE(su.first_name, ''), ' ', COALESCE(su.last_name, ''))), '') AS substitute_teacher_name,
                 COALESCE(room.name, w.room) AS room_name
          FROM course_schedule_replacements r
          JOIN schools s ON s.id = r.school_id
          JOIN course_schedule_weekly_slots w ON w.id = r.weekly_slot_id
          JOIN classes c ON c.id = w.class_id
          JOIN school_courses sc ON sc.id = w.school_course_id
          JOIN subjects sub ON sub.id = sc.subject_id
          JOIN teachers orig ON orig.id = r.original_teacher_id
          JOIN teachers subste ON subste.id = r.substitute_teacher_id
          LEFT JOIN users ou ON ou.id = orig.user_id
          LEFT JOIN users su ON su.id = subste.user_id
          LEFT JOIN school_rooms room ON room.id = w.room_id
`;

function isoWeekdayToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kinshasa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const utc = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const js = utc.getUTCDay();
  return js === 0 ? 7 : js;
}

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
      async all(sql, params) {
        return all(sql, params);
      },
      async one(sql, params) {
        return one(sql, params);
      },
      async query(sql, params) {
        return query(sql, params);
      },
      async getSchoolByCode(code) {
        const row = await one("SELECT * FROM schools WHERE school_code = $1", [asTrimmed(code).toUpperCase()]);
        if (!row) return null;
        const profile = parsePayload(row.profile_payload);
        return { ...row, code: row.school_code, timezone: profile.timezone };
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
      async getAcademicYearById(id) {
        if (!id) return null;
        return one(`SELECT * FROM academic_years WHERE id = $1`, [id]);
      },
      async findTermByName(academicYearId, name) {
        return one(
          `SELECT * FROM terms
           WHERE academic_year_id = $1 AND lower(btrim(name)) = lower(btrim($2))
           LIMIT 1`,
          [academicYearId, name],
        );
      },
      async findActiveTeacherAssignment({ schoolId, teacherId, classId, subjectId, academicYearId }) {
        return one(
          `SELECT ta.*
           FROM teacher_assignments ta
           WHERE ta.school_id = $1
             AND ta.teacher_id = $2
             AND ta.class_id = $3
             AND ta.subject_id = $4
             AND ta.academic_year_id = $5
             AND lower(ta.status) = 'active'
           LIMIT 1`,
          [schoolId, teacherId, classId, subjectId, academicYearId],
        );
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
           WHERE school_id = $1 AND (${sqlTeacherPublicCodeEquals("teachers", "$2")} OR id::text = $2)
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
      async getCourseContextByCode(code, principal) {
        const params = [asTrimmed(code)];
        let sql = `
          SELECT sc.id AS course_db_id, sc.school_id, s.school_code,
                 c.id AS class_id, c.academic_year_id,
                 sub.id AS subject_id
          FROM school_courses sc
          JOIN schools s ON s.id = sc.school_id
          JOIN classes c ON c.id = sc.class_id
          JOIN subjects sub ON sub.id = sc.subject_id
          WHERE sc.course_code = $1 OR sc.id::text = $1 OR sc.legacy_json_id = $1
        `;
        const schoolCode = asTrimmed(principal?.schoolCode);
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $2";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        return one(sql, params);
      },
      async getSchoolCourseContext(courseKey, schoolId) {
        const key = asTrimmed(courseKey);
        if (!key) return null;
        return one(
          `SELECT sc.*, s.school_code, c.academic_year_id AS class_academic_year_id,
                  t.teacher_code, t.status AS teacher_row_status
           FROM school_courses sc
           JOIN schools s ON s.id = sc.school_id
           JOIN classes c ON c.id = sc.class_id
           LEFT JOIN teachers t ON t.id = sc.teacher_id
           WHERE sc.school_id = $2
             AND (sc.id::text = $1 OR sc.course_code = $1 OR sc.legacy_json_id = $1)
           LIMIT 1`,
          [key, schoolId],
        );
      },
      async resolveTeacherIdForPrincipal(principal, schoolId) {
        const keys = [
          principal?.sub,
          principal?.id,
          principal?.identifier,
          principal?.teacherId,
          principal?.teacherCode,
        ]
          .map((value) => asTrimmed(value))
          .filter(Boolean);
        if (!keys.length || !schoolId) return null;
        const row = await one(
          `SELECT t.id
           FROM teachers t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.school_id = $1
             AND ${sqlTeacherIdentityEqualsAny("t", "u", "$2::text[]")}
           LIMIT 1`,
          [schoolId, keys],
        );
        return row?.id ?? null;
      },
      async insertWeeklyScheduleSlot(payload) {
        const row = await one(
          `INSERT INTO course_schedule_weekly_slots
             (school_id, academic_year_id, school_course_id, class_id, teacher_id,
              day_of_week, start_time, end_time, status, room, room_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7::time,$8::time,$9,$10,$11)
           RETURNING id`,
          [
            payload.schoolId,
            payload.academicYearId,
            payload.schoolCourseId,
            payload.classId,
            payload.teacherId,
            payload.dayOfWeek,
            payload.startTime,
            payload.endTime,
            payload.status ?? "active",
            payload.room ?? "",
            payload.roomId ?? null,
          ],
        );
        return this.getWeeklyScheduleById(row.id, { schoolCode: "*" });
      },
      async updateWeeklyScheduleSlot(id, patch) {
        await one(
          `UPDATE course_schedule_weekly_slots
           SET school_id = $2,
               academic_year_id = $3,
               school_course_id = $4,
               class_id = $5,
               teacher_id = $6,
               day_of_week = $7,
               start_time = $8::time,
               end_time = $9::time,
               room = COALESCE($10, room),
               room_id = $11,
               updated_at = NOW()
           WHERE id = $1
           RETURNING id`,
          [
            id,
            patch.schoolId,
            patch.academicYearId,
            patch.schoolCourseId,
            patch.classId,
            patch.teacherId,
            patch.dayOfWeek,
            patch.startTime,
            patch.endTime,
            patch.room ?? null,
            patch.roomId === undefined ? null : patch.roomId,
          ],
        );
        return this.getWeeklyScheduleById(id, { schoolCode: "*" });
      },
      async cancelWeeklyScheduleSlot(id) {
        await query(
          `UPDATE course_schedule_weekly_slots
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [id],
        );
        return this.getWeeklyScheduleById(id, { schoolCode: "*" });
      },
      async getWeeklyScheduleById(id, principal) {
        const params = [asTrimmed(id)];
        let sql = `${WEEKLY_SLOT_SELECT} WHERE w.id::text = $1`;
        const schoolCode = asTrimmed(principal?.schoolCode);
        if (schoolCode && schoolCode !== "*") {
          sql += " AND s.school_code = $2";
          params.push(schoolCode.toUpperCase());
        }
        sql += " LIMIT 1";
        const row = await one(sql, params);
        return mapWeeklyScheduleDto(row);
      },
      async listPlanningCourseOptions(filters = {}) {
        const params = [];
        const where = ["sc.status = 'active'", "c.status = 'active'", "t.status = 'active'"];
        const push = (sql, value) => {
          params.push(value);
          where.push(sql.replace("?", `$${params.length}`));
        };
        if (filters.schoolId) push("sc.school_id = ?", filters.schoolId);
        if (filters.classId) push("c.id::text = ?", filters.classId);
        else if (filters.className) push("lower(btrim(c.name)) = lower(btrim(?))", filters.className);
        if (filters.academicYearId) push("c.academic_year_id::text = ?", filters.academicYearId);
        if (filters.teacherId) {
          params.push(filters.teacherId);
          const idx = params.length;
          where.push(`(
            sc.teacher_id = $${idx}
            OR EXISTS (
              SELECT 1 FROM teacher_assignments ta
               WHERE ta.teacher_id = $${idx}
                 AND ta.class_id = sc.class_id
                 AND ta.subject_id = sc.subject_id
                 AND ta.status = 'active'
            )
          )`);
        }
        const sql = `
          SELECT sc.id, sc.status,
                 c.id AS class_id, c.name AS class_name, c.academic_year_id,
                 sub.name AS subject_name, t.teacher_code,
                 NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS teacher_name
          FROM school_courses sc
          JOIN schools s ON s.id = sc.school_id
          JOIN classes c ON c.id = sc.class_id
          JOIN subjects sub ON sub.id = sc.subject_id
          JOIN teachers t ON t.id = sc.teacher_id
          LEFT JOIN users u ON u.id = t.user_id
          WHERE ${where.join(" AND ")}
          ORDER BY c.name, sub.name, sc.id`;
        const rows = await all(sql, params);
        return rows.map(mapPlanningCourseOption);
      },
      async listWeeklyScheduleSlots(filters = {}) {
        const params = [];
        const where = [];
        const push = (sql, value) => {
          params.push(value);
          where.push(sql.replace("?", `$${params.length}`));
        };
        if (filters.schoolId) push("w.school_id = ?", filters.schoolId);
        if (filters.schoolCode && filters.schoolCode !== "*") {
          push("s.school_code = ?", asTrimmed(filters.schoolCode).toUpperCase());
        }
        if (filters.academicYearId) push("w.academic_year_id::text = ?", filters.academicYearId);
        if (filters.classId) push("w.class_id::text = ?", filters.classId);
        if (filters.teacherOrSubstituteId && filters.from && filters.to) {
          params.push(filters.teacherOrSubstituteId, filters.from, filters.to);
          const teacherIdx = params.length - 2;
          const fromIdx = params.length - 1;
          const toIdx = params.length;
          where.push(`(
            w.teacher_id::text = $${teacherIdx}
            OR EXISTS (
              SELECT 1 FROM course_schedule_replacements rpl
               WHERE rpl.weekly_slot_id = w.id
                 AND rpl.substitute_teacher_id::text = $${teacherIdx}
                 AND rpl.status IN ('planned', 'completed')
                 AND rpl.occurrence_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
            )
          )`);
        } else if (filters.teacherId) {
          push("w.teacher_id::text = ?", filters.teacherId);
        }
        if (filters.schoolCourseId) push("w.school_course_id::text = ?", filters.schoolCourseId);
        if (filters.dayOfWeek != null) push("w.day_of_week = ?", filters.dayOfWeek);
        if (filters.status && filters.status !== "all") push("w.status = ?", filters.status);
        const sql = `${WEEKLY_SLOT_SELECT}
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY w.day_of_week, w.start_time, w.id`;
        const rows = await all(sql, params);
        return rows.map(mapWeeklyScheduleDto);
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
            payload.classId,
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
           SET class_id = $2,
               class_name = $3,
               subject_name = $4,
               teacher_id = $5,
               starts_at = $6,
               ends_at = $7,
               room = COALESCE($8, room),
               profile_payload = CASE
                 WHEN $9::jsonb IS NULL THEN profile_payload
                 ELSE profile_payload || $9::jsonb
               END,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            dbId,
            patch.classId,
            patch.className,
            patch.subjectName,
            patch.teacherId ?? null,
            patch.startsAt,
            patch.endsAt,
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
      async upsertEvaluation(payload, principal, options = {}) {
        const row = await scopedRepo.upsertEvaluationFromLegacy(payload, {
          principal,
          ensure: false,
          ...options,
        });
        const mappedRow = await one(
          `SELECT e.*, s.school_code, c.name AS class_name, c.class_code, sub.name AS subject_name,
                  t.teacher_code, tm.name AS term_name, tm.academic_year_id,
                  ay.name AS academic_year_name,
                  NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS teacher_name,
                  et.name AS evaluation_type_name, et.code AS evaluation_type_code
           FROM evaluations e
           JOIN schools s ON s.id = e.school_id
           JOIN classes c ON c.id = e.class_id
           JOIN subjects sub ON sub.id = e.subject_id
           LEFT JOIN teachers t ON t.id = e.teacher_id
           LEFT JOIN users u ON u.id = t.user_id
           JOIN terms tm ON tm.id = e.term_id
           LEFT JOIN academic_years ay ON ay.id = tm.academic_year_id
           LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
           WHERE e.id = $1`,
          [row.id],
        );
        return scopedRepo.mapEvaluation(mappedRow);
      },
      async upsertGrade(payload, principal) {
        return scopedRepo.upsertGrade(payload, principal);
      },
      async upsertAttendance(payload, principal) {
        return scopedRepo.upsertAttendance(payload, principal);
      },
      async upsertAttendanceBatch(payload, principal) {
        return scopedRepo.upsertAttendanceBatch(payload, principal);
      },
      async listSchoolRooms(filters = {}) {
        const params = [filters.schoolId];
        const where = ["r.school_id = $1"];
        if (filters.status) {
          params.push(filters.status);
          where.push(`r.status = $${params.length}`);
        }
        if (filters.roomType) {
          params.push(filters.roomType);
          where.push(`lower(btrim(r.room_type)) = lower(btrim($${params.length}))`);
        }
        if (filters.minCapacity != null) {
          params.push(filters.minCapacity);
          where.push(`r.capacity >= $${params.length}`);
        }
        if (filters.search) {
          params.push(`%${filters.search}%`);
          where.push(`(r.name ILIKE $${params.length} OR r.room_code ILIKE $${params.length} OR COALESCE(r.building, '') ILIKE $${params.length})`);
        }
        const classSizeSql = filters.classId
          ? `(SELECT COUNT(*)::int FROM enrollments e WHERE e.class_id = $class::uuid AND lower(e.status) = 'active')`
          : "NULL";
        if (filters.classId) params.push(filters.classId);
        const classParam = filters.classId ? `$${params.length}` : "NULL";
        const occupancyDow = isoWeekdayToday();
        const rows = await all(
          `SELECT r.*,
                  (
                    SELECT COUNT(*)::int
                    FROM course_schedule_weekly_slots w
                    WHERE w.room_id = r.id AND w.status = 'active' AND w.day_of_week = ${occupancyDow}
                  ) AS occupation_today,
                  ${classSizeSql.replace("$class", classParam)} AS class_size
           FROM school_rooms r
           WHERE ${where.join(" AND ")}
           ORDER BY r.room_code, r.name`,
          params,
        );
        return rows.map((row) => mapSchoolRoom(row));
      },
      async getSchoolRoomById(id, schoolId) {
        const row = await one(
          `SELECT r.*,
                  (
                    SELECT COUNT(*)::int
                    FROM course_schedule_weekly_slots w
                    WHERE w.room_id = r.id AND w.status = 'active' AND w.day_of_week = ${isoWeekdayToday()}
                  ) AS occupation_today
           FROM school_rooms r
           WHERE r.id::text = $1 AND r.school_id = $2
           LIMIT 1`,
          [id, schoolId],
        );
        return row ? mapSchoolRoom(row) : null;
      },
      async insertSchoolRoom(payload) {
        const row = await one(
          `INSERT INTO school_rooms
             (school_id, room_code, name, capacity, room_type, building, floor, equipment, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
           RETURNING *`,
          [
            payload.schoolId,
            payload.roomCode,
            payload.name,
            payload.capacity,
            payload.roomType,
            payload.building,
            payload.floor,
            JSON.stringify(payload.equipment ?? []),
            payload.status ?? "active",
          ],
        );
        return mapSchoolRoom(row);
      },
      async updateSchoolRoom(id, schoolId, patch) {
        const row = await one(
          `UPDATE school_rooms
           SET name = COALESCE($3, name),
               capacity = CASE WHEN $10::boolean THEN $4 ELSE capacity END,
               room_type = CASE WHEN $11::boolean THEN $5 ELSE room_type END,
               building = CASE WHEN $12::boolean THEN $6 ELSE building END,
               floor = CASE WHEN $13::boolean THEN $7 ELSE floor END,
               equipment = COALESCE($8::jsonb, equipment),
               status = COALESCE($9, status),
               updated_at = NOW()
           WHERE id = $1 AND school_id = $2
           RETURNING *`,
          [
            id,
            schoolId,
            patch.name ?? null,
            patch.capacity === undefined ? null : patch.capacity,
            patch.roomType === undefined ? null : patch.roomType,
            patch.building === undefined ? null : patch.building,
            patch.floor === undefined ? null : patch.floor,
            patch.equipment ? JSON.stringify(patch.equipment) : null,
            patch.status ?? null,
            patch.capacity !== undefined,
            patch.roomType !== undefined,
            patch.building !== undefined,
            patch.floor !== undefined,
          ],
        );
        return row ? mapSchoolRoom(row) : null;
      },
      async archiveSchoolRoom(id, schoolId) {
        const row = await one(
          `UPDATE school_rooms
           SET status = 'archived', updated_at = NOW()
           WHERE id = $1 AND school_id = $2
           RETURNING *`,
          [id, schoolId],
        );
        return row ? mapSchoolRoom(row) : null;
      },
      async classActiveEnrollmentCount(classId, schoolId) {
        const row = await one(
          `SELECT COUNT(*)::int AS count
           FROM enrollments e
           JOIN classes c ON c.id = e.class_id
           WHERE e.class_id = $1 AND c.school_id = $2 AND lower(e.status) = 'active'`,
          [classId, schoolId],
        );
        return Number(row?.count ?? 0);
      },
      async listPlanningDiagnostics({ schoolId }) {
        const roomConflicts = await all(
          `SELECT a.id AS slot_id, a.class_id, ca.name AS class_name, suba.name AS subject,
                  a.day_of_week, a.start_time::text AS start_time, a.end_time::text AS end_time,
                  ra.name AS room_name, 'room' AS kind,
                  'Conflit salle : deux classes sur le même local.' AS message
           FROM course_schedule_weekly_slots a
           JOIN course_schedule_weekly_slots b
             ON a.id < b.id
            AND a.school_id = b.school_id
            AND a.academic_year_id = b.academic_year_id
            AND a.room_id = b.room_id
            AND a.day_of_week = b.day_of_week
            AND a.status = 'active' AND b.status = 'active'
            AND a.room_id IS NOT NULL
            AND a.slot_minutes && b.slot_minutes
           JOIN classes ca ON ca.id = a.class_id
           JOIN school_courses sca ON sca.id = a.school_course_id
           JOIN subjects suba ON suba.id = sca.subject_id
           JOIN school_rooms ra ON ra.id = a.room_id
           WHERE a.school_id = $1`,
          [schoolId],
        );
        const teacherConflicts = await all(
          `SELECT a.id AS slot_id, a.class_id, ca.name AS class_name, suba.name AS subject,
                  a.day_of_week, a.start_time::text AS start_time, a.end_time::text AS end_time,
                  NULL AS room_name, 'teacher' AS kind,
                  'Conflit enseignant : déjà occupé.' AS message
           FROM course_schedule_weekly_slots a
           JOIN course_schedule_weekly_slots b
             ON a.id < b.id
            AND a.school_id = b.school_id
            AND a.academic_year_id = b.academic_year_id
            AND a.teacher_id = b.teacher_id
            AND a.day_of_week = b.day_of_week
            AND a.status = 'active' AND b.status = 'active'
            AND a.slot_minutes && b.slot_minutes
           JOIN classes ca ON ca.id = a.class_id
           JOIN school_courses sca ON sca.id = a.school_course_id
           JOIN subjects suba ON suba.id = sca.subject_id
           WHERE a.school_id = $1`,
          [schoolId],
        );
        const classConflicts = await all(
          `SELECT a.id AS slot_id, a.class_id, ca.name AS class_name, suba.name AS subject,
                  a.day_of_week, a.start_time::text AS start_time, a.end_time::text AS end_time,
                  NULL AS room_name, 'class' AS kind,
                  'Conflit classe : déjà un cours à cet horaire.' AS message
           FROM course_schedule_weekly_slots a
           JOIN course_schedule_weekly_slots b
             ON a.id < b.id
            AND a.school_id = b.school_id
            AND a.academic_year_id = b.academic_year_id
            AND a.class_id = b.class_id
            AND a.day_of_week = b.day_of_week
            AND a.status = 'active' AND b.status = 'active'
            AND a.slot_minutes && b.slot_minutes
           JOIN classes ca ON ca.id = a.class_id
           JOIN school_courses sca ON sca.id = a.school_course_id
           JOIN subjects suba ON suba.id = sca.subject_id
           WHERE a.school_id = $1`,
          [schoolId],
        );
        const substituteConflicts = await all(
          `SELECT r.id AS slot_id, w.class_id, c.name AS class_name, sub.name AS subject,
                  w.day_of_week, w.start_time::text AS start_time, w.end_time::text AS end_time,
                  NULL AS room_name, 'substitute' AS kind,
                  'Conflit remplaçant : enseignant déjà occupé.' AS message
           FROM course_schedule_replacements r
           JOIN course_schedule_weekly_slots w ON w.id = r.weekly_slot_id
           JOIN classes c ON c.id = w.class_id
           JOIN school_courses sc ON sc.id = w.school_course_id
           JOIN subjects sub ON sub.id = sc.subject_id
           WHERE r.school_id = $1
             AND r.status IN ('planned', 'completed')
             AND (
               EXISTS (
                 SELECT 1 FROM course_schedule_weekly_slots other
                 WHERE other.teacher_id = r.substitute_teacher_id
                   AND other.school_id = r.school_id
                   AND other.academic_year_id = r.academic_year_id
                   AND other.status = 'active'
                   AND other.day_of_week = w.day_of_week
                   AND other.start_time < r.end_time
                   AND r.start_time < other.end_time
               )
               OR EXISTS (
                 SELECT 1 FROM course_schedule_replacements other
                 WHERE other.id <> r.id
                   AND other.school_id = r.school_id
                   AND other.substitute_teacher_id = r.substitute_teacher_id
                   AND other.occurrence_date = r.occurrence_date
                   AND other.status IN ('planned', 'completed')
                   AND other.start_time < r.end_time
                   AND r.start_time < other.end_time
               )
             )`,
          [schoolId],
        );
        const capacityWarnings = await all(
          `SELECT w.id AS slot_id, w.class_id, c.name AS class_name, sub.name AS subject,
                  w.day_of_week, w.start_time::text AS start_time, w.end_time::text AS end_time,
                  r.name AS room_name, 'capacity' AS kind,
                  'Capacité salle inférieure à l''effectif de la classe.' AS message
           FROM course_schedule_weekly_slots w
           JOIN school_rooms r ON r.id = w.room_id
           JOIN classes c ON c.id = w.class_id
           JOIN school_courses sc ON sc.id = w.school_course_id
           JOIN subjects sub ON sub.id = sc.subject_id
           WHERE w.school_id = $1
             AND w.status = 'active'
             AND r.capacity IS NOT NULL
             AND r.capacity < (
               SELECT COUNT(*) FROM enrollments e
               WHERE e.class_id = w.class_id AND lower(e.status) = 'active'
             )`,
          [schoolId],
        );
        return [...classConflicts, ...teacherConflicts, ...roomConflicts, ...substituteConflicts, ...capacityWarnings].map(
          mapDiagnosticRow,
        );
      },
      async lockWeeklyScheduleForReplacement(id, schoolId) {
        return one(
          `SELECT * FROM course_schedule_weekly_slots
           WHERE id::text = $1 AND school_id = $2 AND status = 'active'
           FOR UPDATE`,
          [id, schoolId],
        );
      },
      async lockTeacherForReplacement(teacherId, schoolId) {
        const row = await one(
          `SELECT id FROM teachers
           WHERE id::text = $1 AND school_id = $2 AND lower(status) = 'active'
           FOR UPDATE`,
          [teacherId, schoolId],
        );
        if (!row) {
          const { createPedagogyError, PEDAGOGY_ERROR } = require("../lib/pedagogyManagement");
          throw createPedagogyError(404, "Enseignant introuvable ou inactif.", PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED);
        }
        return row;
      },
      async findSubstituteWeeklyOverlap({ schoolId, academicYearId, teacherId, dayOfWeek, startTime, endTime }) {
        return one(
          `SELECT id FROM course_schedule_weekly_slots
           WHERE school_id = $1
             AND academic_year_id = $2
             AND teacher_id::text = $3
             AND status = 'active'
             AND day_of_week = $4
             AND start_time < $6::time
             AND $5::time < end_time
           LIMIT 1`,
          [schoolId, academicYearId, teacherId, dayOfWeek, startTime, endTime],
        );
      },
      async findSubstituteReplacementOverlap({
        schoolId,
        substituteTeacherId,
        occurrenceDate,
        startTime,
        endTime,
        excludeReplacementId,
        excludeWeeklySlotId,
      }) {
        return one(
          `SELECT id FROM course_schedule_replacements
           WHERE school_id = $1
             AND substitute_teacher_id::text = $2
             AND occurrence_date = $3::date
             AND status IN ('planned', 'completed')
             AND start_time < $5::time
             AND $4::time < end_time
             AND ($6::uuid IS NULL OR id <> $6)
             AND ($7::uuid IS NULL OR weekly_slot_id <> $7)
           LIMIT 1`,
          [
            schoolId,
            substituteTeacherId,
            occurrenceDate,
            startTime,
            endTime,
            excludeReplacementId ?? null,
            excludeWeeklySlotId ?? null,
          ],
        );
      },
      async listEligibleSubstituteTeachers({
        schoolId,
        academicYearId,
        weeklySlotId,
        occurrenceDate,
        dayOfWeek,
        startTime,
        endTime,
        originalTeacherId,
        subjectName,
      }) {
        const rows = await all(
          `SELECT t.id, t.teacher_code, t.speciality, t.status,
                  NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS teacher_name,
                  EXISTS (
                    SELECT 1 FROM course_schedule_weekly_slots w
                    WHERE w.teacher_id = t.id
                      AND w.school_id = t.school_id
                      AND w.academic_year_id = $2
                      AND w.status = 'active'
                      AND w.day_of_week = $3
                      AND w.start_time < $5::time
                      AND $4::time < w.end_time
                  ) AS weekly_conflict,
                  EXISTS (
                    SELECT 1 FROM course_schedule_replacements r
                    WHERE r.substitute_teacher_id = t.id
                      AND r.school_id = t.school_id
                      AND r.occurrence_date = $6::date
                      AND r.status IN ('planned', 'completed')
                      AND r.start_time < $5::time
                      AND $4::time < r.end_time
                      AND r.weekly_slot_id <> $7
                  ) AS replacement_conflict
           FROM teachers t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.school_id = $1
             AND lower(t.status) = 'active'
             AND t.id <> $8
           ORDER BY teacher_name, t.teacher_code`,
          [schoolId, academicYearId, dayOfWeek, startTime, endTime, occurrenceDate, weeklySlotId, originalTeacherId],
        );
        const coursesByTeacher = await all(
          `SELECT sc.teacher_id, c.name AS class_name, sub.name AS subject_name
           FROM school_courses sc
           JOIN classes c ON c.id = sc.class_id
           JOIN subjects sub ON sub.id = sc.subject_id
           WHERE sc.school_id = $1 AND sc.status = 'active' AND sc.teacher_id IS NOT NULL`,
          [schoolId],
        );
        const grouped = new Map();
        for (const row of coursesByTeacher) {
          const key = String(row.teacher_id);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push({ className: row.class_name, subject: row.subject_name });
        }
        const subjectNorm = String(subjectName ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
        return rows.map((row) => {
          const conflict = Boolean(row.weekly_conflict || row.replacement_conflict);
          const speciality = String(row.speciality ?? "").trim();
          const specialityNorm = speciality
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          const subjectMismatch = Boolean(subjectNorm && specialityNorm && !specialityNorm.includes(subjectNorm) && !subjectNorm.includes(specialityNorm));
          return {
            teacherId: row.id,
            teacherCode: row.teacher_code,
            name: row.teacher_name || row.teacher_code,
            speciality,
            courses: grouped.get(String(row.id)) || [],
            availability: conflict ? "schedule_conflict" : subjectMismatch ? "subject_mismatch" : "available",
            selectable: !conflict,
          };
        });
      },
      async insertCourseScheduleReplacement(payload) {
        const row = await one(
          `INSERT INTO course_schedule_replacements
             (school_id, weekly_slot_id, occurrence_date, original_teacher_id, substitute_teacher_id,
              reason, note, status, created_by, academic_year_id, start_time, end_time)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11::time,$12::time)
           RETURNING id`,
          [
            payload.schoolId,
            payload.weeklySlotId,
            payload.occurrenceDate,
            payload.originalTeacherId,
            payload.substituteTeacherId,
            payload.reason,
            payload.note,
            payload.status ?? "planned",
            payload.createdBy ?? null,
            payload.academicYearId,
            payload.startTime,
            payload.endTime,
          ],
        );
        return { id: row.id };
      },
      async updateCourseScheduleReplacement(id, schoolId, patch) {
        await one(
          `UPDATE course_schedule_replacements
           SET substitute_teacher_id = COALESCE($3, substitute_teacher_id),
               reason = CASE WHEN $4::boolean THEN $5 ELSE reason END,
               note = CASE WHEN $6::boolean THEN $7 ELSE note END,
               status = COALESCE($8, status),
               updated_at = NOW()
           WHERE id = $1 AND school_id = $2
           RETURNING id`,
          [
            id,
            schoolId,
            patch.substituteTeacherId ?? null,
            patch.reason !== undefined,
            patch.reason ?? null,
            patch.note !== undefined,
            patch.note ?? null,
            patch.status ?? null,
          ],
        );
        return this.getCourseScheduleReplacementById(id, schoolId);
      },
      async cancelCourseScheduleReplacement(id, schoolId, cancelledBy) {
        await one(
          `UPDATE course_schedule_replacements
           SET status = 'cancelled', cancelled_by = $3, updated_at = NOW()
           WHERE id = $1 AND school_id = $2 AND status <> 'cancelled'
           RETURNING id`,
          [id, schoolId, cancelledBy ?? null],
        );
        return this.getCourseScheduleReplacementById(id, schoolId);
      },
      async getCourseScheduleReplacementById(id, schoolId) {
        const row = await one(`${REPLACEMENT_SELECT} WHERE r.id::text = $1 AND r.school_id = $2 LIMIT 1`, [id, schoolId]);
        return row ? mapReplacementRow(row) : null;
      },
      async listCourseScheduleReplacements(filters = {}) {
        const params = [];
        const where = [];
        const push = (sql, value) => {
          params.push(value);
          where.push(sql.replace("?", `$${params.length}`));
        };
        if (filters.schoolId) push("r.school_id = ?", filters.schoolId);
        if (filters.from) push("r.occurrence_date >= ?::date", filters.from);
        if (filters.to) push("r.occurrence_date <= ?::date", filters.to);
        if (filters.teacherId) push("r.original_teacher_id::text = ?", filters.teacherId);
        if (filters.substituteTeacherId) push("r.substitute_teacher_id::text = ?", filters.substituteTeacherId);
        if (filters.classId) push("w.class_id::text = ?", filters.classId);
        if (filters.weeklySlotId) push("r.weekly_slot_id::text = ?", filters.weeklySlotId);
        if (filters.status) push("r.status = ?", filters.status);
        if (filters.concernedTeacherId) {
          params.push(filters.concernedTeacherId);
          where.push(`(r.original_teacher_id::text = $${params.length} OR r.substitute_teacher_id::text = $${params.length})`);
        }
        const rows = await all(
          `${REPLACEMENT_SELECT}
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY r.occurrence_date, w.start_time, r.id`,
          params,
        );
        return rows.map(mapReplacementRow);
      },
      async listActiveReplacementsForSlots({ schoolId, slotIds, from, to }) {
        if (!slotIds?.length) return [];
        const rows = await all(
          `${REPLACEMENT_SELECT}
           WHERE r.school_id = $1
             AND r.weekly_slot_id = ANY($2::uuid[])
             AND r.status IN ('planned', 'completed')
             AND r.occurrence_date BETWEEN $3::date AND $4::date`,
          [schoolId, slotIds, from, to],
        );
        return rows.map(mapReplacementRow);
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
          SELECT e.*, s.school_code, c.name AS class_name, c.class_code, sub.name AS subject_name,
                 t.teacher_code, tm.name AS term_name, tm.academic_year_id,
                 ay.name AS academic_year_name,
                 NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), '') AS teacher_name,
                 et.name AS evaluation_type_name, et.code AS evaluation_type_code
          FROM evaluations e
          JOIN schools s ON s.id = e.school_id
          JOIN classes c ON c.id = e.class_id
          JOIN subjects sub ON sub.id = e.subject_id
          LEFT JOIN teachers t ON t.id = e.teacher_id
          LEFT JOIN users u ON u.id = t.user_id
          JOIN terms tm ON tm.id = e.term_id
          LEFT JOIN academic_years ay ON ay.id = tm.academic_year_id
          LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
          ORDER BY e.created_at DESC
        `),
        repo.all(`
          SELECT g.*, s.school_code, st.student_code, c.name AS class_name, sub.name AS subject_name,
                 t.teacher_code, tm.name AS term_name, e.title AS evaluation_title,
                 e.max_score AS evaluation_max_score, e.coefficient AS evaluation_coefficient,
                 e.evaluation_type AS evaluation_type_pg, e.legacy_json_id AS evaluation_legacy_id,
                 e.id AS evaluation_uuid, e.evaluation_type_id,
                 et.name AS evaluation_type_name, et.code AS evaluation_type_code
          FROM grades g
          JOIN schools s ON s.id = g.school_id
          JOIN students st ON st.id = g.student_id
          JOIN classes c ON c.id = g.class_id
          JOIN subjects sub ON sub.id = g.subject_id
          JOIN teachers t ON t.id = g.teacher_id
          JOIN terms tm ON tm.id = g.term_id
          LEFT JOIN evaluations e ON e.id = g.evaluation_id
          LEFT JOIN evaluation_types et ON et.id = e.evaluation_type_id
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
          ${WEEKLY_SLOT_SELECT}
          WHERE w.status = 'active'
          ORDER BY w.day_of_week, w.start_time, w.id
        `),
      ]);

      const courses = courseRows.length
        ? courseRows.map(mapCourseRow)
        : repo.buildCourses([], [], gradeRows);

      return {
        courses,
        courseSchedules: scheduleRows.map(mapWeeklyScheduleDto),
        evaluations: evaluationRows.map((row) => repo.mapEvaluation(row)),
        notes: gradeRows.map((row) => repo.mapGrade(row)),
        presences: attendanceRows.map((row) => repo.mapAttendance(row)),
      };
    },
    getSchoolByCode: (code) => bind(repo).getSchoolByCode(code),
    resolveTeacherIdForPrincipal: (principal, schoolId) =>
      bind(repo).resolveTeacherIdForPrincipal(principal, schoolId),
    listPlanningCourseOptions: (filters) => bind(repo).listPlanningCourseOptions(filters),
    listWeeklyScheduleSlots: (filters) => bind(repo).listWeeklyScheduleSlots(filters),
    getWeeklyScheduleById: (id, principal) => bind(repo).getWeeklyScheduleById(id, principal),
    listCourseSchedules: (principal, query) => pedagogyService.listCourseSchedules(api, principal, query),
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
    getCourseSchedule: (id, principal) => bind(repo).getWeeklyScheduleById(id, principal),
    createEvaluation: (payload, principal, auditMeta) =>
      pedagogyService.createEvaluation(api, payload, principal, auditMeta),
    updateEvaluation: (id, patch, principal, auditMeta) =>
      pedagogyService.updateEvaluation(api, id, patch, principal, auditMeta),
    upsertSchoolGrade: (payload, principal, auditMeta) =>
      pedagogyService.upsertGrade(api, payload, principal, auditMeta),
    upsertSchoolAttendanceBatch: (payload, principal, auditMeta) =>
      pedagogyService.upsertAttendanceBatch(api, payload, principal, auditMeta),
    listSchoolRooms: (principal, query) => schoolRoomsService.listSchoolRooms(api, principal, query),
    createSchoolRoom: (payload, principal, auditMeta) =>
      schoolRoomsService.createSchoolRoom(api, payload, principal, auditMeta),
    updateSchoolRoom: (id, patch, principal, auditMeta) =>
      schoolRoomsService.updateSchoolRoom(api, id, patch, principal, auditMeta),
    archiveSchoolRoom: (id, principal, auditMeta) =>
      schoolRoomsService.archiveSchoolRoom(api, id, principal, auditMeta),
    listCourseScheduleReplacements: (principal, query) =>
      replacementsService.listCourseScheduleReplacements(api, principal, query),
    listReplacementTeacherOptions: (principal, query) =>
      replacementsService.listReplacementTeacherOptions(api, principal, query),
    createCourseScheduleReplacement: (payload, principal, auditMeta) =>
      replacementsService.createCourseScheduleReplacement(api, payload, principal, auditMeta),
    updateCourseScheduleReplacement: (id, patch, principal, auditMeta) =>
      replacementsService.updateCourseScheduleReplacement(api, id, patch, principal, auditMeta),
    cancelCourseScheduleReplacement: (id, principal, auditMeta) =>
      replacementsService.cancelCourseScheduleReplacement(api, id, principal, auditMeta),
    listActiveReplacementsForSlots: (filters) => bind(repo).listActiveReplacementsForSlots(filters),
    listPlanningDiagnostics: (filters) => bind(repo).listPlanningDiagnostics(filters),
    classActiveEnrollmentCount: (classId, schoolId) => bind(repo).classActiveEnrollmentCount(classId, schoolId),
    getSchoolRoomById: (id, schoolId) => bind(repo).getSchoolRoomById(id, schoolId),
  };

  return api;
}

function mapPlanningCourseOption(row) {
  return {
    schoolCourseId: row.id,
    classId: row.class_id,
    className: row.class_name,
    academicYearId: row.academic_year_id,
    name: row.subject_name,
    teacherId: row.teacher_code || "",
    teacherName: row.teacher_name || "",
    status: row.status === "archived" ? "archived" : "active",
  };
}

function mapCourseRow(row) {
  const profile = parsePayload(row.profile_payload);
  const id = row.legacy_json_id || row.course_code || row.id;
  return {
    id,
    schoolCourseId: row.id,
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
    dbId: row.id,
    classId: row.class_id,
    teacherDbId: row.teacher_id,
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

function mapDiagnosticRow(row) {
  return {
    slotId: row.slot_id,
    classId: row.class_id,
    className: row.class_name || "",
    subject: row.subject || "",
    dayOfWeek: Number(row.day_of_week),
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    roomName: row.room_name || "",
    kind: row.kind,
    message: row.message,
    blocking: row.kind !== "capacity",
  };
}

function mapSchoolRoom(row) {
  const equipment = parsePayload(row.equipment);
  const classSize = row.class_size == null ? null : Number(row.class_size);
  const capacity = row.capacity == null ? null : Number(row.capacity);
  return {
    id: row.id,
    schoolId: row.school_id,
    roomCode: row.room_code,
    name: row.name,
    capacity,
    roomType: row.room_type || "",
    building: row.building || "",
    floor: row.floor || "",
    equipment: Array.isArray(equipment) ? equipment : [],
    status: row.status,
    occupationToday: Number(row.occupation_today ?? 0),
    classSize,
    capacityWarning:
      capacity != null && classSize != null && classSize > capacity
        ? {
            roomCapacity: capacity,
            classSize,
            message: `Salle ${row.name} : capacité ${capacity}. Classe : ${classSize} élèves. Capacité inférieure à l'effectif de la classe.`,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReplacementRow(row) {
  const occurrenceDate =
    row.occurrence_date instanceof Date
      ? row.occurrence_date.toISOString().slice(0, 10)
      : String(row.occurrence_date ?? "").slice(0, 10);
  return {
    id: row.id,
    schoolId: row.school_id,
    schoolCode: row.school_code,
    weeklySlotId: row.weekly_slot_id,
    occurrenceDate,
    originalTeacherId: row.original_teacher_id,
    originalTeacherName: row.original_teacher_name || "",
    originalTeacherCode: row.original_teacher_code || "",
    substituteTeacherId: row.substitute_teacher_id,
    substituteTeacherName: row.substitute_teacher_name || "",
    substituteTeacherCode: row.substitute_teacher_code || "",
    classId: row.class_id,
    className: row.class_name || "",
    courseName: row.subject_name || "",
    dayOfWeek: Number(row.day_of_week),
    startTime: String(row.start_time || "").slice(0, 5),
    endTime: String(row.end_time || "").slice(0, 5),
    room: row.room_name || "",
    reason: row.reason || "",
    note: row.note || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { createPedagogyPgStore };
