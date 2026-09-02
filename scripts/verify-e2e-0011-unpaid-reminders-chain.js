/**
 * E2E 0011 : Parcours impayés et relances (Finances > Impayés)
 *
 * Vérifie :
 * - Comptable consulte la liste des élèves en retard
 * - Filtres par classe, période, montant dû
 * - Détail des frais impayés
 * - Envoi et historisation des relances
 * - Relance persistée en PostgreSQL (notifications générales = LOT 6, hors périmètre)
 * - Après paiement, l'élève sort de la liste impayés
 * - Élève sans dette absent des impayés
 * - Montant dû = total frais − paiements validés
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0011
 */
const assert = require("assert");
const {
  request,
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  ADMIN_PASSWORD,
  resolveSchoolContext,
  createClassViaApi,
  enrollStudentViaApi,
  createFeeGridViaApi,
  activateFeeGridViaApi,
  applyFeeGridViaApi,
  createPaymentViaApi,
} = require("./e2e-api-helpers");
const { resolveSchoolYear } = require("./e2e-student-enrollment-rules");
const {
  saveContactOnly,
  createStudentFromContact,
  createParentUserFromContact,
} = require("./e2e-contact-flow");
const {
  listUnpaidStudentFees,
  aggregateUnpaidByStudent,
  filterRowsByMinAmount,
  verifyAmountDueConsistency,
} = require("./e2e-unpaid-rules");

const ACADEMIC_YEAR = resolveSchoolYear();

async function main() {
  const results = [];
  const stamp = Date.now();
  const classOverdue = `IMP-${String(stamp).slice(-4)}A`;
  const classClear = `IMP-${String(stamp).slice(-4)}B`;
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const parentPassword = `SF-PARENT-${stamp}`;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, adminToken } = await resolveSchoolContext(superToken);

  const comptableId = `CPT-IMP-${stamp}`;
  const comptableUser = {
    id: newId("USERS"),
    firstName: "Comptable",
    lastName: "Impayés E2E",
    role: "Comptable",
    identifier: comptableId,
    email: `${comptableId.toLowerCase()}@somafrik.app`,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    validationStatus: "Validé",
    password: ADMIN_PASSWORD,
    temporaryPassword: ADMIN_PASSWORD,
    permissions: [],
  };

  let state = await getState(adminToken);
  state = await putStatePatch(adminToken, { users: [comptableUser, ...(state.users ?? [])] });
  const comptableToken = await login(comptableId, ADMIN_PASSWORD, schoolCode);
  pushResult(results, "1. Comptable connecté", "200", comptableId, Boolean(comptableToken));

  const classOverdueCreated = await createClassViaApi(adminToken, {
    name: classOverdue,
    level: "4ème",
    academicYearName: ACADEMIC_YEAR,
  });
  const classClearCreated = await createClassViaApi(adminToken, {
    name: classClear,
    level: "5ème",
    academicYearName: ACADEMIC_YEAR,
  });
  const classOverdueCode = classOverdueCreated.api?.classCode || classOverdueCreated.classRecord.id;
  const classClearCode = classClearCreated.api?.classCode || classClearCreated.classRecord.id;

  const enrollOverdue = await enrollStudentViaApi(adminToken, classOverdueCode, {
    firstName: `Élève${stamp}`,
    lastName: "RetardA",
    gender: "Féminin",
    birthDate: "2011-08-12",
    parentPhone,
  });
  const enrollSettled = await enrollStudentViaApi(adminToken, classOverdueCode, {
    firstName: `Élève${stamp}`,
    lastName: "RetardB",
    gender: "Féminin",
    birthDate: "2011-08-12",
    parentPhone,
  });
  const enrollNoDebt = await enrollStudentViaApi(adminToken, classClearCode, {
    firstName: `Élève${stamp}`,
    lastName: "RetardC",
    gender: "Féminin",
    birthDate: "2011-08-12",
  });
  const studentOverdue = { id: enrollOverdue.studentCode, studentCode: enrollOverdue.studentCode, className: classOverdue, schoolCode };
  const studentSettled = { id: enrollSettled.studentCode, studentCode: enrollSettled.studentCode, className: classOverdue, schoolCode };
  const studentNoDebt = { id: enrollNoDebt.studentCode, studentCode: enrollNoDebt.studentCode, className: classClear, schoolCode };

  const overdueGrid = await createFeeGridViaApi(adminToken, {
    className: classOverdue,
    academicYear: ACADEMIC_YEAR,
    periodName: "Année complète",
    currency: "CDF",
    items: [
      { feeType: "Inscription", label: "Frais d'inscription", amount: 80_000, dueDate: "2026-01-01", status: "Actif" },
      { feeType: "Transport", label: "Transport", amount: 40_000, periodLabel: "Janvier", dueDate: "2026-01-01", status: "Actif" },
    ],
  });
  await activateFeeGridViaApi(adminToken, overdueGrid.id);
  await applyFeeGridViaApi(adminToken, overdueGrid.id);

  await createPaymentViaApi(adminToken, {
    studentId: studentSettled.id,
    feeType: "Inscription",
    amount: 80_000,
    method: "Espèces",
    date: "2026-08-13",
  });
  await createPaymentViaApi(adminToken, {
    studentId: studentSettled.id,
    feeType: "Transport",
    amount: 40_000,
    method: "Espèces",
    date: "2026-08-13",
  });

  const parentContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Parent",
      firstName: `Impayé${stamp}`,
      contactType: "Parent",
      phone: parentPhone,
      email: `parent-imp-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentContactFlow.ok, parentContactFlow.error);
  const parentUser = createParentUserFromContact(
    parentContactFlow.contact,
    schoolCode,
    parentPhone,
    parentPassword,
  );

  state = await putStatePatch(adminToken, {
    contacts: [parentContactFlow.contact, ...(state.contacts ?? [])],
    users: [parentUser, ...(state.users ?? [])],
  });

  // 2) Liste impayés
  const unpaidRes = await request("/backoffice/finance/unpaid", { token: comptableToken });
  const allRows = unpaidRes.data?.rows ?? [];
  pushResult(
    results,
    "2. Liste des élèves en retard",
    ">=1",
    String(allRows.length),
    unpaidRes.status === 200 && allRows.length >= 1,
  );

  const targetRow = allRows.find((row) => row.studentId === studentOverdue.id);
  assert.ok(targetRow, "Élève en retard introuvable dans la liste");

  // Élève sans dette exclu
  const noDebtVisible = allRows.some((row) => row.studentId === studentNoDebt.id);
  const settledVisible = allRows.some((row) => row.studentId === studentSettled.id);
  pushResult(
    results,
    "3. Élève sans dette absent des impayés",
    "absent",
    noDebtVisible ? "présent" : "absent",
    !noDebtVisible,
  );
  pushResult(
    results,
    "3b. Élève soldé absent des impayés",
    "absent",
    settledVisible ? "présent" : "absent",
    !settledVisible,
  );

  // 4) Filtre par classe
  const classFilterRes = await request(
    `/backoffice/finance/unpaid?className=${encodeURIComponent(classOverdue)}`,
    { token: comptableToken },
  );
  const classRows = classFilterRes.data?.rows ?? [];
  const classFilterOk =
    classFilterRes.status === 200 &&
    classRows.every((row) => normalize(row.className) === normalize(classOverdue)) &&
    classRows.some((row) => row.studentId === studentOverdue.id);
  pushResult(results, "4. Filtre par classe", classOverdue, String(classRows.length), classFilterOk);

  // 5) Filtre par période
  const periodFilterRes = await request(
    `/backoffice/finance/unpaid?period=${encodeURIComponent("Janvier")}`,
    { token: comptableToken },
  );
  const periodRows = periodFilterRes.data?.rows ?? [];
  const periodFilterOk =
    periodFilterRes.status === 200 && periodRows.some((row) => row.studentId === studentOverdue.id);
  pushResult(results, "5. Filtre par période", "Janvier", String(periodRows.length), periodFilterOk);

  // 6) Filtre par montant dû (logique client)
  const minAmount = 100_000;
  const amountFiltered = filterRowsByMinAmount(allRows, minAmount);
  const amountFilterOk =
    amountFiltered.length >= 1 &&
    amountFiltered.every((row) => row.amountDue >= minAmount) &&
    amountFiltered.some((row) => row.studentId === studentOverdue.id);
  pushResult(
    results,
    "6. Filtre par montant dû (≥ 100 000)",
    ">=1",
    String(amountFiltered.length),
    amountFilterOk,
  );

  // 7) Détail élève
  const detailRes = await request(
    `/backoffice/finance/unpaid/${encodeURIComponent(studentOverdue.id)}`,
    { token: comptableToken },
  );
  const detailFees = detailRes.data?.fees ?? [];
  const detailRow = detailRes.data?.row;
  pushResult(
    results,
    "7. Détail des frais impayés",
    "2",
    String(detailFees.length),
    detailRes.status === 200 && detailFees.length === 2,
  );

  // 8) Cohérence montant dû
  const consistency = verifyAmountDueConsistency(detailRow ?? targetRow);
  pushResult(
    results,
    "8. Montant dû = frais − paiements validés",
    String(consistency.expected),
    String(consistency.actual),
    consistency.ok,
  );
  assert.ok(consistency.ok, "Montant dû incohérent");
  assert.strictEqual(consistency.actual, 120_000, "Total impayé attendu 120 000");

  // 9) Envoi relance
  const reminderRes = await request(
    `/backoffice/finance/unpaid/${encodeURIComponent(studentOverdue.id)}/reminders`,
    {
      method: "POST",
      token: comptableToken,
      body: { channel: "notification", recipient: "Parent" },
    },
  );
  const reminder = reminderRes.data?.reminder;
  pushResult(
    results,
    "9. Relance envoyée au parent",
    "201",
    String(reminderRes.status),
    reminderRes.status === 201 && Boolean(reminder?.id),
  );
  assert.ok(reminder?.id, "Relance non enregistrée");

  // 10) Historique relances
  const historyRes = await request(
    `/backoffice/finance/unpaid/${encodeURIComponent(studentOverdue.id)}/reminders`,
    { token: comptableToken },
  );
  const history = Array.isArray(historyRes.data) ? historyRes.data : [];
  pushResult(
    results,
    "10. Relance historisée",
    reminder.id,
    history[0]?.id ?? "—",
    historyRes.status === 200 && history.some((row) => row.id === reminder.id),
  );

  // 11) Accès parent — le domaine Notifications reste LOT 6.
  const parentToken = await login(parentPhone, parentPassword, schoolCode);
  assert.ok(parentToken, "parent peut se connecter");
  pushResult(
    results,
    "11. Parent authentifié après relance (notifications LOT 6 hors périmètre)",
    "session",
    parentToken ? "session" : "—",
    Boolean(parentToken),
  );

  // 12) Paiement + mise à jour dettes via API dédiée (jamais PUT state Finance)
  const inscriptionPay = await createPaymentViaApi(comptableToken, {
    studentId: studentOverdue.id,
    feeType: "Inscription",
    amount: 80_000,
    method: "Espèces",
    date: "2026-07-09",
  });
  const annexePay = await createPaymentViaApi(comptableToken, {
    studentId: studentOverdue.id,
    feeType: "Transport",
    amount: 40_000,
    method: "Espèces",
    date: "2026-07-09",
  });
  assert.ok(inscriptionPay?.id && annexePay?.id, "paiements persistés via API");
  state = await getState(comptableToken);

  pushResult(
    results,
    "12. Paiement enregistré",
    inscriptionPay.reference,
    inscriptionPay.reference,
    Boolean(inscriptionPay.reference && annexePay.reference),
  );

  // 13) Élève sort de la liste impayés
  const afterRes = await request("/backoffice/finance/unpaid", { token: comptableToken });
  const afterRows = afterRes.data?.rows ?? [];
  const stillUnpaid = afterRows.some((row) => row.studentId === studentOverdue.id);
  pushResult(
    results,
    "13. Élève sort de la liste après paiement",
    "absent",
    stillUnpaid ? "présent" : "absent",
    afterRes.status === 200 && !stillUnpaid,
  );

  // Vérification locale cohérente
  const localFees = listUnpaidStudentFees(state);
  const localRows = aggregateUnpaidByStudent(localFees, state.paymentReminders ?? []);
  pushResult(
    results,
    "14. Cohérence locale post-paiement",
    "0 ligne impayée cible",
    String(localRows.filter((row) => row.studentId === studentOverdue.id).length),
    !localRows.some((row) => row.studentId === studentOverdue.id),
  );

  console.log("\n=== E2E 0011 : Parcours impayés & relances ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe cible   : ${classOverdue}`);
  console.log(`Élève en retard: ${studentOverdue.firstName} ${studentOverdue.name} (${studentOverdue.id})`);
  console.log(`Parent         : ${parentPhone}`);
  console.log(`Montant dû     : ${consistency.actual} CDF\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0011 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
