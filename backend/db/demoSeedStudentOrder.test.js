"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const seedData = require("../data");
const {
  attachDemoStudentSeedOrder,
  isStudentSeedUser,
  isAcademicStudentUserInsertSql,
  withoutAcademicStudentUserWrites,
} = require("./demoSeedStudentOrder");

test("student demo users are deferred during seedReferenceData then restored", async () => {
  const originalAccounts = seedData.userAccounts.slice();
  assert.ok(originalAccounts.some(isStudentSeedUser), "fixture must contain at least one student account");

  let seenRoles = [];
  const repository = {
    async seedReferenceData() {
      seenRoles = seedData.userAccounts.map((user) => user.role);
      return { ok: true };
    },
  };

  attachDemoStudentSeedOrder(repository);
  const result = await repository.seedReferenceData({});

  assert.deepEqual(result, { ok: true });
  assert.equal(seenRoles.some((role) => isStudentSeedUser({ role })), false);
  assert.deepEqual(seedData.userAccounts, originalAccounts);
});

test("student demo users are restored even when reference seed fails", async () => {
  const originalAccounts = seedData.userAccounts.slice();
  const repository = {
    async seedReferenceData() {
      assert.equal(seedData.userAccounts.some(isStudentSeedUser), false);
      throw new Error("reference seed failed");
    },
  };

  attachDemoStudentSeedOrder(repository);
  await assert.rejects(() => repository.seedReferenceData({}), /reference seed failed/);
  assert.deepEqual(seedData.userAccounts, originalAccounts);
});

test("student role detection accepts canonical and accented labels", () => {
  assert.equal(isStudentSeedUser({ role: "STUDENT" }), true);
  assert.equal(isStudentSeedUser({ role: "Élève / Étudiant" }), true);
  assert.equal(isStudentSeedUser({ role: "ELEVE / ETUDIANT" }), true);
  assert.equal(isStudentSeedUser({ role: "Parent" }), false);
});

test("academic student user INSERT is detected and suppressed", async () => {
  const studentInsert = `
    INSERT INTO users (school_id, user_code, role)
    SELECT st.school_id, st.student_code, 'STUDENT'
    FROM students st
  `;
  assert.equal(isAcademicStudentUserInsertSql(studentInsert), true);
  assert.equal(isAcademicStudentUserInsertSql("SELECT 1"), false);

  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ ok: true }], rowCount: 1 };
    },
  };
  const wrapped = withoutAcademicStudentUserWrites(client);

  const suppressed = await wrapped.query(studentInsert, []);
  assert.equal(suppressed.rowCount, 0);
  assert.equal(calls.length, 0, "student account INSERT must not reach PostgreSQL before canonical students exist");

  const passed = await wrapped.query("SELECT 1", []);
  assert.equal(passed.rowCount, 1);
  assert.equal(calls.length, 1);
});

test("seedAcademicData is wrapped so premature student account writes are skipped", async () => {
  const queries = [];
  const repository = {
    async seedReferenceData() {
      return {};
    },
    async seedAcademicData(client) {
      await client.query("INSERT INTO students (student_code) VALUES ('LEGACY-STUDENT')", []);
      await client.query("INSERT INTO users (user_code, role) VALUES ('LEGACY-STUDENT', 'STUDENT')", []);
      return { ok: true };
    },
  };
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };

  attachDemoStudentSeedOrder(repository);
  const result = await repository.seedAcademicData(client, {});

  assert.deepEqual(result, { ok: true });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO students/i);
});

test("ensureStudentUsers creates canonical student users without reusing parent contact identities", async () => {
  const previousSkip = process.env.SOMAFRIK_SKIP_DEMO_SEED;
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "false";
  let captured = null;
  const repository = {
    async seedReferenceData() {
      return {};
    },
    async seedAcademicData() {
      return undefined;
    },
    async ensureStudentUsers() {
      return undefined;
    },
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [], rowCount: 0 };
    },
  };

  try {
    attachDemoStudentSeedOrder(repository);
    await repository.ensureStudentUsers();
  } finally {
    if (previousSkip === undefined) {
      delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
    } else {
      process.env.SOMAFRIK_SKIP_DEMO_SEED = previousSkip;
    }
  }

  assert.ok(captured, "ensureStudentUsers must issue one canonical INSERT");
  assert.match(captured.sql, /st\.student_code/);
  assert.match(captured.sql, /NULL::text, NULL::text/);
  assert.doesNotMatch(captured.sql, /parent_email|parent_phone/i);
  assert.match(captured.sql, /'STUDENT'/);
  assert.equal(captured.params.length, 1);
});
