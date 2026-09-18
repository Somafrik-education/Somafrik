/**
 * PARITY-029 — preuve comportementale du flux post-login Mobile.
 *   npx --yes tsx --test Mobile/src/lib/schoolSetupMobile.postLogin.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveMobilePostLoginNavigation,
  resetSchoolSetupWizardSessionDismiss,
} from "./schoolSetupMobile";
import type { SchoolSetupPayload } from "./schoolSetupStatusApi";

const notStarted: SchoolSetupPayload = {
  status: "NOT_STARTED",
  core: { academicYear: false, structure: false, classes: false },
  progress: { coreDone: 0, coreTotal: 3 },
};

const inProgress: SchoolSetupPayload = {
  status: "IN_PROGRESS",
  core: { academicYear: true, structure: false, classes: false },
  progress: { coreDone: 1, coreTotal: 3 },
};

function spyStatus(payload: SchoolSetupPayload | Error) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getStatus: async () => {
      calls += 1;
      if (payload instanceof Error) throw payload;
      return payload;
    },
  };
}

test("school_admin + NOT_STARTED → Home puis SchoolSetup", async () => {
  resetSchoolSetupWizardSessionDismiss();
  const status = spyStatus(notStarted);
  const plan = await resolveMobilePostLoginNavigation({
    role: "school_admin",
    mustChangePassword: false,
    getStatus: status.getStatus,
  });
  assert.equal(status.calls, 1);
  assert.equal(plan.fetchStatus, true);
  assert.deepEqual(plan.destinations, ["Home", "SchoolSetup"]);
});

test("teacher / parent / student → pas de GET setup, pas d'auto-open", async () => {
  for (const role of ["teacher", "parent_student", "student"]) {
    const status = spyStatus(notStarted);
    const plan = await resolveMobilePostLoginNavigation({
      role,
      mustChangePassword: false,
      getStatus: status.getStatus,
    });
    assert.equal(status.calls, 0, `${role} ne doit pas appeler GET school-setup/status`);
    assert.equal(plan.fetchStatus, false);
    assert.deepEqual(plan.destinations, ["Home"]);
  }
});

test("API setup KO → Home accessible, pas de boucle SchoolSetup", async () => {
  const status = spyStatus(new Error("network"));
  const plan = await resolveMobilePostLoginNavigation({
    role: "school_admin",
    mustChangePassword: false,
    getStatus: status.getStatus,
  });
  assert.equal(status.calls, 1);
  assert.equal(plan.fetchStatus, true);
  assert.deepEqual(plan.destinations, ["Home"]);
  assert.equal(plan.destinations.includes("SchoolSetup"), false);
});

test("mustChangePassword → aucun setup avant changement de secret", async () => {
  const status = spyStatus(notStarted);
  const plan = await resolveMobilePostLoginNavigation({
    role: "school_admin",
    mustChangePassword: true,
    getStatus: status.getStatus,
  });
  assert.equal(status.calls, 0);
  assert.equal(plan.fetchStatus, false);
  assert.deepEqual(plan.destinations, []);
});

test("IN_PROGRESS ne déclenche pas l'auto-open", async () => {
  resetSchoolSetupWizardSessionDismiss();
  const status = spyStatus(inProgress);
  const plan = await resolveMobilePostLoginNavigation({
    role: "school_admin",
    mustChangePassword: false,
    getStatus: status.getStatus,
  });
  assert.equal(status.calls, 1);
  assert.deepEqual(plan.destinations, ["Home"]);
});
