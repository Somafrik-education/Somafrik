"use strict";

/**
 * Repository mémoire — inscription élève + fiche/annuaire PostgreSQL.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createClassStudentsRepository } = require("../db/classStudentsRepository");
const { generateTemporarySecret, hashSecret, verifySecret } = require("../services/credentialService");

function createMemoryDb() {
  const schools = [
    { id: "school-a", school_code: "CD-2026-0001", name: "Institut Nuru", login_code: "CD-IN-26-001" },
    { id: "school-b", school_code: "CD-2026-0002", name: "Lycée Lumumba", login_code: "CD-LL-26-001" },
    { id: "school-bi", school_code: "BI-2026-0001", name: "Lycée Bujumbura", login_code: "BI-LB-26-001" },
  ];
  const years = [
    { id: "ay-a", school_id: "school-a", name: "2025-2026", status: "open" },
    { id: "ay-b", school_id: "school-b", name: "2025-2026", status: "open" },
    { id: "ay-bi", school_id: "school-bi", name: "2025-2026", status: "open" },
  ];
  /** @type {any[]} */
  const classes = [];
  /** @type {any[]} */
  const students = [];
  /** @type {any[]} */
  const enrollments = [];
  /** @type {any[]} */
  const documents = [];
  /** @type {any[]} */
  const users = [];
  let classSeq = 1;
  let studentSeq = 1;

  function joinActiveEnrollment(student) {
    const enrollment = enrollments.find(
      (row) => row.student_id === student.id && row.status === "active",
    );
    const cls = classes.find((row) => row.id === enrollment?.class_id);
    const year = years.find((item) => item.id === enrollment?.academic_year_id);
    return {
      ...student,
      student_uuid: student.id,
      school_code: schools.find((item) => item.id === student.school_id)?.school_code,
      class_code: cls?.class_code,
      class_name: cls?.name,
      academic_year_name: year?.name,
      enrollment_id: enrollment?.id,
      enrollment_date: enrollment?.enrollment_date,
    };
  }

  const memory = {
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
        const rows = !params.length
          ? students
          : students.filter((row) => row.school_id === params[0]);
        return rows.map((row) => ({ student_code: row.student_code }));
      }

      if (text.startsWith("INSERT INTO STUDENTS")) {
        const school = schools.find((row) => row.id === params[0]);
        const { assignCanonicalStudentCode } = require("./studentCodeAllocation");
        const studentCode = assignCanonicalStudentCode(
          school,
          students.map((row) => row.student_code),
          params[1],
        );
        const row = {
          id: `stu-${studentSeq++}`,
          school_id: params[0],
          student_code: studentCode,
          login_code: studentCode,
          identity_code: studentCode,
          first_name: params[2],
          last_name: params[3],
          gender: params[4],
          birth_date: params[5],
          birth_place: "",
          photo_url: "",
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        enrollments.push(row);
        return { id: row.id, enrollment_date: row.enrollment_date };
      }

      if (text.includes("FROM STUDENTS ST") && text.includes("WHERE ST.STUDENT_CODE") && text.includes("LIMIT 1")) {
        const student = students.find(
          (row) => row.student_code === params[0] && row.school_id === params[1],
        );
        if (!student) return null;
        return joinActiveEnrollment(student);
      }

      if (text.includes("SELECT ST.ID, ST.STUDENT_CODE") && text.includes("FROM STUDENTS ST")) {
        const student = students.find(
          (row) => row.student_code === params[0] && row.school_id === params[1],
        );
        return student ?? null;
      }

      if (text.startsWith("UPDATE STUDENTS")) {
        const student = students.find((row) => row.id === params[7] && row.school_id === params[8]);
        if (!student) return null;
        if (String(student.updated_at) !== String(params[9])) return null;
        student.first_name = params[0];
        student.last_name = params[1];
        student.gender = params[2];
        student.birth_date = params[3];
        student.birth_place = params[4];
        student.parent_phone = params[5];
        student.parent_email = params[6];
        student.updated_at = new Date(Date.now() + 1).toISOString();
        return { id: student.id };
      }

      throw new Error(`Unhandled one(): ${text}`);
    },
    async all(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();

      if (text.startsWith("SELECT STUDENT_CODE FROM STUDENTS")) {
        const rows = !params.length
          ? students
          : students.filter((row) => row.school_id === params[0]);
        return rows.map((row) => ({ student_code: row.student_code }));
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
            if (!student) return null;
            return joinActiveEnrollment(student);
          })
          .filter(Boolean);
      }

      if (text.includes("FROM STUDENTS ST") && text.includes("WHERE ST.SCHOOL_ID")) {
        const schoolId = params[0];
        return students
          .filter((row) => row.school_id === schoolId)
          .map((student) => joinActiveEnrollment(student))
          .sort((a, b) =>
            String(a.last_name).localeCompare(String(b.last_name)) ||
            String(a.first_name).localeCompare(String(b.first_name)),
          );
      }

      if (text.includes("FROM ENROLLMENTS E") && text.includes("WHERE E.STUDENT_ID")) {
        const studentId = params[0];
        const schoolId = params[1];
        return enrollments
          .filter((row) => row.student_id === studentId && row.school_id === schoolId)
          .map((enrollment) => {
            const cls = classes.find((row) => row.id === enrollment.class_id);
            const year = years.find((item) => item.id === enrollment.academic_year_id);
            return {
              enrollment_id: enrollment.id,
              enrollment_status: enrollment.status,
              enrollment_date: enrollment.enrollment_date,
              enrollment_created_at: enrollment.created_at,
              enrollment_updated_at: enrollment.updated_at,
              class_code: cls?.class_code,
              class_name: cls?.name,
              academic_year_name: year?.name,
              academic_year_status: year?.status,
            };
          });
      }

      if (text.includes("FROM STUDENT_DOCUMENTS")) {
        return documents.filter(
          (row) => row.student_id === params[0] && row.school_id === params[1],
        );
      }

      throw new Error(`Unhandled all(): ${text}`);
    },
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
      if (text.startsWith("SELECT PG_ADVISORY_XACT_LOCK")) {
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO USERS")) {
        const userCode = params[1];
        if (users.some((row) => row.user_code === userCode)) {
          const error = new Error(
            'duplicate key value violates unique constraint "users_user_code_key"',
          );
          error.code = "23505";
          throw error;
        }
        const row = {
          user_code: userCode,
          school_id: params[0],
          password_hash: params[6],
          pin_hash: params[6],
          must_change_password: true,
          role: "STUDENT",
        };
        users.push(row);
        return { rows: [] };
      }
      throw new Error(`Unhandled query(): ${text}`);
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
      return { students: students.length, enrollments: enrollments.length, users: users.length };
    },
    users() {
      return users.slice();
    },
  };
  memory.withTransaction = async (fn) =>
    fn({
      one: (sql, params) => memory.one(sql, params),
      all: (sql, params) => memory.all(sql, params),
      query: (sql, params) => memory.query(sql, params),
    });
  return memory;
}

function assertEnrollmentHasNoSecret(row) {
  const serialized = JSON.stringify(row);
  assert.equal(row.pin, undefined);
  assert.equal(row.password, undefined);
  assert.equal(row.temporaryPassword, undefined);
  assert.doesNotMatch(serialized, /"1234"/);
  assert.doesNotMatch(serialized, /Tmp-/i);
}

async function main() {
  const db = createMemoryDb();
  const repo = createClassStudentsRepository(db);
  const activeClass = db.seedClass("CD-2026-0001");
  const inactiveClass = db.seedClass("CD-2026-0001", { name: "6ème B", status: "inactive" });
  db.seedClass("CD-2026-0002", { name: "5ème A", class_code: "CLS-SCH-B-1" });

  const enrolled = await repo.enroll(activeClass.class_code, "CD-2026-0001", {
    firstName: "Awa",
    lastName: "Diop",
    gender: "Féminin",
  });
  assert.match(enrolled.studentCode, /^CD-IN-EL-\d{2}-\d{3}$/);
  assert.equal(enrolled.matricule, enrolled.studentCode);
  assert.equal(enrolled.loginCode, enrolled.studentCode);
  assert.equal(enrolled.classCode, activeClass.class_code);
  assert.equal(enrolled.className, "6ème A");

  const listed = await repo.listByClassCode(activeClass.class_code, "CD-2026-0001");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].studentCode, enrolled.studentCode);

  const schoolList = await repo.listBySchoolCode("CD-2026-0001");
  assert.equal(schoolList.length, 1);
  assert.equal(schoolList[0].studentCode, enrolled.studentCode);

  const fetched = await repo.getByStudentCode(enrolled.studentCode, "CD-2026-0001");
  assert.equal(fetched.firstName, "Awa");
  assert.ok(Array.isArray(fetched.enrollments));
  assert.equal(fetched.enrollments.length, 1);
  assert.ok(Array.isArray(fetched.guardians));
  assert.equal(fetched.guardians.length, 0);
  assert.ok(fetched.medical);
  assert.ok(Array.isArray(fetched.documents));
  assert.ok(fetched.access?.notesPath);

  const updated = await repo.updateByStudentCode(enrolled.studentCode, "CD-2026-0001", {
    parentPhone: "+243800000001",
    expectedUpdatedAt: fetched.updatedAt,
  });
  assert.equal(updated.parentPhone, "+243800000001");
  assert.notEqual(updated.updatedAt, fetched.updatedAt);

  await assert.rejects(
    () =>
      repo.updateByStudentCode(enrolled.studentCode, "CD-2026-0001", {
        parentPhone: "+243800000002",
        expectedUpdatedAt: fetched.updatedAt,
      }),
    (error) => error.statusCode === 409,
  );

  await assert.rejects(
    () =>
      repo.updateByStudentCode(enrolled.studentCode, "CD-2026-0001", {
        classCode: "HACK",
        expectedUpdatedAt: updated.updatedAt,
      }),
    (error) => error.statusCode === 400,
  );

  await assert.rejects(
    () =>
      repo.updateByStudentCode(enrolled.studentCode, "CD-2026-0001", {
        schoolCode: "CD-2026-0002",
        expectedUpdatedAt: updated.updatedAt,
      }),
    (error) => error.statusCode === 400,
  );

  const biClass = db.seedClass("BI-2026-0001", { name: "6ème A", class_code: "CLS-BI-1" });
  const enrolledBi = await repo.enroll(biClass.class_code, "BI-2026-0001", {
    firstName: "Grace",
    lastName: "Nkurunziza",
  });
  assert.match(enrolledBi.studentCode, /^BI-LB-EL-\d{2}-\d{3}$/);
  assert.notEqual(enrolled.studentCode, enrolledBi.studentCode);

  await assert.rejects(
    () => repo.getByStudentCode(enrolled.studentCode, "CD-2026-0002"),
    (error) => error.statusCode === 404,
  );

  // Erreur PG documents non liée à l'absence de table → doit remonter.
  const previousAll = db.all.bind(db);
  db.all = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
    if (text.includes("FROM STUDENT_DOCUMENTS")) {
      const error = new Error("permission denied for table student_documents");
      error.code = "42501";
      throw error;
    }
    return previousAll(sql, params);
  };
  await assert.rejects(
    () => repo.getByStudentCode(enrolled.studentCode, "CD-2026-0001"),
    (error) => error.code === "42501",
  );
  db.all = previousAll;

  // Absence explicite de table → documents vides.
  db.all = async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toUpperCase();
    if (text.includes("FROM STUDENT_DOCUMENTS")) {
      const error = new Error('relation "student_documents" does not exist');
      error.code = "42P01";
      throw error;
    }
    return previousAll(sql, params);
  };
  const dossierWithoutDocsTable = await repo.getByStudentCode(enrolled.studentCode, "CD-2026-0001");
  assert.deepEqual(dossierWithoutDocsTable.documents, []);
  db.all = previousAll;

  await assert.rejects(
    () =>
      repo.enroll(inactiveClass.class_code, "CD-2026-0001", {
        firstName: "Ibra",
        lastName: "Fall",
      }),
    (error) => error.statusCode === 409,
  );

  await assert.rejects(
    () =>
      repo.enroll(activeClass.class_code, "CD-2026-0001", {
        firstName: "Hack",
        lastName: "Test",
        classCode: "CLS-SCH-B-1",
      }),
    (error) => error.statusCode === 400,
  );

  await assert.rejects(
    () => repo.listByClassCode(activeClass.class_code, "CD-2026-0002"),
    (error) => error.statusCode === 404,
  );

  assert.equal(db.counts().students, 2);
  assert.equal(db.counts().enrollments, 2);
  assert.equal(db.counts().users, 2);

  const loginUsers = db.users();
  assert.notEqual(loginUsers[0].password_hash, loginUsers[1].password_hash);
  for (const user of loginUsers) {
    assert.equal(user.pin_hash, user.password_hash);
    assert.equal(user.must_change_password, true);
    assert.match(user.password_hash, /^scrypt\$/);
    assert.equal(verifySecret("1234", user.password_hash), false);
    assert.equal(verifySecret(user.user_code, user.password_hash), false);
  }
  assertEnrollmentHasNoSecret(enrolled);
  assertEnrollmentHasNoSecret(enrolledBi);

  const generated = new Set(Array.from({ length: 32 }, () => generateTemporarySecret()));
  assert.equal(generated.size, 32);
  for (const secret of generated) {
    assert.match(secret, /^Tmp-[0-9a-f]{32}$/);
    assert.notEqual(secret, "1234");
  }
  assert.equal(verifySecret("1234", hashSecret(generateTemporarySecret())), false);

  const productionSrc = fs.readFileSync(
    path.join(__dirname, "../db/classStudentsRepository.js"),
    "utf8",
  );
  assert.doesNotMatch(productionSrc, /ON CONFLICT \(user_code\) DO NOTHING/);
  assert.doesNotMatch(productionSrc, /hashSecret\(["']1234["']\)/);

  console.log("classStudentsRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
