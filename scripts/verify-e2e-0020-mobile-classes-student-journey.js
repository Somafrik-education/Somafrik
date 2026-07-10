/**
 * E2E 0020 : Parcours mobile Classes → Élèves → Détail élève
 *
 * Scénario :
 *   Étant donné que l'utilisateur est connecté comme administrateur d'établissement
 *   Quand il appuie sur l'onglet "Classes"
 *   Et sélectionne une classe
 *   Alors la liste des élèves de cette classe est affichée
 *
 *   Quand il sélectionne un élève
 *   Alors la fiche détail de l'élève est affichée
 *   Et le nom de l'élève est visible
 *   Et la classe de l'élève est visible
 *   Et les boutons "Notes", "Présences" et "Paiements" sont visibles
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *   3. Playwright    : npm install -D playwright && npx playwright install chromium
 *
 *   npm run verify:e2e-0020
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
  openClassesTab,
  assertClassesStudentJourneyUi,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
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

async function setupClassesStudentFixtures() {
  const stamp = Date.now();
  const className = `CLS-${String(stamp).slice(-4)}`;
  const studentLastName = "MukendiKabongoTshilumba";
  const studentFirstName = "Jean-Baptiste";
  const studentDisplayName = `${studentFirstName} ${studentLastName}`;

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
      email: `eleve-cls-${stamp}@somafrik.app`,
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
    matricule: `ELE-CLS-${stamp}`,
    schoolYear: ACADEMIC_YEAR,
    schoolStatus: "Inscrit",
    parentPhone: `+243 820 ${String(stamp).slice(-6)}`,
  });

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
    pushUiResult(results, "Admin connecté — onglet Classes accessible", "visible", "visible", true);

    await openClassesTab(page);
    pushUiResult(results, "Onglet Classes ouvert", fixtures.className, fixtures.className, true);

    await page.waitForTimeout(1200);
    await assertClassesStudentJourneyUi(page, fixtures, VIEWPORT, results);
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
    fixtures = await setupClassesStudentFixtures();
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
  console.log("E2E 0020 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0020 : Parcours Classes → Élèves → Détail élève ===");
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
