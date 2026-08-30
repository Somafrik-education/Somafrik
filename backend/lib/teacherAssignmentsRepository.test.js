"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTeacherAssignmentsRepository, mapMobileSyncAssignmentRow, SELECT_ASSIGNMENT } = require("../db/teacherAssignmentsRepository");

function createMemoryAdapter() {
  const schools = new Map([
    ["CD-2026-0001", { id: "school-1", school_code: "CD-2026-0001" }],
    ["CD-2026-0002", { id: "school-2", school_code: "CD-2026-0002" }],
  ]);
  const teachers = [
    { id: "teacher-1", school_id: "school-1", teacher_code: "CD-2026-0001-ENS-0001", first_name: "Awa", last_name: "Diop", status: "active", user_status: "active" },
    { id: "teacher-2", school_id: "school-1", teacher_code: "CD-2026-0001-ENS-0002", first_name: "Moussa", last_name: "Ba", status: "active", user_status: "active" },
    { id: "teacher-archived", school_id: "school-1", teacher_code: "CD-2026-0001-ENS-0099", first_name: "Archivé", last_name: "Test", status: "archived", user_status: "archived" },
    { id: "teacher-x", school_id: "school-2", teacher_code: "CD-2026-0002-ENS-0001", first_name: "Cross", last_name: "Tenant", status: "active", user_status: "active" },
  ];
  const classes = [
    { id: "class-1", school_id: "school-1", class_code: "CLS-6A", name: "6ème A", academic_year_id: "year-1" },
    { id: "class-2", school_id: "school-2", class_code: "CLS-B", name: "6ème B", academic_year_id: "year-1" },
  ];
  const subjects = [
    { id: "subject-1", school_id: "school-1", subject_code: "SUB-MATH", name: "Mathématiques", status: "active" },
    { id: "subject-archived", school_id: "school-1", subject_code: "SUB-OLD", name: "Ancienne", status: "archived" },
    { id: "subject-b", school_id: "school-2", subject_code: "SUB-BIO", name: "Biologie", status: "active" },
  ];
  const assignments = [];

  function mapped(row) {
    if (!row) return null;
    const school = [...schools.values()].find((item) => item.id === row.school_id);
    const teacher = teachers.find((item) => item.id === row.teacher_id);
    const schoolClass = classes.find((item) => item.id === row.class_id);
    const subject = subjects.find((item) => item.id === row.subject_id);
    return {
      ...row,
      school_code: school?.school_code,
      login_code: school?.login_code ?? school?.school_code,
      teacher_code: teacher?.teacher_code,
      user_code: teacher?.user_code ?? teacher?.teacher_code,
      teacher_user_id: teacher?.user_id ?? null,
      first_name: teacher?.first_name,
      last_name: teacher?.last_name,
      class_code: schoolClass?.class_code,
      class_name: schoolClass?.name,
      subject_code: subject?.subject_code,
      subject_name: subject?.name,
      academic_year_name: "2025-2026",
    };
  }

  const adapter = {
    async getSchoolByCode(code) {
      return schools.get(String(code).toUpperCase()) ?? null;
    },
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("SELECT TA.ID") && text.includes("WHERE TA.ID::TEXT")) {
        return mapped(
          assignments.find(
            (row) => String(row.id) === String(params[0]) && row.school_id === params[1],
          ),
        );
      }
      if (text.startsWith("SELECT T.ID, T.USER_ID") || text.startsWith("SELECT T.ID, T.TEACHER_CODE")) {
        return teachers.find(
          (row) =>
            row.school_id === params[0] &&
            [row.id, row.teacher_code, row.user_code].includes(String(params[1])) &&
            String(row.status ?? "active") === "active" &&
            String(row.user_status ?? "active") === "active",
        ) ?? null;
      }
      if (text.startsWith("SELECT CL.ID")) {
        return classes.find(
          (row) =>
            row.school_id === params[0] &&
            [row.class_code, row.name].includes(String(params[1])),
        ) ?? null;
      }
      if (text.startsWith("SELECT SUB.ID")) {
        return subjects.find(
          (row) =>
            row.school_id === params[0] &&
            [row.subject_code, row.name].includes(String(params[1])) &&
            String(row.status ?? "active") === "active",
        ) ?? null;
      }
      if (text.startsWith("SELECT TA.ID, TA.TEACHER_ID") || text.startsWith("SELECT TA.ID, T.TEACHER_CODE")) {
        const conflict = assignments.find(
          (row) =>
            row.school_id === params[0] &&
            row.class_id === params[1] &&
            row.subject_id === params[2] &&
            row.academic_year_id === params[3] &&
            row.status === "active" &&
            (!params[4] || String(row.id) !== String(params[4])),
        );
        return conflict ? { id: conflict.id, teacher_id: conflict.teacher_id } : null;
      }
      if (text.startsWith("INSERT INTO TEACHER_ASSIGNMENTS")) {
        const row = {
          id: `assignment-${assignments.length + 1}`,
          school_id: params[0],
          teacher_id: params[1],
          class_id: params[2],
          subject_id: params[3],
          academic_year_id: params[4],
          assignment_role: params[5],
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        assignments.push(row);
        return { id: row.id };
      }
      if (text.startsWith("UPDATE TEACHER_ASSIGNMENTS SET TEACHER_ID")) {
        const row = assignments.find(
          (item) => String(item.id) === String(params[5]) && item.school_id === params[6],
        );
        if (!row) return null;
        Object.assign(row, {
          teacher_id: params[0],
          class_id: params[1],
          subject_id: params[2],
          academic_year_id: params[3],
          assignment_role: params[4],
          updated_at: new Date().toISOString(),
        });
        return { id: row.id };
      }
      if (text.startsWith("UPDATE TEACHER_ASSIGNMENTS SET STATUS = 'DELETED'")) {
        const row = assignments.find(
          (item) =>
            String(item.id) === String(params[0]) &&
            item.school_id === params[1] &&
            item.status === "active",
        );
        if (!row) return null;
        row.status = "deleted";
        return { id: row.id };
      }
      return null;
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("SELECT TA.ID")) {
        return assignments
          .filter((row) => row.school_id === params[0] && row.status === "active")
          .map(mapped);
      }
      return [];
    },
    async query() {
      return { rows: [] };
    },
    async withTransaction(fn) {
      const snapshot = assignments.map((row) => ({ ...row }));
      try {
        return await fn(adapter);
      } catch (error) {
        assignments.length = 0;
        assignments.push(...snapshot);
        throw error;
      }
    },
  };
  return adapter;
}

test("CRUD affectation, conflit et isolation établissement", async () => {
  const repo = createTeacherAssignmentsRepository(createMemoryAdapter());
  const created = await repo.create(
    { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
    "CD-2026-0001",
  );
  assert.equal(created.teacherName, "Awa Diop");
  assert.equal(created.teacherId, "teacher-1");
  assert.equal(created.teacherCode, "CD-2026-0001-ENS-0001");
  assert.notEqual(created.teacherId, created.teacherCode);
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 1);

  await assert.rejects(
    () => repo.create(
      { teacherCode: "CD-2026-0001-ENS-0002", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
      "CD-2026-0001",
    ),
    (error) => error.statusCode === 409 && error.code === "ASSIGNMENT_COURSE_CONFLICT",
  );

  const updated = await repo.update(
    created.id,
    { teacherCode: "CD-2026-0001-ENS-0002" },
    "CD-2026-0001",
  );
  assert.equal(updated.teacherName, "Moussa Ba");
  await assert.rejects(
    () => repo.update(created.id, { teacherCode: "CD-2026-0002-ENS-0001" }, "CD-2026-0001"),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
  );
  await assert.rejects(
    () => repo.remove(created.id, "CD-2026-0002"),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_NOT_FOUND",
  );
  assert.deepEqual(await repo.remove(created.id, "CD-2026-0001"), {
    id: created.id,
    deleted: true,
  });
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 0);
  const recreated = await repo.create(
    { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
    "CD-2026-0001",
  );
  assert.notEqual(recreated.id, created.id);
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 1);
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 409 && error.code === "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-UNKNOWN" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-OLD" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-BIO" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_SUBJECT_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0099", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0002-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_TEACHER_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-B", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 404 && error.code === "ASSIGNMENT_CLASS_NOT_FOUND",
  );
});

test("SELECT_ASSIGNMENT exige school_id sur tous les JOIN métier", () => {
  assert.match(SELECT_ASSIGNMENT, /JOIN teachers t ON t\.id = ta\.teacher_id\s+AND t\.school_id = ta\.school_id/);
  assert.match(SELECT_ASSIGNMENT, /LEFT JOIN users u ON u\.id = t\.user_id\s+AND u\.school_id = ta\.school_id/);
  assert.match(SELECT_ASSIGNMENT, /JOIN classes cl ON cl\.id = ta\.class_id\s+AND cl\.school_id = ta\.school_id/);
  assert.match(SELECT_ASSIGNMENT, /JOIN subjects sub ON sub\.id = ta\.subject_id\s+AND sub\.school_id = ta\.school_id/);
  assert.match(
    SELECT_ASSIGNMENT,
    /JOIN academic_years ay ON ay\.id = ta\.academic_year_id\s+AND ay\.school_id = ta\.school_id/,
  );
});

test("DELETE n'alias pas ta.status (UPDATE sans FROM ta)", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../db/teacherAssignmentsRepository.js"),
    "utf8",
  );
  const match = src.match(/UPDATE teacher_assignments SET status = 'deleted'[\s\S]*?RETURNING id/);
  assert.ok(match);
  assert.equal(match[0].includes("ta.status"), false);
  assert.match(match[0], /AND status = 'active' RETURNING id/);
});

test("L1 teacherUserId = t.user_id ; tombstone ⇔ status != 'active'", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../db/teacherAssignmentsRepository.js"),
    "utf8",
  );
  const l1Start = src.indexOf("async listForMobileSync");
  const l1 = src.slice(l1Start, src.indexOf("async create(body, schoolCode"));
  assert.match(l1, /t\.user_id AS teacher_user_id/);
  assert.equal(l1.includes("u.id AS teacher_user_id"), false);
  assert.match(l1, /JOIN users u ON u\.id = t\.user_id/);
  assert.equal(
    mapMobileSyncAssignmentRow({
      id: "a",
      teacher_id: "t",
      teacher_code: "T",
      teacher_user_id: "u",
      class_id: "c",
      class_code: "C",
      subject_id: "s",
      subject_code: "S",
      academic_year_id: "y",
      assignment_role: "primary",
      status: "active",
      updated_at: "2026-08-26T08:00:00.000Z",
    }).tombstone,
    false,
  );
  assert.equal(
    mapMobileSyncAssignmentRow({
      id: "a",
      teacher_id: "t",
      teacher_code: "T",
      teacher_user_id: null,
      class_id: "c",
      class_code: "C",
      subject_id: "s",
      subject_code: "S",
      academic_year_id: "y",
      assignment_role: "primary",
      status: "deleted",
      updated_at: "2026-08-26T08:00:00.000Z",
    }).tombstone,
    true,
  );
});

