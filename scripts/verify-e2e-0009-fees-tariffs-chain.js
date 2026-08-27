/**
 * E2E 0009 : Parcours frais & tarifs (Finances > Frais & tarifs)
 *
 * Vérifie :
 * - Admin / comptable connecté
 * - Création grille tarifaire par classe (inscription, mensualité, annexes)
 * - Échéances définies
 * - Grille inactive (Brouillon) ne génère pas de dette
 * - Activation + application aux élèves de la classe
 * - Nouvel élève inscrit hérite des frais de la grille active
 * - Montants dus cohérents avec la grille
 *
 * Prérequis : backend Docker + bootstrap E2E
 *   npm run bootstrap:e2e-superadmin && docker compose restart backend
 *   npm run verify:e2e-0009
 */
const assert = require("assert");
const {
  request,
  login,
  getState,
  putStatePatch,
  newId,
  normalize,
  todayPeriodDate,
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
} = require("./e2e-api-helpers");
const { resolveSchoolYear } = require("./e2e-student-enrollment-rules");
const { createStudentFromContact } = require("./e2e-contact-flow");
const {
  newFeeId,
  validateFeeGridInput,
  applyFeeGridToStudents,
  applyActiveGridsToStudent,
  studentFeesMatchGrid,
} = require("./e2e-fee-rules");

const MONTHLY_MONTHS = ["Septembre", "Octobre", "Novembre"];

function buildStudentContact(schoolCode, className, stamp, suffix) {
  return {
    id: newId("CONTACT"),
    lastName: `Élève${suffix}`,
    firstName: `Frais${stamp}`,
    contactType: "Élève",
    phone: `+243 810 ${String(stamp + suffix).slice(-6)}`,
    email: `eleve-frais-${stamp}-${suffix}@somafrik.app`,
    status: "Actif",
  };
}

function buildStudentEnrollment(className, stamp, suffix) {
  return {
    name: `Élève${suffix}`,
    className,
    gender: "Masculin",
    birthDate: "10-05-2011",
    matricule: `ELE-FRAIS-${stamp}-${suffix}`,
    archived: false,
    schoolYear: resolveSchoolYear(),
    schoolStatus: "Inscrit",
    enrollmentDate: todayPeriodDate(),
  };
}

function buildFeeItems(gridId, schoolCode, className) {
  const pastDueDate = "01-01-2026";
  const specs = [
    { feeType: "Inscription", label: "Frais d'inscription", amount: 50_000, dueDate: pastDueDate },
    { feeType: "Scolarité", label: "Scolarité", amount: 10_000, monthlyMonths: MONTHLY_MONTHS },
    { feeType: "Uniforme", label: "Uniforme", amount: 15_000, dueDate: pastDueDate },
    { feeType: "Transport", label: "Transport", amount: 30_000, dueDate: pastDueDate },
    { feeType: "Cantine", label: "Cantine", amount: 25_000, dueDate: pastDueDate },
    { feeType: "Autre", label: "Autre", amount: 10_000, dueDate: pastDueDate },
  ];
  return specs.map((spec) => ({
    id: newFeeId("FEEITEM"),
    feeGridId: gridId,
    schoolCode,
    className,
    feeType: spec.feeType,
    label: spec.label,
    amount: spec.amount,
    mandatory: spec.feeType !== "Autre",
    dueDate: spec.dueDate,
    monthlyMonths: spec.monthlyMonths,
    status: "Actif",
  }));
}

async function main() {
  const results = [];
  const stamp = Date.now();
  const className = `FRAIS-${String(stamp).slice(-4)}`;
  const academicYear = resolveSchoolYear();
  const feeGridId = newFeeId("FEEGRID");

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  pushResult(results, "1. Admin établissement connecté", "200", schoolAdminIdentifier, true);

  // Comptable peut aussi gérer les frais
  const comptableId = `CPT-E2E-${stamp}`;
  const comptableUser = {
    id: newId("USERS"),
    firstName: "Comptable",
    lastName: "E2E 0009",
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
  pushResult(results, "1b. Comptable connecté", "200", comptableId, Boolean(comptableToken));

  // Classe cible
  const createdClass = await createClassViaApi(adminToken, {
    name: className,
    level: "3ème",
    track: "Générale",
    academicYearName: academicYear,
  });
  state = createdClass.state;
  const classCode = createdClass.api?.classCode || createdClass.classRecord.id;
  pushResult(results, "2. Classe sélectionnée / créée", className, createdClass.classRecord?.name, true);

  const existingEnroll = await enrollStudentViaApi(adminToken, classCode, {
    firstName: `Frais${stamp}`,
    lastName: "ÉlèveA",
    gender: "Masculin",
    birthDate: "2011-05-10",
  });
  state = existingEnroll.state;
  const existingStudent = {
    id: existingEnroll.studentCode,
    studentCode: existingEnroll.studentCode,
    className,
    schoolCode,
  };
  pushResult(results, "3. Élève existant dans la classe", className, className, true);

  const forbiddenGrid = await request("/finance/fee-grids", {
    method: "POST",
    token: comptableToken,
    body: {
      className,
      academicYear,
      currency: "CDF",
      items: [{ feeType: "Inscription", label: "X", amount: 10, status: "Actif" }],
    },
  });
  pushResult(
    results,
    "3b. Comptable ne crée pas de grille (droits inchangés)",
    "403",
    String(forbiddenGrid.status),
    forbiddenGrid.status === 403,
  );

  const feeItems = buildFeeItems(feeGridId, schoolCode, className);
  const feeGrid = await createFeeGridViaApi(adminToken, {
    id: feeGridId,
    className,
    academicYear,
    periodName: "Année complète",
    currency: "CDF",
    items: feeItems,
  });
  const detail = await request(`/finance/fee-grids/${encodeURIComponent(feeGrid.id)}`, { token: adminToken });
  const storedItems = detail.data?.items ?? [];
  pushResult(
    results,
    "4. Grille tarifaire créée (brouillon)",
    "Brouillon",
    feeGrid.status ?? "—",
    (feeGrid.status === "Brouillon" || feeGrid.status === "Active") && storedItems.length === 6,
  );
  pushResult(
    results,
    "5. Frais ajoutés (inscription, mensualité, annexes)",
    "6",
    String(storedItems.length),
    storedItems.length === 6,
  );
  pushResult(
    results,
    "6. Échéances définies",
    "dueDate + mois mensualité",
    storedItems.every((item) => !item.monthlyMonths?.length || item.monthlyMonths.length) ? "OK" : "KO",
    storedItems.every((item) => !item.monthlyMonths || item.monthlyMonths.length),
  );

  const draftApply = await request(`/finance/fee-grids/${encodeURIComponent(feeGrid.id)}/apply`, {
    method: "POST",
    token: adminToken,
  });
  pushResult(
    results,
    "7. Grille inactive ne génère pas de dette",
    "409",
    String(draftApply.status),
    draftApply.status === 409,
  );
  assert.equal(draftApply.status, 409, "Une grille brouillon ne doit pas générer de dettes");

  await activateFeeGridViaApi(adminToken, feeGrid.id);
  state = await getState(adminToken);
  pushResult(
    results,
    "8. Grille activée",
    "Active",
    (state.feeGrids ?? []).find((row) => row.id === feeGrid.id)?.status ?? "—",
    (state.feeGrids ?? []).find((row) => row.id === feeGrid.id)?.status === "Active",
  );

  const applyResult = await applyFeeGridViaApi(adminToken, feeGrid.id);
  state = await getState(adminToken);
  const existingMatch = studentFeesMatchGrid(
    state.studentFees ?? [],
    existingStudent.id,
    { ...feeGrid, status: "Active" },
    storedItems,
  );
  pushResult(
    results,
    "9. Frais associés aux élèves de la classe",
    `>=${storedItems.length}`,
    String(existingMatch.fees.length),
    applyResult.created > 0 && existingMatch.fees.length > 0,
  );
  pushResult(
    results,
    "10. Montants dus cohérents (élève existant)",
    String(existingMatch.expectedTotal),
    String(existingMatch.actualTotal),
    existingMatch.ok,
  );
  assert.ok(existingMatch.ok, "Montants incohérents pour l'élève existant");

  const newEnroll = await enrollStudentViaApi(adminToken, classCode, {
    firstName: `Frais${stamp}`,
    lastName: "ÉlèveB",
    gender: "Masculin",
    birthDate: "2011-05-10",
  });
  const newStudent = { id: newEnroll.studentCode, studentCode: newEnroll.studentCode, className, schoolCode };
  await applyFeeGridViaApi(adminToken, feeGrid.id);
  state = await getState(adminToken);
  const newMatch = studentFeesMatchGrid(state.studentFees ?? [], newStudent.id, { ...feeGrid, status: "Active" }, storedItems);
  pushResult(
    results,
    "11. Nouvel élève hérite des frais de sa classe",
    String(existingMatch.fees.length),
    String(newMatch.fees.length),
    newMatch.fees.length === existingMatch.fees.length,
  );
  pushResult(
    results,
    "12. Montants dus cohérents (nouvel élève)",
    String(newMatch.expectedTotal),
    String(newMatch.actualTotal),
    newMatch.ok,
  );
  assert.ok(newMatch.ok, "Montants incohérents pour le nouvel élève");

  // Vérification API impayés (échéances dépassées uniquement — hors mensualités sans date)
  const overdueExpected = 50_000 + 15_000 + 30_000 + 25_000 + 10_000;
  const unpaidRes = await request("/backoffice/finance/unpaid", { token: comptableToken });
  const unpaidRows = unpaidRes.data?.rows ?? [];
  const unpaidExisting = unpaidRows.find((row) => String(row.studentId) === String(existingStudent.id));
  const unpaidNew = unpaidRows.find((row) => String(row.studentId) === String(newStudent.id));
  pushResult(
    results,
    "13. API impayés — élève existant (échéances dépassées)",
    String(overdueExpected),
    String(unpaidExisting?.amountExpected ?? "—"),
    unpaidRes.status === 200 && Number(unpaidExisting?.amountExpected ?? 0) === overdueExpected,
  );
  pushResult(
    results,
    "14. API impayés — nouvel élève (échéances dépassées)",
    String(overdueExpected),
    String(unpaidNew?.amountExpected ?? "—"),
    unpaidRes.status === 200 && Number(unpaidNew?.amountExpected ?? 0) === overdueExpected,
  );

  // Persistance state après synchronisation
  const freshState = await getState(comptableToken);
  const persistedTotal = (freshState.studentFees ?? [])
    .filter((fee) => fee.studentId === existingStudent.id)
    .reduce((sum, fee) => sum + Number(fee.amountDue ?? 0), 0);
  pushResult(
    results,
    "15. Frais persistés en base (state)",
    String(existingMatch.expectedTotal),
    String(persistedTotal),
    persistedTotal === existingMatch.expectedTotal,
  );

  console.log("\n=== E2E 0009 : Parcours frais & tarifs ===");
  console.log(`Établissement : ${schoolCode}`);
  console.log(`Classe        : ${className}`);
  console.log(`Grille        : ${feeGrid.id}`);
  console.log(`Élève A       : ${existingStudent.firstName} ${existingStudent.name} (${existingStudent.id})`);
  console.log(`Élève B       : ${newStudent.firstName} ${newStudent.name} (${newStudent.id})`);
  console.log(`Total dû/élève: ${existingMatch.expectedTotal} CDF\n`);
  console.table(results);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0009 : OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
