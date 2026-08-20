/**
 *   npx tsx Mobile/src/lib/canonicalResourceNormalize.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeSchool,
  normalizeTeacher,
  readTenantScopeFields,
} from "./canonicalResourceNormalize";

function run() {
  const tenant = readTenantScopeFields({
    school_code: "CD-IN-26-001",
    schoolId: "uuid-school",
    country_code: "CD",
  });
  assert.equal(tenant.schoolCode, "CD-IN-26-001");
  assert.equal(tenant.schoolId, "uuid-school");
  assert.equal(tenant.countryCode, "CD");

  const teacher = normalizeTeacher({
    id: "ENS-9",
    teacher_code: "CD-IN-ENS-26-009",
    first_name: "Amina",
    last_name: "Diallo",
    schoolCode: "CD-IN-26-001",
    assigned_classes: [],
  });
  assert.equal(teacher?.schoolCode, "CD-IN-26-001");
  assert.deepEqual(teacher?.assignedClasses, []);

  const announcement = normalizeAnnouncement({
    id: "ann-pg",
    title: "Conseil",
    message: "18h",
    school_code: "CD-IN-26-001",
    school_id: "school-1",
  });
  assert.equal(announcement?.schoolCode, "CD-IN-26-001");
  assert.equal(announcement?.schoolId, "school-1");
  assert.equal(announcement?.systemBroadcast, false);

  const message = normalizeMessage({
    id: "msg-pg",
    parent_phone: "+243820000009",
    theme: "Absence",
    message: "Justifiée",
    school_code: "CD-IN-26-001",
  });
  assert.equal(message?.schoolCode, "CD-IN-26-001");

  const school = normalizeSchool({
    id: "school-uuid",
    code: "CD-IN-26-001",
    loginCode: "CD-IN-26-001",
    name: "Institut Nuru",
    countryCode: "CD",
  });
  assert.equal(school?.code, "CD-IN-26-001");
  assert.equal(school?.name, "Institut Nuru");
  assert.equal(school?.countryCode, "CD");

  console.log("canonicalResourceNormalize.test.ts OK");
}

run();
