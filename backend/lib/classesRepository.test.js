"use strict";

/**
 * Preuve repository Classes métier :
 * create → list → update → isolation inter-établissements.
 */
const assert = require("node:assert/strict");
const { createClassesRepository } = require("../db/classesRepository");

function createMemoryDb() {
  const schools = [
    { id: "school-a", school_code: "SCH-A" },
    { id: "school-b", school_code: "SCH-B" },
  ];
  const years = [
    { id: "ay-a", school_id: "school-a", name: "2025-2026" },
    { id: "ay-b", school_id: "school-b", name: "2025-2026" },
  ];
  /** @type {any[]} */
  const classes = [];
  /** @type {any[]} */
  const enrollments = [];
  let seq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

  return {
    async getSchoolByCode(code) {
      return schools.find((row) => row.school_code === String(code).trim().toUpperCase()) ?? null;
    },
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("SELECT ID, NAME FROM ACADEMIC_YEARS")) {
        return (
          years.find((row) => row.school_id === params[0] && row.name === params[1]) ?? null
        );
      }
      if (text.startsWith("SELECT CLASS_CODE FROM CLASSES")) {
        const found = classes.find(
          (row) =>
            row.school_id === params[0] &&
            row.academic_year_id === params[1] &&
            String(row.name).trim().toLowerCase() === String(params[2]).trim().toLowerCase() &&
            (params[3] == null || row.class_code !== params[3]),
        );
        return found ? { class_code: found.class_code } : null;
      }
      if (text.startsWith("INSERT INTO CLASSES")) {
        const row = {
          id: nextId(),
          school_id: params[0],
          academic_year_id: params[1],
          class_code: params[2],
          name: params[3],
          level: params[4],
          section: params[5],
          status: params[6],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (classes.some((item) => item.class_code === row.class_code)) {
          const error = new Error("duplicate");
          error.code = "23505";
          throw error;
        }
        classes.push(row);
        return row;
      }
      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE")) {
        const row = classes.find((item) => item.class_code === params[0]);
        if (!row) return null;
        const school = schools.find((item) => item.id === row.school_id);
        const year = years.find((item) => item.id === row.academic_year_id);
        return {
          ...row,
          school_code: school?.school_code,
          academic_year_name: year?.name,
        };
      }
      if (text.startsWith("UPDATE CLASSES")) {
        const row = classes.find(
          (item) => item.class_code === params[4] && item.school_id === params[5],
        );
        if (!row) return null;
        row.name = params[0];
        row.level = params[1];
        row.section = params[2];
        row.status = params[3];
        row.updated_at = new Date().toISOString();
        return { ...row };
      }
      if (text.startsWith("SELECT COUNT(*)::INT AS ENROLLMENT_COUNT")) {
        return {
          enrollment_count: enrollments.filter(
            (item) => item.class_id === params[0] && item.status === "active",
          ).length,
        };
      }
      throw new Error(`Unhandled one(): ${text}`);
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.SCHOOL_ID")) {
        return classes
          .filter((row) => row.school_id === params[0])
          .map((row) => {
            const school = schools.find((item) => item.id === row.school_id);
            const year = years.find((item) => item.id === row.academic_year_id);
            return {
              ...row,
              school_code: school?.school_code,
              academic_year_name: year?.name,
              enrollment_count: enrollments.filter(
                (item) => item.class_id === row.id && item.status === "active",
              ).length,
            };
          });
      }
      throw new Error(`Unhandled all(): ${text}`);
    },
    async query() {
      return { rows: [] };
    },
  };
}

async function main() {
  const db = createMemoryDb();
  const repo = createClassesRepository(db);

  const created = await repo.create(
    {
      name: "6ème A",
      academicYearName: "2025-2026",
      level: "6ème",
      section: "A",
      status: "active",
    },
    "SCH-A",
  );
  assert.equal(created.schoolCode, "SCH-A");
  assert.equal(created.name, "6ème A");
  assert.match(created.classCode, /^CLS-/);
  assert.equal(created.status, "active");

  const listed = await repo.listBySchoolCode("SCH-A");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].classCode, created.classCode);

  const otherSchoolList = await repo.listBySchoolCode("SCH-B");
  assert.equal(otherSchoolList.length, 0);

  await assert.rejects(
    () =>
      repo.create(
        {
          name: "6ème A",
          academicYearName: "2025-2026",
          status: "active",
        },
        "SCH-A",
      ),
    (error) => error.statusCode === 409,
  );

  const updated = await repo.update(created.classCode, "SCH-A", {
    name: "6ème A Bis",
    status: "inactive",
  });
  assert.equal(updated.name, "6ème A Bis");
  assert.equal(updated.status, "inactive");

  await assert.rejects(
    () => repo.update(created.classCode, "SCH-B", { name: "Hack" }),
    (error) => error.statusCode === 403,
  );

  console.log("classesRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
