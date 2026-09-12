"use strict";

/**
 * Preuve repository — professeur principal (mémoire JS) :
 * liste candidats même établissement, affectation, remplacement, retrait,
 * refus hors tenant, classe inactive, enseignant inactif.
 */
const assert = require("node:assert/strict");
const { createClassHeadTeachersRepository } = require("../db/classHeadTeachersRepository");
const { HEAD_TEACHER_ERROR } = require("./classHeadTeachersManagement");

function createMemoryDb() {
  const schools = [
    { id: "school-a", school_code: "SCH-A" },
    { id: "school-b", school_code: "SCH-B" },
  ];
  const years = [{ id: "ay-a", school_id: "school-a", name: "2025-2026" }];
  const classes = [
    {
      id: "class-1",
      school_id: "school-a",
      class_code: "CLS-A",
      name: "6ème A",
      status: "active",
      academic_year_id: "ay-a",
      level: "6ème",
      group_code: "A",
    },
    {
      id: "class-2",
      school_id: "school-a",
      class_code: "CLS-B",
      name: "5ème B",
      status: "active",
      academic_year_id: "ay-a",
      level: "5ème",
      group_code: "B",
    },
    {
      id: "class-off",
      school_id: "school-a",
      class_code: "CLS-OFF",
      name: "4ème Z",
      status: "inactive",
      academic_year_id: "ay-a",
      level: "4ème",
      group_code: "Z",
    },
  ];
  const teachers = [
    {
      id: "teacher-1",
      school_id: "school-a",
      teacher_code: "SCH-A-ENS-0001",
      status: "active",
      first_name: "Awa",
      last_name: "Diop",
      user_status: "active",
    },
    {
      id: "teacher-2",
      school_id: "school-a",
      teacher_code: "SCH-A-ENS-0002",
      status: "active",
      first_name: "Moussa",
      last_name: "Ba",
      user_status: "active",
    },
    {
      id: "teacher-off",
      school_id: "school-a",
      teacher_code: "SCH-A-ENS-0099",
      status: "archived",
      first_name: "Archivé",
      last_name: "Test",
      user_status: "archived",
    },
    {
      id: "teacher-x",
      school_id: "school-b",
      teacher_code: "SCH-B-ENS-0001",
      status: "active",
      first_name: "Cross",
      last_name: "Tenant",
      user_status: "active",
    },
  ];
  /** @type {any[]} */
  const assignments = [];
  let seq = 1;
  const nextId = () => `ht-${seq++}`;

  function sqlClassRow(row) {
    const active = assignments.find((item) => item.class_id === row.id && item.status === "active");
    const teacher = active ? teachers.find((item) => item.id === active.teacher_id) : null;
    const school = schools.find((item) => item.id === row.school_id);
    const year = years.find((item) => item.id === row.academic_year_id);
    return {
      ...row,
      school_code: school?.school_code,
      academic_year_name: year?.name,
      level_name: row.level,
      stream_name: "",
      enrollment_count: 0,
      head_teacher_code: teacher?.teacher_code ?? null,
      head_teacher_status: teacher?.status ?? null,
      head_teacher_first_name: teacher?.first_name ?? null,
      head_teacher_last_name: teacher?.last_name ?? null,
    };
  }

  return {
    async getSchoolByCode(code) {
      return schools.find((row) => row.school_code === String(code).trim().toUpperCase()) ?? null;
    },
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE")) {
        const row = classes.find((item) => item.class_code === params[0] && item.school_id === params[1]);
        if (!row) return null;
        if (text.includes("CLASS_HEAD_TEACHERS") || text.includes("ENROLLMENT_COUNT")) {
          return sqlClassRow(row);
        }
        return row;
      }
      if (text.includes("FROM CLASSES CL") && text.includes("WHERE CL.CLASS_CODE = $1 AND CL.SCHOOL_ID")) {
        return classes.find((item) => item.class_code === params[0] && item.school_id === params[1]) ?? null;
      }
      if (text.startsWith("SELECT CL.ID") && text.includes("FROM CLASSES CL")) {
        return classes.find((item) => item.class_code === params[0] && item.school_id === params[1]) ?? null;
      }
      if (text.includes("FROM TEACHERS T") && text.includes("LIMIT 1")) {
        return (
          teachers.find(
            (row) => row.teacher_code === params[0] || row.id === params[0],
          ) ?? null
        );
      }
      if (text.includes("FROM CLASS_HEAD_TEACHERS") && text.includes("STATUS = 'ACTIVE'")) {
        return assignments.find((row) => row.class_id === params[0] && row.status === "active") ?? null;
      }
      if (text.startsWith("UPDATE CLASS_HEAD_TEACHERS")) {
        const row = assignments.find((item) => item.id === params[0]);
        if (!row) return null;
        row.status = "inactive";
        row.ended_at = new Date().toISOString();
        return row;
      }
      if (text.startsWith("INSERT INTO CLASS_HEAD_TEACHERS")) {
        const row = {
          id: nextId(),
          school_id: params[0],
          class_id: params[1],
          teacher_id: params[2],
          academic_year_id: params[3],
          status: "active",
        };
        assignments.push(row);
        return row;
      }
      throw new Error(`Unhandled one(): ${text}`);
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM TEACHERS T") && text.includes("T.SCHOOL_ID = $1")) {
        const schoolId = params[0];
        const classId = params[1];
        const search = params[2] ? String(params[2]).replace(/%/g, "").toLowerCase() : "";
        return teachers
          .filter((teacher) => teacher.school_id === schoolId)
          .filter((teacher) => teacher.status === "active" && teacher.user_status === "active")
          .filter((teacher) => {
            if (!search) return true;
            return `${teacher.first_name} ${teacher.last_name} ${teacher.teacher_code}`
              .toLowerCase()
              .includes(search);
          })
          .map((teacher) => {
            const other = assignments.filter(
              (item) =>
                item.teacher_id === teacher.id &&
                item.status === "active" &&
                item.class_id !== classId,
            );
            return {
              teacher_code: teacher.teacher_code,
              status: teacher.status,
              first_name: teacher.first_name,
              last_name: teacher.last_name,
              assigned_to_current_class: assignments.some(
                (item) =>
                  item.teacher_id === teacher.id &&
                  item.status === "active" &&
                  item.class_id === classId,
              ),
              other_class_names: other.map(
                (item) => classes.find((cls) => cls.id === item.class_id)?.name,
              ),
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
  const repo = createClassHeadTeachersRepository(db);

  const candidates = await repo.listCandidates("CLS-A", "SCH-A");
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((row) => row.teacherCode.startsWith("SCH-A-")));
  assert.ok(!candidates.some((row) => row.teacherCode === "SCH-B-ENS-0001"));
  assert.ok(!candidates.some((row) => row.teacherCode === "SCH-A-ENS-0099"));
  assert.equal(candidates[0].displayName, "Awa DIOP");

  const assigned = await repo.assign("CLS-A", "SCH-A", { teacherCode: "SCH-A-ENS-0001" });
  assert.equal(assigned.headTeacherDisplayName, "Awa DIOP");
  assert.equal(assigned.teacherId, "SCH-A-ENS-0001");
  assert.equal(assigned.teacher, "Awa DIOP");

  const listedAfter = await repo.listCandidates("CLS-B", "SCH-A");
  const awaOnB = listedAfter.find((row) => row.teacherCode === "SCH-A-ENS-0001");
  assert.equal(awaOnB.alreadyHeadTeacherHint, "Déjà professeur principal de 6ème A");

  const replaced = await repo.assign("CLS-A", "SCH-A", { teacherCode: "SCH-A-ENS-0002" });
  assert.equal(replaced.headTeacherDisplayName, "Moussa BA");
  assert.equal(replaced.teacherId, "SCH-A-ENS-0002");

  const removed = await repo.remove("CLS-A", "SCH-A");
  assert.equal(removed.headTeacher, null);
  assert.equal(removed.teacher, "Non assigné");

  await assert.rejects(
    () => repo.assign("CLS-A", "SCH-A", { teacherCode: "SCH-B-ENS-0001" }),
    (error) => error.statusCode === 403 && error.code === HEAD_TEACHER_ERROR.TEACHER_OTHER_SCHOOL,
  );

  await assert.rejects(
    () => repo.assign("CLS-OFF", "SCH-A", { teacherCode: "SCH-A-ENS-0001" }),
    (error) => error.statusCode === 409 && error.code === HEAD_TEACHER_ERROR.CLASS_INACTIVE,
  );

  await assert.rejects(
    () => repo.assign("CLS-A", "SCH-A", { teacherCode: "SCH-A-ENS-0099" }),
    (error) => error.statusCode === 409 && error.code === HEAD_TEACHER_ERROR.TEACHER_INACTIVE,
  );

  await assert.rejects(
    () => repo.assign("CLS-A", "SCH-A", { teacherCode: "SCH-A-ENS-0001", schoolCode: "SCH-B" }),
    (error) => error.statusCode === 400 && error.code === HEAD_TEACHER_ERROR.TENANT_FIELD_FORBIDDEN,
  );

  console.log("classHeadTeachersRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
