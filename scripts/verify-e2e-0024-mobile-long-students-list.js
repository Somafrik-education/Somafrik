/**
 * E2E 0024 : Affichage des listes longues — élèves
 *
 * Scénario :
 *   Étant donné qu'une classe contient plus de 50 élèves
 *   Quand l'utilisateur ouvre la liste des élèves
 *   Alors la liste est affichée sans ralentissement important
 *   Et l'utilisateur peut faire défiler la liste
 *   Et chaque ligne reste lisible
 *   Et la barre de navigation reste accessible
 *
 * Prérequis :
 *   1. Backend API : npm run backend
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *
 *   npm run verify:e2e-0024
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
  assertLongStudentsListUi,
  LONG_STUDENTS_LIST_MIN_COUNT,
  DEFAULT_MOBILE_WEB_URL,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = DEFAULT_MOBILE_WEB_URL;
const VIEWPORT = { name: "iPhone 13", width: 390, height: 844 };
const ACADEMIC_YEAR = resolveSchoolYear();
const STUDENT_COUNT = LONG_STUDENTS_LIST_MIN_COUNT + 5;

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

async function setupLongStudentsListFixtures() {
  const stamp = Date.now();
  const className = `LL-${String(stamp).slice(-4)}`;

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

  state = await putStatePatch(adminToken, { users });

  let workingState = { ...state };
  const newContacts = [];
  const enrollments = [];

  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const rank = index + 1;
    const padded = String(rank).padStart(2, "0");
    const lastName = `LongList-${padded}`;
    const studentContactFlow = saveContactOnly(
      workingState,
      {
        id: newId("CONTACT"),
        lastName,
        firstName: "Eleve",
        contactType: "Élève",
        phone: `+243 81${String(stamp + rank).slice(-7)}`,
        email: `eleve-ll-${stamp}-${padded}@somafrik.app`,
        status: "Actif",
      },
      schoolCode,
    );
    assert.ok(studentContactFlow.ok, studentContactFlow.error);
    newContacts.push(studentContactFlow.contact);
    workingState = {
      ...workingState,
      contacts: [...(workingState.contacts ?? []), studentContactFlow.contact],
    };

    const link = linkContactToOperationalRecord(studentContactFlow.contact, workingState, schoolCode);
    assert.strictEqual(link.linkedType, "student");
    const student = (link.students ?? []).find(
      (row) => normalize(row.contactId) === normalize(studentContactFlow.contact.id),
    );
    assert.ok(student, `Fiche élève absente (${padded})`);

    enrollments.push(
      buildEnrollmentPatch(student, {
        className,
        matricule: `ELE-LL-${stamp}-${padded}`,
        schoolYear: ACADEMIC_YEAR,
        schoolStatus: "Inscrit",
        enrollmentDate: todayPeriodDate(),
        gender: rank % 2 === 0 ? "F" : "M",
      }),
    );
    workingState = {
      ...workingState,
      students: [...enrollments, ...(state.students ?? [])],
    };
  }

  state = await putStatePatch(adminToken, {
    classes: [
      {
        id: newId("CLASS"),
        name: className,
        className,
        level: "6ème",
        schoolCode,
        status: "Actif",
      },
      ...(state.classes ?? []),
    ],
    contacts: [...newContacts, ...(state.contacts ?? [])],
    students: [...enrollments, ...(state.students ?? [])],
  });

  const stored = (state.students ?? [])
    .filter((row) => normalize(row.className) === normalize(className))
    .sort((left, right) => String(left.matricule).localeCompare(String(right.matricule)));
  assert.ok(stored.length >= LONG_STUDENTS_LIST_MIN_COUNT, "Classe sans assez d'élèves");

  const firstStudent = stored[0];
  const lastStudent = stored[stored.length - 1];

  return {
    schoolCode,
    schoolName,
    adminIdentifier: schoolAdminIdentifier,
    adminPassword: ADMIN_PASSWORD,
    className,
    studentCount: stored.length,
    firstStudentId: firstStudent.id,
    lastStudentId: lastStudent.id,
    lastStudentLabel: `${lastStudent.firstName} ${lastStudent.name}`,
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

    await assertLongStudentsListUi(page, fixtures, VIEWPORT, results);
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
    fixtures = await setupLongStudentsListFixtures();
    pushUiResult(
      results,
      "2. Données test préparées",
      `≥ ${LONG_STUDENTS_LIST_MIN_COUNT} élèves`,
      String(fixtures.studentCount),
      true,
    );
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
  console.log("E2E 0024 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0024 : Affichage des listes longues (élèves) ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  console.log(`Viewport       : ${VIEWPORT.name} (${VIEWPORT.width}x${VIEWPORT.height})`);
  if (fixtures) {
    console.log(`Établissement  : ${fixtures.schoolCode} (${fixtures.schoolName})`);
    console.log(`Admin          : ${fixtures.adminIdentifier}`);
    console.log(`Classe         : ${fixtures.className}`);
    console.log(`Élèves         : ${fixtures.studentCount}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
