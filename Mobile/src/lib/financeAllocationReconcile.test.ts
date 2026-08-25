/**
 * Réconciliation Finance :
 * - le wrapper de chargement GET est strictement read-only ;
 * - l'action explicite conserve son fail-soft 403 / vraie coupure seulement.
 *
 *   npx tsx Mobile/src/lib/financeAllocationReconcile.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import {
  ensureCanonicalPaymentAllocations,
  isSoftPaymentAllocationReconcileFailure,
  withCanonicalPaymentAllocations,
} from "./financeAllocationReconcile";

function httpError(status: number, message = "échec") {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function run() {
  const source = fs.readFileSync(path.join(__dirname, "financeAllocationReconcile.ts"), "utf8");
  assert.match(source, /isSoftPaymentAllocationReconcileFailure/);
  assert.match(source, /throw error/);
  assert.match(source, /return load\(\);/);
  assert.doesNotMatch(
    source,
    /withCanonicalPaymentAllocations[\s\S]*?await ensureCanonicalPaymentAllocations/,
    "un GET ne doit jamais réconcilier implicitement",
  );

  assert.equal(isSoftPaymentAllocationReconcileFailure(httpError(403)), true);
  assert.equal(isSoftPaymentAllocationReconcileFailure(httpError(0, "Connexion Internet indisponible.")), true);
  assert.equal(
    isSoftPaymentAllocationReconcileFailure(new Error("Délai de requête dépassé. Vérifiez votre réseau.")),
    false,
    "timeout n'est pas une coupure réseau",
  );
  for (const status of [400, 401, 404, 409, 500]) {
    assert.equal(
      isSoftPaymentAllocationReconcileFailure(httpError(status, "indisponible")),
      false,
      `${status} ne doit pas être absorbé par l'action explicite`,
    );
  }

  return (async () => {
    for (const status of [400, 401, 403, 404, 409, 500] as const) {
      let reconcileCalls = 0;
      let loadCalls = 0;
      const result = await withCanonicalPaymentAllocations(
        async () => {
          loadCalls += 1;
          return [{ amountPaid: 0 }];
        },
        async () => {
          reconcileCalls += 1;
          throw httpError(status);
        },
      );
      assert.deepEqual(result, [{ amountPaid: 0 }]);
      assert.equal(loadCalls, 1, `${status} → GET appelé une fois`);
      assert.equal(reconcileCalls, 0, `${status} → aucune réconciliation implicite`);
    }

    let explicit403Calls = 0;
    await ensureCanonicalPaymentAllocations(async () => {
      explicit403Calls += 1;
      throw httpError(403);
    });
    assert.equal(explicit403Calls, 1, "action explicite 403 exécutée puis fail-soft");

    await assert.rejects(
      ensureCanonicalPaymentAllocations(async () => {
        throw httpError(500);
      }),
      (error: unknown) => {
        assert.equal((error as { status?: number }).status, 500);
        return true;
      },
    );

    console.log("OK: GET frais read-only ; reconcile explicite 403/offline fail-soft ; 5xx visible");
  })();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
