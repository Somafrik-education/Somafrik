/**
 * HOTFIX-PRE-E1-02B — Dedupe teachers ne doit pas écraser TEACHERS-* via identifier login.
 */
const assert = require("assert");
const { dedupeBackOfficeState } = require("./backofficeDedupe");

function run() {
  const state = {
    teachers: [
      {
        id: "TEACHER-1",
        userId: "USERS-1",
        identifier: "ENS-0001",
        publicId: "CD-SCH-ENS-0001",
        schoolCode: "SCH-A",
        firstName: "A",
        lastName: "Parasite",
      },
      {
        id: "TEACHERS-1",
        userId: "USERS-1",
        identifier: "ENS-0001",
        schoolCode: "SCH-A",
        firstName: "A",
        lastName: "Pedagogy",
      },
    ],
    assignments: [
      {
        id: "ASSIGN-1",
        teacherId: "TEACHERS-1",
        className: "6e A",
        subject: "Mathématiques",
        schoolCode: "SCH-A",
      },
    ],
  };

  const { state: deduped } = dedupeBackOfficeState(state);
  const ids = (deduped.teachers ?? []).map((row) => row.id).sort();
  assert.deepStrictEqual(ids, ["TEACHER-1", "TEACHERS-1"]);
  assert.strictEqual(
    (deduped.assignments ?? []).some((row) => row.teacherId === "TEACHERS-1"),
    true,
  );
  console.log("backofficeDedupe.teachers.test.js : OK");
}

run();
