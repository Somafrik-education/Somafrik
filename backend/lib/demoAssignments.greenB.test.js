"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  repairPublicDemoCanonicalRoles,
} = require("./demoCanonicalRoleRepair");
const {
  resolveLiveAssignmentsSyncSnapshot,
  liveSnapshotHasAssignmentsRead,
} = require("./mobileSyncScope");

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_CODE = "SCH-BULK-CD-0001";
const LOGIN_CODE = "CD-IN-26-001";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";

function fakeRepairClient({ users, linkedStudentUserIds = [] }) {
  const roles = [];
  const linked = new Set(linkedStudentUserIds);
  return {
    roles,
    async query(sql, params = []) {
      const source = String(sql);
      if (source.includes("FROM schools")) {
        return {
          rowCount: 1,
          rows: [{ id: SCHOOL_ID, school_code: SCHOOL_CODE, login_code: LOGIN_CODE }],
        };
      }
      if (source.includes("FROM users")) {
        return { rowCount: users.length, rows: users };
      }
      if (source.includes("FROM students")) {
        const found = linked.has(params[0]);
        return { rowCount: found ? 1 : 0, rows: found ? [{ ok: 1 }] : [] };
      }
      if (source.includes("INSERT INTO user_roles")) {
        const [userId, schoolId, roleKey] = params;
        const exists = roles.some(
          (row) =>
            row.user_id === userId &&
            row.school_id === schoolId &&
            row.role_key === roleKey &&
            row.status === "active" &&
            !row.revoked_at,
        );
        if (exists) return { rowCount: 0, rows: [] };
        roles.push({
          id: `role-${roles.length + 1}`,
          user_id: userId,
          school_id: schoolId,
          role_key: roleKey,
          status: "active",
          revoked_at: null,
        });
        return { rowCount: 1, rows: [{ id: roles.at(-1).id }] };
      }
      if (source.includes("GROUP BY role_key")) {
        const counts = new Map();
        for (const row of roles) {
          if (row.school_id !== SCHOOL_ID || row.status !== "active" || row.revoked_at) continue;
          counts.set(row.role_key, (counts.get(row.role_key) ?? 0) + 1);
        }
        const rows = [...counts.entries()].map(([role_key, count]) => ({ role_key, count }));
        return { rowCount: rows.length, rows };
      }
      throw new Error(`Unexpected SQL in fakeRepairClient: ${source}`);
    },
  };
}

test("GREEN-B: backfill Démo crée SCHOOL_ADMIN + TEACHER dans user_roles et reste idempotent", async () => {
  const client = fakeRepairClient({
    users: [
      { id: ADMIN_ID, user_code: "USR-DEMO-ADMIN", role: "SCHOOL_ADMIN" },
      { id: TEACHER_ID, user_code: "USR-DEMO-TEACHER", role: "TEACHER" },
    ],
  });

  const first = await repairPublicDemoCanonicalRoles(client);
  assert.equal(first.inserted, 2);
  assert.equal(first.schoolAdmins, 1);
  assert.equal(first.teachers, 1);
  assert.deepEqual(
    client.roles.map((row) => row.role_key).sort(),
    ["SCHOOL_ADMIN", "TEACHER"],
  );

  const second = await repairPublicDemoCanonicalRoles(client);
  assert.equal(second.inserted, 0);
  assert.equal(client.roles.length, 2);
});

test("GREEN-B: réparation refuse un rôle plateforme dans l'école Démo", async () => {
  const client = fakeRepairClient({
    users: [
      { id: ADMIN_ID, user_code: "USR-DEMO-BAD", role: "SUPER_ADMIN" },
      { id: TEACHER_ID, user_code: "USR-DEMO-TEACHER", role: "TEACHER" },
    ],
  });
  await assert.rejects(
    repairPublicDemoCanonicalRoles(client),
    /PUBLIC_DEMO_ROLE_REPAIR_ROLE_FORBIDDEN/,
  );
});

test("GREEN-B: utilisateur lié à students ne peut pas être réparé comme staff", async () => {
  const client = fakeRepairClient({
    users: [
      { id: ADMIN_ID, user_code: "USR-DEMO-CONFLICT", role: "SCHOOL_ADMIN" },
      { id: TEACHER_ID, user_code: "USR-DEMO-TEACHER", role: "TEACHER" },
    ],
    linkedStudentUserIds: [ADMIN_ID],
  });
  await assert.rejects(
    repairPublicDemoCanonicalRoles(client),
    /PUBLIC_DEMO_ROLE_REPAIR_STUDENT_ROLE_CONFLICT/,
  );
});

test("DEMO-PRES-RED-01 — rôle live SCHOOL_ADMIN donne un scope assignments school-wide", async () => {
  const repo = {
    async resolveCanonicalUserIdForSchool(userRef, schoolId) {
      assert.equal(userRef, ADMIN_ID);
      assert.equal(schoolId, SCHOOL_ID);
      return ADMIN_ID;
    },
    async listActiveUserRoleKeysForSchool(userId, schoolId) {
      assert.equal(userId, ADMIN_ID);
      assert.equal(schoolId, SCHOOL_ID);
      return ["SCHOOL_ADMIN"];
    },
    async resolveEffectivePermissions() {
      return { permissions: ["Affectations:READ"] };
    },
  };

  const snapshot = await resolveLiveAssignmentsSyncSnapshot(
    repo,
    { sub: ADMIN_ID, role: "Admin School", schoolCode: SCHOOL_CODE },
    { schoolId: SCHOOL_ID, schoolCode: SCHOOL_CODE },
  );

  assert.equal(snapshot.scope.scopeKind, "school-wide");
  assert.equal(liveSnapshotHasAssignmentsRead(snapshot.input), true);
  assert.deepEqual(snapshot.input.roleKeys, ["SCHOOL_ADMIN"]);
});

test("GREEN-B sécurité — aucun user_roles live => none même si le JWT dit Admin School", async () => {
  const repo = {
    async resolveCanonicalUserIdForSchool() {
      return ADMIN_ID;
    },
    async listActiveUserRoleKeysForSchool() {
      return [];
    },
    async resolveEffectivePermissions() {
      throw new Error("permissions ne doivent pas être résolues sans rôle live");
    },
  };

  const snapshot = await resolveLiveAssignmentsSyncSnapshot(
    repo,
    {
      sub: ADMIN_ID,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      permissions: ["Affectations:READ"],
      schoolCode: SCHOOL_CODE,
    },
    { schoolId: SCHOOL_ID, schoolCode: SCHOOL_CODE },
  );

  assert.equal(snapshot.scope.scopeKind, "none");
  assert.equal(liveSnapshotHasAssignmentsRead(snapshot.input), false);
  assert.deepEqual(snapshot.input.roleKeys, []);
});
