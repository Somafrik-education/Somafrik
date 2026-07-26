/**
 * HOTFIX-PRE-E1-02 — Preuve repository :
 * teachers + teacher_assignments + evaluations.teacher_id + grades via PUT
 * + garde POST notes (teacherCanAccessStudentClass) sans affaiblir RBAC.
 */
const assert = require("assert");
const { PostgresRepository } = require("../db/postgresRepository");

function createInjectablePostgresRepository() {
  const tables = {
    schools: [],
    classes: [],
    academic_years: [],
    subjects: [],
    teachers: [],
    teacher_assignments: [],
    students: [],
    enrollments: [],
    evaluations: [],
    grades: [],
    terms: [],
    users: [],
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
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
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
        status: "active",
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

    if (upper.includes("FROM SUBJECTS") && upper.includes("LOWER")) {
      return tables.subjects.filter(
        (row) =>
          eq(row.school_id, params[0]) &&
          (lower(row.name) === lower(params[1]) || lower(row.subject_code) === lower(params[1])),
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
        existing.name = row.name;
        return [existing];
      }
      tables.subjects.push(row);
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
      const existing = tables.terms.find(
        (item) => eq(item.academic_year_id, row.academic_year_id) && eq(item.name, row.name),
      );
      if (existing) return [existing];
      tables.terms.push(row);
      return [row];
    }

    if (upper.startsWith("SELECT ID FROM USERS")) {
      return tables.users
        .filter(
          (row) =>
            eq(row.id, params[0]) ||
            eq(row.user_code, params[0]) ||
            lower(row.email) === lower(params[0]),
        )
        .slice(0, 1);
    }

    if (upper.startsWith("SELECT * FROM TEACHERS WHERE SCHOOL_ID") && upper.includes("TEACHER_CODE")) {
      return tables.teachers.filter(
        (row) => eq(row.school_id, params[0]) && eq(row.teacher_code, params[1]),
      );
    }
    if (upper.startsWith("SELECT * FROM TEACHERS WHERE ID")) {
      return tables.teachers.filter((row) => eq(row.id, params[0]));
    }
    if (upper.startsWith("SELECT * FROM TEACHERS WHERE SCHOOL_ID") && upper.includes("ORDER BY")) {
      return tables.teachers
        .filter((row) => eq(row.school_id, params[0]))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    if (upper.includes("SELECT T.TEACHER_CODE FROM TEACHERS T")) {
      return tables.teachers
        .filter((row) => eq(row.school_id, params[0]) && eq(row.teacher_code, params[1]))
        .map((row) => ({ teacher_code: row.teacher_code }));
    }
    if (upper.startsWith("SELECT ID, SCHOOL_ID, TEACHER_CODE FROM TEACHERS WHERE TEACHER_CODE")) {
      return tables.teachers
        .filter((row) => eq(row.teacher_code, params[0]))
        .map((row) => ({ id: row.id, school_id: row.school_id, teacher_code: row.teacher_code }));
    }
    if (upper.startsWith("INSERT INTO TEACHERS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        user_id: params[1],
        teacher_code: params[2],
        speciality: params[3],
        status: params[4],
        created_at: new Date().toISOString(),
      };
      const existing = tables.teachers.find((item) => eq(item.teacher_code, row.teacher_code));
      if (existing) {
        if (!eq(existing.school_id, row.school_id)) return [];
        existing.speciality = row.speciality || existing.speciality;
        existing.user_id = row.user_id ?? existing.user_id;
        existing.status = row.status;
        return [
          {
            id: existing.id,
            school_id: existing.school_id,
            teacher_code: existing.teacher_code,
          },
        ];
      }
      tables.teachers.push(row);
      return [{ id: row.id, school_id: row.school_id, teacher_code: row.teacher_code }];
    }

    if (upper.startsWith("INSERT INTO TEACHER_ASSIGNMENTS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        teacher_id: params[1],
        class_id: params[2],
        subject_id: params[3],
        academic_year_id: params[4],
        assignment_role: "primary",
        status: "active",
      };
      const existing = tables.teacher_assignments.find(
        (item) =>
          eq(item.teacher_id, row.teacher_id) &&
          eq(item.class_id, row.class_id) &&
          eq(item.subject_id, row.subject_id) &&
          eq(item.academic_year_id, row.academic_year_id) &&
          eq(item.assignment_role, "primary"),
      );
      if (existing) {
        existing.status = "active";
        return [{ id: existing.id }];
      }
      tables.teacher_assignments.push(row);
      return [{ id: row.id }];
    }

    if (upper.includes("FROM TEACHER_ASSIGNMENTS TA") && upper.includes("SELECT 1 AS OK")) {
      const hit = tables.teacher_assignments.some((row) => {
        if (!(eq(row.teacher_id, params[0]) && eq(row.class_id, params[1]) && row.status === "active")) {
          return false;
        }
        // Variante classe seule (2 params) vs classe+matière (3 params).
        if (params.length >= 3 && params[2] != null) {
          return eq(row.subject_id, params[2]);
        }
        return true;
      });
      return hit ? [{ ok: 1 }] : [];
    }
    if (upper.startsWith("SELECT NAME FROM SUBJECTS WHERE ID")) {
      return tables.subjects
        .filter((row) => eq(row.id, params[0]))
        .map((row) => ({ name: row.name }));
    }

    if (upper.includes("FROM TEACHERS T") && upper.includes("JOIN TEACHER_ASSIGNMENTS")) {
      return tables.teachers.filter((teacher) => {
        if (!eq(teacher.school_id, params[0])) return false;
        const keyOk =
          eq(teacher.teacher_code, params[1]) ||
          eq(teacher.id, params[1]) ||
          eq(teacher.user_id, params[1]);
        if (!keyOk) return false;
        return tables.teacher_assignments.some(
          (ta) =>
            eq(ta.teacher_id, teacher.id) &&
            eq(ta.class_id, params[2]) &&
            eq(ta.subject_id, params[3]) &&
            ta.status === "active",
        );
      });
    }

    if (upper.includes("SELECT T.ID FROM TEACHERS T")) {
      return tables.teachers
        .filter(
          (row) =>
            eq(row.school_id, params[0]) &&
            (eq(row.teacher_code, params[1]) || eq(row.id, params[1]) || eq(row.user_id, params[1])),
        )
        .map((row) => ({ id: row.id }));
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

    if (upper.startsWith("INSERT INTO STUDENTS")) {
      const row = {
        id: nextId(),
        school_id: params[0],
        student_code: params[1],
        first_name: params[2],
        last_name: params[3],
        gender: params[4],
        birth_date: params[5],
        parent_phone: params[6],
        parent_email: params[7],
        status: params[8],
      };
      const existing = tables.students.find((item) => eq(item.student_code, row.student_code));
      if (existing) {
        if (!eq(existing.school_id, row.school_id)) return [];
        Object.assign(existing, {
          first_name: row.first_name,
          last_name: row.last_name,
          status: row.status,
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
        evaluation_type: params[5],
        evaluation_date: params[6],
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
    if (upper.startsWith("INSERT INTO GRADES")) {
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
      };
      tables.grades.push(row);
      return [{ id: row.id }];
    }
    if (upper.startsWith("UPDATE GRADES")) {
      const id = params[params.length - 1];
      const row = tables.grades.find((item) => eq(item.id, id));
      if (row) {
        row.score = params[0];
        row.teacher_id = params[3] ?? row.teacher_id;
      }
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
      if (existing) existing.state_payload = payload;
      else tables.backoffice_state.push({ state_key: "default", state_payload: payload });
      return [];
    }

    if (
      upper.startsWith("DO $$") ||
      upper.includes("CREATE TABLE") ||
      upper.includes("CREATE UNIQUE INDEX") ||
      upper.includes("ALTER TABLE") ||
      upper.includes("FROM GRADES G")
    ) {
      return [];
    }

    throw new Error(`SQL non supporté: ${text.slice(0, 180)}`);
  }

  repo.query = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return { rows, rowCount: rows.length };
  };
  repo.one = async (sql, params = []) => (await execute(sql, params))[0] ?? null;
  repo.all = async (sql, params = []) => execute(sql, params);
  repo.getGradeById = async (id) => {
    const grade = tables.grades.find((row) => eq(row.id, id));
    if (!grade) return null;
    const student = tables.students.find((row) => eq(row.id, grade.student_id));
    const evaluation = tables.evaluations.find((row) => eq(row.id, grade.evaluation_id));
    return {
      id: grade.id,
      evaluationId: evaluation?.legacy_json_id || evaluation?.id,
      studentId: student?.student_code,
      value: grade.score,
      score: grade.score,
      version: 1,
    };
  };

  return repo;
}

async function run() {
  const schoolAId = "11111111-1111-4111-8111-111111111111";
  const repo = createInjectablePostgresRepository();
  repo.tables.schools.push({ id: schoolAId, school_code: "SCH-A", name: "École A" });

  const teacher = {
    id: "TEACHERS-A-1",
    publicId: "TEACHERS-A-1",
    userId: "USERS-T-1",
    firstName: "Prof",
    lastName: "Alpha",
    schoolCode: "SCH-A",
    mainSubject: "Mathématiques",
  };
  const assignment = {
    id: "ASSIGN-1",
    teacherId: "TEACHERS-A-1",
    className: "6e A",
    subject: "Mathématiques",
    course: "Mathématiques",
    schoolCode: "SCH-A",
  };
  const student = {
    id: "STUDENTS-A-1",
    matricule: "STUDENTS-A-1",
    publicId: "STUDENTS-A-1",
    firstName: "Eleve",
    name: "Eleve",
    className: "6e A",
    schoolCode: "SCH-A",
  };

  // 1) Sync staff + élèves
  const staffSaved = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-A", name: "École A" }],
    classes: [{ id: "CLS-A", name: "6e A", schoolCode: "SCH-A" }],
    courses: [{ id: "COURSE-M", name: "Mathématiques", schoolCode: "SCH-A" }],
    teachers: [teacher],
    assignments: [assignment],
    students: [student],
  });
  assert.ok(staffSaved.syncAck.accepted.some((row) => row.entity === "teachers"));
  assert.ok(staffSaved.syncAck.accepted.some((row) => row.entity === "assignments"));
  assert.strictEqual(repo.tables.teachers.length, 1);
  assert.strictEqual(repo.tables.teacher_assignments.length, 1);
  assert.strictEqual(repo.tables.students.length, 1);
  assert.strictEqual(repo.tables.enrollments.length, 1);

  // 2) Évaluation + notes → teacher_id non null + grades PG
  const evaluation = {
    id: "EVAL-HF02-1",
    schoolCode: "SCH-A",
    className: "6e A",
    subject: "Mathématiques",
    period: "Trimestre 1",
    title: "Devoir HF02",
    evaluationType: "Devoir",
    scale: 20,
    coefficient: 1,
    status: "Publiée",
    teacherId: "TEACHERS-A-1",
    active: true,
    date: "2026-07-26",
  };
  const note = {
    id: "NOTE-HF02-1",
    studentId: "STUDENTS-A-1",
    evaluationId: "EVAL-HF02-1",
    schoolCode: "SCH-A",
    className: "6e A",
    subject: "Mathématiques",
    value: 14.5,
    scale: 20,
    coefficient: 1,
    evaluationCoefficient: 1,
  };

  const notesSaved = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-A", name: "École A" }],
    classes: [{ id: "CLS-A", name: "6e A", schoolCode: "SCH-A" }],
    courses: [{ id: "COURSE-M", name: "Mathématiques", schoolCode: "SCH-A" }],
    teachers: [teacher],
    assignments: [assignment],
    students: [student],
    evaluations: [evaluation],
    notes: [note],
  });

  assert.ok(notesSaved.syncAck.accepted.some((row) => row.entity === "evaluations"));
  assert.ok(
    notesSaved.syncAck.accepted.some((row) => row.entity === "notes"),
    `notes rejected: ${JSON.stringify(notesSaved.syncAck.rejected)}`,
  );
  assert.strictEqual(repo.tables.evaluations.length, 1);
  assert.ok(repo.tables.evaluations[0].teacher_id, "evaluations.teacher_id renseigné");
  assert.strictEqual(repo.tables.grades.length, 1);
  assert.strictEqual(String(repo.tables.grades[0].evaluation_id), String(repo.tables.evaluations[0].id));

  // 3) Garde RBAC : enseignant affecté OK ; non affecté KO
  const pgStudent = await repo.resolveStudentForGrade("STUDENTS-A-1", "SCH-A");
  assert.ok(pgStudent?.class_id);
  const allowed = await repo.teacherCanAccessStudentClass(
    { role: "Enseignant", sub: "USERS-T-1", classNames: [] },
    pgStudent,
  );
  assert.strictEqual(allowed, true, "enseignant affecté autorisé même sans classNames JWT");

  const denied = await repo.teacherCanAccessStudentClass(
    { role: "Enseignant", sub: "USERS-OTHER", classNames: [] },
    pgStudent,
  );
  assert.strictEqual(denied, false, "enseignant non affecté toujours refusé");

  const evalRow = repo.tables.evaluations[0];
  const canEval = await repo.teacherCanAccessEvaluation(
    { role: "Enseignant", sub: "USERS-T-1", schoolCode: "SCH-A", classNames: ["6e A"] },
    evalRow,
    pgStudent,
  );
  assert.strictEqual(canEval, true, "enseignant affecté classe+matière");

  const otherSubject = {
    id: "00000000-0000-4000-8000-000000000099",
    school_id: schoolAId,
    subject_code: "PHY-A",
    name: "Physique",
  };
  repo.tables.subjects.push(otherSubject);
  const physicsEval = { ...evalRow, subject_id: otherSubject.id, teacher_id: null };
  const cannotPhysics = await repo.teacherCanAccessEvaluation(
    { role: "Enseignant", sub: "USERS-T-1", schoolCode: "SCH-A", classNames: ["6e A"] },
    physicsEval,
    pgStudent,
  );
  assert.strictEqual(cannotPhysics, false, "matière non affectée refusée");

  // 4) Isolation : affectation école A ne fuit pas vers école B
  const schoolBId = "22222222-2222-4222-8222-222222222222";
  repo.tables.schools.push({ id: schoolBId, school_code: "SCH-B", name: "École B" });

  const crossSchoolDenied = await repo.teacherCanAccessEvaluation(
    { role: "Enseignant", sub: "USERS-T-1", schoolCode: "SCH-A", classNames: ["6e A"] },
    { ...evalRow, school_id: schoolBId },
    pgStudent,
  );
  assert.strictEqual(crossSchoolDenied, false, "évaluation autre école refusée");

  let conflict = false;
  try {
    await repo.materializeBackOfficeTeacher({
      id: "TEACHERS-A-1",
      schoolCode: "SCH-B",
      firstName: "Intrus",
    });
  } catch (error) {
    conflict = error.code === "TEACHER_TENANT_CONFLICT";
  }
  assert.ok(conflict, "conflit tenant enseignant");

  console.log("pedagogyStaffSyncRepository.test.js : OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
