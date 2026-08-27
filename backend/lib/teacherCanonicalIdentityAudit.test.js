"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  classifyInventory,
  parsePersonName,
  namesMatch,
} = require("./teacherCanonicalIdentityAudit");

const USER = {
  user_id: "c81b0ec1-b8dd-4f09-8357-6775586920ff",
  school_id: "3b11f338-38a9-43ba-9321-ebfc526b21af",
  role: "TEACHER",
  roles: ["TEACHER"],
};
const TEACHER = {
  teacher_id: "cd866ff1-92f5-4bf6-9086-dce64f903717",
  teacher_user_id: USER.user_id,
  school_id: USER.school_id,
};
const ASSIGNMENTS = [1, 2, 3, 4].map((n) => ({
  assignment_id: `asg-${n}`,
  teacher_id: TEACHER.teacher_id,
  status: "active",
}));

test("nom KILOMBO SEKE / Seke Kilombo", () => {
  assert.deepEqual(parsePersonName("KILOMBO SEKE"), { first: "kilombo", last: "seke" });
  assert.equal(namesMatch("KILOMBO", "SEKE", "KILOMBO SEKE"), true);
  assert.equal(namesMatch("Seke", "Kilombo", "KILOMBO SEKE"), true);
  assert.equal(namesMatch("ALPHONSINE", "NDJITA", "KILOMBO SEKE"), false);
});

test("CANONICAL : users.id === teachers.user_id + 4 affectations", () => {
  const result = classifyInventory(
    { users: [USER], teachers: [TEACHER], assignments: ASSIGNMENTS },
    { expectedAssignments: 4 },
  );
  assert.equal(result.verdict, "CANONICAL");
  assert.equal(result.repairable, false);
});

test("REPAIRABLE_UNLINKED : un user + un teacher.user_id NULL + 4 affectations", () => {
  const result = classifyInventory(
    {
      users: [USER],
      teachers: [{ ...TEACHER, teacher_user_id: null }],
      assignments: ASSIGNMENTS,
    },
    { expectedAssignments: 4 },
  );
  assert.equal(result.verdict, "REPAIRABLE_UNLINKED");
  assert.equal(result.repairable, true);
});

test("AMBIGUOUS_USERS : deux comptes, aucune mutation", () => {
  const result = classifyInventory({
    users: [USER, { ...USER, user_id: "other-user" }],
    teachers: [TEACHER],
    assignments: ASSIGNMENTS,
  });
  assert.equal(result.verdict, "AMBIGUOUS_USERS");
  assert.equal(result.repairable, false);
});

test("AMBIGUOUS_TEACHERS : plusieurs fiches orphelines", () => {
  const result = classifyInventory({
    users: [USER],
    teachers: [
      { ...TEACHER, teacher_user_id: null },
      { ...TEACHER, teacher_id: "other-teacher", teacher_user_id: null },
    ],
    assignments: ASSIGNMENTS,
  });
  assert.equal(result.verdict, "AMBIGUOUS_TEACHERS");
  assert.equal(result.repairable, false);
});

test("contrat live : identité par teachers.user_id, jamais par nom", () => {
  const identity = fs.readFileSync(
    path.join(__dirname, "../db/teacherAssignmentsRepository.js"),
    "utf8",
  );
  const fnStart = identity.indexOf("async getLiveTeacherIdentityForSchool");
  const fn = identity.slice(fnStart, identity.indexOf("async listLiveTeacherAssignmentIdsForSync"));
  assert.match(fn, /t\.user_id::text = \$1/);
  assert.match(fn, /t\.school_id::text = \$2/);
  assert.doesNotMatch(fn, /first_name/);
  assert.doesNotMatch(fn, /last_name/);
  assert.doesNotMatch(fn, /teacher_code = \$/);
  assert.doesNotMatch(fn, /JOIN users u ON u\.id = t\.user_id\s+AND u\.school_id = t\.school_id/);
});

test("écran Appel n'introduit pas de fallback nom / teacherCode", () => {
  const establishment = fs.readFileSync(
    path.join(__dirname, "../../Mobile/src/lib/establishment.ts"),
    "utf8",
  );
  assert.match(establishment, /teacherUserId === session\.user\.id|teacherUserId && teacherUserId === userId/);
  assert.match(establishment, /Ne pas utiliser pour le matching en ligne KILOMBO/);
});
