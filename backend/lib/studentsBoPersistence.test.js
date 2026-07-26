/**
 * HOTFIX-PRE-E1-01 — Contrat sync élèves (helpers purs).
 */
const assert = require("assert");
const {
  resolveStableStudentCode,
  validateStudentSyncRecord,
  shouldSyncStudentsFromPayload,
  mergeStudentAndNotesSyncAck,
} = require("./studentsBoPersistence");

function run() {
  assert.strictEqual(
    resolveStableStudentCode({
      id: "STUDENTS-1",
      publicId: "PUB-1",
      matricule: "MAT-1",
    }),
    "MAT-1",
  );
  assert.strictEqual(
    resolveStableStudentCode({ id: "STUDENTS-1", publicId: "PUB-1" }),
    "PUB-1",
  );
  assert.strictEqual(resolveStableStudentCode({ id: "STUDENTS-1" }), "STUDENTS-1");
  assert.strictEqual(resolveStableStudentCode({}), "");

  const ok = validateStudentSyncRecord({
    id: "STUDENTS-1",
    schoolCode: "cd-2026-0001",
  });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.studentCode, "STUDENTS-1");
  assert.strictEqual(ok.schoolCode, "CD-2026-0001");

  const noSchool = validateStudentSyncRecord({ id: "STUDENTS-1" });
  assert.strictEqual(noSchool.ok, false);
  assert.strictEqual(noSchool.code, "STUDENT_SYNC_SCHOOL_REQUIRED");

  const noId = validateStudentSyncRecord({ schoolCode: "SCH-A" });
  assert.strictEqual(noId.ok, false);
  assert.strictEqual(noId.code, "STUDENT_SYNC_ID_REQUIRED");

  assert.strictEqual(shouldSyncStudentsFromPayload({ students: [] }), true);
  assert.strictEqual(shouldSyncStudentsFromPayload({ notes: [] }), false);
  assert.strictEqual(shouldSyncStudentsFromPayload({}), false);

  const ack = mergeStudentAndNotesSyncAck(
    {
      accepted: { students: ["S1"], enrollments: ["S1"] },
      rejected: [{ entity: "students", id: "S2", error: "x" }],
    },
    {
      accepted: { evaluations: ["E1"], notes: ["N1"] },
      rejected: [],
    },
  );
  assert.deepStrictEqual(
    ack.accepted.map((row) => `${row.entity}:${row.id}`),
    ["students:S1", "enrollments:S1", "evaluations:E1", "notes:N1"],
  );
  assert.strictEqual(ack.rejected.length, 1);

  console.log("studentsBoPersistence.test.js : OK");
}

run();
