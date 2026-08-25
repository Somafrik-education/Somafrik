/**
 * Caisse Mobile — Encaissé / Imputé / Non imputé.
 *   npx tsx Mobile/src/lib/paymentCashKpi.test.ts
 */
import assert from "node:assert/strict";
import { getPaymentCashKpi, isCountedMobileCashPayment } from "./paymentCashKpi";
import { normalizePaymentRow, paymentStatusLabel, isPaidStatus } from "./dataTruth";

function run() {
  const maeva = normalizePaymentRow({
    id: "CD-2026-0001-2026-PAY-0007",
    reference: "CD-2026-0001-2026-PAY-0007",
    amount: 150,
    status: "Non imputé",
    allocatedAmount: 0,
    unallocatedAmount: 150,
    studentId: "CD-2026-0001-STU-MAEVA",
  });
  assert.equal(paymentStatusLabel(maeva.status), "Non imputé");
  assert.equal(isPaidStatus(maeva.status), false);
  const leftover = getPaymentCashKpi([maeva]);
  assert.equal(leftover.collectedAmount, 150);
  assert.equal(leftover.allocatedAmount, 0);
  assert.equal(leftover.unallocatedAmount, 150);

  const allocated = normalizePaymentRow({
    id: "pay-ok",
    amount: 150,
    status: "Partiel",
    allocatedAmount: 150,
    unallocatedAmount: 0,
  });
  const mix = getPaymentCashKpi([maeva, allocated]);
  assert.equal(mix.collectedAmount, 300);
  assert.equal(mix.allocatedAmount, 150);
  assert.equal(mix.unallocatedAmount, 150);

  for (const status of ["Annulé", "En attente de confirmation", "pending", "Refusé", "Échoué", "failed"]) {
    const row = normalizePaymentRow({ id: `skip-${status}`, amount: 150, status, unallocatedAmount: 150 });
    assert.equal(isCountedMobileCashPayment(row), false, `${status} ne doit pas entrer dans Encaissé`);
    const ignored = getPaymentCashKpi([row]);
    assert.equal(ignored.collectedAmount, 0, `${status} → encaissé = 0`);
    assert.equal(ignored.allocatedAmount, 0, `${status} → imputé = 0`);
    assert.equal(ignored.unallocatedAmount, 0, `${status} → non imputé = 0`);
  }

  console.log("OK: paymentCashKpi exclut pending/refusé/échoué et sépare Maeva 150 FC non imputés");
}

run();
