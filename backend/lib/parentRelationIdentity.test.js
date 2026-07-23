const assert = require("assert");
const {
  inventoryParentRelations,
  migrateParentRelationsToContactId,
} = require("./parentRelationIdentity");

function run() {
  const state = {
    contacts: [{ id: "CNT-1", contactType: "Parent" }],
    users: [
      { id: "USER-1", contactId: "CNT-1", role: "Parent", firstName: "Awa", lastName: "Diallo" },
      { id: "USER-2", role: "Parent", firstName: "No", lastName: "Contact" },
    ],
    relations: [
      {
        id: "REL-CANON",
        relationType: "Parent → Élève",
        fromContactId: "CNT-1",
        toStudentId: "STU-1",
      },
      {
        id: "REL-LEGACY",
        relationType: "Parent → Élève",
        fromContactId: "USER-1",
        toStudentId: "STU-2",
      },
      {
        id: "REL-ORPHAN",
        relationType: "Parent → Élève",
        fromContactId: "UNKNOWN",
        toStudentId: "STU-3",
      },
      {
        id: "REL-OTHER",
        relationType: "Autre",
        fromContactId: "USER-1",
        toStudentId: "STU-9",
      },
    ],
  };

  const before = inventoryParentRelations(state);
  assert.strictEqual(before.summary.total, 3);
  assert.strictEqual(before.summary.canonical, 1);
  assert.strictEqual(before.summary.legacyUserId, 1);
  assert.strictEqual(before.summary.orphan, 1);

  const first = migrateParentRelationsToContactId(state);
  assert.strictEqual(first.changed, 1);
  const legacy = first.relations.find((row) => row.id === "REL-LEGACY");
  assert.strictEqual(legacy.fromContactId, "CNT-1");
  assert.strictEqual(first.inventory.summary.legacyUserId, 0);
  assert.strictEqual(first.inventory.summary.canonical, 2);

  const second = migrateParentRelationsToContactId({ ...state, relations: first.relations });
  assert.strictEqual(second.changed, 0, "migration idempotente");

  console.log("parentRelationIdentity.test.js : OK");
}

run();
