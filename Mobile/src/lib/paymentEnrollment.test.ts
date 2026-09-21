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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  UNALLOCATED_TARGET,
  applyScopedPaymentFeeDraft,
  buildFinancePaymentItems,
  buildFinancePaymentWritePayload,
  buildSchoolPaymentPayload,
  collectActivePaymentClasses,
  collectOpenPaymentFees,
  isFreshPaymentFeeResponse,
  isUnallocatedTarget,
  paymentClassBelongsToStudent,
  paymentFeeIdentityFromStudent,
  paymentSubmitErrorMessage,
  paymentStudentsFromOptions,
  preselectPaymentClassId,
  preselectPaymentObligationId,
  type PaymentFeeRow,
  type PaymentStudent,
} from "./paymentEnrollment";
import { hasFieldErrors, validatePaymentDraft } from "./formFieldValidation";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function readSrc(relative: string) {
  return fs.readFileSync(path.join(srcRoot, relative), "utf8");
}

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

const ESTHER_UUID = "f81035b2-545d-4a73-ab5d-775b120787f3";
const ESTHER_CODE = "CG-ITC-OE-26-00001";
const ESTHER_OCTOBRE_ID = "obl-esther-octobre";
const STUDENT_A_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STUDENT_A_CODE = "CD-IN-26-STU-A";
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

const estherOctobre: PaymentFeeRow = {
  id: ESTHER_OCTOBRE_ID,
  studentId: ESTHER_CODE,
  studentDbId: ESTHER_UUID,
  label: "Octobre",
  feeType: "Scolarité",
  status: "Partiellement payé",
  amountDue: 80_000,
  amountPaid: 50_000,
  balance: 30_000,
};
const estherFees = [
  estherOctobre,
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
const estherIdentity = paymentFeeIdentityFromStudent(estherFromRoster.id, estherFromRoster);
const estherOpen = collectOpenPaymentFees(estherIdentity, estherFees);
assert.equal(estherOpen.length, 1, "P1 Esther : Octobre partiel est la seule obligation ouverte");
assert.equal(estherOpen[0].obligationId, ESTHER_OCTOBRE_ID);
assert.equal(estherOpen[0].amountDue, 80_000);
assert.equal(estherOpen[0].amountPaid, 50_000);
assert.equal(estherOpen[0].balance, 30_000);
assert.equal(preselectPaymentObligationId(estherIdentity, estherFees), ESTHER_OCTOBRE_ID);
assert.notEqual(preselectPaymentObligationId(estherIdentity, estherFees), UNALLOCATED_TARGET);
assert.equal(collectOpenPaymentFees(estherFromRoster.id, estherFees).length, 1);
assert.equal(collectOpenPaymentFees(ESTHER_UUID, []).length, 0, "élève sans obligation → Non imputé légitime");
assert.equal(preselectPaymentObligationId(estherIdentity, []), UNALLOCATED_TARGET);

const emptySnapshotDraft = applyScopedPaymentFeeDraft({
  session: 1,
  selection: 1,
  responseSession: 1,
  responseSelection: 1,
  identity: estherIdentity,
  scopedFees: [],
});
assert.equal(emptySnapshotDraft?.obligationId, UNALLOCATED_TARGET, "snapshot vide → Non imputé temporaire");
const scopedEstherDraft = applyScopedPaymentFeeDraft({
  session: 1,
  selection: 1,
  responseSession: 1,
  responseSelection: 1,
  identity: estherIdentity,
  scopedFees: estherFees,
});
assert.equal(scopedEstherDraft?.obligationId, ESTHER_OCTOBRE_ID, "scoped UUID recalcule lines hors __unallocated__");
assert.notEqual(scopedEstherDraft?.obligationId, UNALLOCATED_TARGET);

const noneStudent = paymentFeeIdentityFromStudent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
  studentCode: "CG-ITC-NONE-26-00099",
});
const noneDraft = applyScopedPaymentFeeDraft({
  session: 2,
  selection: 1,
  responseSession: 2,
  responseSelection: 1,
  identity: noneStudent,
  scopedFees: [],
});
assert.equal(noneDraft?.obligationId, UNALLOCATED_TARGET, "véritable élève sans obligation → Non imputé");
assert.equal(collectOpenPaymentFees(noneStudent, []).length, 0);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const studentAFees: PaymentFeeRow[] = [
  {
    id: "obl-a-sco",
    studentId: STUDENT_A_CODE,
    studentDbId: STUDENT_A_UUID,
    label: "Scolarité T1",
    feeType: "Scolarité",
    balance: 140_000,
    amountDue: 140_000,
    amountPaid: 0,
    status: "À payer",
  },
];
const studentAIdentity = paymentFeeIdentityFromStudent(STUDENT_A_UUID, { studentCode: STUDENT_A_CODE });

void (async () => {
  const delayedA = deferred<PaymentFeeRow[]>();
  let session = 1;
  let selection = 0;
  let obligationId = UNALLOCATED_TARGET;
  let openLabel = "";

  const fetchFees = (studentId: string) => {
    if (studentId === STUDENT_A_UUID) return delayedA.promise;
    if (studentId === ESTHER_UUID) return Promise.resolve(estherFees);
    return Promise.resolve([]);
  };

  const apply = async (studentId: string, identity: ReturnType<typeof paymentFeeIdentityFromStudent>) => {
    const responseSelection = ++selection;
    const responseSession = session;
    obligationId = preselectPaymentObligationId(identity, []);
    openLabel = "";
    const scoped = await fetchFees(studentId);
    const accepted = applyScopedPaymentFeeDraft({
      session,
      selection,
      responseSession,
      responseSelection,
      identity,
      scopedFees: scoped,
    });
    if (!accepted) return;
    obligationId = accepted.obligationId;
    openLabel = collectOpenPaymentFees(identity, accepted.fees)[0]?.label ?? "";
  };

  const applyA = apply(STUDENT_A_UUID, studentAIdentity);
  const applyEsther = apply(ESTHER_UUID, estherIdentity);
  await applyEsther;
  assert.equal(obligationId, ESTHER_OCTOBRE_ID, "A→Esther : scoped Esther appliqué avant la réponse A");
  assert.equal(openLabel, "Octobre");
  assert.notEqual(obligationId, UNALLOCATED_TARGET, "pas de __unallocated__ résiduel après scoped Esther");
  delayedA.resolve(studentAFees);
  await applyA;
  assert.equal(obligationId, ESTHER_OCTOBRE_ID, "réponse A tardive ignorée");
  assert.equal(openLabel, "Octobre");
  assert.equal(isFreshPaymentFeeResponse({ session: 1, selection: 2, responseSession: 1, responseSelection: 1 }), false);

  const delayedEsther = deferred<PaymentFeeRow[]>();
  session += 1;
  selection = 0;
  obligationId = UNALLOCATED_TARGET;
  openLabel = "";
  const fetchFeesReopen = (studentId: string) => {
    if (studentId === ESTHER_UUID) return delayedEsther.promise;
    if (studentId === STUDENT_A_UUID) return Promise.resolve(studentAFees);
    return Promise.resolve([]);
  };
  const applyReopen = async (studentId: string, identity: ReturnType<typeof paymentFeeIdentityFromStudent>) => {
    const responseSelection = ++selection;
    const responseSession = session;
    obligationId = preselectPaymentObligationId(identity, []);
    const scoped = await fetchFeesReopen(studentId);
    const accepted = applyScopedPaymentFeeDraft({
      session,
      selection,
      responseSession,
      responseSelection,
      identity,
      scopedFees: scoped,
    });
    if (!accepted) return;
    obligationId = accepted.obligationId;
    openLabel = collectOpenPaymentFees(identity, accepted.fees)[0]?.label ?? "";
  };
  const staleEsther = applyReopen(ESTHER_UUID, estherIdentity);
  session += 1;
  selection = 0;
  const applyAAfterReopen = applyReopen(STUDENT_A_UUID, studentAIdentity);
  await applyAAfterReopen;
  assert.equal(obligationId, "obl-a-sco", "nouvelle session : A préselectionné");
  delayedEsther.resolve(estherFees);
  await staleEsther;
  assert.equal(obligationId, "obl-a-sco", "scoped Esther de la session précédente ignoré");
  assert.notEqual(openLabel, "Octobre");

  const apiSrc = readSrc("services/api.ts");
  const getStudentFeesFn = apiSrc.slice(
    apiSrc.indexOf("export function getStudentFees"),
    apiSrc.indexOf("export function reconcilePaymentAllocations"),
  );
  assert.match(
    getStudentFeesFn,
    /export function getStudentFees\(studentId\?: string\)/,
    "Mobile doit exposer getStudentFees(UUID)",
  );
  assert.match(
    getStudentFeesFn,
    /\?studentId=\$\{encodeURIComponent/,
    "GET student-fees scoped doit passer ?studentId=",
  );

  const controlsSrc = readSrc("components/PaymentMutationControls.tsx");
  assert.match(controlsSrc, /getStudentFees\(/, "applyStudent doit charger le scoped UUID");
  assert.match(controlsSrc, /getStudentFees\(nextStudentId\)/, "le scoped utilise l'UUID roster sélectionné");
  assert.match(controlsSrc, /selectionGenRef/, "invalidation des réponses périmées : sélection");
  assert.match(controlsSrc, /sessionGenRef/, "invalidation des réponses périmées : session modal");
  assert.match(controlsSrc, /applyScopedPaymentFeeDraft/, "arrivée du scoped recalcule feeOptions et lines");
  assert.match(controlsSrc, /setScopedFees/, "le scoped ne doit pas être écrasé par le snapshot global");

  console.log("OK paymentEnrollment: élève → classes actives, reset, payload classId, erreurs API visibles");
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
