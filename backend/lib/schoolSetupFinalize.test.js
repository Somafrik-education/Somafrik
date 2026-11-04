"use strict";

/**
 * CONFIG-FINAL-01 — finalisation explicite de la configuration d'établissement.
 * Le tenant vient du rattachement, jamais d'un schoolId client.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createMemoryProgressStore,
  finalizeSchoolSetupGuided,
  getSchoolSetupGuided,
  completeGuidedStep,
} = require("./schoolSetupGuided");

const ROOT = path.resolve(__dirname, "../..");
const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function membershipOne(rowsBySub) {
  return async (sql, params = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      return rowsBySub[String(params[0] ?? "")] ?? null;
    }
    return null;
  };
}

const MEMBERSHIP = membershipOne({
  "admin-a": { school_id: SCHOOL_A, login_code: "CD-IN-26-001", id: SCHOOL_A },
  "admin-b": { school_id: SCHOOL_B, login_code: "CD-EL-26-002", id: SCHOOL_B },
});

function admin(sub, permissions = ["Paramètres Établissement:UPDATE"]) {
  return { role: "Admin School", sub, permissions };
}

function snapshot(overrides = {}) {
  return {
    hasName: true,
    hasCountry: true,
    hasAddress: true,
    hasPhone: true,
    hasCurrency: true,
    hasCurrentOrOpenAcademicYear: true,
    hasAcademicYearDates: true,
    activatedLevelCount: 1,
    activatedGroupCount: 1,
    classCount: 1,
    subjectCount: 1,
    teacherCount: 1,
    teacherAssignmentCount: 1,
    enrolledStudentCount: 1,
    feeGridCount: 0,
    paymentMethodCount: 0,
    evaluationTypeCount: 0,
    notificationsConfigured: false,
    userCount: 1,
    ...overrides,
  };
}

function countingStore(seed) {
  const store = createMemoryProgressStore(seed);
  let writes = 0;
  const save = store.save.bind(store);
  store.save = async (schoolId, row) => {
    writes += 1;
    return save(schoolId, row);
  };
  store.writes = () => writes;
  return store;
}

function input(extra = {}) {
  return {
    principal: admin("admin-a"),
    one: MEMBERSHIP,
    loadSnapshot: async () => snapshot(),
    ...extra,
  };
}

test("configuration obligatoire complète : finalisation confirmée et rechargée", async () => {
  const store = countingStore();
  const done = await finalizeSchoolSetupGuided(input({ progressStore: store }));
  assert.equal(done.finalized, true);
  assert.ok(done.finalizedAt);
  assert.equal(done.schoolId, SCHOOL_A);
  assert.equal(done.status, "operational");
  assert.equal(done.percent, 60);
  assert.equal(store.writes(), 1);

  const reloaded = await getSchoolSetupGuided(input({ progressStore: store }));
  assert.equal(reloaded.finalized, true);
  assert.equal(reloaded.finalizedAt, done.finalizedAt);
  assert.equal(reloaded.schoolId, SCHOOL_A);
});

test("étape obligatoire manquante : blocage explicite, aucune écriture", async () => {
  const store = countingStore();
  await assert.rejects(
    () =>
      finalizeSchoolSetupGuided(
        input({
          progressStore: store,
          loadSnapshot: async () => snapshot({ enrolledStudentCount: 0, teacherCount: 0, teacherAssignmentCount: 0 }),
        }),
      ),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "SETUP_INCOMPLETE");
      assert.match(error.message, /Élèves/);
      assert.match(error.message, /Enseignants/);
      const keys = error.details.missingSteps.map((step) => step.key);
      assert.ok(keys.includes("students"));
      assert.ok(keys.includes("teachers"));
      assert.equal(keys.includes("finance"), false);
      assert.equal(keys.includes("communication"), false);
      return true;
    },
  );
  assert.equal(store.writes(), 0);
  const row = await store.load(SCHOOL_A);
  assert.equal(row.finalizedAt, null);
});

test("les étapes facultatives ne bloquent pas la finalisation", async () => {
  const store = countingStore();
  const done = await finalizeSchoolSetupGuided(
    input({
      progressStore: store,
      loadSnapshot: async () => snapshot({ feeGridCount: 0, evaluationTypeCount: 0, notificationsConfigured: false }),
    }),
  );
  assert.equal(done.finalized, true);
  assert.equal(done.percent, 60);
});

test("double finalisation : une seule écriture, horodatage stable", async () => {
  const store = countingStore();
  const first = await finalizeSchoolSetupGuided(input({ progressStore: store }));
  const second = await finalizeSchoolSetupGuided(input({ progressStore: store }));
  assert.equal(store.writes(), 1);
  assert.equal(second.finalizedAt, first.finalizedAt);
  assert.equal(second.finalized, true);
});

test("configuration déjà terminée : une donnée retirée ne réinitialise pas le statut", async () => {
  const finalizedAt = "2026-09-21T08:00:00.000Z";
  const store = countingStore({
    [SCHOOL_A]: {
      lastValidStep: 10,
      completedSteps: ["establishment", "academicYear", "structure", "subjects", "teachers", "students"],
      updatedAt: finalizedAt,
      finalizedAt,
    },
  });
  const done = await finalizeSchoolSetupGuided(
    input({
      progressStore: store,
      loadSnapshot: async () => snapshot({ enrolledStudentCount: 0, classCount: 0 }),
    }),
  );
  assert.equal(store.writes(), 0);
  assert.equal(done.finalized, true);
  assert.equal(done.finalizedAt, finalizedAt);
  assert.equal(done.percent < 60, true);

  const afterStep = await completeGuidedStep(
    input({
      progressStore: store,
      stepKey: "establishment",
      loadSnapshot: async () => snapshot(),
    }),
  );
  assert.equal(afterStep.finalized, true);
  assert.equal(afterStep.finalizedAt, finalizedAt);
});

test("utilisateur non autorisé : accès refusé, aucune écriture", async () => {
  const store = countingStore();
  await assert.rejects(
    () => finalizeSchoolSetupGuided(input({ progressStore: store, principal: null })),
    (error) => error.statusCode === 401,
  );
  await assert.rejects(
    () =>
      finalizeSchoolSetupGuided(
        input({
          progressStore: store,
          principal: admin("admin-a", ["Paramètres Établissement:READ"]),
        }),
      ),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () =>
      finalizeSchoolSetupGuided(
        input({
          progressStore: store,
          principal: { role: "Super Admin", sub: "super-1", permissions: ["ALL_PRIVILEGES"] },
        }),
      ),
    (error) => error.statusCode === 403,
  );
  assert.equal(store.writes(), 0);
  assert.equal((await store.load(SCHOOL_A)).finalizedAt, null);
  assert.equal((await store.load(SCHOOL_B)).finalizedAt, null);
});

test("autre établissement : le schoolId client est ignoré", async () => {
  const store = countingStore();
  const done = await finalizeSchoolSetupGuided(
    input({
      progressStore: store,
      schoolId: SCHOOL_B,
      body: { schoolId: SCHOOL_B },
      query: { schoolId: SCHOOL_B },
    }),
  );
  assert.equal(done.schoolId, SCHOOL_A);
  assert.equal((await store.load(SCHOOL_A)).finalizedAt, done.finalizedAt);
  assert.equal((await store.load(SCHOOL_B)).finalizedAt, null);

  const other = await finalizeSchoolSetupGuided(
    input({
      progressStore: store,
      principal: admin("admin-b"),
      schoolId: SCHOOL_A,
      body: { schoolId: SCHOOL_A },
    }),
  );
  assert.equal(other.schoolId, SCHOOL_B);
  assert.equal((await store.load(SCHOOL_A)).finalizedAt, done.finalizedAt);
  assert.notEqual((await store.load(SCHOOL_B)).finalizedAt, null);
});

test("Web et Mobile appellent le même POST canonique, sans schoolId", () => {
  const web = fs.readFileSync(path.join(ROOT, "web/src/lib/schoolSetupGuidedApi.ts"), "utf8");
  const mobile = fs.readFileSync(path.join(ROOT, "Mobile/src/lib/schoolSetupGuidedApi.ts"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const rbac = fs.readFileSync(path.join(ROOT, "backend/services/rbacService.js"), "utf8");
  for (const source of [web, mobile]) {
    assert.match(source, /\/v2\/school-setup\/guided\/complete/);
    assert.doesNotMatch(source, /guided\/complete[^"'\n]*schoolId/);
  }
  const start = server.indexOf('app.post("/api/v2/school-setup/guided/complete"');
  assert.ok(start >= 0);
  const next = server.indexOf("\napp.", start + 10);
  const block = server.slice(start, next);
  assert.match(block, /finalizeSchoolSetupGuided/);
  assert.doesNotMatch(block, /req\.body|schoolId/);
  assert.match(block, /requirePermission\("POST \/api\/v2\/school-setup\/guided\/complete"\)/);
  assert.match(rbac, /"POST \/api\/v2\/school-setup\/guided\/complete": \["Paramètres Établissement:UPDATE"\]/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "backend/db/schoolSetupGuidedSchema.js"), "utf8"), /setup_status/);
});
