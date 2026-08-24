/**
 * Fail-soft réconciliation : 403 / offline seulement.
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
  assert.doesNotMatch(source, /catch\s*\{/);

  assert.equal(isSoftPaymentAllocationReconcileFailure(httpError(403)), true);
  assert.equal(isSoftPaymentAllocationReconcileFailure(httpError(0, "Connexion Internet indisponible.")), true);
  assert.equal(
    isSoftPaymentAllocationReconcileFailure(new Error("Délai de requête dépassé. Vérifiez votre réseau.")),
    true,
  );
  for (const status of [400, 401, 404, 409, 500]) {
    assert.equal(
      isSoftPaymentAllocationReconcileFailure(httpError(status, "indisponible")),
      false,
      `${status} ne doit pas être absorbé`,
    );
  }

  async function scenario(status: number | "offline") {
    let loaded = false;
    const reconcile = async () => {
      if (status === "offline") {
        throw Object.assign(new Error("Connexion Internet indisponible."), { status: 0 });
      }
      throw httpError(status);
    };
    const load = async () => {
      loaded = true;
      return [{ amountPaid: 0 }];
    };
    return { loaded: () => loaded, run: () => withCanonicalPaymentAllocations(load, reconcile) };
  }

  return (async () => {
    const forbidden = await scenario(403);
    await forbidden.run();
    assert.equal(forbidden.loaded(), true, "403 → GET student-fees continue");

    const offline = await scenario("offline");
    await offline.run();
    assert.equal(offline.loaded(), true, "offline → GET continue");

    for (const status of [400, 401, 404, 409, 500] as const) {
      const blocked = await scenario(status);
      await assert.rejects(blocked.run, (error: unknown) => {
        assert.equal((error as { status?: number }).status, status);
        return true;
      });
      assert.equal(blocked.loaded(), false, `${status} → GET non appelé, pas de faux 0`);
    }

    await ensureCanonicalPaymentAllocations(async () => {
      throw httpError(403);
    });

    console.log("OK: financeAllocationReconcile 403/offline fail-soft ; 400/401/404/409/5xx visibles");
  })();
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
