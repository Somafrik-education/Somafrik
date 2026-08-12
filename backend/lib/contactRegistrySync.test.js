/**
 * PR2 — contactRegistrySync : no-op élèves, purge enseignants inchangée.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  linkContactToOperationalRecord,
  syncContactRegistry,
} = require("./contactRegistrySync");

test("linkContactToOperationalRecord ignore les contacts Élève", () => {
  const contact = {
    id: "CONTACT-1",
    contactType: "Élève",
    schoolCode: "SCH-A",
    lastName: "Kabeya",
    firstName: "Léa",
  };
  const state = { students: [], teachers: [] };
  const result = linkContactToOperationalRecord(contact, state);
  assert.equal(result.students, null);
  assert.equal(result.teachers, null);
  assert.equal(result.linkedType, undefined);
  assert.equal(result.created, undefined);
  assert.deepEqual(result.contact, contact);
});

test("linkContactToOperationalRecord crée toujours une fiche enseignant", () => {
  const contact = {
    id: "CONTACT-T1",
    contactType: "Enseignant",
    schoolCode: "SCH-A",
    lastName: "Mukendi",
    firstName: "Jean",
  };
  const result = linkContactToOperationalRecord(contact, { students: [], teachers: [] });
  assert.equal(result.linkedType, "teacher");
  assert.equal(result.created, true);
  assert.ok(Array.isArray(result.teachers) && result.teachers.length === 1);
  assert.equal(result.students, null);
});

test("syncContactRegistry conserve la projection students et purge enseignants orphelins", () => {
  const state = {
    contacts: [
      {
        id: "CONTACT-T1",
        contactType: "Enseignant",
        schoolCode: "SCH-A",
        lastName: "Prof",
        firstName: "Ok",
        teacherId: "TEACHERS-1",
      },
    ],
    students: [
      { id: "STUDENTS-ORPHAN", name: "Orphelin", firstName: "X", schoolCode: "SCH-A" },
      { id: "STUDENTS-2", name: "Autre", firstName: "Y", schoolCode: "SCH-A", contactId: "CONTACT-MISSING" },
    ],
    teachers: [
      { id: "TEACHERS-1", name: "Prof", firstName: "Ok", schoolCode: "SCH-A", contactId: "CONTACT-T1" },
      { id: "TEACHERS-ORPHAN", name: "Ghost", firstName: "T", schoolCode: "SCH-A" },
    ],
    users: [],
    notes: [{ id: "N1", studentId: "STUDENTS-ORPHAN" }],
    relations: [],
    presences: [],
    payments: [],
    bulletins: [],
    documents: [],
    assignments: [],
    courses: [],
  };

  const { state: next, report } = syncContactRegistry(state);
  assert.equal(next.students.length, 2);
  assert.equal(report.removed.students, 0);
  assert.ok(next.students.some((row) => row.id === "STUDENTS-ORPHAN"));
  assert.equal(next.notes.length, 1);
  assert.ok(next.teachers.some((row) => row.id === "TEACHERS-1"));
  assert.ok(!next.teachers.some((row) => row.id === "TEACHERS-ORPHAN"));
  assert.ok(report.removed.teachers >= 1);
});
