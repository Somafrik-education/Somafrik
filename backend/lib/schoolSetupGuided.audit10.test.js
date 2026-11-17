"use strict";

/**
 * AUDIT-SETUP-GUIDED-10-01 — messages des étapes bloquées.
 *
 * Anomalie prod : « Étape Informations établissement non satisfaite : Renseignez le nom,
 * le pays, l'adresse, le téléphone et la devise » alors que seul un champ manque.
 * L'utilisateur doit voir précisément le ou les champs manquants, et une dépendance
 * bloquée doit nommer l'étape à corriger. Aucune règle n'est assouplie.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const guided = require("./schoolSetupGuided");

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function admin() {
  return {
    role: "Admin School",
    sub: "admin-a-1",
    permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"],
  };
}

const MEMBERSHIP = async (sql, params = []) =>
  /from\s+users/i.test(String(sql)) && String(params[0]) === "admin-a-1"
    ? { school_id: SCHOOL_ID, login_code: "BI-BUJ-26-001", id: SCHOOL_ID }
    : null;

function snapshot(overrides = {}) {
  return {
    hasName: true,
    hasCountry: true,
    hasAddress: true,
    hasPhone: true,
    hasCurrency: true,
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
    userCount: 1,
    ...overrides,
  };
}

function input(stepKey, snap, store = guided.createMemoryProgressStore()) {
  return { principal: admin(), stepKey, one: MEMBERSHIP, progressStore: store, loadSnapshot: async () => snap };
}

test("AUDIT10-U-01 — anomalie prod : seule l'adresse manque → le message nomme l'adresse et uniquement elle", async () => {
  const store = guided.createMemoryProgressStore();
  await assert.rejects(
    () => guided.completeGuidedStep(input("establishment", snapshot({ hasAddress: false }), store)),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "STEP_NOT_SATISFIED");
      assert.match(error.message, /Informations établissement/);
      assert.match(error.message, /adresse/);
      for (const other of ["le nom", "le pays", "le téléphone", "la devise"]) {
        assert.doesNotMatch(error.message, new RegExp(other), `« ${other} » est renseigné, il ne doit pas être cité`);
      }
      assert.deepEqual(error.details.missingFields, [{ key: "address", label: "Adresse" }]);
      assert.equal(error.details.stepKey, "establishment");
      assert.equal(error.details.stepLabel, "Informations établissement");
      return true;
    },
  );
  const after = await guided.getSchoolSetupGuided(input("establishment", snapshot({ hasAddress: false }), store));
  assert.equal(after.completedSteps.includes("establishment"), false, "jamais marquée sans adresse");
});

test("AUDIT10-U-02 — plusieurs champs manquants : tous sont listés, dans l'ordre du formulaire", async () => {
  await assert.rejects(
    () => guided.completeGuidedStep(input("establishment", snapshot({ hasAddress: false, hasCurrency: false, hasPhone: false }))),
    (error) => {
      assert.deepEqual(
        error.details.missingFields.map((field) => field.key),
        ["address", "phone", "currency"],
      );
      assert.match(error.message, /adresse, téléphone, devise/);
      return true;
    },
  );
});

test("AUDIT10-U-03 — une fois l'adresse saisie, la même étape passe (réévaluation sans reconnexion)", async () => {
  const store = guided.createMemoryProgressStore();
  await assert.rejects(() => guided.completeGuidedStep(input("establishment", snapshot({ hasAddress: false }), store)));
  const done = await guided.completeGuidedStep(input("establishment", snapshot(), store));
  assert.ok(done.completedSteps.includes("establishment"));
  assert.equal(done.currentStep, 2);
});

test("AUDIT10-U-04 — dépendance bloquée : le message nomme l'étape précédente non satisfaite", async () => {
  await assert.rejects(
    () => guided.completeGuidedStep(input("structure", snapshot({ hasAddress: false }))),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "STEP_DEPENDENCY");
      assert.match(error.message, /Informations établissement/);
      assert.equal(error.details.stepKey, "establishment");
      assert.equal(error.details.blockedStepKey, "structure");
      assert.deepEqual(error.details.missingFields, [{ key: "address", label: "Adresse" }]);
      return true;
    },
  );
});

test("AUDIT10-U-05 — les autres étapes gardent leur condition explicite (contrat PROD-V25-POSTSMOKE-01 inchangé)", async () => {
  await assert.rejects(
    () => guided.completeGuidedStep(input("establishment", snapshot({ hasName: false }))),
    (error) => {
      assert.deepEqual(error.details.missingFields, [{ key: "name", label: "Nom" }]);
      return true;
    },
  );
  const ready = snapshot({
    hasCurrentOrOpenAcademicYear: true,
    hasAcademicYearDates: false,
  });
  await assert.rejects(
    () => guided.completeGuidedStep(input("academicYear", ready)),
    (error) => {
      assert.equal(error.code, "STEP_NOT_SATISFIED");
      assert.equal(error.details.requirement, guided.GUIDED_STEP_REQUIREMENTS.academicYear);
      assert.equal(error.details.missingFields, undefined);
      return true;
    },
  );
});
