/**
 * E2E 0022 : Parcours mobile fiche élève — Notes, Présences, Paiements
 *
 * Scénarios :
 *   - Consulter les notes (matière, valeur, période)
 *   - Consulter les présences (Présent, Absent, Retard)
 *   - Consulter les paiements (montants, statuts)
 *   - Cohérence UI/UX entre les 3 sous-écrans
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *   3. Playwright  : npm install -D playwright && npx playwright install chromium
 *
 *   npm run verify:e2e-0023
 */
const assert = require("assert");
const path = require("path");
const {
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
  base,
  todayPeriodDate,
} = require("./e2e-api-helpers");
const { prepareContactForSave, assertContactRequiredFields, validateContactDuplicate } = require("./e2e-contacts-rules");
const { buildEnrollmentPatch, resolveSchoolYear } = require("./e2e-student-enrollment-rules");
const { linkContactToOperationalRecord } = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "contactRegistrySync",
));
const {
  pushResult: pushUiResult,
  loadPlaywright,
  loginAsSchoolAdmin,
  assertStudentSubScreensUi,
  DEFAULT_MOBILE_WEB_URL,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = DEFAULT_MOBILE_WEB_URL;
const VIEWPORT = { name: "iPhone 13", width: 390, height: 844 };
const ACADEMIC_YEAR = resolveSchoolYear();

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

async function setupStudentSubScreensFixtures() {
  const stamp = Date.now();
  const className = `SUB-${String(stamp).slice(-4)}`;
  const studentLastName = "KabilaMukendiLongName";
  const studentFirstName = "Marie-Claire";
  const studentDisplayName = `${studentFirstName} ${studentLastName}`;
  const noteSubject = "Mathématiques";
  const notePeriod = "Trimestre 1";
  const noteValue = 15;

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  let state = await getState(adminToken);

  const users = (state.users ?? []).map((row) =>
    normalize(row.identifier) === normalize(schoolAdminIdentifier)
      ? {
          ...row,
          password: ADMIN_PASSWORD,
          temporaryPassword: ADMIN_PASSWORD,
          mustChangePassword: false,
        }
      : row,
  );
  state = await putStatePatch(adminToken, { users });

  const studentContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: studentLastName,
      firstName: studentFirstName,
      contactType: "Élève",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `eleve-sub-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(studentContactFlow.ok, studentContactFlow.error);

  const link = linkContactToOperationalRecord(studentContactFlow.contact, state, schoolCode);
  assert.strictEqual(link.linkedType, "student");
  let student = (link.students ?? []).find(
    (row) => normalize(row.contactId) === normalize(studentContactFlow.contact.id),
  );
  assert.ok(student, "Fiche élève absente");

  const enrollment = buildEnrollmentPatch(student, {
    className,
    matricule: `ELE-SUB-${stamp}`,
    schoolYear: ACADEMIC_YEAR,
    schoolStatus: "Inscrit",
    parentPhone: `+243 820 ${String(stamp).slice(-6)}`,
  });

  const noteId = newId("NOTE");
  const presencePresentId = newId("PRES");
  const presenceAbsentId = newId("PRES");
  const presenceLateId = newId("PRES");
  const paidPaymentId = newId("PAY");
  const pendingPaymentId = newId("PAY");
  const paidAmount = 50_000;
  const pendingAmount = 30_000;

  state = await putStatePatch(adminToken, {
    contacts: [studentContactFlow.contact, ...(state.contacts ?? [])],
    students: (state.students ?? []).some((row) => row.id === student.id)
      ? (state.students ?? []).map((row) => (row.id === student.id ? enrollment : row))
      : [enrollment, ...(state.students ?? [])],
    classes: [
      {
        id: newId("CLASS"),
        name: className,
        className,
        level: "3ème",
        schoolCode,
        status: "Actif",
      },
      ...(state.classes ?? []),
    ],
    notes: [
      {
        id: noteId,
        studentId: student.id,
        studentName: studentDisplayName,
        className,
        schoolCode,
        subject: noteSubject,
        value: noteValue,
        coefficient: 2,
        scale: 20,
        period: notePeriod,
        date: todayPeriodDate(),
      },
      ...(state.notes ?? []),
    ],
    presences: [
      {
        id: presencePresentId,
        publicId: `PRES-P-${stamp}`,
        studentId: student.id,
        className,
        schoolCode,
        date: "01-03-2026",
        status: "Présent",
        present: true,
      },
      {
        id: presenceAbsentId,
        publicId: `PRES-A-${stamp}`,
        studentId: student.id,
        className,
        schoolCode,
        date: "02-03-2026",
        status: "Absent",
        present: false,
      },
      {
        id: presenceLateId,
        publicId: `PRES-R-${stamp}`,
        studentId: student.id,
        className,
        schoolCode,
        date: "03-03-2026",
        status: "Retard",
        present: true,
      },
      ...(state.presences ?? []),
    ],
    payments: [
      {
        id: paidPaymentId,
        publicId: `PAY-PAID-${stamp}`,
        reference: `PAY-PAID-${stamp}`,
        schoolCode,
        studentId: student.id,
        studentName: studentDisplayName,
        className,
        feeType: "Scolarité",
        label: "Tranche 1",
        amount: paidAmount,
        currency: "CDF",
        method: "Mobile Money",
        date: "15-03-2026",
        status: "PAYE",
      },
      {
        id: pendingPaymentId,
        publicId: `PAY-PEND-${stamp}`,
        reference: `PAY-PEND-${stamp}`,
        schoolCode,
        studentId: student.id,
        studentName: studentDisplayName,
        className,
        feeType: "Scolarité",
        label: "Tranche 2",
        amount: pendingAmount,
        currency: "CDF",
        method: "Espèces",
        date: "01-02-2026",
        status: "EN_ATTENTE",
      },
      ...(state.payments ?? []),
    ],
  });

  student = (state.students ?? []).find((row) => row.id === student.id);
  assert.ok(student?.className === className, "Élève non affecté à la classe");

  return {
    schoolCode,
    schoolName,
    adminIdentifier: schoolAdminIdentifier,
    adminPassword: ADMIN_PASSWORD,
    className,
    studentId: student.id,
    studentLastName,
    studentDisplayName,
    noteId,
    noteSubject,
    notePeriod,
    noteValue,
    presencePresentId,
    presenceAbsentId,
    presenceLateId,
    paidPaymentId,
    pendingPaymentId,
    paidAmount,
    pendingAmount,
    paidAmountLabel: paidAmount.toLocaleString("fr-FR"),
    pendingAmountLabel: pendingAmount.toLocaleString("fr-FR"),
  };
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function runUiJourney(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await loginAsSchoolAdmin(page, MOBILE_WEB_URL, fixtures, results);
    pushUiResult(results, "Admin connecté", "visible", "visible", true);

    await assertStudentSubScreensUi(page, fixtures, VIEWPORT, results);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const results = [];

  const apiOk = await probe(`${base.replace(/\/api$/, "")}/api/health`).catch(() => probe(`${base}/health`));
  pushUiResult(results, "0. Backend API accessible", base, apiOk ? "OK" : "indisponible", Boolean(apiOk));

  const mobileOk = await probe(MOBILE_WEB_URL);
  pushUiResult(results, "1. Mobile web accessible", MOBILE_WEB_URL, mobileOk ? "OK" : "indisponible", mobileOk);

  if (!apiOk || !mobileOk) {
    console.error("\nPrérequis manquants. Backend + Mobile web requis.\n");
    printReport(results, null);
    process.exit(1);
  }

  let fixtures;
  try {
    fixtures = await setupStudentSubScreensFixtures();
    pushUiResult(results, "2. Données test préparées", fixtures.className, fixtures.studentDisplayName, true);
  } catch (error) {
    pushUiResult(results, "2. Données test préparées", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runUiJourney(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0022 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0022 : Parcours fiche élève — Notes, Présences, Paiements ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  console.log(`Viewport       : ${VIEWPORT.name} (${VIEWPORT.width}x${VIEWPORT.height})`);
  if (fixtures) {
    console.log(`Établissement  : ${fixtures.schoolCode} (${fixtures.schoolName})`);
    console.log(`Admin          : ${fixtures.adminIdentifier}`);
    console.log(`Classe         : ${fixtures.className}`);
    console.log(`Élève          : ${fixtures.studentDisplayName} (${fixtures.studentId})\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
