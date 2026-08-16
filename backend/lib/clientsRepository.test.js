"use strict";

const assert = require("node:assert/strict");
const { createClientsMemoryStore } = require("../db/clientsMemoryStore");
const { collectSensitiveUserFieldPaths } = require("./sanitizeUserForResponse");

async function main() {
  const store = createClientsMemoryStore({
    school: { id: "school-1", code: "CD-2026-0001", loginCode: "CD-IN-26-001", name: "INSTITUT NURU", countryId: "country-1", countryCode: "CD" },
    platformSchools: [{ id: "school-1", code: "CD-2026-0001", loginCode: "CD-IN-26-001", name: "INSTITUT NURU", countryId: "country-1", countryCode: "CD" }],
    students: [{ id: "student-1", school_id: "school-1", first_name: "Jean", last_name: "Kabila", studentCode: "STU-1" }],
  });

  const principal = {
    sub: "actor-1",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    identifier: "admin",
  };
  const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

  const contact = await store.createContact(
    {
      firstName: "Paul",
      lastName: "Mukendi",
      contactType: "Parent",
      phone: "+243900000099",
      schoolCode: "CD-2026-0001",
    },
    principal,
    auditMeta,
  );

  const provisioned = await store.provisionContactAccount(
    contact.id,
    { role: "Parent", studentId: "student-1" },
    principal,
    auditMeta,
  );

  assert.equal(provisioned.created, true);
  assert.ok(provisioned.temporaryPassword);
  assert.equal(provisioned.user.passwordHash, undefined);
  assert.equal(provisioned.user.pinHash, undefined);

  const projection = store.listProjection();
  assert.ok(projection.users.length >= 1);
  const projected = projection.users.find((row) => row.id === provisioned.user.id);
  assert.equal(projected.schoolCode, "CD-2026-0001");
  assert.equal(projected.schoolPublicCode, "CD-IN-26-001");
  assert.equal(projected.schoolName, "INSTITUT NURU");
  assert.ok(projection.contacts.length >= 1);
  assert.ok(projection.relations.length >= 1);

  console.log("clientsRepository.test.js OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
