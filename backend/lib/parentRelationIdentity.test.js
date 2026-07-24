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
      {
        id: "USER-3",
        contactId: "CNT-MISSING",
        role: "Parent",
        firstName: "Ghost",
        lastName: "Contact",
      },
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
        id: "REL-MISSING-CONTACT",
        relationType: "Parent → Élève",
        fromContactId: "USER-3",
        toStudentId: "STU-4",
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
  assert.strictEqual(before.summary.total, 4);
  assert.strictEqual(before.summary.canonical, 1);
  assert.strictEqual(before.summary.legacyUserId, 1);
  assert.strictEqual(before.summary.legacyMissingContact, 1);
  assert.strictEqual(before.summary.orphan, 1);

  const missingItem = before.items.find((row) => row.relationId === "REL-MISSING-CONTACT");
  assert.strictEqual(missingItem.status, "legacy_missing_contact");
  assert.strictEqual(missingItem.mappedContactId, "CNT-MISSING");
  assert.strictEqual(missingItem.mappedContactExists, false);

  const first = migrateParentRelationsToContactId(state);
  assert.strictEqual(first.changed, 1);
  assert.strictEqual(first.skippedMissingContact, 1);
  const legacy = first.relations.find((row) => row.id === "REL-LEGACY");
  assert.strictEqual(legacy.fromContactId, "CNT-1");
  const untouchedMissing = first.relations.find((row) => row.id === "REL-MISSING-CONTACT");
  assert.strictEqual(
    untouchedMissing.fromContactId,
    "USER-3",
    "ne remappe pas si contact cible absent",
  );
  assert.strictEqual(first.inventory.summary.legacyUserId, 0);
  assert.strictEqual(first.inventory.summary.legacyMissingContact, 1);
  assert.strictEqual(first.inventory.summary.canonical, 2);

  const second = migrateParentRelationsToContactId({ ...state, relations: first.relations });
  assert.strictEqual(second.changed, 0, "migration idempotente");
  assert.strictEqual(second.skippedMissingContact, 1);

  console.log("parentRelationIdentity.test.js : OK");
}

run();
