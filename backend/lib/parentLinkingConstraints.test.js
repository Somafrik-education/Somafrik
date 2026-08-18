"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  CONTACTS_SCHOOL_USER_DUPLICATES_CODE,
  CONTACT_RELATIONS_ACTIVE_DUPLICATES_CODE,
  CONTACTS_SCHOOL_USER_UNIQUE_INDEX,
  CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX,
  formatContactsSchoolUserDuplicateDiagnostic,
  formatContactRelationsActiveDuplicateDiagnostic,
  ensureParentLinkingConstraints,
} = require("./parentLinkingConstraints");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");

const postgresRepositorySource = fs.readFileSync(
  path.join(__dirname, "../db/postgresRepository.js"),
  "utf8",
);
const parentLinkingMigration = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260818_parent_linking_canonical.sql"),
  "utf8",
);

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

  assert.doesNotMatch(CLIENTS_SCHEMA_SQL, /uq_contacts_school_user_active/);
  assert.doesNotMatch(CLIENTS_SCHEMA_SQL, /uq_contact_relations_active/);
  assert.match(CLIENTS_SCHEMA_SQL, /ensureParentLinkingConstraints/);
  assert.equal(CONTACTS_SCHOOL_USER_UNIQUE_INDEX, "uq_contacts_school_user_active");
  assert.equal(CONTACT_RELATIONS_ACTIVE_UNIQUE_INDEX, "uq_contact_relations_active");

  assert.match(postgresRepositorySource, /ensureClientsCanonicalBootstrap/);
  const clientsIdx = postgresRepositorySource.indexOf("ensureClientsCanonicalSchema()");
  assert.ok(clientsIdx > 0, "init() must apply Clients canonical bootstrap");
  const schemaFn = postgresRepositorySource.indexOf("async ensureClientsCanonicalSchema()");
  const schemaFnEnd = postgresRepositorySource.indexOf("async ensureUserRolesCanonicalSchema()", schemaFn);
  const schemaFnBody = postgresRepositorySource.slice(schemaFn, schemaFnEnd);
  assert.match(schemaFnBody, /ensureClientsCanonicalBootstrap/);
  assert.doesNotMatch(schemaFnBody, /uq_contacts_school_user_active/);
  assert.doesNotMatch(schemaFnBody, /uq_contact_relations_active/);

  assert.match(
    parentLinkingMigration,
    /DROP CONSTRAINT IF EXISTS contact_relations_school_id_contact_id_student_id_key/,
  );
  assert.doesNotMatch(parentLinkingMigration, /^\s*CREATE UNIQUE INDEX/im);

  console.log("parentLinkingConstraints.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
