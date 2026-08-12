"use strict";

/**
 * Repository mémoire — inscription élève dans une classe.
 */
const assert = require("node:assert/strict");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");

function createMemoryDb() {
  const schools = [
    { id: "school-a", school_code: "SCH-A" },
    { id: "school-b", school_code: "SCH-B" },
  ];
  const years = [
    { id: "ay-a", school_id: "school-a", name: "2025-2026", status: "open" },
    { id: "ay-b", school_id: "school-b", name: "2025-2026", status: "open" },
  ];
  /** @type {any[]} */
  const classes = [];
  /** @type {any[]} */
  const students = [];
  /** @type {any[]} */
  const enrollments = [];
  let classSeq = 1;
  let studentSeq = 1;

  return {
    async getSchoolByCode(code) {
      return schools.find((row) => row.school_code === String(code).trim().toUpperCase()) ?? null;
    },
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();

      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE")) {
        const classCode = params[0];
        const schoolId = params[1];
        const row = classes.find((item) => item.class_code === classCode && item.school_id === schoolId);
        if (!row) return null;
        const year = years.find((item) => item.id === row.academic_year_id);
        return {
          ...row,
          school_code: schools.find((item) => item.id === schoolId)?.school_code,
          academic_year_name: year?.name,
          academic_year_status: year?.status,
        };
      }

      if (text.startsWith("SELECT STUDENT_CODE FROM STUDENTS")) {
        return students
          .filter((row) => row.school_id === params[0])
          .map((row) => ({ student_code: row.student_code }));
      }

      if (text.startsWith("INSERT INTO STUDENTS")) {
        const row = {
          id: `stu-${studentSeq++}`,
          school_id: params[0],
          student_code: params[1],
          first_name: params[2],
          last_name: params[3],
          gender: params[4],
          birth_date: params[5],
          parent_phone: params[6],
          parent_email: params[7],
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        students.push(row);
        return row;
      }

      if (text.startsWith("INSERT INTO ENROLLMENTS")) {
        const row = {
          id: `enr-${enrollments.length + 1}`,
          school_id: params[0],
          student_id: params[1],
          class_id: params[2],
          academic_year_id: params[3],
          enrollment_date: new Date().toISOString().slice(0, 10),
          status: "active",
        };
        enrollments.push(row);
        return { id: row.id, enrollment_date: row.enrollment_date };
      }

      if (text.includes("FROM STUDENTS ST") && text.includes("WHERE ST.STUDENT_CODE")) {
        const student = students.find(
          (row) => row.student_code === params[0] && row.school_id === params[1],
        );
        if (!student) return null;
        const enrollment = enrollments.find(
          (row) => row.student_id === student.id && row.status === "active",
        );
        const cls = classes.find((row) => row.id === enrollment?.class_id);
        const year = years.find((item) => item.id === enrollment?.academic_year_id);
        return {
          ...student,
          school_code: schools.find((item) => item.id === student.school_id)?.school_code,
          class_code: cls?.class_code,
          class_name: cls?.name,
          academic_year_name: year?.name,
          enrollment_id: enrollment?.id,
          enrollment_date: enrollment?.enrollment_date,
        };
      }

      throw new Error(`Unhandled one(): ${text}`);
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();

      if (text.startsWith("SELECT STUDENT_CODE FROM STUDENTS")) {
        return students
          .filter((row) => row.school_id === params[0])
          .map((row) => ({ student_code: row.student_code }));
      }

      if (text.includes("FROM ENROLLMENTS E") && text.includes("WHERE E.CLASS_ID")) {
        const classId = params[0];
        const schoolId = params[1];
        return enrollments
          .filter((row) => row.class_id === classId && row.status === "active")
          .map((enrollment) => {
            const student = students.find(
              (row) => row.id === enrollment.student_id && row.school_id === schoolId,
            );
            const cls = classes.find((row) => row.id === classId);
            const year = years.find((item) => item.id === enrollment.academic_year_id);
            if (!student) return null;
            return {
              ...student,
              school_code: schools.find((item) => item.id === schoolId)?.school_code,
              class_code: cls?.class_code,
              class_name: cls?.name,
              academic_year_name: year?.name,
              enrollment_id: enrollment.id,
              enrollment_date: enrollment.enrollment_date,
            };
          })
          .filter(Boolean);
      }

      throw new Error(`Unhandled all(): ${text}`);
    },
    async query() {
      return { rows: [] };
    },
    async withTransaction(fn) {
      return fn();
    },
    seedClass(schoolCode, overrides = {}) {
      const school = schools.find((row) => row.school_code === schoolCode);
      const year = years.find((row) => row.school_id === school.id);
      const classCode = overrides.class_code ?? `CLS-${schoolCode}-${classSeq++}`;
      const row = {
        id: `class-${classSeq}`,
        school_id: school.id,
        academic_year_id: year.id,
        class_code: classCode,
        name: overrides.name ?? "6ème A",
        status: overrides.status ?? "active",
      };
      classes.push(row);
      return row;
    },
    counts() {
      return { students: students.length, enrollments: enrollments.length };
    },
  };
}

async function main() {
  const db = createMemoryDb();
  const repo = createClassStudentsRepository(db);
  const activeClass = db.seedClass("SCH-A");
  const inactiveClass = db.seedClass("SCH-A", { name: "6ème B", status: "inactive" });
  db.seedClass("SCH-B", { name: "5ème A", class_code: "CLS-SCH-B-1" });

  const enrolled = await repo.enroll(activeClass.class_code, "SCH-A", {
    firstName: "Awa",
    lastName: "Diop",
    gender: "Féminin",
  });
  assert.match(enrolled.studentCode, /^ELE-SCH-A-/);
  assert.equal(enrolled.classCode, activeClass.class_code);
  assert.equal(enrolled.className, "6ème A");

  const listed = await repo.listByClassCode(activeClass.class_code, "SCH-A");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].studentCode, enrolled.studentCode);

  const fetched = await repo.getByStudentCode(enrolled.studentCode, "SCH-A");
  assert.equal(fetched.firstName, "Awa");

  await assert.rejects(
    () =>
      repo.enroll(inactiveClass.class_code, "SCH-A", {
        firstName: "Ibra",
        lastName: "Fall",
      }),
    (error) => error.statusCode === 409,
  );

  await assert.rejects(
    () =>
      repo.enroll(activeClass.class_code, "SCH-A", {
        firstName: "Hack",
        lastName: "Test",
        classCode: "CLS-SCH-B-1",
      }),
    (error) => error.statusCode === 403,
  );

  await assert.rejects(
    () => repo.listByClassCode(activeClass.class_code, "SCH-B"),
    (error) => error.statusCode === 404,
  );

  assert.equal(db.counts().students, 1);
  assert.equal(db.counts().enrollments, 1);

  console.log("classStudentsRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
