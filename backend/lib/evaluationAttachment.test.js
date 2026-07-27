/**
 * HOTFIX-SYNC-02 — erreurs structurées + résolution injectable (unit).
 * Le parcours repository/PG réel est dans evaluationSyncRepository.test.js.
 */
const assert = require("assert");
const {
  resolveEvaluationAttachments,
  ERRORS,
  matchByNormalizedName,
  normalizeText,
} = require("./evaluationAttachment");

function createMemoryDeps(seed = {}) {
  const schools = new Map(Object.entries(seed.schools ?? {}));
  const classes = [...(seed.classes ?? [])];
  const subjects = [...(seed.subjects ?? [])];
  const years = [...(seed.years ?? [])];
  const terms = [...(seed.terms ?? [])];
  const teachers = [...(seed.teachers ?? [])];

  return {
    classes,
    subjects,
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
          (row) => row.school_id === schoolId && normalizeText(row.name) === normalizeText(name),
        ) ?? null,
      ensureClass: async (schoolId, name) => {
        const existing = classes.find(
          (row) => row.school_id === schoolId && normalizeText(row.name) === normalizeText(name),
        );
        if (existing) return existing;
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
            normalizeText(row.subject_code) === normalizeText(code),
        ) ?? null,
      findSubjectByName: async (schoolId, name) =>
        subjects.find(
          (row) => row.school_id === schoolId && normalizeText(row.name) === normalizeText(name),
        ) ?? null,
      ensureSubject: async (schoolId, name) => {
        const existing = subjects.find(
          (row) => row.school_id === schoolId && normalizeText(row.name) === normalizeText(name),
        );
        if (existing) return existing;
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
        let row = years.find((item) => item.school_id === schoolId);
        if (!row) {
          row = { id: `year-${schoolId}`, school_id: schoolId, name: "2026-2027", status: "open" };
          years.push(row);
        }
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
      ensureTeacher: async (schoolId, code) => {
        const existing = teachers.find(
          (row) => row.school_id === schoolId && row.teacher_code === code,
        );
        if (existing) return existing;
        if (seed.ensureTeacherCodes?.includes(code)) {
          const row = {
            id: `pg-${code}`,
            school_id: schoolId,
            teacher_code: code,
          };
          teachers.push(row);
          return row;
        }
        return null;
      },
      findTeacherByExactAssignment: async (schoolId, classId, subjectId, code) =>
        teachers.find(
          (row) =>
            row.school_id === schoolId &&
            row.teacher_code === code &&
            row.class_id === classId &&
            row.subject_id === subjectId,
        ) ?? null,
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
    },
    mem.deps,
    { ensure: true },
  );
  assert.strictEqual(resolved.schoolClass.name, "6e A");
  assert.strictEqual(resolved.subject.name, "Mathématiques");
  assert.ok(resolved.academicYear);
  assert.strictEqual(resolved.term.name, "T1");

  // Anti-doublon accentué côté résolution
  assert.strictEqual(
    matchByNormalizedName([{ name: "Mathématiques" }], "Mathematiques")?.name,
    "Mathématiques",
  );
  const beforeSubjects = mem.subjects.length;
  await resolveEvaluationAttachments(
    {
      schoolCode: "SCH-001",
      className: "6e A",
      subject: "Mathematiques",
      period: "T1",
    },
    mem.deps,
    { ensure: true },
  );
  assert.strictEqual(mem.subjects.length, beforeSubjects, "pas de doublon matière accentuée");

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
  assert.ok(ERRORS.YEAR_MISSING().code === "EVAL_ATTACHMENT_YEAR");

  // FIX V2.1 §5.2 — sans teacherId : pas de findAnyTeacher opportuniste
  const noTeacher = await resolveEvaluationAttachments(
    {
      schoolCode: "SCH-001",
      className: "6e A",
      subject: "Mathématiques",
      period: "T1",
    },
    createMemoryDeps({
      schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
      teachers: [{ id: "t-any", school_id: "s1", teacher_code: "TEACHER-ANY" }],
    }).deps,
    { ensure: true },
  );
  assert.strictEqual(noTeacher.teacher, null, "pas de choix opportuniste d'enseignant");

  // teacherId exact → résolution
  const withTeacher = await resolveEvaluationAttachments(
    {
      schoolCode: "SCH-001",
      className: "6e A",
      subject: "Mathématiques",
      period: "T1",
      teacherId: "TEACHERS-exact",
    },
    createMemoryDeps({
      schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
      teachers: [{ id: "t1", school_id: "s1", teacher_code: "TEACHERS-exact" }],
    }).deps,
    { ensure: true },
  );
  assert.strictEqual(withTeacher.teacher.teacher_code, "TEACHERS-exact");

  // teacherId inconnu → refus structuré (pas de fallback)
  await assert.rejects(
    () =>
      resolveEvaluationAttachments(
        {
          schoolCode: "SCH-001",
          className: "6e A",
          subject: "Mathématiques",
          period: "T1",
          teacherId: "TEACHERS-missing",
        },
        createMemoryDeps({
          schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
          teachers: [{ id: "t-other", school_id: "s1", teacher_code: "TEACHER-other" }],
        }).deps,
        { ensure: true },
      ),
    (error) => {
      assert.strictEqual(error.code, "EVAL_TEACHER_UNRESOLVED");
      return true;
    },
  );

  // requireTeacher sans teacherId
  await assert.rejects(
    () =>
      resolveEvaluationAttachments(
        {
          schoolCode: "SCH-001",
          className: "6e A",
          subject: "Mathématiques",
          period: "T1",
        },
        createMemoryDeps({
          schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
        }).deps,
        { ensure: true, requireTeacher: true },
      ),
    (error) => error.code === "EVAL_TEACHER_REQUIRED",
  );

  // Matérialisation exacte via ensureTeacher
  const materialized = await resolveEvaluationAttachments(
    {
      schoolCode: "SCH-001",
      className: "6e A",
      subject: "Mathématiques",
      period: "T1",
      teacherId: "TEACHERS-new",
    },
    createMemoryDeps({
      schools: { "SCH-001": { id: "s1", school_code: "SCH-001" } },
      ensureTeacherCodes: ["TEACHERS-new"],
    }).deps,
    { ensure: true },
  );
  assert.strictEqual(materialized.teacher.teacher_code, "TEACHERS-new");

  console.log("evaluationAttachment.test.js : OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
