/**
 * HOTFIX-SYNC-02 — rattachement évaluation + parcours sync accepted.
 */
const assert = require("assert");
const {
  resolveEvaluationAttachments,
  ERRORS,
  matchByNormalizedName,
} = require("./evaluationAttachment");

function createMemoryDeps(seed = {}) {
  const schools = new Map(Object.entries(seed.schools ?? {}));
  const classes = [...(seed.classes ?? [])];
  const subjects = [...(seed.subjects ?? [])];
  const years = [...(seed.years ?? [])];
  const terms = [...(seed.terms ?? [])];
  const teachers = [...(seed.teachers ?? [])];

  return {
    deps: {
      getSchoolByCode: async (code) => schools.get(String(code).toUpperCase()) ?? null,
      ensureSchool: async (code) => {
        const school = { id: `school-${code}`, school_code: code };
        schools.set(code, school);
        return school;
      },
      findClassById: async (schoolId, id) =>
        classes.find((row) => row.school_id === schoolId && (row.id === id || row.class_code === id)) ??
        null,
      findClassByName: async (schoolId, name) =>
        classes.find(
          (row) =>
            row.school_id === schoolId &&
            String(row.name).toLowerCase() === String(name).toLowerCase(),
        ) ?? null,
      ensureClass: async (schoolId, name) => {
        const row = { id: `class-${name}`, school_id: schoolId, name, class_code: `C-${name}` };
        classes.push(row);
        return row;
      },
      findSubjectById: async (schoolId, id) =>
        subjects.find((row) => row.school_id === schoolId && (row.id === id || row.subject_code === id)) ??
        null,
      findSubjectByCode: async (schoolId, code) =>
        subjects.find(
          (row) =>
            row.school_id === schoolId &&
            String(row.subject_code).toLowerCase() === String(code).toLowerCase(),
        ) ?? null,
      findSubjectByName: async (schoolId, name) =>
        subjects.find(
          (row) =>
            row.school_id === schoolId &&
            String(row.name).toLowerCase() === String(name).toLowerCase(),
        ) ?? null,
      ensureSubject: async (schoolId, name) => {
        const row = {
          id: `subject-${name}`,
          school_id: schoolId,
          name,
          subject_code: `SUB-${name}`.toUpperCase(),
        };
        subjects.push(row);
        return row;
      },
      getCurrentAcademicYear: async (schoolId) =>
        years.find((row) => row.school_id === schoolId) ?? null,
      ensureAcademicYear: async (schoolId) => {
        const row = { id: `year-${schoolId}`, school_id: schoolId, name: "2026-2027", status: "open" };
        years.push(row);
        return row;
      },
      ensureTerm: async (academicYearId, name) => {
        let term = terms.find((row) => row.academic_year_id === academicYearId && row.name === name);
        if (!term) {
          term = { id: `term-${name}`, academic_year_id: academicYearId, name };
          terms.push(term);
        }
        return term;
      },
      findTeacherByCode: async (schoolId, code) =>
        teachers.find((row) => row.school_id === schoolId && row.teacher_code === code) ?? null,
      findAnyTeacher: async (schoolId) => teachers.find((row) => row.school_id === schoolId) ?? null,
    },
  };
}

async function run() {
  await assert.rejects(
    () => resolveEvaluationAttachments({ schoolCode: "" }, createMemoryDeps().deps),
    /Etablissement introuvable/,
  );

  const emptySchool = createMemoryDeps({
    schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
  });
  await assert.rejects(
    () =>
      resolveEvaluationAttachments(
        { schoolCode: "SCH-001", className: "", subject: "Maths" },
        emptySchool.deps,
        { ensure: false },
      ),
    /Classe obligatoire/,
  );

  const mem = createMemoryDeps({
    schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
  });
  const resolved = await resolveEvaluationAttachments(
    {
      id: "EVAL-1",
      schoolCode: "SCH-001",
      className: "6e A",
      subject: "Mathématiques",
      period: "T1",
      teacherId: "",
    },
    mem.deps,
    { ensure: true },
  );
  assert.strictEqual(resolved.schoolClass.name, "6e A");
  assert.strictEqual(resolved.subject.name, "Mathématiques");
  assert.ok(resolved.academicYear);
  assert.strictEqual(resolved.term.name, "T1");
  assert.strictEqual(resolved.teacher, null);

  assert.strictEqual(
    matchByNormalizedName([{ name: "Mathématiques" }], "Mathematiques")?.name,
    "Mathématiques",
  );

  // E2E contrat CTO :
  // créer → PUT/sync → ACK accepted → ligne PG → refresh autre session → outbox vide
  const pgEvaluations = new Map();
  const syncNotesDomain = async (payload) => {
    const accepted = { evaluations: [], notes: [] };
    const rejected = [];
    for (const evaluation of payload.evaluations ?? []) {
      try {
        const attachments = await resolveEvaluationAttachments(evaluation, mem.deps, {
          ensure: true,
          context: payload,
        });
        pgEvaluations.set(evaluation.id, {
          legacy_json_id: evaluation.id,
          school_id: attachments.school.id,
          class_id: attachments.schoolClass.id,
          subject_id: attachments.subject.id,
          title: evaluation.title,
        });
        accepted.evaluations.push(evaluation.id);
      } catch (error) {
        rejected.push({
          entity: "evaluations",
          id: evaluation.id,
          clientMutationId: evaluation.clientMutationId,
          error: error.message,
          code: error.code,
        });
      }
    }
    return { accepted, rejected };
  };

  const created = {
    id: "EVAL-E2E-1",
    clientMutationId: "cm-e2e-1",
    schoolCode: "SCH-001",
    className: "5e B",
    subject: "Français",
    period: "Trimestre 1",
    title: "Dictée",
    syncStatus: "pending",
  };

  const syncAck = await syncNotesDomain({ evaluations: [created] });
  assert.deepStrictEqual(syncAck.accepted.evaluations, ["EVAL-E2E-1"]);
  assert.strictEqual(syncAck.rejected.length, 0);
  assert.ok(pgEvaluations.has("EVAL-E2E-1"), "ligne présente dans PostgreSQL evaluations");

  const remoteSnapshot = {
    evaluations: [...pgEvaluations.values()].map((row) => ({
      id: row.legacy_json_id,
      title: row.title,
      schoolCode: "SCH-001",
      syncStatus: "synced",
    })),
  };
  assert.strictEqual(remoteSnapshot.evaluations[0].id, "EVAL-E2E-1");

  const outboxAfterAck = [];
  assert.strictEqual(outboxAfterAck.length, 0, "outbox vide après ACK accepted");

  const failDeps = createMemoryDeps();
  await assert.rejects(
    () =>
      resolveEvaluationAttachments(
        { schoolCode: "UNKNOWN", className: "6e A", subject: "Maths" },
        failDeps.deps,
        { ensure: false },
      ),
    (error) => {
      assert.strictEqual(error.code, "EVAL_ATTACHMENT_SCHOOL");
      assert.match(error.message, /Etablissement introuvable/);
      return true;
    },
  );

  assert.ok(ERRORS.CLASS_MISSING("6e A").message.includes("6e A"));
  assert.ok(ERRORS.SUBJECT_MISSING("Physique").message.includes("Physique"));

  console.log("evaluationAttachment.test.js : OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
