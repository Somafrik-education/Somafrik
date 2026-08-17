"use strict";

/**
 * Preuve repository Classes métier (mémoire JS) :
 * create structurel → list → update status → isolation inter-établissements.
 */
const assert = require("node:assert/strict");
const { createClassesRepository } = require("../db/classesRepository");

function createMemoryDb() {
  const schools = [
    { id: "school-a", school_code: "SCH-A", country_id: "country-a" },
    { id: "school-b", school_code: "SCH-B", country_id: "country-b" },
  ];
  const years = [
    { id: "ay-a", school_id: "school-a", name: "2025-2026" },
    { id: "ay-b", school_id: "school-b", name: "2025-2026" },
  ];
  const levels = [
    { id: "level-a", country_id: "country-a", name: "6ème", status: "active" },
    { id: "level-b", country_id: "country-b", name: "5ème", status: "active" },
  ];
  const schoolLevels = [
    { school_id: "school-a", level_id: "level-a", status: "active" },
    { school_id: "school-b", level_id: "level-b", status: "active" },
  ];
  const streams = [
    { id: "stream-a", country_id: "country-a", name: "Générale", level_id: null, status: "active" },
  ];
  const schoolStreams = [{ school_id: "school-a", stream_id: "stream-a", status: "active" }];
  const groups = [
    { id: "group-a", country_id: "country-a", group_code: "A", name: "A", status: "active" },
    { id: "group-a2", country_id: "country-a", group_code: "B", name: "B", status: "active" },
    { id: "group-b", country_id: "country-b", group_code: "A", name: "A", status: "active" },
  ];
  const schoolGroups = [
    { school_id: "school-a", group_id: "group-a", status: "active" },
    { school_id: "school-a", group_id: "group-a2", status: "active" },
    { school_id: "school-b", group_id: "group-b", status: "active" },
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
        return years.find((row) => row.school_id === params[0] && String(row.id) === String(params[1])) ?? null;
      }
      if (text.includes("FROM EDUCATION_LEVELS EL")) {
        const level = levels.find((row) => row.id === params[1]);
        if (!level) return null;
        const activation = schoolLevels.find((row) => row.school_id === params[0] && row.level_id === level.id);
        return {
          ...level,
          level_status: level.status,
          school_status: activation?.status ?? null,
        };
      }
      if (text.includes("FROM EDUCATION_STREAMS ES")) {
        const stream = streams.find((row) => row.id === params[1]);
        if (!stream) return null;
        const activation = schoolStreams.find((row) => row.school_id === params[0] && row.stream_id === stream.id);
        return {
          ...stream,
          stream_status: stream.status,
          school_status: activation?.status ?? null,
        };
      }
      if (text.includes("FROM EDUCATION_CLASS_GROUPS EG")) {
        const group = groups.find((row) => row.id === params[1]);
        if (!group) return null;
        const activation = schoolGroups.find((row) => row.school_id === params[0] && row.group_id === group.id);
        return {
          ...group,
          group_status: group.status,
          school_status: activation?.status ?? null,
        };
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
          level_id: params[7],
          stream_id: params[8],
          group_id: params[9],
          group_code: params[10],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (
          classes.some(
            (item) =>
              item.school_id === row.school_id &&
              item.academic_year_id === row.academic_year_id &&
              item.level_id === row.level_id &&
              (item.stream_id || null) === (row.stream_id || null) &&
              String(item.group_id) === String(row.group_id),
          )
        ) {
          const error = new Error(
            'duplicate key value violates unique constraint "uq_classes_structural_offering"',
          );
          error.code = "23505";
          error.constraint = "uq_classes_structural_offering";
          throw error;
        }
        if (classes.some((item) => item.class_code === row.class_code)) {
          const error = new Error(
            'duplicate key value violates unique constraint "classes_class_code_key"',
          );
          error.code = "23505";
          error.constraint = "classes_class_code_key";
          error.detail = `Key (class_code)=(${row.class_code}) already exists.`;
          throw error;
        }
        classes.push(row);
        return row;
      }
      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE")) {
        const row = classes.find((item) => item.class_code === params[0] && item.school_id === params[1]);
        if (!row) return null;
        const school = schools.find((item) => item.id === row.school_id);
        const year = years.find((item) => item.id === row.academic_year_id);
        const level = levels.find((item) => item.id === row.level_id);
        const stream = streams.find((item) => item.id === row.stream_id);
        return {
          ...row,
          school_code: school?.school_code,
          academic_year_name: year?.name,
          level_name: level?.name,
          stream_name: stream?.name ?? null,
        };
      }
      if (text.startsWith("UPDATE CLASSES")) {
        const row = classes.find((item) => item.class_code === params[8] && item.school_id === params[9]);
        if (!row) return null;
        row.name = params[0];
        row.level = params[1];
        row.section = params[2];
        row.status = params[3];
        row.level_id = params[4];
        row.stream_id = params[5];
        row.group_id = params[6];
        row.group_code = params[7];
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
            const level = levels.find((item) => item.id === row.level_id);
            const stream = streams.find((item) => item.id === row.stream_id);
            return {
              ...row,
              school_code: school?.school_code,
              academic_year_name: year?.name,
              level_name: level?.name,
              stream_name: stream?.name ?? null,
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
      academicYearId: "ay-a",
      levelId: "level-a",
      streamId: "stream-a",
      groupId: "group-a",
      status: "active",
    },
    "SCH-A",
  );
  assert.equal(created.schoolCode, "SCH-A");
  assert.equal(created.name, "6ème Générale");
  assert.equal(created.groupCode, "A");
  assert.equal(created.track, "Générale");
  assert.match(created.classCode, /^CLS-/);
  assert.equal(created.status, "active");

  const sameNameOtherGroup = await repo.create(
    {
      academicYearId: "ay-a",
      levelId: "level-a",
      streamId: "stream-a",
      groupId: "group-a2",
      status: "active",
    },
    "SCH-A",
  );
  assert.equal(sameNameOtherGroup.name, created.name);
  assert.equal(sameNameOtherGroup.groupCode, "B");
  assert.notEqual(sameNameOtherGroup.classCode, created.classCode);

  const listed = await repo.listBySchoolCode("SCH-A");
  assert.equal(listed.length, 2);
  assert.ok(listed.some((row) => row.classCode === created.classCode));
  assert.ok(listed.some((row) => row.classCode === sameNameOtherGroup.classCode));

  const otherSchoolList = await repo.listBySchoolCode("SCH-B");
  assert.equal(otherSchoolList.length, 0);

  await assert.rejects(
    () =>
      repo.create(
        {
          academicYearId: "ay-a",
          levelId: "level-a",
          streamId: "stream-a",
          groupId: "group-a",
          status: "active",
        },
        "SCH-A",
      ),
    (error) => error.statusCode === 409,
  );

  const updated = await repo.update(created.classCode, "SCH-A", { status: "inactive" });
  assert.equal(updated.status, "inactive");
  assert.equal(updated.name, "6ème Générale");

  await assert.rejects(
    () => repo.update(created.classCode, "SCH-B", { status: "active" }),
    (error) => error.statusCode === 404,
  );

  await assert.rejects(
    () =>
      repo.create(
        {
          name: "Inventé",
          academicYearName: "2025-2026",
          level: "X",
        },
        "SCH-A",
      ),
    (error) => error.statusCode === 400,
  );

  console.log("classesRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
