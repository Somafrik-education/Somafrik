"use strict";

/**
 * RED — configuration guidée établissement (10 étapes).
 *
 * Contrats B1–B10. Doivent échouer tant que le module et les routes
 * `/api/v2/school-setup/guided` sont absents. Aucune implémentation GREEN ici.
 *
 * Le contrat LOT 0 `GET /api/v2/school-setup/status` (3 core, état dérivé)
 * reste inchangé : pas de colonne `setup_status`, pas de second READY.
 *
 *   node --test --test-reporter spec backend/lib/schoolSetupGuided.red.test.js
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SERVER_PATH = path.join(ROOT, "backend/server.js");
const SCHEMA_PATH = path.join(ROOT, "backend/db/schema.sql");
const RBAC_PATH = path.join(ROOT, "backend/services/rbacService.js");
const MODULE_PATH = path.join(__dirname, "schoolSetupGuided.js");
const LOT0_MODULE_PATH = path.join(__dirname, "schoolSetupStatus.js");

const GUIDED_GET_PATH = "/api/v2/school-setup/guided";
const GUIDED_COMPLETE_PATH = "/api/v2/school-setup/guided/steps/:stepKey/complete";
const GUIDED_GET = `GET ${GUIDED_GET_PATH}`;
const GUIDED_COMPLETE = `POST ${GUIDED_COMPLETE_PATH}`;

const SCHOOL_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCHOOL_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const LOGIN_A = "CD-IN-26-001";
const LOGIN_B = "CD-EL-26-002";

const REQUIRED_STEP_KEYS = Object.freeze([
  "establishment",
  "academicYear",
  "structure",
  "subjects",
  "teachers",
  "students",
]);
const COMPLEMENTARY_STEP_KEYS = Object.freeze([
  "finance",
  "pedagogy",
  "communication",
  "users",
]);
const ALL_STEP_KEYS = Object.freeze([...REQUIRED_STEP_KEYS, ...COMPLEMENTARY_STEP_KEYS]);

const PAYLOAD_KEYS = Object.freeze([
  "completedSteps",
  "currentStep",
  "lastValidStep",
  "nextStepKey",
  "nextStepLabel",
  "percent",
  "schoolId",
  "status",
  "steps",
  "updatedAt",
]);

function loadGuided() {
  try {
    return require("./schoolSetupGuided");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND" && String(error.message).includes("schoolSetupGuided")) {
      return null;
    }
    throw error;
  }
}

function requireGuided() {
  const mod = loadGuided();
  assert.ok(mod, "backend/lib/schoolSetupGuided.js manquant — contrat guidé non implémenté");
  assert.equal(typeof mod.GUIDED_STEP_KEYS, "object", "GUIDED_STEP_KEYS manquant");
  assert.equal(typeof mod.deriveGuidedProgress, "function", "deriveGuidedProgress manquant");
  assert.equal(typeof mod.getSchoolSetupGuided, "function", "getSchoolSetupGuided manquant");
  assert.equal(typeof mod.completeGuidedStep, "function", "completeGuidedStep manquant");
  return mod;
}

function emptySnapshot(overrides = {}) {
  return {
    hasName: false,
    hasCountry: false,
    hasAddress: false,
    hasPhone: false,
    hasCurrency: false,
    hasCurrentOrOpenAcademicYear: false,
    hasAcademicYearDates: false,
    activatedLevelCount: 0,
    activatedGroupCount: 0,
    classCount: 0,
    subjectCount: 0,
    teacherCount: 0,
    teacherAssignmentCount: 0,
    enrolledStudentCount: 0,
    feeGridCount: 0,
    paymentMethodCount: 0,
    evaluationTypeCount: 0,
    notificationsConfigured: false,
    userCount: 0,
    ...overrides,
  };
}

function establishmentReady(overrides = {}) {
  return emptySnapshot({
    hasName: true,
    hasCountry: true,
    hasAddress: true,
    hasPhone: true,
    hasCurrency: true,
    ...overrides,
  });
}

function through(stepKey, overrides = {}) {
  const doneUntil = ALL_STEP_KEYS.indexOf(stepKey);
  assert.ok(doneUntil >= 0, stepKey);
  const base = establishmentReady({
    hasCurrentOrOpenAcademicYear: doneUntil >= 1,
    hasAcademicYearDates: doneUntil >= 1,
    activatedLevelCount: doneUntil >= 2 ? 1 : 0,
    activatedGroupCount: doneUntil >= 2 ? 1 : 0,
    classCount: doneUntil >= 2 ? 1 : 0,
    subjectCount: doneUntil >= 3 ? 2 : 0,
    teacherCount: doneUntil >= 4 ? 1 : 0,
    teacherAssignmentCount: doneUntil >= 4 ? 1 : 0,
    enrolledStudentCount: doneUntil >= 5 ? 1 : 0,
    feeGridCount: doneUntil >= 6 ? 1 : 0,
    evaluationTypeCount: doneUntil >= 7 ? 1 : 0,
    notificationsConfigured: doneUntil >= 8,
    userCount: doneUntil >= 9 ? 2 : 1,
  });
  return { ...base, ...overrides };
}

function emptyPersisted() {
  return { lastValidStep: 0, completedSteps: [], updatedAt: null };
}

function memoryProgressStore(seed = {}) {
  const rows = { ...seed };
  return {
    async load(schoolId) {
      const id = String(schoolId);
      return rows[id] ? { ...rows[id], completedSteps: [...rows[id].completedSteps] } : emptyPersisted();
    },
    async save(schoolId, row) {
      rows[String(schoolId)] = {
        lastValidStep: row.lastValidStep,
        completedSteps: [...row.completedSteps],
        updatedAt: row.updatedAt,
      };
    },
    dump: () => rows,
  };
}

function schoolAdminA(overrides = {}) {
  return {
    role: "Admin School",
    sub: "admin-a-1",
    schoolCode: LOGIN_A,
    permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"],
    ...overrides,
  };
}

function schoolAdminB(overrides = {}) {
  return schoolAdminA({
    sub: "admin-b-1",
    schoolCode: LOGIN_B,
    ...overrides,
  });
}

function membershipOneBySub(rowsBySub) {
  return async (sql, params = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      return rowsBySub[String(params[0] ?? "")] ?? null;
    }
    return null;
  };
}

const MEMBERSHIP_LOOKUP = membershipOneBySub({
  "admin-a-1": { school_id: SCHOOL_A_ID, login_code: LOGIN_A, id: SCHOOL_A_ID },
  "admin-b-1": { school_id: SCHOOL_B_ID, login_code: LOGIN_B, id: SCHOOL_B_ID },
});

function assertPayloadShape(payload) {
  assert.ok(payload && typeof payload === "object", "payload objet requis");
  assert.deepEqual(Object.keys(payload).sort(), [...PAYLOAD_KEYS]);
  assert.ok(["configuration_required", "operational"].includes(payload.status), payload.status);
  assert.equal(typeof payload.percent, "number");
  assert.ok(payload.percent >= 0 && payload.percent <= 100, `percent hors bornes: ${payload.percent}`);
  assert.equal(payload.percent % 10, 0, "percent déterministe par étapes de 10 %");
  assert.ok(payload.currentStep >= 1 && payload.currentStep <= 10);
  assert.ok(payload.lastValidStep >= 0 && payload.lastValidStep <= 10);
  assert.ok(Array.isArray(payload.completedSteps));
  assert.ok(Array.isArray(payload.steps));
  assert.equal(payload.steps.length, 10);
  assert.equal(payload.completedSteps.length, payload.percent / 10);
  if (payload.status === "operational") {
    for (const key of REQUIRED_STEP_KEYS) {
      assert.ok(payload.completedSteps.includes(key), `opérationnel sans ${key}`);
    }
    assert.ok(payload.percent >= 60);
  } else {
    assert.ok(payload.percent < 60 || REQUIRED_STEP_KEYS.some((key) => !payload.completedSteps.includes(key)));
  }
}

async function getGuided(mod, input) {
  return mod.getSchoolSetupGuided(input);
}

async function completeStep(mod, input) {
  return mod.completeGuidedStep(input);
}

test("contrat — module schoolSetupGuided exporte derive / get / complete + 10 étapes", () => {
  const mod = requireGuided();
  assert.deepEqual([...mod.GUIDED_STEP_KEYS], [...ALL_STEP_KEYS]);
  assert.equal(mod.GUIDED_STEP_TOTAL, 10);
  assert.equal(mod.GUIDED_OPERATIONAL_STEP_TOTAL, 6);
});

test("contrat — GET/POST guided déclarés (auth + permission, sans :schoolCode, LOT 0 intact)", () => {
  const server = fs.readFileSync(SERVER_PATH, "utf8");
  const rbac = fs.readFileSync(RBAC_PATH, "utf8");
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");

  assert.ok(server.includes(`app.get("${GUIDED_GET_PATH}"`), `${GUIDED_GET_PATH} absent de server.js`);
  assert.ok(
    server.includes(`app.post("${GUIDED_COMPLETE_PATH}"`) || server.includes('app.post("/api/v2/school-setup/guided/steps/'),
    `${GUIDED_COMPLETE_PATH} absent de server.js`,
  );
  assert.ok(!server.includes("/api/v2/school-setup/guided/:schoolCode"), "path :schoolCode interdit");
  assert.ok(schema.includes("setup_status") === false, "colonne setup_status toujours interdite (LOT 0)");

  const getLine = rbac.split("\n").find((line) => line.includes(`"${GUIDED_GET}"`));
  assert.ok(getLine, `RBAC ${GUIDED_GET} manquant`);
  assert.match(getLine, /Paramètres Établissement:READ/);

  const postLine = rbac.split("\n").find((line) => line.includes(`"${GUIDED_COMPLETE}"`));
  assert.ok(postLine, `RBAC ${GUIDED_COMPLETE} manquant`);
  assert.match(postLine, /Paramètres Établissement:UPDATE/);

  assert.ok(fs.existsSync(LOT0_MODULE_PATH), "LOT 0 schoolSetupStatus.js ne doit pas disparaître");
});

test("B1 — nouvel établissement → configuration_required, 0 %, étape 1", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  const payload = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => emptySnapshot(),
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "configuration_required");
  assert.equal(payload.percent, 0);
  assert.equal(payload.currentStep, 1);
  assert.equal(payload.lastValidStep, 0);
  assert.equal(payload.nextStepKey, "establishment");
  assert.equal(payload.nextStepLabel, "Informations établissement");
  assert.deepEqual(payload.completedSteps, []);
  assert.equal(payload.schoolId, SCHOOL_A_ID);
});

test("B2 — validation d'une étape valide est persistée", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  const after = await completeStep(mod, {
    principal: schoolAdminA(),
    stepKey: "establishment",
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => establishmentReady(),
  });
  assertPayloadShape(after);
  assert.equal(after.percent, 10);
  assert.deepEqual(after.completedSteps, ["establishment"]);
  assert.equal(after.lastValidStep, 1);
  assert.equal(after.currentStep, 2);
  assert.equal(after.nextStepKey, "academicYear");

  const persisted = await store.load(SCHOOL_A_ID);
  assert.deepEqual(persisted.completedSteps, ["establishment"]);
  assert.equal(persisted.lastValidStep, 1);
  assert.ok(persisted.updatedAt, "updatedAt persisté");
});

test("B3 — reprise : un nouveau GET restaure l'étape courante", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  await completeStep(mod, {
    principal: schoolAdminA(),
    stepKey: "establishment",
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("establishment"),
  });
  await completeStep(mod, {
    principal: schoolAdminA(),
    stepKey: "academicYear",
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("academicYear"),
  });

  const resumed = await getGuided(mod, {
    principal: schoolAdminA({ sub: "admin-a-1" }),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("academicYear"),
  });
  assertPayloadShape(resumed);
  assert.equal(resumed.percent, 20);
  assert.equal(resumed.currentStep, 3);
  assert.equal(resumed.nextStepKey, "structure");
  assert.equal(resumed.nextStepLabel, "Structure pédagogique");
});

test("B4 — la progression n'augmente que si l'étape est réellement valide", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  await assert.rejects(
    () =>
      completeStep(mod, {
        principal: schoolAdminA(),
        stepKey: "establishment",
        one: MEMBERSHIP_LOOKUP,
        progressStore: store,
        loadSnapshot: async () => emptySnapshot({ hasName: true }),
      }),
    (error) => error.statusCode === 409 && /STEP_NOT_SATISFIED|données/i.test(String(error.message) + String(error.code ?? "")),
  );
  const after = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => emptySnapshot({ hasName: true }),
  });
  assert.equal(after.percent, 0);
  assert.deepEqual(after.completedSteps, []);
});

test("B5 — impossible de valider une étape dépendante si la précédente n'est pas satisfaite", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  await assert.rejects(
    () =>
      completeStep(mod, {
        principal: schoolAdminA(),
        stepKey: "academicYear",
        one: MEMBERSHIP_LOOKUP,
        progressStore: store,
        loadSnapshot: async () =>
          through("academicYear", {
            hasName: false,
            hasCountry: false,
            hasAddress: false,
            hasPhone: false,
            hasCurrency: false,
          }),
      }),
    (error) => error.statusCode === 409 && /STEP_DEPENDENCY|dépendance/i.test(String(error.message) + String(error.code ?? "")),
  );

  await assert.rejects(
    () =>
      completeStep(mod, {
        principal: schoolAdminA(),
        stepKey: "students",
        one: MEMBERSHIP_LOOKUP,
        progressStore: store,
        loadSnapshot: async () => through("structure", { enrolledStudentCount: 1 }),
      }),
    (error) => error.statusCode === 409,
  );
});

test("B6 — pas opérationnel avant validation des étapes 1 à 6", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  for (const key of REQUIRED_STEP_KEYS.slice(0, 5)) {
    await completeStep(mod, {
      principal: schoolAdminA(),
      stepKey: key,
      one: MEMBERSHIP_LOOKUP,
      progressStore: store,
      loadSnapshot: async () => through(key),
    });
  }
  const payload = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("teachers"),
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "configuration_required");
  assert.equal(payload.percent, 50);
  assert.equal(payload.nextStepKey, "students");
  assert.ok(!payload.completedSteps.includes("students"));
});

test("B7 — étapes 1 à 6 valides → operational, 60 %", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  for (const key of REQUIRED_STEP_KEYS) {
    await completeStep(mod, {
      principal: schoolAdminA(),
      stepKey: key,
      one: MEMBERSHIP_LOOKUP,
      progressStore: store,
      loadSnapshot: async () => through(key),
    });
  }
  const payload = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("students"),
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "operational");
  assert.equal(payload.percent, 60);
  assert.equal(payload.nextStepKey, "finance");
  assert.equal(payload.nextStepLabel, "Finance");
});

test("B8 — un admin établissement ne lit ni ne modifie la progression d'un autre établissement", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore({
    [SCHOOL_B_ID]: {
      lastValidStep: 4,
      completedSteps: ["establishment", "academicYear", "structure", "subjects"],
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  });

  const payloadA = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    query: { schoolCode: LOGIN_B },
    headers: { "x-somafrik-school-code": LOGIN_B },
    progressStore: store,
    loadSnapshot: async (tenant) => {
      assert.equal(String(tenant.schoolId), SCHOOL_A_ID);
      assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
      return emptySnapshot();
    },
  });
  assert.equal(payloadA.schoolId, SCHOOL_A_ID);
  assert.equal(payloadA.percent, 0);
  assert.doesNotMatch(JSON.stringify(payloadA), new RegExp(SCHOOL_B_ID));

  let writeResult;
  try {
    writeResult = await completeStep(mod, {
      principal: schoolAdminA(),
      stepKey: "establishment",
      one: MEMBERSHIP_LOOKUP,
      query: { schoolCode: LOGIN_B },
      body: { schoolId: SCHOOL_B_ID },
      progressStore: store,
      loadSnapshot: async (tenant) => {
        assert.notEqual(String(tenant.schoolId), SCHOOL_B_ID);
        return establishmentReady();
      },
    });
  } catch (error) {
    assert.ok(
      error.statusCode === 400 || error.statusCode === 403,
      `schoolCode client B: 400/403 ou écriture A, jamais B (status=${error.statusCode})`,
    );
    writeResult = null;
  }
  if (writeResult) {
    assert.equal(writeResult.schoolId, SCHOOL_A_ID);
  }

  const stillB = await store.load(SCHOOL_B_ID);
  assert.equal(stillB.lastValidStep, 4, "la progression B ne doit pas être écrasée");
  assert.deepEqual(stillB.completedSteps, ["establishment", "academicYear", "structure", "subjects"]);
});

test("B9 — un utilisateur sans permission UPDATE ne peut pas modifier la configuration", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  const reader = schoolAdminA({
    permissions: ["Paramètres Établissement:READ"],
  });
  await assert.rejects(
    () =>
      completeStep(mod, {
        principal: reader,
        stepKey: "establishment",
        one: MEMBERSHIP_LOOKUP,
        progressStore: store,
        loadSnapshot: async () => establishmentReady(),
      }),
    (error) => error.statusCode === 403,
  );
  const after = await getGuided(mod, {
    principal: reader,
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => establishmentReady(),
  });
  assert.equal(after.percent, 0);
});

test("B10 — revalider une étape déjà terminée est idempotent, percent ≤ 100", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  for (const key of ALL_STEP_KEYS) {
    await completeStep(mod, {
      principal: schoolAdminA(),
      stepKey: key,
      one: MEMBERSHIP_LOOKUP,
      progressStore: store,
      loadSnapshot: async () => through(key),
    });
  }
  const full = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("users"),
  });
  assertPayloadShape(full);
  assert.equal(full.percent, 100);
  assert.equal(full.status, "operational");
  assert.equal(full.completedSteps.length, 10);

  const again = await completeStep(mod, {
    principal: schoolAdminA(),
    stepKey: "establishment",
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("users"),
  });
  assert.equal(again.percent, 100);
  assert.deepEqual(again.completedSteps, [...ALL_STEP_KEYS]);
  assert.equal(again.completedSteps.filter((key) => key === "establishment").length, 1);

  const persisted = await store.load(SCHOOL_A_ID);
  assert.equal(persisted.completedSteps.filter((key) => key === "establishment").length, 1);
});

test("B11 — un enseignant sans affectation classe/matière ne valide pas l'étape 5", async () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  assert.match(
    src,
    /case\s+"teachers":[\s\S]*teacherAssignmentCount/,
    "étape 5 doit exiger teacherAssignmentCount, pas seulement teacherCount",
  );
  assert.match(
    src,
    /teacher_assignments[\s\S]*status\s*=\s*'active'/,
    "teacherAssignmentCount ne compte que les affectations actives",
  );

  const mod = requireGuided();
  assert.equal(
    mod.stepSatisfied("teachers", { teacherCount: 1, teacherAssignmentCount: 0 }),
    false,
    "teacherCount=1 sans affectation ne satisfait pas l'étape 5",
  );
  assert.equal(mod.stepSatisfied("teachers", { teacherCount: 1, teacherAssignmentCount: 1 }), true);

  const store = memoryProgressStore();
  for (const key of REQUIRED_STEP_KEYS.slice(0, 4)) {
    await completeStep(mod, {
      principal: schoolAdminA(),
      stepKey: key,
      one: MEMBERSHIP_LOOKUP,
      progressStore: store,
      loadSnapshot: async () => through(key),
    });
  }

  await assert.rejects(
    () =>
      completeStep(mod, {
        principal: schoolAdminA(),
        stepKey: "teachers",
        one: MEMBERSHIP_LOOKUP,
        progressStore: store,
        loadSnapshot: async () => through("teachers", { teacherCount: 1, teacherAssignmentCount: 0 }),
      }),
    (error) =>
      error.statusCode === 409
      && /STEP_NOT_SATISFIED|données/i.test(String(error.message) + String(error.code ?? "")),
  );

  const payload = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => through("teachers", { teacherCount: 1, teacherAssignmentCount: 0 }),
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "configuration_required");
  assert.equal(payload.percent, 40);
  assert.equal(payload.nextStepKey, "teachers");
  assert.ok(!payload.completedSteps.includes("teachers"));
  assert.ok(payload.status !== "operational");
});

test("B12 — 0 inscription Classe→Élève + studentCount orphelin ne valide pas l'étape 6", async () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  assert.doesNotMatch(
    src,
    /enrolledStudentCount\s*\|\|/,
    "fallback enrolledStudentCount || interdit — seule l'inscription en classe compte",
  );
  assert.doesNotMatch(
    src,
    /enrolledStudentCount\s*:\s*enrolledStudentCount\s*\|\|\s*asCount\(\s*base\.studentCount\s*\)/,
    "studentCount ne doit plus alimenter enrolledStudentCount",
  );

  const mod = requireGuided();
  const one = async (sql) => {
    const text = String(sql);
    if (/from\s+schools\b/i.test(text)) {
      return {
        name: "École A",
        country_id: "c1",
        address: "1 rue",
        phone: "000",
        logo_url: null,
        profile_payload: { currency: "USD" },
        country_currency: "USD",
      };
    }
    if (/from\s+enrollments\b/i.test(text)) return { c: 0 };
    if (/from\s+students\b/i.test(text)) return { c: 3 };
    return { c: 0 };
  };

  const snapshot = await mod.loadSchoolSetupGuidedSnapshot(one, SCHOOL_A_ID);
  assert.equal(snapshot.enrolledStudentCount, 0, "0 inscription → enrolledStudentCount=0");
  assert.equal(snapshot.studentCount, 3, "élèves hors classe restent dans studentCount");
  assert.equal(mod.stepSatisfied("students", snapshot), false);
  assert.equal(mod.stepSatisfied("students", { enrolledStudentCount: 0, studentCount: 3 }), false);

  const store = memoryProgressStore({
    [SCHOOL_A_ID]: {
      lastValidStep: 6,
      completedSteps: [...REQUIRED_STEP_KEYS],
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
  });
  const payload = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => snapshot,
  });
  assertPayloadShape(payload);
  assert.equal(payload.status, "configuration_required");
  assert.ok(payload.percent < 60, `0 inscription ne peut pas rendre operational (percent=${payload.percent})`);
  assert.ok(!payload.completedSteps.includes("students"));
});

test("B4b — une étape persistée redevient invalide si les données requises disparaissent", async () => {
  const mod = requireGuided();
  const store = memoryProgressStore();
  await completeStep(mod, {
    principal: schoolAdminA(),
    stepKey: "establishment",
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => establishmentReady(),
  });
  const regressed = await getGuided(mod, {
    principal: schoolAdminA(),
    one: MEMBERSHIP_LOOKUP,
    progressStore: store,
    loadSnapshot: async () => emptySnapshot(),
  });
  assert.equal(regressed.percent, 0);
  assert.equal(regressed.status, "configuration_required");
  assert.equal(regressed.currentStep, 1);
  assert.ok(!regressed.completedSteps.includes("establishment"));
  assert.ok(regressed.percent < 100);
});
