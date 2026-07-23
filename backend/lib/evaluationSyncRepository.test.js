/**
 * HOTFIX-SYNC-02 — Preuve repository réelle (méthodes PostgresRepository),
 * pas une Map pgEvaluations reconstruite.
 *
 * Exercice :
 *   saveBackOfficeState
 *   → syncNotesDomainFromBackOffice
 *   → upsertEvaluationFromLegacy
 *   → INSERT evaluations
 *   → syncAck.accepted
 *   → getBackOfficeState (refresh)
 */
const assert = require("assert");
const { PostgresRepository } = require("../db/postgresRepository");
const { normalizeText } = require("./evaluationAttachment");

function createInjectablePostgresRepository() {
  const tables = {
    schools: [],
    classes: [],
    subjects: [],
    academic_years: [],
    terms: [],
    teachers: [],
    evaluations: [],
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

  const eq = (left, right) => String(left ?? "") === String(right ?? "");
  const lower = (value) => String(value ?? "").trim().toLowerCase();

  async function execute(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    const upper = text.toUpperCase();

    if (upper.startsWith("SELECT * FROM SCHOOLS WHERE SCHOOL_CODE")) {
      return tables.schools.filter((row) => eq(row.school_code, params[0]));
    }
    if (upper.includes("SELECT SCHOOL_CODE FROM SCHOOLS WHERE ID")) {
      return tables.schools.filter((row) => eq(row.id, params[0])).map((row) => ({
        school_code: row.school_code,
      }));
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

    if (upper.includes("FROM SUBJECTS") && upper.includes("SUBJECT_CODE") && upper.includes("LOWER")) {
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
        created_at: new Date().toISOString(),
      };
      const existing = tables.subjects.find((item) => eq(item.subject_code, row.subject_code));
      if (existing) {
        Object.assign(existing, {
          name: row.name,
          coefficient: row.coefficient,
        });
        return [existing];
      }
      tables.subjects.push(row);
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

    if (upper.includes("FROM TEACHERS") && upper.includes("TEACHER_CODE")) {
      return tables.teachers.filter(
        (row) => eq(row.school_id, params[0]) && eq(row.teacher_code, params[1]),
      );
    }
    if (upper.includes("FROM TEACHERS") && upper.includes("ORDER BY CREATED_AT")) {
      return tables.teachers.filter((row) => eq(row.school_id, params[0]));
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
        legacy_json_id: row.legacy_json_id ?? params[11],
        updated_at: new Date().toISOString(),
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
        existing.updated_at = new Date().toISOString();
      } else {
        tables.backoffice_state.push({
          state_key: "default",
          state_payload: payload,
          updated_at: new Date().toISOString(),
        });
      }
      return [];
    }

    // Statements hors chemin Notes (init/migration) : no-op sûr
    if (
      upper.startsWith("DO $$") ||
      upper.includes("CREATE TABLE") ||
      upper.includes("CREATE UNIQUE INDEX") ||
      upper.includes("ALTER TABLE") ||
      upper.includes("FROM GRADES")
    ) {
      return [];
    }

    throw new Error(`SQL non supporté par le repository injectable de test: ${text.slice(0, 160)}`);
  }

  repo.query = async (sql, params = []) => {
    const rows = await execute(sql, params);
    return { rows, rowCount: rows.length };
  };

  return repo;
}

async function run() {
  const repo = createInjectablePostgresRepository();
  const schoolId = "11111111-1111-4111-8111-111111111111";
  repo.tables.schools.push({
    id: schoolId,
    school_code: "SCH-001",
    name: "Lycée Test",
  });
  // Aucune année / classe / matière initiale — l'ensure doit tout créer.
  assert.strictEqual(repo.tables.academic_years.length, 0);
  assert.strictEqual(repo.tables.classes.length, 0);
  assert.strictEqual(repo.tables.subjects.length, 0);

  const evaluation = {
    id: "EVAL-REPO-1",
    clientMutationId: "cm-repo-1",
    schoolCode: "SCH-001",
    className: "6e A",
    subject: "Mathématiques",
    period: "Trimestre 1",
    title: "Devoir maison",
    evaluationType: "Devoir",
    scale: 20,
    coefficient: 1,
    status: "Brouillon",
    active: true,
    date: "2026-07-23",
  };

  const saved = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    classes: [{ id: "c1", name: "6e A", schoolCode: "SCH-001" }],
    courses: [{ id: "m1", name: "Mathématiques", schoolCode: "SCH-001" }],
    evaluations: [evaluation],
    notes: [],
  });

  assert.ok(saved.syncAck, "syncAck HTTP réel présent");
  assert.deepStrictEqual(
    saved.syncAck.accepted.map((item) => item.id),
    ["EVAL-REPO-1"],
  );
  assert.strictEqual(saved.syncAck.rejected.length, 0);

  // INSERT réel via upsertEvaluationFromLegacy
  assert.strictEqual(repo.tables.evaluations.length, 1);
  assert.strictEqual(repo.tables.evaluations[0].legacy_json_id, "EVAL-REPO-1");
  assert.strictEqual(repo.tables.evaluations[0].title, "Devoir maison");

  // Année créée par ensureCurrentAcademicYearForSchool
  assert.ok(repo.tables.academic_years.length >= 1, "année scolaire créée");
  assert.strictEqual(repo.tables.academic_years[0].school_id, schoolId);
  assert.strictEqual(repo.tables.academic_years[0].status, "open");

  // Lecture SQL evaluations (refresh autre session)
  const pgRow = await repo.one(
    `SELECT * FROM evaluations WHERE school_id = $1 AND legacy_json_id = $2 LIMIT 1`,
    [schoolId, "EVAL-REPO-1"],
  );
  assert.ok(pgRow, "ligne lue depuis evaluations");

  const refreshed = await repo.getBackOfficeState();
  assert.ok(refreshed, "getBackOfficeState après save");
  // Strip des acceptés : evaluations absentes du JSON durable
  assert.deepStrictEqual(refreshed.evaluations ?? [], []);

  // Anti-doublon matière accentuée : Mathématiques déjà créée → Mathematiques ne crée pas
  const subjectCountBefore = repo.tables.subjects.length;
  const again = await repo.ensureSubjectForSchool(schoolId, "Mathematiques", {});
  assert.strictEqual(repo.tables.subjects.length, subjectCountBefore);
  assert.strictEqual(normalizeText(again.name), normalizeText("Mathématiques"));

  // Deuxième sync idempotente → toujours 1 ligne evaluations
  const second = await repo.saveBackOfficeState({
    schools: [{ code: "SCH-001", name: "Lycée Test" }],
    evaluations: [{ ...evaluation, title: "Devoir maison (maj)" }],
    notes: [],
  });
  assert.deepStrictEqual(
    second.syncAck.accepted.map((item) => item.id),
    ["EVAL-REPO-1"],
  );
  assert.strictEqual(repo.tables.evaluations.length, 1);
  assert.strictEqual(repo.tables.evaluations[0].title, "Devoir maison (maj)");

  // Preuve explicite ensure année seule
  const yearRepo = createInjectablePostgresRepository();
  yearRepo.tables.schools.push({ id: schoolId, school_code: "SCH-001", name: "Lycée Test" });
  assert.strictEqual(yearRepo.tables.academic_years.length, 0);
  const createdYear = await yearRepo.ensureCurrentAcademicYearForSchool(schoolId);
  assert.ok(createdYear?.id);
  assert.strictEqual(yearRepo.tables.academic_years.length, 1);
  const sameYear = await yearRepo.ensureCurrentAcademicYearForSchool(schoolId);
  assert.strictEqual(sameYear.id, createdYear.id);
  assert.strictEqual(yearRepo.tables.academic_years.length, 1);

  console.log("evaluationSyncRepository.test.js : OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
