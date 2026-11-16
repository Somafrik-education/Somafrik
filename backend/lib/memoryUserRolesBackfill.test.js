"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const {
  backfillMemoryUserRolesFromSeedAccounts,
} = require("./memoryUserRolesBackfill");
const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");

test("backfill seed Admin School → SCHOOL_ADMIN sur le school_id du tenant", () => {
  const tables = {
    schools: [seedData.school, seedData.platformSchools.find((row) => row.code === "BI-2026-0002")],
    userRoles: [],
  };
  const inserted = backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  assert.ok(inserted > 0);
  const admin = tables.userRoles.find(
    (row) => row.user_id === "USER-ADMIN1" && row.role_key === "SCHOOL_ADMIN",
  );
  assert.equal(admin?.school_id, seedData.school.id);
  const teacher = tables.userRoles.find(
    (row) => row.user_id === "USER-T1" && row.role_key === "TEACHER",
  );
  assert.equal(teacher?.school_id, seedData.school.id);
  const superAdminOnCd = tables.userRoles.find(
    (row) => row.user_id === "USER-SUPERADMIN" && row.school_id === seedData.school.id,
  );
  assert.equal(superAdminOnCd, undefined);
  const biOnCd = tables.userRoles.find(
    (row) => row.user_id === "USER-ADMIN-BI-SCHOOL" && row.school_id === seedData.school.id,
  );
  assert.equal(biOnCd, undefined);
});

test("backfill n'ajoute pas de rôle staff à un compte lié par students.user_id", () => {
  const tables = {
    schools: [seedData.school],
    userRoles: [],
    students: [
      {
        id: "st-seed-lock",
        school_id: seedData.school.id,
        student_code: "CD-IN-61-26-00017",
        status: "active",
        user_id: "USER-ADMIN1",
      },
    ],
  };
  backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  assert.equal(
    tables.userRoles.some((row) => row.user_id === "USER-ADMIN1" && row.role_key === "SCHOOL_ADMIN"),
    false,
  );
});

test("backfill est idempotent", () => {
  const tables = { schools: [seedData.school], userRoles: [] };
  const first = backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  const second = backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  assert.ok(first > 0);
  assert.equal(second, 0);
});

test("SEC-RBAC-REVOKE-01 : un rôle révoqué n'est jamais recréé par le backfill mémoire", () => {
  const tables = { schools: [seedData.school], userRoles: [] };
  assert.ok(backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts) > 0);
  const target = tables.userRoles[0];
  target.status = "revoked";
  target.revoked_at = new Date();
  const activeBefore = tables.userRoles.filter((row) => row.status === "active").length;

  assert.equal(backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts), 0);
  const sameTuple = tables.userRoles.filter(
    (row) =>
      row.user_id === target.user_id && row.school_id === target.school_id && row.role_key === target.role_key,
  );
  assert.deepEqual(sameTuple.map((row) => row.status), ["revoked"], "aucune ligne active recréée");
  assert.equal(tables.userRoles.filter((row) => row.status === "active").length, activeBefore, "autres rôles intacts");
});

async function withDemoSeed(fn) {
  const previous = process.env.SOMAFRIK_SKIP_DEMO_SEED;
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "false";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
    } else {
      process.env.SOMAFRIK_SKIP_DEMO_SEED = previous;
    }
  }
}

test("FallbackRepository : Admin School seed a un rôle live tenant (pas JWT)", async () => {
  await withDemoSeed(async () => {
    const { FallbackRepository } = require("../db/fallbackRepository");
    const repo = new FallbackRepository();
    const keys = await repo.listActiveUserRoleKeysForSchool("USER-ADMIN1", seedData.school.id);
    assert.ok(keys.includes("SCHOOL_ADMIN"), JSON.stringify(keys));
    const foreign = await repo.listActiveUserRoleKeysForSchool(
      "USER-ADMIN-BI-SCHOOL",
      seedData.school.id,
    );
    assert.deepEqual(foreign, []);
  });
});

test("GET historique mémoire : snapshot live Admin School = school-wide + affectations seed", async () => {
  await withDemoSeed(async () => {
    const { FallbackRepository } = require("../db/fallbackRepository");
    const repo = new FallbackRepository();
    const snapshot = await resolveLiveAssignmentsSyncSnapshot(
      repo,
      { sub: "USER-ADMIN1", schoolCode: seedData.school.code },
      { schoolCode: seedData.school.code, schoolId: seedData.school.id },
    );
    assert.equal(snapshot.scope.scopeKind, "school-wide");
    const { liveSnapshotHasAssignmentsRead } = require("./mobileSyncScope");
    assert.equal(liveSnapshotHasAssignmentsRead(snapshot.input), true);
    const rows = await repo.listSchoolTeacherAssignments(seedData.school.code);
    assert.ok(rows.length > 0, "affectation seed attendue");
    assert.ok(rows[0]?.id);
  });
});
