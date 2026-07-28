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

  const duplicateState = {
    teachers: [
      {
        id: "TEACHERS-OLD",
        identifier: "TEACHERS-OLD",
        schoolCode: "CD-2026-0002",
        name: "Mathieu Laurelle",
        firstName: "Mathieu",
        userId: "USERS-OLD",
      },
      {
        id: "TEACHERS-NEW",
        identifier: "TEACHERS-NEW",
        schoolCode: "CD-2026-0002",
        name: "Mathieu Laurelle",
        firstName: "Mathieu",
      },
    ],
    assignments: [
      {
        id: "ASSIGN-DUPLICATE",
        teacherId: "TEACHERS-NEW",
        schoolCode: "CD-2026-0002",
        className: "1ère A",
        subject: "Mathématiques",
      },
    ],
    classes: [
      {
        id: "CLASS-DUPLICATE",
        teacherId: "TEACHERS-OLD",
        schoolCode: "CD-2026-0002",
        name: "1ère A",
      },
    ],
    contacts: [
      {
        id: "CONTACT-DUPLICATE",
        teacherId: "TEACHERS-NEW",
        schoolCode: "CD-2026-0002",
      },
    ],
  };

  const duplicateResult = dedupeBackOfficeState(duplicateState);
  assert.strictEqual(duplicateResult.state.teachers.length, 1);
  const keptTeacherId = duplicateResult.state.teachers[0].id;
  assert.strictEqual(
    duplicateResult.state.assignments[0].teacherId,
    keptTeacherId,
  );
  assert.strictEqual(duplicateResult.state.classes[0].teacherId, keptTeacherId);
  assert.strictEqual(duplicateResult.state.contacts[0].teacherId, keptTeacherId);
  assert.strictEqual(
    duplicateResult.report.byEntity["teachers:civil-identity"],
    1,
  );

  const homonyms = dedupeBackOfficeState({
    teachers: [
      {
        id: "TEACHERS-HOMONYM-1",
        schoolCode: "CD-2026-0002",
        name: "Mathieu Laurelle",
        firstName: "Mathieu",
        birthDate: "1980-01-01",
      },
      {
        id: "TEACHERS-HOMONYM-2",
        schoolCode: "CD-2026-0002",
        name: "Mathieu Laurelle",
        firstName: "Mathieu",
        birthDate: "1990-01-01",
      },
    ],
  });
  assert.strictEqual(homonyms.state.teachers.length, 2);
  console.log("backofficeDedupe.teachers.test.js : OK");
}

run();
