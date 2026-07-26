/**
 * HOTFIX-PRE-E1-01 — Preuve repository réelle :
 *   saveBackOfficeState
 *   → syncStudentsDomainFromBackOffice
 *   → materializeBackOfficeStudent
 *   → students + enrollments PG
 *   → resolveStudentForGrade (POST /api/notes)
 *   → isolation multi-tenant
 */
const assert = require("assert");
const { PostgresRepository } = require("../db/postgresRepository");

function createInjectablePostgresRepository() {
  const tables = {
    schools: [],
    classes: [],
    academic_years: [],
    students: [],
    enrollments: [],
    countries: [],
    backoffice_state: [],
  };
  let seq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

  const repo = Object.create(PostgresRepository.prototype);
  repo.ready = true;
  repo.cachedDataset = null;
  repo.engine = "postgresql";
  repo.pool = {
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {},
    }),
    end: async () => {},
  };
  repo.init = async () => {
    repo.ready = true;
  };
  repo.withTransaction = async (fn) => fn(null);
  repo.tables = tables;
  repo.parseDate = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const m = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
  };

  const eq = (left, right) => String(left ?? "") === String(right ?? "");
  const lower = (value) => String(value ?? "").trim().toLowerCase();

  async function execute(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    const upper = text.toUpperCase();

    if (upper.startsWith("SELECT * FROM SCHOOLS WHERE SCHOOL_CODE")) {
      return tables.schools.filter((row) => eq(row.school_code, params[0]));
    }
    if (upper.includes("SELECT SCHOOL_CODE FROM SCHOOLS WHERE ID")) {
      return tables.schools
        .filter((row) => eq(row.id, params[0]))
        .map((row) => ({ school_code: row.school_code }));
    }
    if (upper.startsWith("SELECT * FROM SCHOOLS WHERE ID")) {
      return tables.schools.filter((row) => eq(row.id, params[0]));
    }
    if (upper.startsWith("INSERT INTO SCHOOLS")) {
      const row = {
        id: nextId(),
        country_id: params[0],
        school_code: params[1],
        name: params[2],
        status: params[9] ?? "active",
      };
      const existing = tables.schools.find((item) => eq(item.school_code, row.school_code));
      if (existing) {
        existing.name = row.name;
        return [existing];
      }
      tables.schools.push(row);
      return [row];
    }

    if (upper.includes("FROM COUNTRIES WHERE ISO_CODE")) {
      return tables.countries.filter((row) => eq(row.iso_code, params[0]));
    }
    if (upper.startsWith("INSERT INTO COUNTRIES")) {
      const row = { id: nextId(), name: params[0], iso_code: params[1] };
      const existing = tables.countries.find((item) => eq(item.iso_code, row.iso_code));
      if (existing) return [existing];
      tables.countries.push(row);
      return [row];
    }

    if (upper.includes("FROM CLASSES") && upper.includes("LOWER(TRIM(NAME))")) {
      return tables.classes.filter(
        (row) => eq(row.school_id, params[0]) && lower(row.name) === lower(params[1]),
      );
    }
    if (upper.startsWith("SELECT * FROM CLASSES WHERE SCHOOL_ID") && !upper.includes("LOWER")) {
      return tables.classes.filter((row) => eq(row.school_id, params[0]));
    }
    if (upper.startsWith("SELECT * FROM CLASSES WHERE ID")) {
      return tables.classes.filter((row) => eq(row.id, params[0]));
    }
    if (upper.startsWith("INSERT INTO CLASSES")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        academic_year_id: params[1],
        class_code: params[2],
        name: params[3],
        level: params[4],
        section: params[5],
        status: "active",
        created_at: new Date().toISOString(),
      };
      const existing = tables.classes.find((item) => eq(item.class_code, row.class_code));
      if (existing) {
        existing.name = row.name;
        return [existing];
      }
      tables.classes.push(row);
      return [row];
    }

    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("STATUS IN")) {
      return tables.academic_years
        .filter((row) => eq(row.school_id, params[0]) && ["active", "open"].includes(row.status))
        .sort((a, b) => Number(b.is_current) - Number(a.is_current));
    }
    if (upper.startsWith("INSERT INTO ACADEMIC_YEARS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        name: params[1],
        start_date: params[2],
        end_date: params[3],
        is_current: true,
        status: "open",
        created_at: new Date().toISOString(),
      };
      const existing = tables.academic_years.find(
        (item) => eq(item.school_id, row.school_id) && eq(item.name, row.name),
      );
      if (existing) {
        existing.is_current = true;
        existing.status = "open";
        return [existing];
      }
      tables.academic_years.push(row);
      return [row];
    }

    if (upper.includes("FROM STUDENTS ST") && upper.includes("JOIN SCHOOLS")) {
      const key = params[0];
      const schoolFilter = params[1];
      return tables.students
        .filter((st) => eq(st.student_code, key) || eq(st.id, key))
        .map((st) => {
          const school = tables.schools.find((s) => eq(s.id, st.school_id));
          const enrollment = tables.enrollments.find(
            (e) => eq(e.student_id, st.id) && e.status === "active",
          );
          const klass = enrollment
            ? tables.classes.find((c) => eq(c.id, enrollment.class_id))
            : null;
          return {
            ...st,
            school_code: school?.school_code,
            class_id: enrollment?.class_id ?? null,
            class_name: klass?.name ?? null,
          };
        })
        .filter((row) => !schoolFilter || eq(row.school_code, schoolFilter))
        .slice(0, 1);
    }

    if (upper.startsWith("SELECT ID, SCHOOL_ID FROM STUDENTS WHERE STUDENT_CODE")) {
      return tables.students
        .filter((row) => eq(row.student_code, params[0]))
        .map((row) => ({ id: row.id, school_id: row.school_id }))
        .slice(0, 1);
    }

    if (upper.startsWith("INSERT INTO STUDENTS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        student_code: params[1],
        first_name: params[2],
        last_name: params[3],
        gender: params[4],
        birth_date: params[5],
        birth_place: "",
        photo_url: "",
        parent_phone: params[6],
        parent_email: params[7],
        status: params[8],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const existing = tables.students.find((item) => eq(item.student_code, row.student_code));
      if (existing) {
        if (!eq(existing.school_id, row.school_id)) {
          // Simule WHERE students.school_id = EXCLUDED.school_id → 0 row
          return [];
        }
        Object.assign(existing, {
          first_name: row.first_name,
          last_name: row.last_name,
          gender: row.gender,
          birth_date: row.birth_date,
          parent_phone: row.parent_phone,
          parent_email: row.parent_email,
          status: row.status,
          updated_at: row.updated_at,
        });
        return [{ id: existing.id, school_id: existing.school_id }];
      }
      tables.students.push(row);
      return [{ id: row.id, school_id: row.school_id }];
    }

    if (upper.startsWith("INSERT INTO ENROLLMENTS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        student_id: params[1],
        class_id: params[2],
        academic_year_id: params[3],
        enrollment_date: "2026-07-26",
        status: "active",
      };
      const existing = tables.enrollments.find(
        (item) =>
          eq(item.student_id, row.student_id) && eq(item.academic_year_id, row.academic_year_id),
      );
      if (existing) {
        existing.class_id = row.class_id;
        existing.status = "active";
        return [];
      }
      tables.enrollments.push(row);
      return [];
    }

    if (upper.includes("FROM BACKOFFICE_STATE")) {
      return tables.backoffice_state
        .filter((row) => eq(row.state_key, "default"))
        .map((row) => ({ state_payload: row.state_payload }));
    }
    if (upper.startsWith("INSERT INTO BACKOFFICE_STATE")) {
      const payload = typeof params[0] === "string" ? JSON.parse(params[0]) : params[0];
      const existing = tables.backoffice_state.find((row) => eq(row.state_key, "default"));
      if (existing) {
        existing.state_payload = payload;
      } else {
        tables.backoffice_state.push({
          state_key: "default",
          state_payload: payload,
        });
      }
      return [];
    }

    if (
      upper.startsWith("DO $$") ||
      upper.includes("CREATE TABLE") ||
      upper.includes("CREATE UNIQUE INDEX") ||
      upper.includes("ALTER TABLE") ||
      upper.includes("FROM EVALUATIONS") ||
      upper.includes("FROM GRADES") ||
      upper.includes("FROM SUBJECTS") ||
      upper.includes("FROM TERMS") ||
      upper.includes("FROM TEACHERS")
    ) {
      return [];
    }

    throw new Error(`SQL non supporté par le repository injectable de test: ${text.slice(0, 180)}`);
  }

  repo.query = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return { rows, rowCount: rows.length };
  };
  repo.one = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return rows[0] ?? null;
  };
  repo.all = async (sql, params = []) => execute(sql, params);

  return repo;
}

async function run() {
  const schoolAId = "11111111-1111-4111-8111-111111111111";
  const schoolBId = "22222222-2222-4222-8222-222222222222";
  const repo = createInjectablePostgresRepository();
  repo.tables.schools.push(
    { id: schoolAId, school_code: "SCH-A", name: "École A" },
    { id: schoolBId, school_code: "SCH-B", name: "École B" },
  );

  const studentA1 = {
    id: "STUDENTS-A-1",
    matricule: "STUDENTS-A-1",
    publicId: "STUDENTS-A-1",
    firstName: "Mbuyi",
    name: "Mbuyi",
    className: "6e A",
    schoolCode: "SCH-A",
  };
  const studentA2 = {
    id: "STUDENTS-A-2",
    matricule: "STUDENTS-A-2",
    publicId: "STUDENTS-A-2",
    firstName: "Tshilombo",
    name: "Tshilombo",
    className: "6e A",
    schoolCode: "SCH-A",
  };
  const studentB = {
    id: "STUDENTS-B-1",
    matricule: "STUDENTS-B-1",
    publicId: "STUDENTS-B-1",
    firstName: "Kabila",
    name: "Kabila",
    className: "5e B",
    schoolCode: "SCH-B",
  };

  const saved = await repo.saveBackOfficeState({
    schools: [
      { code: "SCH-A", name: "École A" },
      { code: "SCH-B", name: "École B" },
    ],
    classes: [
      { id: "CLS-A", name: "6e A", schoolCode: "SCH-A" },
      { id: "CLS-B", name: "5e B", schoolCode: "SCH-B" },
    ],
    students: [studentA1, studentA2, studentB],
  });

  assert.ok(saved.syncAck, "syncAck présent");
  const acceptedStudentIds = saved.syncAck.accepted
    .filter((row) => row.entity === "students")
    .map((row) => row.id)
    .sort();
  assert.deepStrictEqual(acceptedStudentIds, ["STUDENTS-A-1", "STUDENTS-A-2", "STUDENTS-B-1"]);
  const acceptedEnrollments = saved.syncAck.accepted.filter((row) => row.entity === "enrollments");
  assert.strictEqual(acceptedEnrollments.length, 3);
  assert.strictEqual(saved.syncAck.rejected.length, 0);

  assert.strictEqual(repo.tables.students.length, 3);
  assert.strictEqual(repo.tables.enrollments.length, 3);

  const pgA = repo.tables.students.filter((row) => eqSchool(row.school_id, schoolAId));
  assert.strictEqual(pgA.length, 2);
  assert.ok(pgA.every((row) => row.student_code.startsWith("STUDENTS-A-")));

  // Modification BO → update PG (même identifiant stable)
  const updated = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-A", name: "École A" }],
    classes: [{ id: "CLS-A", name: "6e A", schoolCode: "SCH-A" }],
    students: [{ ...studentA1, firstName: "Mbuyi-Maj", name: "Mbuyi-Maj" }],
  });
  assert.ok(updated.syncAck.accepted.some((row) => row.entity === "students" && row.id === "STUDENTS-A-1"));
  const refreshedA1 = repo.tables.students.find((row) => row.student_code === "STUDENTS-A-1");
  assert.strictEqual(refreshedA1.first_name, "Mbuyi-Maj");
  assert.strictEqual(repo.tables.students.filter((row) => row.student_code === "STUDENTS-A-1").length, 1);

  // Résolution POST /api/notes par identifiant stable + isolation tenant
  const resolvedA = await repo.resolveStudentForGrade("STUDENTS-A-1", "SCH-A");
  assert.ok(resolvedA, "élève A résolvable");
  assert.strictEqual(resolvedA.student_code, "STUDENTS-A-1");
  assert.strictEqual(resolvedA.school_id, schoolAId);
  assert.ok(resolvedA.class_id, "inscription active liée");

  const crossTenant = await repo.resolveStudentForGrade("STUDENTS-A-1", "SCH-B");
  assert.strictEqual(crossTenant, null, "pas de résolution cross-tenant");

  // Conflit d'identifiant stable entre établissements
  let conflictCaught = false;
  try {
    await repo.materializeBackOfficeStudent({
      id: "STUDENTS-A-1",
      matricule: "STUDENTS-A-1",
      firstName: "Intrus",
      name: "Intrus",
      className: "5e B",
      schoolCode: "SCH-B",
    });
  } catch (error) {
    conflictCaught = true;
    assert.strictEqual(error.code, "STUDENT_TENANT_CONFLICT");
    assert.strictEqual(error.statusCode, 409);
  }
  assert.ok(conflictCaught, "conflit multi-tenant levé");

  // PUT sans students ⇒ no-op sync élèves (notes-only)
  const beforeCount = repo.tables.students.length;
  const notesOnly = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-A", name: "École A" }],
    evaluations: [],
    notes: [],
  });
  assert.strictEqual(repo.tables.students.length, beforeCount);
  assert.ok(!notesOnly.syncAck.accepted.some((row) => row.entity === "students"));

  console.log("studentsSyncRepository.test.js : OK");
}

function eqSchool(left, right) {
  return String(left ?? "") === String(right ?? "");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
