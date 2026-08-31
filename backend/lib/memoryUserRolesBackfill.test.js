"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const {
  backfillMemoryUserRolesFromSeedAccounts,
  usersFromSeedAccounts,
} = require("./memoryUserRolesBackfill");
const { resolveLiveAssignmentsSyncSnapshot } = require("./mobileSyncScope");

test("usersFromSeedAccounts : USER-ADMIN1 porte le school_id réel, pas un preset", () => {
  const users = usersFromSeedAccounts(
    [seedData.school, seedData.platformSchools.find((row) => row.code === "BI-2026-0002")],
    seedData.userAccounts,
  );
  const admin = users.find((row) => row.id === "USER-ADMIN1");
  assert.equal(admin?.school_id, seedData.school.id);
  assert.notEqual(admin?.school_id, "school-cd");
  const bi = users.find((row) => row.id === "USER-ADMIN-BI-SCHOOL");
  const biSchool = seedData.platformSchools.find((row) => row.code === "BI-2026-0002");
  assert.equal(bi?.school_id, biSchool.id);
  assert.equal(users.some((row) => row.id === "USER-SUPERADMIN"), false);
});

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

test("backfill est idempotent", () => {
  const tables = { schools: [seedData.school], userRoles: [] };
  const first = backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  const second = backfillMemoryUserRolesFromSeedAccounts(tables, seedData.userAccounts);
  assert.ok(first > 0);
  assert.equal(second, 0);
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

test("FallbackRepository : getClientsStore expose USER-ADMIN1.school_id réel", async () => {
  await withDemoSeed(async () => {
    const { FallbackRepository } = require("../db/fallbackRepository");
    const repo = new FallbackRepository();
    const store = repo.getClientsStore();
    const admin = store._tables.users.find((row) => row.id === "USER-ADMIN1");
    assert.equal(admin?.school_id, seedData.school.id);
    assert.equal(store._tables.users.some((row) => row.id === "admin-cd"), false);
  });
});

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
