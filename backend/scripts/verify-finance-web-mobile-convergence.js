"use strict";

/**
 * F5 — Gate convergence Web ↔ Mobile.
 * Pas de nouveau moteur Finance. Pas de F6 RBAC. Pas de F7 redesign.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function sourceGuards() {
  const contract = read("backend/lib/financeWebMobileWriteContract.js");
  const webWrite = read("web/src/lib/financePaymentWrite.ts");
  const webModal = read("web/src/components/payments/QuickPaymentModal.tsx");
  const entityPage = read("web/src/pages/EntityPage.tsx");
  const mobileEnroll = read("Mobile/src/lib/paymentEnrollment.ts");
  const mobileControls = read("Mobile/src/components/PaymentMutationControls.tsx");
  const studentPayments = read("Mobile/src/screens/StudentPaymentsScreen.tsx");
  const paymentsScreen = read("Mobile/src/screens/PaymentsScreen.tsx");
  const outbox = read("Mobile/src/lib/outbox.ts");
  const outboxRuntime = read("Mobile/src/components/OutboxRuntime.tsx");
  const inventory = read("Mobile/src/lib/mobileMutationInventory.ts");
  const api = read("Mobile/src/services/api.ts");
  const cash = read("Mobile/src/lib/paymentCashKpi.ts");
  const receipt = read("web/src/components/payments/PaymentReceipt.tsx");

  const formValidation = read("Mobile/src/lib/formFieldValidation.ts");

  assert.match(contract, /UNALLOCATED_FEE_TYPE = "Non imputé"/);
  assert.match(contract, /UNALLOCATED_TARGET = "__unallocated__"/);
  assert.match(contract, /buildFinancePaymentWritePayload/);
  assert.match(contract, /isOpenObligationFromProjection/);
  assert.match(contract, /trim\(value\) === UNALLOCATED_TARGET/);
  assert.match(contract, /FINANCE_OBLIGATION_ID_REQUIRED/);
  assert.doesNotMatch(contract, /amountDue - amountPaid/);
  assert.doesNotMatch(contract, /Math\.max\(0,\s*(due|amountDue)/);
  assert.doesNotMatch(contract, /!id \|\| id === UNALLOCATED_TARGET/);
  assert.doesNotMatch(contract, /!obligationId => Non imputé/);

  assert.match(webWrite, /UNALLOCATED_FEE_TYPE = "Non imputé"/);
  assert.match(webWrite, /buildFinancePaymentWritePayload/);
  assert.match(webWrite, /Number\(fee\.balance\)/);
  assert.match(webWrite, /trim\(value\) === UNALLOCATED_TARGET/);
  assert.match(webWrite, /FINANCE_OBLIGATION_ID_REQUIRED/);
  assert.doesNotMatch(webWrite, /amountDue - amountPaid/);
  assert.doesNotMatch(webWrite, /!id \|\| id === UNALLOCATED_TARGET/);
  assert.doesNotMatch(webWrite, /!obligationId => Non imputé/);

  assert.match(webModal, /buildFinancePaymentWritePayload/);
  assert.match(webModal, /listStudentFees/);
  assert.match(webModal, /listPaymentStudentOptions/);
  assert.match(webModal, /getFinanceCatalog/);
  assert.match(webModal, /UNALLOCATED_TARGET/);
  assert.match(webModal, /Montant non imputé/);
  assert.match(webModal, /obligationId/);
  assert.doesNotMatch(webModal, /PAYMENT_METHODS/);
  assert.doesNotMatch(webModal, /\["Espèces", "Mobile Money", "Virement"\]/);
  assert.doesNotMatch(webModal, /computeFeeBalance/);
  assert.doesNotMatch(webModal, /feeType: line\.feeType/);
  assert.doesNotMatch(webModal, /catalogFeeTypes/);

  assert.match(entityPage, /obligationId ou Non imputé/);
  assert.doesNotMatch(
    entityPage.slice(entityPage.indexOf('if (module.key === "payments")'), entityPage.indexOf('if (String(module.key) === "paymentStatuses")')),
    /financeApi\.createPayment/,
  );

  assert.match(mobileEnroll, /UNALLOCATED_FEE_TYPE = "Non imputé"/);
  assert.match(mobileEnroll, /buildFinancePaymentWritePayload/);
  assert.match(mobileEnroll, /Number\.isFinite\(balance\) && balance > 0/);
  assert.match(mobileEnroll, /trim\(value\) === UNALLOCATED_TARGET/);
  assert.match(mobileEnroll, /FINANCE_OBLIGATION_ID_REQUIRED/);
  assert.doesNotMatch(mobileEnroll, /due - paid - exempt/);
  assert.doesNotMatch(mobileEnroll, /Math\.max\(0, due - paid/);
  assert.doesNotMatch(mobileEnroll, /!id \|\| id === UNALLOCATED_TARGET/);
  assert.doesNotMatch(mobileEnroll, /!obligationId => Non imputé/);
  assert.doesNotMatch(formValidation, /!id \|\| id === UNALLOCATED_TARGET/);
  assert.match(formValidation, /trimField\(obligationId\) === UNALLOCATED_TARGET/);

  assert.match(mobileControls, /buildFinancePaymentWritePayload/);
  assert.match(mobileControls, /isOfflineContext/);
  assert.match(mobileControls, /Aucune file Finance/);
  assert.match(mobileControls, /UNALLOCATED_TARGET/);
  assert.match(mobileControls, /Non imputé/);
  assert.doesNotMatch(mobileControls, /persistOutbox:\s*true/);
  assert.doesNotMatch(mobileControls, /submitProtectedMutation/);
  assert.doesNotMatch(mobileControls, /enqueueOutbox/);
  assert.doesNotMatch(mobileControls, /\["Espèces", "Mobile money", "Virement"\]/);
  assert.match(mobileControls, /Catalogue des moyens de paiement indisponible/);
  assert.match(mobileControls, /label="Élève"/);
  assert.match(mobileControls, /label="Classe"/);
  assert.match(mobileControls, /label="Montant"/);
  const eleveAt = mobileControls.indexOf('label="Élève"');
  const classeAt = mobileControls.indexOf('label="Classe"');
  const montantAt = mobileControls.indexOf('label="Montant"');
  assert.ok(eleveAt >= 0 && eleveAt < classeAt && classeAt < montantAt, "ordre Élève → Classe → Montant");

  assert.match(paymentsScreen, /getPaymentStudentOptions/);
  assert.match(paymentsScreen, /getFinanceCatalog/);
  assert.doesNotMatch(paymentsScreen, /getStudents\(/);
  assert.match(studentPayments, /getPaymentStudentOptions/);
  assert.match(studentPayments, /getFinanceCatalog/);
  assert.doesNotMatch(studentPayments, /loadStudents/);
  assert.doesNotMatch(studentPayments, /studentsData as PaymentStudent/);
  assert.doesNotMatch(studentPayments, /getStudents\(/);

  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS = \["messages", "presences", "notes"\]/);
  assert.doesNotMatch(outbox, /"payments"/);
  assert.doesNotMatch(outboxRuntime, /createSchoolPayment/);
  assert.doesNotMatch(outboxRuntime, /case "payments"/);
  assert.match(inventory, /name: "createSchoolPayment", method: "POST", path: "\/payments", class: "B", outbox: false/);

  assert.doesNotMatch(api, /amountDue - amountPaid - exemption/);
  assert.match(cash, /unallocatedAmount \?\? 0/);
  assert.doesNotMatch(cash, /collected - allocated/);
  assert.match(receipt, /Montant reçu/);
  assert.match(receipt, /Montant imputé/);
  assert.match(receipt, /Montant non imputé/);

  console.log("verify-finance-web-mobile-convergence: source guards OK");
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function runNpm(args, label, cwd = ROOT) {
  const result = spawnSync("npm", args, { cwd, encoding: "utf8", shell: false });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function main() {
  sourceGuards();
  runNode(
    ["--test", path.join(ROOT, "backend/lib/financeWebMobileConvergence.test.js")],
    "tests F5 mémoire ont échoué",
  );
  runNpm(
    ["run", "test", "--", "src/lib/financePaymentWrite.test.ts", "src/lib/quickPayment.multiItem.test.ts"],
    "contrat Web a échoué",
    path.join(ROOT, "web"),
  );
  runNpm(
    ["run", "test:payment-enrollment"],
    "contrat Mobile a échoué",
    path.join(ROOT, "Mobile"),
  );
  console.log("verify-finance-web-mobile-convergence: GO");
}

main();
