/**
 *   npx tsx Mobile/src/lib/canonicalResourceNormalize.test.ts
 */
import assert from "node:assert/strict";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeTeacher,
  readTenantScopeFields,
} from "./canonicalResourceNormalize";

function run() {
  const tenant = readTenantScopeFields({
    school_code: "CD-2026-0001",
    schoolId: "uuid-school",
    country_code: "CD",
  });
  assert.equal(tenant.schoolCode, "CD-2026-0001");
  assert.equal(tenant.schoolId, "uuid-school");
  assert.equal(tenant.countryCode, "CD");

  const teacher = normalizeTeacher({
    id: "ENS-9",
    teacher_code: "CD-IN-ENS-26-009",
    first_name: "Amina",
    last_name: "Diallo",
    schoolCode: "CD-2026-0001",
    assigned_classes: [],
  });
  assert.equal(teacher?.schoolCode, "CD-2026-0001");
  assert.deepEqual(teacher?.assignedClasses, []);

  const announcement = normalizeAnnouncement({
    id: "ann-pg",
    title: "Conseil",
    message: "18h",
    school_code: "CD-2026-0001",
    school_id: "school-1",
  });
  assert.equal(announcement?.schoolCode, "CD-2026-0001");
  assert.equal(announcement?.schoolId, "school-1");
  assert.equal(announcement?.systemBroadcast, false);

  const message = normalizeMessage({
    id: "msg-pg",
    parent_phone: "+243820000009",
    theme: "Absence",
    message: "Justifiée",
    school_code: "CD-2026-0001",
  });
  assert.equal(message?.schoolCode, "CD-2026-0001");

  console.log("canonicalResourceNormalize.test.ts OK");
}

run();
