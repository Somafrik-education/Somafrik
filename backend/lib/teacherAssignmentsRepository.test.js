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
  const schoolCourses = [
    {
      id: "course-1",
      school_id: "school-1",
      class_id: "class-1",
      subject_id: "subject-1",
      teacher_id: null,
      status: "active",
    },
  ];

  function mapped(row) {
    if (!row) return null;
    const school = [...schools.values()].find((item) => item.id === row.school_id);
    const teacher = teachers.find((item) => item.id === row.teacher_id);
    const schoolClass = classes.find((item) => item.id === row.class_id);
    const subject = subjects.find((item) => item.id === row.subject_id);
    return {
      ...row,
      school_code: school?.school_code,
      teacher_code: teacher?.teacher_code,
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
      if (text.startsWith("SELECT T.ID, T.TEACHER_CODE")) {
        return teachers.find(
          (row) =>
            row.school_id === params[0] &&
            [row.id, row.teacher_code].includes(String(params[1])) &&
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
      if (text.startsWith("SELECT TA.ID, T.TEACHER_CODE")) {
        const conflict = assignments.find(
          (row) =>
            row.school_id === params[0] &&
            row.class_id === params[1] &&
            row.subject_id === params[2] &&
            row.academic_year_id === params[3] &&
            row.status === "active" &&
            (!params[4] || String(row.id) !== String(params[4])),
        );
        return conflict ? { id: conflict.id, teacher_code: mapped(conflict).teacher_code } : null;
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
      if (text.startsWith("SELECT ID FROM TEACHER_ASSIGNMENTS")) {
        return assignments.find(
          (row) =>
            row.school_id === params[0] &&
            row.class_id === params[1] &&
            row.subject_id === params[2] &&
            row.status === "active",
        ) ?? null;
      }
      if (text.startsWith("UPDATE SCHOOL_COURSES SET TEACHER_ID = NULL")) {
        const row = schoolCourses.find(
          (item) =>
            item.school_id === params[0] &&
            item.class_id === params[1] &&
            item.subject_id === params[2] &&
            item.status === "active" &&
            item.teacher_id === params[3],
        );
        if (!row) return null;
        row.teacher_id = null;
        return { id: row.id };
      }
      if (text.startsWith("UPDATE SCHOOL_COURSES SET TEACHER_ID =")) {
        const row = schoolCourses.find((item) => item.id === params[0] && item.status === "active");
        if (!row) return null;
        const target = params[1];
        const replaceable = params[2];
        if (
          row.teacher_id != null &&
          row.teacher_id !== target &&
          (!replaceable || row.teacher_id !== replaceable)
        ) {
          return null;
        }
        row.teacher_id = target;
        return { id: row.id };
      }
      return null;
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("SELECT ID, TEACHER_ID FROM SCHOOL_COURSES")) {
        return schoolCourses
          .filter(
            (row) =>
              row.school_id === params[0] &&
              row.class_id === params[1] &&
              row.subject_id === params[2] &&
              row.status === "active",
          )
          .map((row) => ({ id: row.id, teacher_id: row.teacher_id }));
      }
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
      const assignmentSnapshot = assignments.map((row) => ({ ...row }));
      const schoolCourseSnapshot = schoolCourses.map((row) => ({ ...row }));
      try {
        return await fn(adapter);
      } catch (error) {
        assignments.length = 0;
        assignments.push(...assignmentSnapshot);
        schoolCourses.length = 0;
        schoolCourses.push(...schoolCourseSnapshot);
        throw error;
      }
    },
    __schoolCourses: schoolCourses,
  };
  return adapter;
}

test("CRUD affectation, conflit et isolation établissement", async () => {
  const adapter = createMemoryAdapter();
  const repo = createTeacherAssignmentsRepository(adapter);
  const created = await repo.create(
    { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
    "CD-2026-0001",
  );
  assert.equal(created.teacherName, "Awa Diop");
  assert.equal(adapter.__schoolCourses[0].teacher_id, "teacher-1");
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
  assert.equal(adapter.__schoolCourses[0].teacher_id, "teacher-2");
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
  assert.equal(adapter.__schoolCourses[0].teacher_id, null);
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 0);
  const recreated = await repo.create(
    { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
    "CD-2026-0001",
  );
  assert.notEqual(recreated.id, created.id);
  assert.equal(adapter.__schoolCourses[0].teacher_id, "teacher-1");
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

test("refuse d'écraser un school_course déjà lié à un tiers", async () => {
  const adapter = createMemoryAdapter();
  adapter.__schoolCourses[0].teacher_id = "teacher-2";
  const repo = createTeacherAssignmentsRepository(adapter);

  await assert.rejects(
    () =>
      repo.create(
        { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
        "CD-2026-0001",
      ),
    (error) =>
      error.statusCode === 409 &&
      error.code === "ASSIGNMENT_SCHOOL_COURSE_CONFLICT",
  );
  assert.equal(adapter.__schoolCourses[0].teacher_id, "teacher-2");
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 0);
});


test("PG: create/update/delete convergent avec school_courses sans écraser un tiers", { skip: !process.env.DATABASE_URL }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const ids = {
    school: "10000000-0000-0000-0000-000000000001",
    year: "10000000-0000-0000-0000-000000000002",
    klass: "10000000-0000-0000-0000-000000000003",
    subject: "10000000-0000-0000-0000-000000000004",
    user1: "10000000-0000-0000-0000-000000000005",
    user2: "10000000-0000-0000-0000-000000000006",
    teacher1: "10000000-0000-0000-0000-000000000007",
    teacher2: "10000000-0000-0000-0000-000000000008",
    course: "10000000-0000-0000-0000-000000000009",
  };

  try {
    await client.query("BEGIN");
    await client.query(String.raw\`
      CREATE TEMP TABLE schools (
        id uuid PRIMARY KEY,
        school_code text NOT NULL
      );
      CREATE TEMP TABLE users (
        id uuid PRIMARY KEY,
        school_id uuid,
        first_name text,
        last_name text,
        status text
      );
      CREATE TEMP TABLE academic_years (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        name text,
        status text
      );
      CREATE TEMP TABLE classes (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        academic_year_id uuid NOT NULL,
        class_code text,
        name text,
        status text
      );
      CREATE TEMP TABLE subjects (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        subject_code text,
        name text,
        status text
      );
      CREATE TEMP TABLE teachers (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        user_id uuid,
        teacher_code text,
        status text
      );
      CREATE TEMP TABLE teacher_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id uuid NOT NULL,
        teacher_id uuid NOT NULL,
        class_id uuid NOT NULL,
        subject_id uuid NOT NULL,
        academic_year_id uuid NOT NULL,
        assignment_role text,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE school_courses (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        class_id uuid NOT NULL,
        subject_id uuid NOT NULL,
        teacher_id uuid,
        status text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    \`);

    await client.query(
      "INSERT INTO schools (id, school_code) VALUES ($1, 'CD-2026-0001')",
      [ids.school],
    );
    await client.query(
      "INSERT INTO academic_years (id, school_id, name, status) VALUES ($1,$2,'2026-2027','open')",
      [ids.year, ids.school],
    );
    await client.query(
      "INSERT INTO classes (id, school_id, academic_year_id, class_code, name, status) VALUES ($1,$2,$3,'CLS-6A','6ème A','active')",
      [ids.klass, ids.school, ids.year],
    );
    await client.query(
      "INSERT INTO subjects (id, school_id, subject_code, name, status) VALUES ($1,$2,'SUB-MATH','Mathématiques','active')",
      [ids.subject, ids.school],
    );
    await client.query(
      "INSERT INTO users (id, school_id, first_name, last_name, status) VALUES ($1,$3,'Awa','Diop','active'),($2,$3,'Moussa','Ba','active')",
      [ids.user1, ids.user2, ids.school],
    );
    await client.query(
      "INSERT INTO teachers (id, school_id, user_id, teacher_code, status) VALUES ($1,$3,$4,'CD-2026-0001-ENS-0001','active'),($2,$3,$5,'CD-2026-0001-ENS-0002','active')",
      [ids.teacher1, ids.teacher2, ids.school, ids.user1, ids.user2],
    );
    await client.query(
      "INSERT INTO school_courses (id, school_id, class_id, subject_id, teacher_id, status) VALUES ($1,$2,$3,$4,NULL,'active')",
      [ids.course, ids.school, ids.klass, ids.subject],
    );

    const adapter = {
      query: (sql, params) => client.query(sql, params),
      one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
      all: async (sql, params) => (await client.query(sql, params)).rows,
      async getSchoolByCode(code) {
        return (await client.query(
          "SELECT id, school_code FROM schools WHERE school_code = $1 LIMIT 1",
          [String(code).toUpperCase()],
        )).rows[0] ?? null;
      },
      async withTransaction(fn) {
        return fn(adapter);
      },
    };
    const repository = createTeacherAssignmentsRepository(adapter);

    const created = await repository.create(
      { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
      "CD-2026-0001",
    );
    let course = (await client.query("SELECT teacher_id FROM school_courses WHERE id = $1", [ids.course])).rows[0];
    assert.equal(String(course.teacher_id), ids.teacher1);

    await repository.update(
      created.id,
      { teacherCode: "CD-2026-0001-ENS-0002" },
      "CD-2026-0001",
    );
    course = (await client.query("SELECT teacher_id FROM school_courses WHERE id = $1", [ids.course])).rows[0];
    assert.equal(String(course.teacher_id), ids.teacher2);

    await repository.remove(created.id, "CD-2026-0001");
    course = (await client.query("SELECT teacher_id FROM school_courses WHERE id = $1", [ids.course])).rows[0];
    assert.equal(course.teacher_id, null);

    await client.query("UPDATE school_courses SET teacher_id = $1 WHERE id = $2", [ids.teacher2, ids.course]);
    await assert.rejects(
      () =>
        repository.create(
          { teacherCode: "CD-2026-0001-ENS-0001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
          "CD-2026-0001",
        ),
      (error) =>
        error.statusCode === 409 &&
        error.code === "ASSIGNMENT_SCHOOL_COURSE_CONFLICT",
    );
    const activeAssignments = await client.query(
      "SELECT count(*)::int AS count FROM teacher_assignments WHERE status = 'active'",
    );
    assert.equal(activeAssignments.rows[0].count, 0);
    course = (await client.query("SELECT teacher_id FROM school_courses WHERE id = $1", [ids.course])).rows[0];
    assert.equal(String(course.teacher_id), ids.teacher2);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    client.release();
    await pool.end();
  }
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
  assert.doesNotMatch(l1, /LEFT JOIN users u ON u\.id = t\.user_id/);
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

