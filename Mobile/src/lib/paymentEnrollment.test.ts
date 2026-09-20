/**
 * P0 paiements — élève → classe → payload.
 *
 * Reproduction avant correction (contrat historique, encore observé sur develop) :
 * - PaymentMutationControls n'affichait pas de Classe.
 * - payload = { studentId, method, date, items } sans classId
 *   → POST /api/payments
 * - 4xx masqué en « Enregistrement refusé. »
 *
 * Payload anonymisé reproduit :
 *   { studentId: "CD-2026-0001-STU-0001", method: "Espèces", date: "2026-08-22",
 *     items: [{ feeType: "Scolarité", amount: 25000 }] }
 * HTTP attendu après garde-fou inscription : 400 ENROLLMENT_REQUIRED
 * si l'élève n'a pas de classe active, ou 201 si une inscription unique est dérivable.
 */
import assert from "node:assert/strict";
import {
  UNALLOCATED_TARGET,
  buildFinancePaymentItems,
  buildFinancePaymentWritePayload,
  buildSchoolPaymentPayload,
  collectActivePaymentClasses,
  collectOpenPaymentFees,
  isUnallocatedTarget,
  paymentClassBelongsToStudent,
  paymentSubmitErrorMessage,
  paymentStudentsFromOptions,
  preselectPaymentClassId,
  preselectPaymentObligationId,
  type PaymentStudent,
} from "./paymentEnrollment";
import { hasFieldErrors, validatePaymentDraft } from "./formFieldValidation";

const awa: PaymentStudent = {
  id: "CD-2026-0001-STU-0001",
  name: "Awa Diop",
  classId: "11111111-1111-4111-8111-111111111111",
  classCode: "CLS-6A",
  className: "6ème A",
  schoolCode: "CD-2026-0001",
};
const awaSecondYear: PaymentStudent = {
  ...awa,
  classId: "22222222-2222-4222-8222-222222222222",
  classCode: "CLS-5B",
  className: "5ème B",
};
const orphan: PaymentStudent = {
  id: "CD-2026-0001-STU-ORPHAN",
  name: "Sans Classe",
  classId: null,
  classCode: "",
  className: "",
  schoolCode: "CD-2026-0001",
};
const jean: PaymentStudent = {
  id: "CD-2026-0001-STU-0002",
  name: "Jean Mbala",
  classId: "33333333-3333-4333-8333-333333333333",
  classCode: "CLS-4C",
  className: "4ème C",
  schoolCode: "CD-2026-0001",
};

assert.deepEqual(collectActivePaymentClasses(awa.id, [awa]), [
  { classId: awa.classId, classCode: "CLS-6A", className: "6ème A" },
]);
assert.equal(preselectPaymentClassId(awa.id, [awa]), awa.classId);

assert.deepEqual(collectActivePaymentClasses(orphan.id, [orphan]), []);
assert.equal(preselectPaymentClassId(orphan.id, [orphan]), "");
assert.equal(
  validatePaymentDraft({ studentId: orphan.id, amount: "25000", classId: "", classOptions: [] }).classId,
  "Cet élève n'a aucune inscription active.",
);

const multi = collectActivePaymentClasses(awa.id, [awa, awaSecondYear, jean]);
assert.equal(multi.length, 2);
assert.deepEqual(
  multi.map((row) => row.classId).sort(),
  [awa.classId, awaSecondYear.classId].sort(),
);
assert.equal(preselectPaymentClassId(awa.id, [awa, awaSecondYear]), "");
assert.equal(paymentClassBelongsToStudent(awa.id, String(jean.classId), [awa, jean]), false);
assert.equal(paymentClassBelongsToStudent(awa.id, String(awaSecondYear.classId), [awa, awaSecondYear]), true);

const switched = preselectPaymentClassId(jean.id, [awa, jean]);
assert.equal(switched, jean.classId);
assert.equal(paymentClassBelongsToStudent(jean.id, String(awa.classId), [awa, jean]), false);

const historic: PaymentStudent = {
  id: "CD-2026-0001-STU-HIST",
  name: "Ancien",
  className: "6ème A",
  enrollments: [
    { status: "inactive", classId: "old-class", classCode: "CLS-OLD", className: "6ème A" },
    { status: "active", classId: "live-class", classCode: "CLS-NEW", className: "5ème B" },
  ],
};
assert.deepEqual(collectActivePaymentClasses(historic.id, [historic]), [
  { classId: "live-class", classCode: "CLS-NEW", className: "5ème B" },
]);

assert.equal(isUnallocatedTarget(UNALLOCATED_TARGET), true);
assert.equal(isUnallocatedTarget(undefined), false);
assert.equal(isUnallocatedTarget(""), false);
assert.equal(isUnallocatedTarget("   "), false);
assert.equal(isUnallocatedTarget("obl-1"), false);

assert.throws(
  () =>
    buildSchoolPaymentPayload({
      studentId: awa.id,
      classId: String(awa.classId),
      amount: 25000,
      feeType: "Scolarité",
      method: "Espèces",
      date: "2026-08-22",
    }),
  (error: unknown) =>
    error instanceof Error &&
    error.message.includes("FINANCE_OBLIGATION_ID_REQUIRED") &&
    (error as Error & { code?: string }).code === "FINANCE_OBLIGATION_ID_REQUIRED",
);
assert.throws(
  () =>
    buildFinancePaymentWritePayload({
      studentId: awa.id,
      classId: String(awa.classId),
      method: "Espèces",
      date: "2026-08-22",
      lines: [{ feeType: "Scolarité", amount: 10_000 }],
    }),
  (error: unknown) => error instanceof Error && error.message.includes("FINANCE_OBLIGATION_ID_REQUIRED"),
);
assert.throws(
  () => buildFinancePaymentItems([{ obligationId: "", feeType: "Scolarité", amount: 10_000 }]),
  (error: unknown) => error instanceof Error && error.message.includes("FINANCE_OBLIGATION_ID_REQUIRED"),
);
assert.throws(
  () => buildFinancePaymentItems([{ obligationId: "   ", feeType: "Scolarité", amount: 10_000 }]),
  (error: unknown) => error instanceof Error && error.message.includes("FINANCE_OBLIGATION_ID_REQUIRED"),
);
assert.deepEqual(buildFinancePaymentItems([{ obligationId: UNALLOCATED_TARGET, amount: 10_000 }]), [
  { feeType: "Non imputé", amount: 10_000 },
]);
assert.deepEqual(buildFinancePaymentItems([{ obligationId: "obl-1", amount: 40, feeType: "Scolarité" }]), [
  { obligationId: "obl-1", amount: 40, feeType: "Scolarité", feeLabel: "Scolarité" },
]);

const identified = buildSchoolPaymentPayload({
  studentId: awa.id,
  classId: String(awa.classId),
  amount: 150,
  feeType: "Mensualité",
  method: "Espèces",
  date: "2026-08-24",
  obligationId: "obl-maeva-mens",
  schoolFeeItemId: "fee-item-1",
});
assert.deepEqual(identified.items, [
  { obligationId: "obl-maeva-mens", amount: 150, feeType: "Mensualité", feeLabel: "Mensualité" },
]);
assert.equal(identified.method, "Espèces");
assert.equal(identified.paymentMethod, "Espèces");
assert.equal(identified.date, "2026-08-24");
assert.equal(identified.paidAt, "2026-08-24");
assert.ok(!("className" in identified), "className n'est pas une identité métier");

const unallocatedPayload = buildSchoolPaymentPayload({
  studentId: awa.id,
  classId: String(awa.classId),
  amount: 1000,
  feeType: "",
  method: "Espèces",
  date: "2026-08-24",
  obligationId: UNALLOCATED_TARGET,
});
const unallocatedItem = (unallocatedPayload.items as Array<{ feeType: string; obligationId?: string }>)[0];
assert.equal(unallocatedItem.feeType, "Non imputé");
assert.equal(unallocatedItem.obligationId, undefined);
assert.notEqual(unallocatedItem.feeType, "Acompte");

const openFees = collectOpenPaymentFees(awa.id, [
  { id: "obl-1", studentId: awa.id, feeType: "Mensualité", label: "Mensualité", balance: 1000, status: "À payer" },
  { id: "obl-paid", studentId: awa.id, feeType: "Inscription", label: "Inscription", balance: 0, status: "Payé" },
  {
    id: "obl-invented",
    studentId: awa.id,
    feeType: "Transport",
    label: "Transport",
    amountDue: 3000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
  },
]);
assert.equal(openFees.length, 1, "sans balance serveur, la dette n'est pas ouverte");
assert.equal(openFees[0].obligationId, "obl-1");
assert.equal(preselectPaymentObligationId(awa.id, [
  { id: "obl-1", studentId: awa.id, balance: 1000, status: "À payer" },
]), "obl-1");
assert.equal(
  validatePaymentDraft({
    studentId: awa.id,
    amount: "150",
    classId: awa.classId,
    classOptions: [{ classId: String(awa.classId) }],
    obligationOptions: [{ obligationId: "obl-1" }],
  }).obligationId,
  "FINANCE_OBLIGATION_ID_REQUIRED",
);
assert.equal(
  validatePaymentDraft({
    studentId: awa.id,
    amount: "150",
    classId: awa.classId,
    classOptions: [{ classId: String(awa.classId) }],
    obligationId: UNALLOCATED_TARGET,
    obligationOptions: [{ obligationId: "obl-1" }],
  }).obligationId,
  undefined,
);
assert.equal(
  validatePaymentDraft({
    studentId: awa.id,
    amount: "150",
    classId: awa.classId,
    classOptions: [{ classId: String(awa.classId) }],
    obligationId: "foreign",
    obligationOptions: [{ obligationId: "obl-1" }],
  }).obligationId,
  "Frais invalide pour cet élève.",
);

assert.equal(hasFieldErrors(validatePaymentDraft({ studentId: "", amount: "abc" })), true);
assert.match(validatePaymentDraft({ studentId: awa.id, amount: "0", classId: awa.classId, classOptions: [{ classId: String(awa.classId) }] }).amount, /montant positif/);

assert.equal(paymentSubmitErrorMessage("in_flight"), "Paiement hors connexion refusé. Aucune file Finance.");
assert.match(
  paymentSubmitErrorMessage("blocked_sending", new Error("Cet envoi est déjà en cours de synchronisation.")),
  /déjà en cours de synchronisation/,
);
assert.equal(
  paymentSubmitErrorMessage("failed", Object.assign(new Error("Cet élève n'a aucune inscription active."), { status: 400 })),
  "Cet élève n'a aucune inscription active.",
);
assert.equal(paymentSubmitErrorMessage("failed"), "Enregistrement refusé.");
assert.equal(
  paymentSubmitErrorMessage("failed", new Error("OUTBOX_PERSIST_FAILED")),
  "Paiement hors connexion refusé. Aucune file Finance.",
);

const fromOptions = paymentStudentsFromOptions([
  {
    studentId: awa.id,
    firstName: "Awa",
    lastName: "Diop",
    classId: awa.classId,
    classCode: "CLS-6A",
    className: "6ème A",
    classes: [
      { classId: String(awa.classId), classCode: "CLS-6A", className: "6ème A" },
    ],
  },
  { firstName: "Ignoré", lastName: "SansId" },
]);
assert.equal(fromOptions.length, 1);
assert.equal(fromOptions[0].id, awa.id);
assert.equal(fromOptions[0].name, "Awa Diop");
assert.deepEqual(fromOptions[0].enrollments, [
  { status: "active", classId: String(awa.classId), classCode: "CLS-6A", className: "6ème A" },
]);
assert.deepEqual(collectActivePaymentClasses(awa.id, fromOptions), [
  { classId: String(awa.classId), classCode: "CLS-6A", className: "6ème A" },
]);
assert.deepEqual(paymentStudentsFromOptions([]), []);

const ESTHER_UUID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const ESTHER_CODE = "CG-ITC-OE-26-00001";
const estherFromRoster = paymentStudentsFromOptions([
  {
    studentId: ESTHER_UUID,
    studentCode: ESTHER_CODE,
    firstName: "Esther",
    lastName: "OKITO",
    classId: "class-1pa",
    classCode: "1PA",
    className: "1ère Primaire A",
    classes: [{ classId: "class-1pa", classCode: "1PA", className: "1ère Primaire A" }],
  },
])[0];
assert.equal(estherFromRoster.id, ESTHER_UUID);
assert.equal(estherFromRoster.studentCode, ESTHER_CODE);

const estherFees = [
  {
    id: "obl-esther-sco",
    studentId: ESTHER_CODE,
    studentDbId: ESTHER_UUID,
    label: "Scolarité T1",
    feeType: "Scolarité",
    balance: 140_000,
    amountDue: 140_000,
    amountPaid: 0,
    status: "À payer",
  },
  {
    id: "obl-esther-partial",
    studentId: ESTHER_CODE,
    studentDbId: ESTHER_UUID,
    label: "Inscription",
    balance: 30_000,
    amountDue: 50_000,
    amountPaid: 20_000,
    status: "Partiellement payé",
  },
  {
    id: "obl-esther-paid",
    studentId: ESTHER_CODE,
    studentDbId: ESTHER_UUID,
    label: "Uniforme",
    balance: 0,
    amountDue: 15_000,
    amountPaid: 15_000,
    status: "Payé",
  },
  {
    id: "obl-foreign",
    studentId: "CD-XX-OTH-26-99999",
    studentDbId: "cccccccc-3333-4333-8333-cccccccccccc",
    label: "Scolarité tenant B",
    balance: 99_000,
    status: "À payer",
  },
];
const estherOpen = collectOpenPaymentFees(
  {
    id: estherFromRoster.id,
    studentId: estherFromRoster.id,
    studentDbId: estherFromRoster.id,
    studentCode: estherFromRoster.studentCode,
  },
  estherFees,
);
assert.equal(estherOpen.length, 2, "P1 Esther : UUID roster doit retrouver les dettes (matricule + studentDbId)");
assert.deepEqual(estherOpen.map((row) => row.obligationId).sort(), ["obl-esther-partial", "obl-esther-sco"]);
assert.equal(estherOpen.find((row) => row.obligationId === "obl-esther-sco")?.balance, 140_000);
assert.equal(estherOpen.find((row) => row.obligationId === "obl-esther-partial")?.balance, 30_000);
assert.equal(collectOpenPaymentFees(estherFromRoster.id, estherFees).length, 2);
assert.equal(collectOpenPaymentFees(ESTHER_UUID, []).length, 0, "élève sans obligation → Non imputé légitime");

console.log("OK paymentEnrollment: élève → classes actives, reset, payload classId, erreurs API visibles");
