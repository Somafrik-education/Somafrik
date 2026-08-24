/**
 * KPI Taux de paiement — assiette obligations, jamais payments.length.
 *   npx tsx Mobile/src/lib/paymentRateKpi.test.ts
 */
import assert from "node:assert/strict";
import {
  PAYMENT_RATE_KPI_LABEL,
  formatPaymentRateKpi,
  getPaymentRateKpi,
  type StudentFeeObligation,
} from "./paymentRateKpi";

function obligation(
  studentId: string,
  extras: Partial<StudentFeeObligation> = {},
): StudentFeeObligation {
  return {
    studentId,
    amountDue: 1000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
    ...extras,
  };
}

function run() {
  assert.equal(PAYMENT_RATE_KPI_LABEL, "Taux de paiement");

  const fiveExpectedOnePaid = [
    obligation("s1", { amountPaid: 1000, status: "Payé" }),
    obligation("s2"),
    obligation("s3"),
    obligation("s4"),
    obligation("s5"),
  ];
  const twenty = formatPaymentRateKpi(fiveExpectedOnePaid);
  assert.equal(twenty.label, "Taux de paiement");
  assert.equal(twenty.value, "20 %");
  assert.equal(getPaymentRateKpi(fiveExpectedOnePaid).rate, 20);

  const nonePaid = [
    obligation("s1"),
    obligation("s2"),
    obligation("s3"),
    obligation("s4"),
    obligation("s5"),
  ];
  assert.equal(formatPaymentRateKpi(nonePaid).value, "0 %");
  assert.equal(getPaymentRateKpi(nonePaid).rate, 0);

  const allPaid = ["s1", "s2", "s3", "s4", "s5"].map((id) =>
    obligation(id, { amountPaid: 1000, status: "Payé" }),
  );
  assert.equal(formatPaymentRateKpi(allPaid).value, "100 %");

  assert.equal(formatPaymentRateKpi([]).value, "—");
  assert.equal(getPaymentRateKpi([]).rate, null);

  const cancelledOnly = ["s1", "s2", "s3", "s4", "s5"].map((id) =>
    obligation(id, { status: "Annulé" }),
  );
  assert.equal(formatPaymentRateKpi(cancelledOnly).value, "—", "obligations annulées ≠ assiette");

  const onePaymentRowWouldBeHundred = formatPaymentRateKpi([
    obligation("s1", { amountPaid: 1000, status: "Payé" }),
  ]);
  assert.equal(
    onePaymentRowWouldBeHundred.value,
    "100 %",
    "une seule obligation soldée = 100 % seulement s'il n'y a pas d'autres dettes",
  );
  assert.notEqual(
    formatPaymentRateKpi(fiveExpectedOnePaid).value,
    "100 %",
    "5 élèves facturables dont 1 payé ne peut pas être 100 %",
  );

  const unequal = [
    obligation("s1", { amountDue: 4000, amountPaid: 4000, status: "Payé" }),
    obligation("s2", { amountDue: 1000, amountPaid: 0 }),
  ];
  assert.equal(formatPaymentRateKpi(unequal).value, "80 %");

  const noDue = [
    { studentId: "s1", status: "Payé", amountPaid: 1000 },
    { studentId: "s2", status: "À payer" },
  ];
  assert.equal(formatPaymentRateKpi(noDue).value, "—", "obligations sans amountDue calculable → —");
  assert.equal(getPaymentRateKpi(noDue).rate, null);

  const mixedInvalid = [
    obligation("s1", { amountPaid: 1000, status: "Payé" }),
    { studentId: "s2", amountDue: "n/a", amountPaid: 0, status: "À payer" },
  ];
  assert.equal(formatPaymentRateKpi(mixedInvalid).value, "—", "mélange valide + amountDue invalide → —");
  assert.equal(getPaymentRateKpi(mixedInvalid).rate, null);

  console.log("OK: paymentRateKpi assiette obligations 20/0/100/—");
}

run();
