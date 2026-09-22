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

  // Projection PG : student.id = code, relation.toStudentId = UUID, contact via user_id.
  const viaContactUser = resolveParentChildren(
    { id: "USER-PARENT", identifier: "+243 000", phone: "+243 000", schoolCode },
    {
      contacts: [{ id: "CNT-PG", userId: "USER-PARENT", schoolCode, status: "Actif" }],
      students: [
        {
          id: "STU-CODE",
          studentUuid: "uuid-child",
          schoolCode,
          name: "Enfant Lié",
          className: "6ème A",
        },
        {
          id: "STU-OTHER-SCHOOL",
          studentUuid: "uuid-foreign",
          schoolCode: "SCH-OTHER",
          name: "Hors tenant",
        },
        {
          id: "STU-PHONE-ONLY",
          schoolCode,
          name: "Téléphone seul",
          parentPhone: "+243 000",
        },
      ],
      relations: [
        {
          fromContactId: "CNT-PG",
          toStudentId: "uuid-child",
          schoolCode,
          status: "Actif",
        },
        {
          fromContactId: "CNT-PG",
          toStudentId: "uuid-foreign",
          schoolCode: "SCH-OTHER",
          status: "Actif",
        },
        {
          fromContactId: "CNT-PG",
          toStudentId: "uuid-archived",
          schoolCode,
          status: "Inactif",
        },
      ],
    },
    schoolCode,
  );
  assert.strictEqual(viaContactUser.length, 1);
  assert.strictEqual(viaContactUser[0].id, "STU-CODE");
  assert.strictEqual(viaContactUser[0].studentUuid, "uuid-child");

  console.log("parentChildren.test.js : OK");
}

run();
