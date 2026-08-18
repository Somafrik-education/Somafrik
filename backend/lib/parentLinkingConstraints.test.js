"use strict";

const assert = require("node:assert/strict");
const {
  CONTACTS_SCHOOL_USER_DUPLICATES_CODE,
  CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE,
  formatContactsSchoolUserDuplicateDiagnostic,
  formatContactRelationsActiveDuplicateDiagnostic,
  ensureParentLinkingConstraints,
} = require("./parentLinkingConstraints");

async function main() {
  const contactDiag = formatContactsSchoolUserDuplicateDiagnostic(
    [{ school_code: "CD-2026-0001", user_id: "u1", duplicate_count: 2 }],
    1,
  );
  assert.match(contactDiag, /1 groupe\(s\) en doublon/);
  assert.match(contactDiag, /CD-2026-0001/);
  assert.equal(CONTACTS_SCHOOL_USER_DUPLICATES_CODE, "CONTACTS_SCHOOL_USER_DUPLICATES");

  const relDiag = formatContactRelationsActiveDuplicateDiagnostic(
    [{ school_code: "CD-2026-0001", contact_id: "c1", student_id: "s1", duplicate_count: 2 }],
    1,
  );
  assert.match(relDiag, /1 groupe\(s\) actifs/);
  assert.equal(CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE, "CONTACT_RELATIONS_ACTIVE_DUPLICATES");

  const failingDb = {
    one: async () => ({ duplicate_groups: 1 }),
    all: async () => [{ school_code: "CD-2026-0001", user_id: "u1", duplicate_count: 2, contact_ids: ["a", "b"] }],
    query: async () => {
      throw new Error("query should not run when inventory fails");
    },
  };
  await assert.rejects(
    () => ensureParentLinkingConstraints(failingDb, { info() {}, error() {} }),
    (error) => error.code === CONTACTS_SCHOOL_USER_DUPLICATES_CODE,
  );

  console.log("parentLinkingConstraints.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
