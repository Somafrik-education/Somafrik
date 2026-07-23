/**
 * HOTFIX-SYNC-04 — Sync évaluation + note même TX :
 * - note retrouve l'évaluation via legacy_json_id / UUID fraîchement créé
 * - rejet note isolé (SAVEPOINT) sans 500 globale
 * - syncAck.rejected porte code GRADE_*
 */
const assert = require("assert");
const { PostgresRepository } = require("../db/postgresRepository");

function createInjectablePostgresRepository() {
  const tables = {
    schools: [],
    classes: [],
    subjects: [],
    academic_years: [],
    terms: [],
    teachers: [],
    students: [],
    evaluations: [],
    grades: [],
    backoffice_state: [],
  };
  let seq = 1;
  const nextId = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

  const repo = Object.create(PostgresRepository.prototype);
  repo.ready = true;
  repo.cachedDataset = null;
  repo.engine = "postgresql";
  repo._txClient = null;
  repo.forceGradeInsertError = null;
  repo.pool = {
    connect: async () => ({
      query: async (sql, params) => repo.query(sql, params),
      release() {},
    }),
    end: async () => {},
  };
  repo.init = async () => {
    repo.ready = true;
  };
  repo.tables = tables;

  const eq = (left, right) => String(left ?? "") === String(right ?? "");
  const lower = (value) => String(value ?? "").trim().toLowerCase();

  async function execute(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    const upper = text.toUpperCase();

    if (
      upper.startsWith("SAVEPOINT ") ||
      upper.startsWith("RELEASE SAVEPOINT") ||
      upper.startsWith("ROLLBACK TO SAVEPOINT") ||
      upper === "BEGIN" ||
      upper === "COMMIT" ||
      upper === "ROLLBACK"
    ) {
      return [];
    }

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

    if (upper.includes("FROM CLASSES") && upper.includes("LOWER(TRIM(NAME))")) {
      return tables.classes.filter(
        (row) => eq(row.school_id, params[0]) && lower(row.name) === lower(params[1]),
      );
    }
    if (upper.includes("FROM CLASSES") && upper.includes("CLASS_CODE")) {
      return tables.classes.filter(
        (row) =>
          eq(row.school_id, params[0]) && (eq(row.id, params[1]) || eq(row.class_code, params[1])),
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
      };
      const existing = tables.classes.find((item) => eq(item.class_code, row.class_code));
      if (existing) {
        existing.name = row.name;
        return [existing];
      }
      tables.classes.push(row);
      return [row];
    }

    if (upper.includes("FROM SUBJECTS") && upper.includes("LOWER")) {
      return tables.subjects.filter(
        (row) =>
          eq(row.school_id, params[0]) &&
          (lower(row.name) === lower(params[1]) || lower(row.subject_code) === lower(params[1])),
      );
    }
    if (upper.includes("FROM SUBJECTS") && upper.includes("ID::TEXT")) {
      return tables.subjects.filter(
        (row) =>
          eq(row.school_id, params[0]) && (eq(row.id, params[1]) || eq(row.subject_code, params[1])),
      );
    }
    if (upper.startsWith("SELECT * FROM SUBJECTS WHERE SCHOOL_ID") && !upper.includes("LOWER")) {
      return tables.subjects.filter((row) => eq(row.school_id, params[0]));
    }
    if (upper.startsWith("INSERT INTO SUBJECTS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        subject_code: params[1],
        name: params[2],
        coefficient: params[3],
        level: params[4],
        description: params[5],
        status: "active",
      };
      const existing = tables.subjects.find((item) => eq(item.subject_code, row.subject_code));
      if (existing) {
        Object.assign(existing, { name: row.name, coefficient: row.coefficient });
        return [existing];
      }
      tables.subjects.push(row);
      return [row];
    }

    if (upper.includes("FROM ACADEMIC_YEARS") && upper.includes("STATUS IN")) {
      return tables.academic_years.filter(
        (row) => eq(row.school_id, params[0]) && ["active", "open"].includes(row.status),
      );
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
      };
      tables.academic_years.push(row);
      return [row];
    }

    if (upper.includes("FROM TERMS") && upper.includes("NAME =")) {
      return tables.terms.filter(
        (row) => eq(row.academic_year_id, params[0]) && eq(row.name, params[1]),
      );
    }
    if (upper.startsWith("INSERT INTO TERMS")) {
      const row = {
        id: nextId(),
        academic_year_id: params[0],
        name: params[1],
        status: "open",
      };
      tables.terms.push(row);
      return [row];
    }

    if (upper.includes("FROM TEACHERS") && upper.includes("ORDER BY CREATED_AT")) {
      return tables.teachers.filter((row) => eq(row.school_id, params[0]));
    }
    if (upper.includes("FROM TEACHERS") && upper.includes("TEACHER_CODE")) {
      return tables.teachers.filter(
        (row) => eq(row.school_id, params[0]) && eq(row.teacher_code, params[1]),
      );
    }
    if (upper.includes("FROM TEACHER_ASSIGNMENTS")) {
      return [];
    }

    if (upper.includes("FROM STUDENTS") && upper.includes("STUDENT_CODE")) {
      return tables.students
        .filter((row) => eq(row.student_code, params[0]) || eq(row.id, params[0]))
        .map((row) => ({
          ...row,
          school_code: tables.schools.find((s) => eq(s.id, row.school_id))?.school_code,
          class_id: row.class_id ?? null,
          class_name: row.class_name ?? "6e A",
        }));
    }

    if (upper.includes("FROM EVALUATIONS WHERE SCHOOL_ID") && upper.includes("LEGACY_JSON_ID")) {
      return tables.evaluations.filter(
        (row) => eq(row.school_id, params[0]) && eq(row.legacy_json_id, params[1]),
      );
    }
    if (upper.includes("FROM EVALUATIONS WHERE LEGACY_JSON_ID")) {
      return tables.evaluations.filter((row) => eq(row.legacy_json_id, params[0]));
    }
    if (upper.includes("FROM EVALUATIONS WHERE ID")) {
      return tables.evaluations.filter((row) => eq(row.id, params[0]));
    }
    if (upper.startsWith("INSERT INTO EVALUATIONS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        class_id: params[1],
        subject_id: params[2],
        teacher_id: params[3],
        term_id: params[4],
        title: params[5],
        evaluation_type: params[6],
        evaluation_date: params[7],
        max_score: params[8],
        coefficient: params[9],
        status: params[10],
        active: params[11],
        legacy_json_id: params[12],
      };
      tables.evaluations.push(row);
      return [row];
    }
    if (upper.startsWith("UPDATE EVALUATIONS")) {
      const id = params[12];
      const row = tables.evaluations.find((item) => eq(item.id, id));
      if (!row) return [];
      Object.assign(row, {
        class_id: params[0],
        subject_id: params[1],
        teacher_id: params[2],
        term_id: params[3],
        title: params[4],
        max_score: params[7],
        coefficient: params[8],
        status: params[9],
        active: params[10],
      });
      return [];
    }

    if (upper.includes("FROM GRADES") && upper.includes("EVALUATION_ID") && upper.includes("STUDENT_ID")) {
      return tables.grades.filter(
        (row) =>
          eq(row.school_id, params[0]) &&
          eq(row.evaluation_id, params[1]) &&
          eq(row.student_id, params[2]),
      );
    }
    if (upper.includes("FROM GRADES G") && upper.includes("WHERE G.ID")) {
      const grade = tables.grades.find((row) => eq(row.id, params[0]));
      if (!grade) return [];
      const student = tables.students.find((row) => eq(row.id, grade.student_id));
      const school = tables.schools.find((row) => eq(row.id, grade.school_id));
      const klass = tables.classes.find((row) => eq(row.id, grade.class_id));
      const subject = tables.subjects.find((row) => eq(row.id, grade.subject_id));
      const teacher = tables.teachers.find((row) => eq(row.id, grade.teacher_id));
      const term = tables.terms.find((row) => eq(row.id, grade.term_id));
      const evaluation = tables.evaluations.find((row) => eq(row.id, grade.evaluation_id));
      return [
        {
          ...grade,
          student_code: student?.student_code,
          school_code: school?.school_code,
          class_code: klass?.class_code,
          class_name: klass?.name,
          subject_name: subject?.name,
          subject_coefficient: subject?.coefficient,
          teacher_code: teacher?.teacher_code,
          term_name: term?.name,
          evaluation_uuid: evaluation?.id,
          evaluation_legacy_id: evaluation?.legacy_json_id,
          evaluation_title: evaluation?.title,
          evaluation_status: evaluation?.status,
          evaluation_max_score: evaluation?.max_score,
          evaluation_coefficient: evaluation?.coefficient,
          evaluation_type_pg: evaluation?.evaluation_type,
        },
      ];
    }
    if (upper.startsWith("SELECT * FROM GRADES WHERE ID")) {
      return tables.grades.filter((row) => eq(row.id, params[0]));
    }
    if (upper.startsWith("INSERT INTO GRADES")) {
      if (repo.forceGradeInsertError) {
        throw repo.forceGradeInsertError;
      }
      const row = {
        id: nextId(),
        school_id: params[0],
        student_id: params[1],
        class_id: params[2],
        subject_id: params[3],
        teacher_id: params[4],
        term_id: params[5],
        evaluation_id: params[6],
        grade_type: params[7],
        score: params[8],
        max_score: params[9],
        coefficient: params[10],
        comment: params[11],
        grade_status: params[12],
        version: 1,
      };
      tables.grades.push(row);
      return [{ id: row.id }];
    }
    if (upper.startsWith("UPDATE GRADES")) {
      const id = params[13];
      const row = tables.grades.find((item) => eq(item.id, id));
      if (!row) return [];
      Object.assign(row, {
        score: params[0],
        max_score: params[1],
        coefficient: params[2],
        teacher_id: params[3],
        grade_status: params[6],
        evaluation_id: params[7],
        version: params[11],
      });
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
        tables.backoffice_state.push({ state_key: "default", state_payload: payload });
      }
      return [];
    }

    if (
      upper.startsWith("DO $$") ||
      upper.includes("CREATE TABLE") ||
      upper.includes("CREATE UNIQUE INDEX") ||
      upper.includes("ALTER TABLE")
    ) {
      return [];
    }

    throw new Error(`SQL non supporté (grade sync test): ${text.slice(0, 160)}`);
  }

  repo.query = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return { rows, rowCount: rows.length };
  };

  repo.withTransaction = async (fn) => {
    const previous = repo._txClient;
    repo._txClient = {
      query: async (sql, params) => repo.query(sql, params),
    };
    try {
      await repo.query("BEGIN");
      const result = await fn(repo._txClient);
      await repo.query("COMMIT");
      return result;
    } catch (error) {
      await repo.query("ROLLBACK");
      throw error;
    } finally {
      repo._txClient = previous;
    }
  };

  return repo;
}

async function run() {
  const schoolId = "11111111-1111-4111-8111-111111111111";
  const teacherId = "22222222-2222-4222-8222-222222222222";
  const studentId = "33333333-3333-4333-8333-333333333333";

  // 1) Évaluation + note même TX → les deux acceptées (legacy → UUID)
  const repo = createInjectablePostgresRepository();
  repo.tables.schools.push({ id: schoolId, school_code: "SCH-001", name: "Lycée Test" });
  repo.tables.teachers.push({
    id: teacherId,
    school_id: schoolId,
    teacher_code: "T-1",
    created_at: "2026-01-01",
  });
  repo.tables.students.push({
    id: studentId,
    school_id: schoolId,
    student_code: "STU-001",
    class_name: "6e A",
  });

  const evaluation = {
    id: "EVAL-GRADE-1",
    clientMutationId: "cm-eval-1",
    schoolCode: "SCH-001",
    className: "6e A",
    subject: "Mathématiques",
    period: "Trimestre 1",
    title: "Interro",
    evaluationType: "Devoir",
    scale: 20,
    coefficient: 1,
    status: "Brouillon",
    active: true,
    date: "2026-07-23",
  };
  const note = {
    id: "NOTE-1",
    clientMutationId: "cm-note-1",
    evaluationId: "EVAL-GRADE-1",
    studentId: "s-bo-1",
    schoolCode: "SCH-001",
    value: 14,
    scale: 20,
    gradeStatus: "Saisie",
    className: "6e A",
    subject: "Mathématiques",
  };

  const saved = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    courses: [{ id: "m1", name: "Mathématiques", schoolCode: "SCH-001" }],
    students: [{ id: "s-bo-1", matricule: "STU-001", schoolCode: "SCH-001", className: "6e A" }],
    teachers: [{ id: "t1", schoolCode: "SCH-001" }],
    evaluations: [evaluation],
    notes: [note],
  });

  assert.ok(saved.syncAck);
  assert.ok(
    saved.syncAck.accepted.some((item) => item.entity === "evaluations" && item.id === "EVAL-GRADE-1"),
  );
  assert.ok(saved.syncAck.accepted.some((item) => item.entity === "notes" && item.id === "NOTE-1"));
  assert.strictEqual(saved.syncAck.rejected.length, 0);
  assert.strictEqual(repo.tables.evaluations.length, 1);
  assert.strictEqual(repo.tables.grades.length, 1);
  assert.strictEqual(
    repo.tables.grades[0].evaluation_id,
    repo.tables.evaluations[0].id,
    "note liée à l'UUID évaluation créé dans la même TX",
  );

  // 2) Élève introuvable → note rejetée avec code, évaluation acceptée
  const repo2 = createInjectablePostgresRepository();
  repo2.tables.schools.push({ id: schoolId, school_code: "SCH-001", name: "Lycée Test" });
  repo2.tables.teachers.push({
    id: teacherId,
    school_id: schoolId,
    teacher_code: "T-1",
    created_at: "2026-01-01",
  });
  const saved2 = await repo2.saveBackOfficeState({
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    courses: [{ id: "m1", name: "Mathématiques", schoolCode: "SCH-001" }],
    students: [],
    evaluations: [{ ...evaluation, id: "EVAL-GRADE-2", clientMutationId: "cm-eval-2" }],
    notes: [
      {
        ...note,
        id: "NOTE-BAD",
        evaluationId: "EVAL-GRADE-2",
        studentId: "missing-student",
        clientMutationId: "cm-note-bad",
      },
    ],
  });
  assert.ok(
    saved2.syncAck.accepted.some((item) => item.id === "EVAL-GRADE-2"),
    "évaluation acceptée malgré échec note",
  );
  assert.strictEqual(saved2.syncAck.rejected.length, 1);
  assert.strictEqual(saved2.syncAck.rejected[0].entity, "notes");
  assert.strictEqual(saved2.syncAck.rejected[0].code, "GRADE_ATTACHMENT_STUDENT");
  assert.match(saved2.syncAck.rejected[0].error, /Élève introuvable/);
  assert.strictEqual(repo2.tables.grades.length, 0);

  // 3) Erreur SQL note (contrainte) isolée par SAVEPOINT → pas de 500, eval conservée
  const repo3 = createInjectablePostgresRepository();
  repo3.tables.schools.push({ id: schoolId, school_code: "SCH-001", name: "Lycée Test" });
  repo3.tables.teachers.push({
    id: teacherId,
    school_id: schoolId,
    teacher_code: "T-1",
    created_at: "2026-01-01",
  });
  repo3.tables.students.push({
    id: studentId,
    school_id: schoolId,
    student_code: "STU-001",
    class_name: "6e A",
  });
  repo3.forceGradeInsertError = Object.assign(new Error('violates check constraint "grades_status_score_coherence"'), {
    code: "23514",
  });
  const saved3 = await repo3.saveBackOfficeState({
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    courses: [{ id: "m1", name: "Mathématiques", schoolCode: "SCH-001" }],
    students: [{ id: "s-bo-1", matricule: "STU-001", schoolCode: "SCH-001" }],
    evaluations: [{ ...evaluation, id: "EVAL-GRADE-3", clientMutationId: "cm-eval-3" }],
    notes: [
      {
        ...note,
        id: "NOTE-SQL",
        evaluationId: "EVAL-GRADE-3",
        clientMutationId: "cm-note-sql",
      },
    ],
  });
  assert.ok(saved3.syncAck.accepted.some((item) => item.id === "EVAL-GRADE-3"));
  assert.strictEqual(saved3.syncAck.rejected[0].code, "GRADE_CONTRACT");
  assert.strictEqual(repo3.tables.evaluations.length, 1);
  assert.strictEqual(repo3.tables.grades.length, 0);
  // Persistance JSON a bien eu lieu (pas de rollback global / Erreur interne)
  assert.ok(repo3.tables.backoffice_state[0]?.state_payload);

  console.log("gradeSyncRepository.test.js : OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
