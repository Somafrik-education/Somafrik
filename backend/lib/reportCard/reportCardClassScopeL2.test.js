"use strict";

/**
 * BULLETIN-CLASSE-01 / L2 — service de configuration en mémoire : portée classe × année.
 * (Parcours HTTP + PostgreSQL réels : reportCardClassScopeL2.http.pg.test.js.)
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAcademicRuleProfileStore } = require("./academicRuleProfileStore");
const { createReportCardSchemaStore } = require("./reportCardSchemaStore");
const { createReportCardConfiguration } = require("./reportCardConfiguration");
const { sampleConfiguration } = require("./reportCardCatalog");

const SCHOOL = "aaaaaaaa-0000-4000-8000-000000000071";
const C1 = { classId: "c1c1c1c1-0000-4000-8000-000000000071", academicYearId: "y1y1y1y1-0000-4000-8000-000000000071".replace(/y/g, "a") };
const C2 = { classId: "c2c2c2c2-0000-4000-8000-000000000071", academicYearId: C1.academicYearId };
const actor = { actorId: "admin", actorSchoolId: SCHOOL, permissions: ["REPORT_CARD_READ", "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"] };
const MODEL = { model_id: "colombiere", version: 1, name: "Colombière", presentation_style: "simple", status: "active" };

function setup() {
  return createReportCardConfiguration({
    profileStore: createAcademicRuleProfileStore(),
    schemaStore: createReportCardSchemaStore(),
    clock: { now: () => new Date().toISOString() },
  });
}

async function saveAndActivate(api, scope, signatures) {
  const built = sampleConfiguration(MODEL, "TJ_EX");
  const templateSpec = { ...built.templateSpec, presentation: { ...built.templateSpec.presentation, signatures } };
  await api.saveCatalogConfiguration({ actor, schoolId: SCHOOL, modelKey: "catalog-colombiere", profileSpec: built.profileSpec, schemaSpec: built.schemaSpec, templateSpec, scope });
  return api.activateCatalogConfiguration({ actor, schoolId: SCHOOL, modelKey: "catalog-colombiere", scope });
}

test("liaison de classe prioritaire, repli établissement, classes indépendantes", async () => {
  const api = setup();
  await saveAndActivate(api, undefined, ["Établissement"]);
  const school = await api.lookupActiveBinding({ schoolId: SCHOOL, modelKey: "catalog-colombiere" });
  assert.equal(school.class_id, undefined);
  // C1 sans configuration propre : héritage.
  assert.equal((await api.lookupActiveBinding({ schoolId: SCHOOL, modelKey: "catalog-colombiere", ...C1 })).request_id, school.request_id);
  const c1State = await api.catalogConfigurationState({ actor, schoolId: SCHOOL, modelKey: "catalog-colombiere", scope: C1 });
  assert.equal(c1State.active, null);
  assert.ok(c1State.inherited, "configuration héritée signalée");
  const c1 = await saveAndActivate(api, C1, ["Titulaire C1"]);
  assert.equal(c1.class_id, C1.classId);
  const c1Binding = await api.lookupActiveBinding({ schoolId: SCHOOL, modelKey: "catalog-colombiere", ...C1 });
  assert.equal(c1Binding.request_id, c1.id);
  assert.equal((await api.lookupActiveBinding({ schoolId: SCHOOL, modelKey: "catalog-colombiere", ...C2 })).request_id, school.request_id, "C2 hérite toujours");
  assert.equal((await api.lookupActiveBinding({ schoolId: SCHOOL, modelKey: "catalog-colombiere" })).request_id, school.request_id, "établissement inchangé");
  assert.notEqual(c1Binding.profile_id, school.profile_id, "version propre à la classe");
  // Requête établissement ACTIVE non archivée par l'activation de C1.
  const requests = await api.listRequests({ actor, schoolId: SCHOOL });
  assert.equal(requests.filter((r) => r.status === "ACTIVE").length, 2);
});

test("portée incomplète refusée", async () => {
  const api = setup();
  const built = sampleConfiguration(MODEL, "TJ_EX");
  await assert.rejects(
    api.saveCatalogConfiguration({ actor, schoolId: SCHOOL, modelKey: "catalog-colombiere", profileSpec: built.profileSpec, schemaSpec: built.schemaSpec, templateSpec: built.templateSpec, scope: { classId: C1.classId } }),
    (err) => err.code === "CLASS_SCOPE_INVALID"
  );
});
