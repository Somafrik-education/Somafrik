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
  parentAverageDisplay,
  paymentItemCount,
  paymentItemsDetail,
  paymentMethodLabel,
  paymentReference,
  paymentStatusLabel,
  paymentTotal,
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
