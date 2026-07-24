const assert = require("assert");
const { resolveParentChildren } = require("./parentChildren");

function run() {
  const schoolCode = "SCH-001";
  const studentRel = {
    id: "STU-REL",
    schoolCode,
    firstName: "Jean",
    name: "Rel",
    parentPhone: "+243 999",
  };
  const studentPhone = {
    id: "STU-PHONE",
    schoolCode,
    firstName: "Marie",
    name: "Phone",
    parentPhone: "+243 111 222",
  };

  const user = {
    id: "USER-1",
    contactId: "CNT-1",
    identifier: "+243 111 222",
    phone: "+243 111 222",
    schoolCode,
  };

  // Relations-only (pas de fallback téléphone si relation matche)
  const viaRelation = resolveParentChildren(
    user,
    {
      students: [studentRel, studentPhone],
      relations: [
        {
          relationType: "Parent → Élève",
          fromContactId: "CNT-1",
          toStudentId: "STU-REL",
          schoolCode,
        },
      ],
    },
    schoolCode,
  );
  assert.strictEqual(viaRelation.length, 1);
  assert.strictEqual(viaRelation[0].id, "STU-REL");

  // Fallback téléphone uniquement si aucune relation
  const viaPhone = resolveParentChildren(
    user,
    { students: [studentRel, studentPhone], relations: [] },
    schoolCode,
  );
  assert.strictEqual(viaPhone.length, 1);
  assert.strictEqual(viaPhone[0].id, "STU-PHONE");

  // user.id dans fromContactId ne résout rien (contrat contactId)
  const wrongKey = resolveParentChildren(
    user,
    {
      students: [studentRel],
      relations: [
        {
          relationType: "Parent → Élève",
          fromContactId: "USER-1",
          toStudentId: "STU-REL",
          schoolCode,
        },
      ],
    },
    schoolCode,
  );
  assert.strictEqual(wrongKey.length, 0);

  console.log("parentChildren.test.js : OK");
}

run();
