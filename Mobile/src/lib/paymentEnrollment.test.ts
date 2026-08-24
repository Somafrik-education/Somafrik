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
  buildSchoolPaymentPayload,
  collectActivePaymentClasses,
  paymentClassBelongsToStudent,
  paymentSubmitErrorMessage,
  preselectPaymentClassId,
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

const payload = buildSchoolPaymentPayload({
  studentId: awa.id,
  classId: String(awa.classId),
  amount: 25000,
  feeType: "Scolarité",
  method: "Espèces",
  date: "2026-08-22",
});
assert.deepEqual(payload, {
  studentId: awa.id,
  classId: awa.classId,
  method: "Espèces",
  date: "2026-08-22",
  items: [{ feeType: "Scolarité", amount: 25000 }],
});
assert.ok(!("className" in payload), "className n'est pas une identité métier");

assert.equal(hasFieldErrors(validatePaymentDraft({ studentId: "", amount: "abc" })), true);
assert.match(validatePaymentDraft({ studentId: awa.id, amount: "0", classId: awa.classId, classOptions: [{ classId: String(awa.classId) }] }).amount, /montant positif/);

assert.equal(paymentSubmitErrorMessage("in_flight"), "Paiement conservé en file. Pas de succès local.");
assert.match(
  paymentSubmitErrorMessage("blocked_sending", new Error("Cet envoi est déjà en cours de synchronisation.")),
  /déjà en cours de synchronisation/,
);
assert.equal(
  paymentSubmitErrorMessage("failed", Object.assign(new Error("Cet élève n'a aucune inscription active."), { status: 400 })),
  "Cet élève n'a aucune inscription active.",
);
assert.equal(paymentSubmitErrorMessage("failed"), "Enregistrement refusé.");

console.log("OK paymentEnrollment: élève → classes actives, reset, payload classId, erreurs API visibles");
