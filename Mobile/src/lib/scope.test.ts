/**
 * Filtrage partagé : une annonce établissement et un enseignant sans affectation
 * restent visibles après normalisation + scopeSchoolEntityData.
 *   npx tsx Mobile/src/lib/scope.test.ts
 */
import assert from "node:assert/strict";
import { scopeBackOfficeForSession, scopeSchoolEntityData } from "./scope";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeTeacher,
} from "./canonicalResourceNormalize";

const SCHOOL = "CD-2026-0001";
const OTHER = "BI-2026-0001";

function emptyPayload(overrides: Record<string, unknown> = {}) {
  return {
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    payments: [],
    presences: [],
    notes: [],
    announcements: [],
    messages: [],
    users: [],
    schools: [],
    paymentStatuses: [],
    subscriptions: [],
    countries: [],
    notifications: [],
    ...overrides,
  };
}

function run() {
  const schoolAnnouncement = normalizeAnnouncement({
    id: "ann-school",
    title: "Réunion parents",
    message: "Salle 2",
    schoolCode: SCHOOL,
    school_id: "school-uuid-1",
  });
  const otherAnnouncement = normalizeAnnouncement({
    id: "ann-other",
    title: "Autre établissement",
    schoolCode: OTHER,
  });
  const systemAnnouncement = normalizeAnnouncement({
    id: "ann-sys",
    title: "Diffusion système",
    systemBroadcast: true,
  });
  if (!schoolAnnouncement || !otherAnnouncement || !systemAnnouncement) {
    throw new Error("normalizeAnnouncement a échoué");
  }
  assert.equal(schoolAnnouncement.schoolCode, SCHOOL);
  assert.equal(schoolAnnouncement.schoolId, "school-uuid-1");

  const unassignedTeacher = normalizeTeacher({
    id: "ENS-1",
    teacherCode: "ENS-1",
    firstName: "Jean",
    lastName: "Nkomo",
    schoolCode: SCHOOL,
    assignedClasses: [],
    assignments: [],
  });
  const otherTeacher = normalizeTeacher({
    id: "ENS-2",
    teacherCode: "ENS-2",
    firstName: "Paul",
    school_code: OTHER,
    assignedClasses: [],
  });
  if (!unassignedTeacher || !otherTeacher) {
    throw new Error("normalizeTeacher a échoué");
  }
  assert.equal(unassignedTeacher.schoolCode, SCHOOL);
  assert.deepEqual(unassignedTeacher.assignedClasses, []);

  const schoolMessage = normalizeMessage({
    id: "msg-1",
    parentPhone: "+243820000001",
    theme: "Retard",
    message: "Bonjour",
    schoolCode: SCHOOL,
  });
  if (!schoolMessage) {
    throw new Error("normalizeMessage a échoué");
  }
  assert.equal(schoolMessage.schoolCode, SCHOOL);

  const scoped = scopeSchoolEntityData(
    emptyPayload({
      announcements: [schoolAnnouncement, otherAnnouncement, systemAnnouncement],
      teachers: [unassignedTeacher, otherTeacher],
      messages: [schoolMessage, { ...schoolMessage, id: "msg-other", schoolCode: OTHER }],
    }),
    SCHOOL,
  ) as {
    announcements: Array<{ id: string }>;
    teachers: Array<{ id: string }>;
    messages: Array<{ id: string }>;
  };

  assert.equal(
    scoped.announcements.some((item) => item.id === "ann-school"),
    true,
    "annonce établissement visible après re-filtrage",
  );
  assert.equal(
    scoped.announcements.some((item) => item.id === "ann-other"),
    false,
  );
  assert.equal(
    scoped.announcements.some((item) => item.id === "ann-sys"),
    true,
  );
  assert.equal(
    scoped.teachers.some((item) => item.id === "ENS-1"),
    true,
    "enseignant sans affectation visible via schoolCode",
  );
  assert.equal(
    scoped.teachers.some((item) => item.id === "ENS-2"),
    false,
  );
  assert.equal(
    scoped.messages.some((item) => item.id === "msg-1"),
    true,
  );

  const droppedAnnouncement = { ...schoolAnnouncement, schoolCode: undefined };
  const droppedTeacher = { ...unassignedTeacher, schoolCode: undefined, assignedClasses: [] };
  const lost = scopeSchoolEntityData(
    emptyPayload({
      announcements: [droppedAnnouncement],
      teachers: [droppedTeacher],
    }),
    SCHOOL,
  ) as { announcements: unknown[]; teachers: unknown[] };
  assert.equal(lost.announcements.length, 0);
  assert.equal(lost.teachers.length, 0);

  const sessionScoped = scopeBackOfficeForSession(
    emptyPayload({
      announcements: [schoolAnnouncement, otherAnnouncement],
      teachers: [unassignedTeacher, otherTeacher],
      schools: [
        { code: SCHOOL, name: "Nuru" },
        { code: OTHER, name: "Bujumbura" },
      ],
    }),
    { role: "super_admin", user: { schoolCode: "*", countryScope: "*" } },
    SCHOOL,
  ) as { announcements: Array<{ id: string }>; teachers: Array<{ id: string }> };
  assert.equal(
    sessionScoped.announcements.some((item) => item.id === "ann-school"),
    true,
  );
  assert.equal(
    sessionScoped.teachers.some((item) => item.id === "ENS-1"),
    true,
  );

  console.log("scope.test.ts OK");
}

run();
