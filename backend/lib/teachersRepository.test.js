"use strict";

const assert = require("node:assert/strict");
const { createTeachersRepository } = require("../db/teachersRepository");
const { verifySecret } = require("../services/credentialService");

function createMemoryDb() {
  const schools = new Map([
    ["CD-2026-0001", { id: "school-1", school_code: "CD-2026-0001" }],
    ["CD-2026-0002", { id: "school-2", school_code: "CD-2026-0002" }],
  ]);
  const users = [];
  const teachers = [];

  const adapter = {
    async getSchoolByCode(code) {
      return schools.get(String(code).toUpperCase()) ?? null;
    },
    async one(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("INSERT INTO USERS")) {
        if (params[6] === "FORCE_USER_FAIL") {
          throw Object.assign(new Error("forced user failure"), { code: "FORCE_USER_FAIL" });
        }
        const row = {
          id: `u-${users.length + 1}`,
          school_id: params[0],
          user_code: params[1],
          first_name: params[2],
          last_name: params[3],
          email: params[4],
          phone: params[5],
          password_hash: params[6],
          pin_hash: params[6],
          must_change_password: true,
          birth_date: params[7],
          gender: params[8],
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.push(row);
        return { ...row };
      }
      if (text.startsWith("INSERT INTO TEACHERS")) {
        if (params[3] === "FORCE_TEACHER_FAIL") {
          throw Object.assign(new Error("forced teacher failure"), { code: "FORCE_TEACHER_FAIL" });
        }
        const clash = teachers.find((row) => row.user_id === params[1] && row.school_id === params[0]);
        if (clash) {
          throw Object.assign(new Error("unique school user"), {
            code: "23505",
            constraint: "teachers_school_user_unique",
          });
        }
        const row = {
          id: `t-${teachers.length + 1}`,
          school_id: params[0],
          user_id: params[1],
          teacher_code: params[2],
          speciality: params[3],
          hire_date: params[4],
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        teachers.push(row);
        return { ...row };
      }
      if (text.includes("FROM TEACHERS T") && text.includes("T.TEACHER_CODE") && text.includes("T.SCHOOL_ID")) {
        const teacher = teachers.find((row) => row.teacher_code === params[0] && row.school_id === params[1]);
        if (!teacher) return null;
        const user = users.find((row) => row.id === teacher.user_id);
        return {
          ...teacher,
          school_code: [...schools.values()].find((s) => s.id === teacher.school_id)?.school_code,
          first_name: user?.first_name,
          last_name: user?.last_name,
          email: user?.email,
          phone: user?.phone,
          birth_date: user?.birth_date,
          gender: user?.gender,
          must_change_password: user?.must_change_password,
        };
      }
      return null;
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.includes("FROM TEACHER_ASSIGNMENTS TA")) {
        return [];
      }
      if (text.includes("LEFT JOIN USERS") && text.includes("WHERE T.SCHOOL_ID")) {
        return teachers
          .filter((row) => row.school_id === params[0])
          .map((teacher) => {
            const user = users.find((row) => row.id === teacher.user_id);
            return {
              ...teacher,
              school_code: [...schools.values()].find((s) => s.id === teacher.school_id)?.school_code,
              first_name: user?.first_name,
              last_name: user?.last_name,
              email: user?.email,
              phone: user?.phone,
              birth_date: user?.birth_date,
              gender: user?.gender,
              must_change_password: user?.must_change_password,
            };
          });
      }
      if (text.includes("JOIN USERS U") && !text.includes("LEFT JOIN") && text.includes("WHERE T.SCHOOL_ID")) {
        return teachers
          .filter((row) => row.school_id === params[0])
          .map((teacher) => {
            const user = users.find((row) => row.id === teacher.user_id);
            return {
              teacher_code: teacher.teacher_code,
              first_name: user?.first_name,
              last_name: user?.last_name,
              birth_date: user?.birth_date,
              gender: user?.gender,
            };
          });
      }
      if (text.startsWith("SELECT TEACHER_CODE AS CODE")) {
        return teachers.filter((row) => row.school_id === params[0]).map((row) => ({ code: row.teacher_code }));
      }
      if (text.startsWith("SELECT USER_CODE AS CODE")) {
        return users.filter((row) => row.school_id === params[0]).map((row) => ({ code: row.user_code }));
      }
      return [];
    },
    async query() {
      return { rows: [] };
    },
    async withTransaction(fn) {
      if (!adapter._txChain) adapter._txChain = Promise.resolve();
      const run = adapter._txChain.then(async () => {
        const usersSnap = users.map((row) => ({ ...row }));
        const teachersSnap = teachers.map((row) => ({ ...row }));
        try {
          return await fn({
            one: (sql, params) => adapter.one(sql, params),
            all: (sql, params) => adapter.all(sql, params),
            query: (sql, params) => adapter.query(sql, params),
          });
        } catch (error) {
          users.length = 0;
          teachers.length = 0;
          users.push(...usersSnap);
          teachers.push(...teachersSnap);
          throw error;
        }
      });
      adapter._txChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    _users: users,
    _teachers: teachers,
  };
  return adapter;
}

async function main() {
  const db = createMemoryDb();
  const repo = createTeachersRepository(db);

  const created = await repo.create(
    {
      firstName: "Awa",
      lastName: "Diop",
      birthDate: "1990-04-12",
      phone: "+243 800",
      temporaryPassword: "TempPass1",
      speciality: "Mathématiques",
    },
    "CD-2026-0001",
  );
  assert.equal(created.identifier, "ENS-0001");
  assert.equal(created.teacherCode, "CD-2026-0001-ENS-0001");
  assert.equal(created.mustChangePassword, true);
  assert.equal(db._users.length, 1);
  assert.equal(db._teachers.length, 1);
  assert.ok(verifySecret("TempPass1", db._users[0].password_hash));
  assert.notEqual(db._users[0].password_hash, "TempPass1");

  const reread = await repo.getByTeacherCode(created.teacherCode, "CD-2026-0001");
  assert.equal(reread.firstName, "Awa");
  assert.equal(reread.lastName, "Diop");

  const listed = await repo.listBySchoolCode("CD-2026-0001");
  assert.equal(listed.length, 1);

  // Homonyme (même nom, autre date) accepté
  const homonym = await repo.create(
    {
      firstName: "Awa",
      lastName: "Diop",
      birthDate: "1988-01-01",
      email: "awa2@example.com",
      temporaryPassword: "TempPass2",
    },
    "CD-2026-0001",
  );
  assert.equal(homonym.identifier, "ENS-0002");

  // Identité exacte → ambiguïté
  await assert.rejects(
    () =>
      repo.create(
        {
          firstName: "Awa",
          lastName: "Diop",
          birthDate: "1990-04-12",
          phone: "+243 801",
          temporaryPassword: "TempPass3",
        },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 409 && error.code === "TEACHER_CANON_AMBIGUOUS",
  );

  // Isolation établissement
  const other = await repo.create(
    {
      firstName: "Awa",
      lastName: "Diop",
      birthDate: "1990-04-12",
      phone: "+243 802",
      temporaryPassword: "TempPass4",
    },
    "CD-2026-0002",
  );
  assert.equal(other.schoolCode, "CD-2026-0002");
  assert.equal((await repo.listBySchoolCode("CD-2026-0001")).length, 2);
  assert.equal((await repo.listBySchoolCode("CD-2026-0002")).length, 1);

  // Rollback si fiche échoue après compte
  const beforeUsers = db._users.length;
  const beforeTeachers = db._teachers.length;
  await assert.rejects(
    () =>
      repo.create(
        {
          firstName: "Rollback",
          lastName: "Teacher",
          birthDate: "1985-01-01",
          phone: "+243 803",
          temporaryPassword: "TempPass5",
          speciality: "FORCE_TEACHER_FAIL",
        },
        "CD-2026-0001",
      ),
    (error) => error.code === "FORCE_TEACHER_FAIL",
  );
  assert.equal(db._users.length, beforeUsers);
  assert.equal(db._teachers.length, beforeTeachers);

  // Falsification tenant / champs techniques
  await assert.rejects(
    () =>
      repo.create(
        {
          firstName: "Hack",
          lastName: "Tenant",
          birthDate: "1985-01-01",
          phone: "+243 804",
          temporaryPassword: "TempPass6",
          schoolCode: "CD-2026-0002",
        },
        "CD-2026-0001",
      ),
    (error) => error.statusCode === 400,
  );

  // Course identité (sérialisée mémoire) : 1 OK + 1 TEACHER_CANON_AMBIGUOUS
  const raced = await Promise.allSettled([
    repo.create(
      {
        firstName: "Race",
        lastName: "Identity",
        birthDate: "1983-03-03",
        phone: "+243 805",
        temporaryPassword: "TempPass7",
      },
      "CD-2026-0001",
    ),
    repo.create(
      {
        firstName: "Race",
        lastName: "Identity",
        birthDate: "1983-03-03",
        phone: "+243 806",
        temporaryPassword: "TempPass8",
      },
      "CD-2026-0001",
    ),
  ]);
  assert.equal(raced.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(raced.filter((item) => item.status === "rejected").length, 1);
  assert.equal(
    raced.find((item) => item.status === "rejected").reason.code,
    "TEACHER_CANON_AMBIGUOUS",
  );

  console.log("teachersRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
