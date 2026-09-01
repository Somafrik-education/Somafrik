/**
 * Filtrage partagé :
 * - scopeSchoolEntityData reste disponible pour les contrôles locaux explicites.
 * - Les sessions canoniques font confiance au tenant déjà imposé par le backend ;
 *   elles ne doivent jamais convertir une réponse valide en [] à cause de SCH-* / V2.
 *   npx tsx Mobile/src/lib/scope.test.ts
 */
import assert from "node:assert/strict";
import {
  scopeBackOfficeForSession,
  scopeSchoolEntityData,
  trustServerScopedPlatformTenant,
} from "./scope";
import {
  normalizeAnnouncement,
  normalizeMessage,
  normalizeTeacher,
} from "./canonicalResourceNormalize";

const SCHOOL = "CD-IN-26-001";
const INTERNAL_SCHOOL = "SCH-ABC123";
const OTHER = "BI-EC-26-001";

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

  // Le helper de filtrage local reste déterministe lorsqu'il est explicitement utilisé.
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

  assert.equal(scoped.announcements.some((item) => item.id === "ann-school"), true);
  assert.equal(scoped.announcements.some((item) => item.id === "ann-other"), false);
  assert.equal(scoped.announcements.some((item) => item.id === "ann-sys"), true);
  assert.equal(scoped.teachers.some((item) => item.id === "ENS-1"), true);
  assert.equal(scoped.teachers.some((item) => item.id === "ENS-2"), false);
  assert.equal(scoped.messages.some((item) => item.id === "msg-1"), true);

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

  // Le serveur a déjà limité ces lignes à Nuru. Certaines projections PG peuvent
  // encore porter l'alias interne : le Mobile ne doit surtout pas les transformer en [].
  const serverScopedPayload = emptyPayload({
    users: [{ id: "usr-nuru", role: "Enseignant", schoolCode: INTERNAL_SCHOOL }],
    students: [{ id: "stu-nuru", schoolCode: INTERNAL_SCHOOL, className: "6A" }],
    teachers: [{ id: "teacher-nuru", schoolCode: INTERNAL_SCHOOL, assignedClasses: [] }],
    classes: [{ id: "class-nuru", schoolCode: INTERNAL_SCHOOL, name: "6A" }],
    courses: [{ id: "course-nuru", schoolCode: INTERNAL_SCHOOL, className: "6A" }],
    payments: [{ id: "pay-nuru", schoolCode: INTERNAL_SCHOOL, studentId: "stu-nuru" }],
    presences: [{ id: "presence-nuru", schoolCode: INTERNAL_SCHOOL, studentId: "stu-nuru" }],
    announcements: [{ id: "ann-nuru", schoolCode: INTERNAL_SCHOOL }],
    messages: [{ id: "msg-nuru", schoolCode: INTERNAL_SCHOOL }],
    schools: [
      { code: SCHOOL, name: "Nuru", countryCode: "CD" },
      { code: "CD-EL-26-002", name: "Lumière", countryCode: "CD" },
    ],
    countries: [{ code: "CD", name: "RDC" }],
    subscriptions: [],
    notifications: [],
  });

  const superSessionScoped = scopeBackOfficeForSession(
    serverScopedPayload,
    { role: "super_admin", user: { schoolCode: "*", countryScope: "*" } },
    SCHOOL,
  ) as Record<string, Array<{ id?: string; code?: string }>>;

  for (const entity of [
    "users",
    "students",
    "teachers",
    "classes",
    "courses",
    "payments",
    "presences",
    "announcements",
    "messages",
  ]) {
    assert.equal(
      superSessionScoped[entity]?.length,
      1,
      `${entity} request-scoped ne doit pas disparaître sur SCH-* != login_code V2`,
    );
  }
  assert.equal(superSessionScoped.schools.length, 2, "le sélecteur Superadmin conserve la liste principale");

  const countrySessionScoped = scopeBackOfficeForSession(
    serverScopedPayload,
    { role: "country_admin", user: { schoolCode: "*", countryScope: "CD", countryCode: "CD" } },
    SCHOOL,
  ) as Record<string, Array<{ id?: string; code?: string }>>;
  assert.equal(countrySessionScoped.users.length, 1);
  assert.equal(countrySessionScoped.students.length, 1);
  assert.equal(countrySessionScoped.schools.length, 2, "Admin Pays conserve les écoles de son pays");

  // Admin School : le JWT/repository impose déjà le tenant. Une projection Users
  // normalisée en public V2 ne doit pas être comparée à l'alias interne de session.
  // H. Même contrat Web : leftover session ≠ login_code API ne doit pas vider la liste.
  const schoolAdminScoped = scopeBackOfficeForSession(
    emptyPayload({
      users: [
        { id: "usr-school", schoolCode: SCHOOL, schoolPublicCode: SCHOOL },
        { id: "usr-school-2", schoolCode: SCHOOL, publicId: "CD-IN-BBB-26-00002" },
      ],
      students: [{ id: "stu-school", schoolCode: INTERNAL_SCHOOL }],
      teachers: [{ id: "teacher-school", schoolCode: INTERNAL_SCHOOL }],
    }),
    { role: "school_admin", user: { schoolCode: INTERNAL_SCHOOL } },
  ) as Record<string, Array<{ id?: string }>>;
  assert.equal(schoolAdminScoped.users.length, 2, "H: SCHOOL_ADMIN conserve la réponse serveur");
  assert.equal(schoolAdminScoped.students.length, 1);
  assert.equal(schoolAdminScoped.teachers.length, 1);
  const leftoverWouldDrop = schoolAdminScoped.users.filter(
    (row) => String((row as { schoolCode?: string }).schoolCode ?? "") === INTERNAL_SCHOOL,
  );
  assert.equal(leftoverWouldDrop.length, 0, "preuve : leftover SCH-* ≠ login_code V2");

  const trusted = trustServerScopedPlatformTenant(
    emptyPayload({ users: [{ id: "tenant-user", schoolCode: INTERNAL_SCHOOL }] }),
    emptyPayload({ schools: [{ code: SCHOOL }], countries: [{ code: "CD", name: "RDC" }] }),
  ) as { users: Array<{ id: string }>; schools: Array<{ code: string }> };
  assert.equal(trusted.users[0]?.id, "tenant-user");
  assert.equal(trusted.schools[0]?.code, SCHOOL);

  console.log("scope.test.ts OK");
}

run();
