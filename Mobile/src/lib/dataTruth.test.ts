/**
 * LOT 1 — vérité des données Mobile.
 *   npx tsx Mobile/src/lib/dataTruth.test.ts
 */
import assert from "node:assert/strict";
import {
  bulletinPeriod,
  canPersistFullSession,
  canRestorePersistedSession,
  classifyLoadFailure,
  DATA_TRUTH_COPY,
  isPublishedBulletin,
  normalizePaymentRow,
  metricLabelFromSnapshot,
  METRIC_PENDING_LABEL,
  METRIC_UNAVAILABLE_LABEL,
  NO_SESSION_RESOURCE_SCOPE,
  buildPrincipalScopeKey,
  buildResourceScopeKey,
  resourceCacheResetKind,
  scopeHydrationPlan,
  emptyResourceSnapshot,
  withScopedSnapshotData,
  parentAverageDisplay,
  paymentItemCount,
  paymentItemsDetail,
  paymentMethodLabel,
  paymentReference,
  paymentStatusLabel,
  paymentTotal,
  isCancelledStatus,
  isPaidStatus,
  shouldRenderEmpty,
  shouldRenderError,
  snapshotFromFailure,
  snapshotFromSuccess,
  unwrapList,
} from "./dataTruth";
import {
  assertUnrestrictedApiPath,
  beginRestrictedSession,
  clearRestrictedSession,
  hasRestrictedSession,
} from "./restrictedSession";
import { resolveDemoPin } from "../data/demoCredentials";

function expectThrow(label: string, fn: () => void) {
  try {
    fn();
    throw new Error(`EXPECTED_THROW:${label}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EXPECTED_THROW:")) throw error;
  }
}

function run() {
  assert.deepEqual(unwrapList([]), []);
  assert.deepEqual(unwrapList({ items: [{ id: "1" }] }), [{ id: "1" }]);
  assert.deepEqual(unwrapList({ bulletins: [] }), []);
  assert.equal(snapshotFromSuccess([]).status, "empty");
  assert.equal(shouldRenderEmpty(snapshotFromSuccess([])), true);
  assert.equal(shouldRenderError(snapshotFromSuccess([])), false);

  const planningError = snapshotFromFailure({ status: 500, message: "Erreur serveur" }, []);
  assert.equal(planningError.status, "error");
  assert.deepEqual(planningError.data, []);
  assert.equal(shouldRenderEmpty(planningError), false);
  assert.equal(shouldRenderError(planningError), true);
  assert.doesNotMatch(JSON.stringify(planningError), /Mathématiques|catalog|démo|demo/i);

  const emptyPlanning = snapshotFromSuccess([]);
  assert.equal(emptyPlanning.status, "empty");
  assert.equal(DATA_TRUTH_COPY.emptyPlanning.includes("Aucun"), true);

  const offline = classifyLoadFailure({ status: 0, message: "Connexion Internet indisponible." });
  assert.equal(offline.status, "offline");

  const receipt = normalizePaymentRow({
    id: "pay-1",
    reference: "PAY-0004",
    student: { id: "stu-1", name: "ESTHER OKITO" },
    status: "PAYE",
    paymentMethod: "Espèces",
    items: [
      { feeLabel: "Minerval", amount: 500 },
      { feeLabel: "Examen", amount: 1 },
      { feeLabel: "Cantine", amount: 40 },
    ],
  });
  assert.equal(paymentReference(receipt), "PAY-0004");
  assert.equal(receipt.studentName, "ESTHER OKITO");
  assert.equal(paymentItemCount(receipt), 3);
  assert.equal(paymentItemsDetail(receipt), "3 libellés");
  assert.equal(paymentTotal(receipt), 541);
  assert.equal(paymentMethodLabel(receipt), "Espèces");
  assert.equal(paymentStatusLabel(receipt.status), "Payé");
  assert.equal(isPaidStatus("Annulé"), false);
  assert.equal(isCancelledStatus("Annulé"), true);
  assert.equal(isCancelledStatus("cancelled"), true);
  assert.equal(isCancelledStatus("En attente"), false);

  const paymentsError = snapshotFromFailure({ status: 500, message: "Erreur paiements" }, []);
  assert.equal(paymentsError.status, "error");
  assert.equal(shouldRenderEmpty(paymentsError), false);
  assert.notEqual(DATA_TRUTH_COPY.errorPayments, DATA_TRUTH_COPY.emptyPayments);

  const parentNoNotes = parentAverageDisplay({
    notesReady: true,
    notesForStudent: [],
    average: 14.5,
  });
  assert.equal(parentNoNotes.available, false);
  assert.equal(parentNoNotes.label, "Moyenne indisponible");
  assert.notEqual(parentNoNotes.label, "14.5");

  const parentNotLoaded = parentAverageDisplay({
    notesReady: false,
    notesForStudent: [{ value: 14.5 }],
    average: 14.5,
  });
  assert.equal(parentNotLoaded.available, false);

  const parentCanonical = parentAverageDisplay({
    notesReady: true,
    notesForStudent: [{ studentId: "s1", value: 12 }],
    average: 12,
  });
  assert.equal(parentCanonical.available, true);
  assert.equal(parentCanonical.label, "12.0");

  const bulletinsEmpty = snapshotFromSuccess([]);
  assert.equal(bulletinsEmpty.status, "empty");
  assert.equal(DATA_TRUTH_COPY.emptyBulletins, "Aucun bulletin disponible");
  assert.equal(bulletinPeriod({ period: "T1" }), "T1");
  assert.equal(isPublishedBulletin("published"), true);
  assert.equal(isPublishedBulletin("Brouillon"), false);

  assert.equal(canPersistFullSession({ user: { mustChangePassword: true } }), false);
  assert.equal(canPersistFullSession({ user: { mustChangePassword: false } }), true);
  assert.equal(
    canRestorePersistedSession({
      hasAccessToken: true,
      profile: { user: { mustChangePassword: true } },
    }),
    false,
  );
  assert.equal(
    canRestorePersistedSession({
      hasAccessToken: false,
      profile: { user: { mustChangePassword: false } },
    }),
    false,
  );
  assert.equal(
    canRestorePersistedSession({
      hasAccessToken: true,
      profile: { user: { mustChangePassword: false } },
    }),
    true,
  );

  clearRestrictedSession();
  beginRestrictedSession("tmp-access", "tmp-refresh");
  assert.equal(hasRestrictedSession(), true);
  assertUnrestrictedApiPath("/auth/change-password");
  expectThrow("restricted payments", () => assertUnrestrictedApiPath("/payments"));
  expectThrow("restricted home", () => assertUnrestrictedApiPath("/students"));
  clearRestrictedSession();
  assert.equal(hasRestrictedSession(), false);

  assert.equal(metricLabelFromSnapshot({ status: "idle", data: [] }, () => "6"), METRIC_PENDING_LABEL);
  assert.equal(metricLabelFromSnapshot({ status: "loading", data: [] }, () => "6"), METRIC_PENDING_LABEL);
  assert.equal(
    metricLabelFromSnapshot({ status: "error", data: [], errorMessage: "boom" }, () => "6"),
    METRIC_UNAVAILABLE_LABEL,
  );
  assert.equal(metricLabelFromSnapshot({ status: "empty", data: [] }, () => "6"), "0");
  assert.equal(metricLabelFromSnapshot({ status: "success", data: [{ id: "1" }, { id: "2" }] }, (rows) => String(rows.length)), "2");
  assert.equal(
    metricLabelFromSnapshot({ status: "offline", data: [{ id: "1" }] }, (rows) => String(rows.length)),
    "1",
  );
  assert.equal(metricLabelFromSnapshot({ status: "offline", data: [] }, () => "6"), METRIC_UNAVAILABLE_LABEL);

  assert.equal(buildResourceScopeKey({ hasSession: false }), NO_SESSION_RESOURCE_SCOPE);
  const schoolAScope = buildResourceScopeKey({
    hasSession: true,
    userId: "admin-a",
    role: "school_admin",
    schoolCode: "NURU-A",
    activeSchoolCode: "NURU-A",
  });
  const schoolBScope = buildResourceScopeKey({
    hasSession: true,
    userId: "admin-b",
    role: "school_admin",
    schoolCode: "NURU-B",
    activeSchoolCode: "NURU-B",
  });
  assert.notEqual(schoolAScope, schoolBScope);
  assert.notEqual(
    buildResourceScopeKey({
      hasSession: true,
      userId: "super",
      role: "super_admin",
      activeSchoolCode: "NURU-A",
    }),
    buildResourceScopeKey({
      hasSession: true,
      userId: "super",
      role: "super_admin",
      activeSchoolCode: "NURU-B",
    }),
  );

  const superPrincipalA = buildPrincipalScopeKey({
    hasSession: true,
    userId: "super",
    role: "super_admin",
  });
  const superPrincipalB = buildPrincipalScopeKey({
    hasSession: true,
    userId: "super",
    role: "super_admin",
  });
  assert.equal(superPrincipalA, superPrincipalB);
  assert.equal(
    resourceCacheResetKind({
      previousPrincipalKey: superPrincipalA,
      nextPrincipalKey: superPrincipalB,
      nextResourceKey: buildResourceScopeKey({
        hasSession: true,
        userId: "super",
        role: "super_admin",
        activeSchoolCode: "NURU-B",
      }),
    }),
    "tenant",
  );
  assert.equal(
    resourceCacheResetKind({
      previousPrincipalKey: superPrincipalA,
      nextPrincipalKey: buildPrincipalScopeKey({
        hasSession: true,
        userId: "other-super",
        role: "super_admin",
      }),
      nextResourceKey: buildResourceScopeKey({
        hasSession: true,
        userId: "other-super",
        role: "super_admin",
        activeSchoolCode: "NURU-A",
      }),
    }),
    "principal",
  );
  assert.equal(
    resourceCacheResetKind({
      previousPrincipalKey: superPrincipalA,
      nextPrincipalKey: NO_SESSION_RESOURCE_SCOPE,
      nextResourceKey: NO_SESSION_RESOURCE_SCOPE,
    }),
    "principal",
  );

  const superLogin = buildPrincipalScopeKey({
    hasSession: true,
    userId: "super",
    role: "super_admin",
  });
  const superTenantA = buildResourceScopeKey({
    hasSession: true,
    userId: "super",
    role: "super_admin",
    activeSchoolCode: "CD-IN-26-001",
  });
  const superTenantB = buildResourceScopeKey({
    hasSession: true,
    userId: "super",
    role: "super_admin",
    activeSchoolCode: "BI-EC-26-001",
  });
  const otherPrincipal = buildPrincipalScopeKey({
    hasSession: true,
    userId: "country-admin",
    role: "country_admin",
    countryScope: "CD",
  });
  const otherResource = buildResourceScopeKey({
    hasSession: true,
    userId: "country-admin",
    role: "country_admin",
    countryScope: "CD",
    activeSchoolCode: "CD-IN-26-001",
  });

  function applySchoolsLifecycle(
    events: Array<{
      nextPrincipalKey: string;
      nextResourceKey: string;
      apiSchools: string[];
    }>,
  ) {
    let schools: string[] = ["LEAK-PREVIOUS"];
    let previousPrincipalKey: string | null = null;
    for (const event of events) {
      const plan = scopeHydrationPlan({
        previousPrincipalKey,
        nextPrincipalKey: event.nextPrincipalKey,
        nextResourceKey: event.nextResourceKey,
      });
      previousPrincipalKey = event.nextPrincipalKey;
      if (plan.resetKind === "principal") schools = [];
      if (plan.loadPrincipal) schools = event.apiSchools;
    }
    return schools;
  }

  const afterSuperLogin = applySchoolsLifecycle([
    {
      nextPrincipalKey: superLogin,
      nextResourceKey: superTenantA,
      apiSchools: ["CD-IN-26-001", "BI-EC-26-001"],
    },
  ]);
  assert.deepEqual(afterSuperLogin, ["CD-IN-26-001", "BI-EC-26-001"]);
  assert.equal(afterSuperLogin.length > 0, true);

  const afterTenantSwitch = applySchoolsLifecycle([
    {
      nextPrincipalKey: superLogin,
      nextResourceKey: superTenantA,
      apiSchools: ["CD-IN-26-001", "BI-EC-26-001"],
    },
    {
      nextPrincipalKey: superLogin,
      nextResourceKey: superTenantB,
      apiSchools: ["SHOULD-NOT-RELOAD"],
    },
  ]);
  assert.deepEqual(afterTenantSwitch, ["CD-IN-26-001", "BI-EC-26-001"]);

  const afterLogout = applySchoolsLifecycle([
    {
      nextPrincipalKey: superLogin,
      nextResourceKey: superTenantA,
      apiSchools: ["CD-IN-26-001", "BI-EC-26-001"],
    },
    {
      nextPrincipalKey: NO_SESSION_RESOURCE_SCOPE,
      nextResourceKey: NO_SESSION_RESOURCE_SCOPE,
      apiSchools: ["CD-IN-26-001"],
    },
  ]);
  assert.deepEqual(afterLogout, []);

  const afterOtherLogin = applySchoolsLifecycle([
    {
      nextPrincipalKey: superLogin,
      nextResourceKey: superTenantA,
      apiSchools: ["CD-IN-26-001", "BI-EC-26-001"],
    },
    {
      nextPrincipalKey: NO_SESSION_RESOURCE_SCOPE,
      nextResourceKey: NO_SESSION_RESOURCE_SCOPE,
      apiSchools: [],
    },
    {
      nextPrincipalKey: otherPrincipal,
      nextResourceKey: otherResource,
      apiSchools: ["CD-IN-26-001"],
    },
  ]);
  assert.deepEqual(afterOtherLogin, ["CD-IN-26-001"]);
  assert.equal(afterOtherLogin.includes("BI-EC-26-001"), false);

  const loginPlan = scopeHydrationPlan({
    previousPrincipalKey: null,
    nextPrincipalKey: superLogin,
    nextResourceKey: superTenantA,
  });
  assert.equal(loginPlan.resetKind, "principal");
  assert.equal(loginPlan.loadPrincipal, true);
  assert.equal(loginPlan.loadTenant, true);

  const switchPlan = scopeHydrationPlan({
    previousPrincipalKey: superLogin,
    nextPrincipalKey: superLogin,
    nextResourceKey: superTenantB,
  });
  assert.equal(switchPlan.resetKind, "tenant");
  assert.equal(switchPlan.loadPrincipal, false);
  assert.equal(switchPlan.loadTenant, true);

  const logoutPlan = scopeHydrationPlan({
    previousPrincipalKey: superLogin,
    nextPrincipalKey: NO_SESSION_RESOURCE_SCOPE,
    nextResourceKey: NO_SESSION_RESOURCE_SCOPE,
  });
  assert.equal(logoutPlan.resetKind, "principal");
  assert.equal(logoutPlan.loadPrincipal, false);
  assert.equal(logoutPlan.loadTenant, false);

  const tenantAUsers = snapshotFromSuccess([{ id: "user-a" }]);
  const purged = emptyResourceSnapshot<typeof tenantAUsers.data[number]>();
  const failedAfterSwitch = snapshotFromFailure({ status: 0, message: "offline" }, purged.data);
  assert.deepEqual(failedAfterSwitch.data, []);
  assert.equal(
    metricLabelFromSnapshot(failedAfterSwitch, (rows) => String(rows.length)),
    METRIC_UNAVAILABLE_LABEL,
  );
  const leakedIfNotPurged = snapshotFromFailure({ status: 0, message: "offline" }, tenantAUsers.data);
  assert.equal(metricLabelFromSnapshot(leakedIfNotPurged, (rows) => String(rows.length)), "1");

  const mixedSchools = snapshotFromSuccess([
    { id: "1", schoolCode: "A" },
    { id: "2", schoolCode: "B" },
  ]);
  const scopedToB = withScopedSnapshotData(
    mixedSchools,
    mixedSchools.data.filter((row) => row.schoolCode === "B"),
  );
  assert.equal(scopedToB.status, "success");
  assert.equal(scopedToB.data.length, 1);
  assert.equal(withScopedSnapshotData(mixedSchools, []).status, "empty");
  assert.equal(
    metricLabelFromSnapshot({ status: "error", data: [] }, () => String([].length)),
    METRIC_UNAVAILABLE_LABEL,
  );
  assert.equal(
    metricLabelFromSnapshot({ status: "offline", data: [] }, () => "0"),
    METRIC_UNAVAILABLE_LABEL,
  );

  const previousPin = process.env.EXPO_PUBLIC_DEMO_PIN;
  process.env.EXPO_PUBLIC_DEMO_PIN = "";
  assert.equal(resolveDemoPin(), null);
  process.env.EXPO_PUBLIC_DEMO_PIN = "local-dev-only";
  assert.equal(resolveDemoPin(), "local-dev-only");
  if (previousPin == null) delete process.env.EXPO_PUBLIC_DEMO_PIN;
  else process.env.EXPO_PUBLIC_DEMO_PIN = previousPin;

  console.log("dataTruth.test.ts OK");
}

run();
