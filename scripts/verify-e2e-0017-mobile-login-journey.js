/**
 * E2E 0017 : Parcours connexion mobile (UI/UX)
 *
 * Scénarios :
 *   - Affichage progressif après code établissement valide
 *   - Connexion parent (téléphone + PIN) → tableau de bord parent
 *   - Connexion enseignant (identifiant + PIN) → tableau de bord enseignant
 *
 * Prérequis :
 *   1. Backend API : npm run backend  (ou Docker)
 *   2. Mobile web  : cd Mobile && npx expo start --web --port 19006
 *   3. Playwright    : npm install -D playwright && npx playwright install chromium
 *
 *   SOMAFRIK_MOBILE_WEB_URL=http://127.0.0.1:19006 EXPO_PUBLIC_API_URL=http://127.0.0.1:5000 npm run verify:e2e-0017
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
  mobileIdentify,
  resolveSchoolContext,
  base,
} = require("./e2e-api-helpers");
const { prepareContactForSave, assertContactRequiredFields, validateContactDuplicate } = require("./e2e-contacts-rules");
const { saveContactWithOptionalUserAccount } = require("./e2e-user-account-rules");
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
  openWelcomeAndRoleSelection,
  verifySchoolCodeUi,
  openLoginForm,
  assertLoginButtonDisabled,
  assertInputTouchTarget,
  assertInputMode,
  fillIdentifierAndWaitRole,
  fillSecretInput,
  submitLogin,
  completePasswordChangeIfNeeded,
  waitForParentDashboard,
  waitForTeacherDashboard,
  logoutFromMenu,
  testIdSelector,
  LOGIN_TEST_IDS,
  ROLE_SELECTION_TEST_IDS,
  WELCOME_TEST_IDS,
  LOGIN_MAX_MS,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
const PARENT_PIN = "1234";
const TEACHER_PIN = "5678";
const SCHOOL_LOGO_URL = "https://cdn.somafrik.test/logo-e2e-mobile.png";

function saveContactOnly(state, draft, schoolCode) {
  const prepared = prepareContactForSave({ ...draft, schoolCode }, state);
  const requiredError = assertContactRequiredFields(prepared);
  if (requiredError) return { ok: false, error: requiredError };
  const duplicate = validateContactDuplicate(prepared, state.contacts ?? []);
  if (duplicate.block) return { ok: false, error: duplicate.block };
  return { ok: true, contact: { ...prepared, id: draft.id ?? newId("CONTACT") } };
}

function createParentUser(contact, schoolCode, phone, pin) {
  return {
    id: newId("USERS"),
    contactId: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    role: "Parent",
    identifier: phone,
    phone,
    email: contact.email,
    schoolCode,
    countryScope: "RDC",
    scopeLevel: "Établissement",
    accessChannel: "Application",
    status: "Actif",
    password: pin,
    pin,
    mustChangePassword: false,
    permissions: [],
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

async function setupLoginFixtures() {
  const stamp = Date.now();
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolName, schoolAdminIdentifier, adminToken } = await resolveSchoolContext(superToken);
  let state = await getState(adminToken);

  const schools = (state.schools ?? []).map((row) =>
    row.code === schoolCode ? { ...row, logoUrl: SCHOOL_LOGO_URL, name: schoolName } : row,
  );
  state = await putStatePatch(adminToken, { schools });

  const parentContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "LoginUI",
      firstName: `Parent${stamp}`,
      contactType: "Parent",
      phone: parentPhone,
      email: `parent-ui-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentContactFlow.ok, parentContactFlow.error);

  const childFlow = (() => {
    const contactFlow = saveContactOnly(
      state,
      {
        id: newId("CONTACT"),
        lastName: "EleveUI",
        firstName: `Enfant${stamp}`,
        contactType: "Élève",
        phone: `+243 810 ${String(stamp).slice(-6)}`,
        email: `eleve-ui-${stamp}@somafrik.app`,
        status: "Actif",
      },
      schoolCode,
    );
    if (!contactFlow.ok) return contactFlow;
    const link = linkContactToOperationalRecord(contactFlow.contact, state, schoolCode);
    if (link.linkedType !== "student") return { ok: false, error: "Liaison élève impossible." };
    const student = (link.students ?? []).find(
      (row) => normalize(row.contactId) === normalize(contactFlow.contact.id),
    );
    if (!student) return { ok: false, error: "Fiche élève absente." };
    return {
      ok: true,
      contact: link.contact,
      student: {
        ...student,
        className: "6ème A",
        schoolCode,
        matricule: `ELE-UI-${stamp}`,
        parentPhone,
        parentName: "LoginUI Parent",
        schoolStatus: "Inscrit",
      },
      students: link.students ?? [],
    };
  })();
  assert.ok(childFlow.ok, childFlow.error);

  const parentUser = createParentUser(parentContactFlow.contact, schoolCode, parentPhone, PARENT_PIN);
  state = await putStatePatch(adminToken, {
    contacts: [parentContactFlow.contact, childFlow.contact, ...(state.contacts ?? [])],
    students: (state.students ?? []).some((row) => row.id === childFlow.student.id)
      ? (state.students ?? []).map((row) => (row.id === childFlow.student.id ? childFlow.student : row))
      : [childFlow.student, ...(state.students ?? [])],
    users: [parentUser, ...(state.users ?? [])],
    classes: [
      {
        id: newId("CLASS"),
        name: "6ème A",
        className: "6ème A",
        level: "6ème",
        schoolCode,
        status: "Actif",
      },
      ...(state.classes ?? []),
    ],
  });

  const teacherContactDraft = {
    id: newId("CONTACT"),
    lastName: "ProfUI",
    firstName: `Teacher${stamp}`,
    contactType: "Enseignant",
    phone: `+243 831 ${String(stamp).slice(-6)}`,
    email: `prof-ui-${stamp}@somafrik.app`,
    hasAccess: "Oui",
    role: "Enseignant",
    status: "Actif",
  };
  const teacherFlow = saveContactWithOptionalUserAccount(
    { ...teacherContactDraft, password: TEACHER_PIN, temporaryPassword: TEACHER_PIN },
    state,
    schoolCode,
    { identifier: schoolAdminIdentifier, role: "Admin School", schoolCode },
  );
  assert.ok(teacherFlow.ok, teacherFlow.error);
  const teacherUser = {
    ...teacherFlow.user,
    password: TEACHER_PIN,
    pin: TEACHER_PIN,
    mustChangePassword: false,
  };
  state = await putStatePatch(adminToken, {
    ...teacherFlow.patch,
    users: teacherFlow.patch.users.map((row) => (row.id === teacherUser.id ? teacherUser : row)),
    teachers: [
      {
        id: newId("TEACHERS"),
        userId: teacherUser.id,
        contactId: teacherFlow.contact.id,
        identifier: teacherUser.identifier,
        firstName: teacherUser.firstName,
        lastName: teacherUser.lastName,
        name: teacherUser.lastName,
        schoolCode,
        mainSubject: "Mathématiques",
        assignments: [],
      },
      ...(state.teachers ?? []),
    ],
  });

  const parentIdentify = await mobileIdentify(parentPhone, schoolCode);
  const teacherIdentify = await mobileIdentify(teacherUser.identifier, schoolCode);

  return {
    schoolCode,
    schoolName,
    parentPhone,
    teacherIdentifier: teacherUser.identifier,
    teacherEmail: teacherContactDraft.email,
    parentRoleLabel: parentIdentify.roleLabel ?? parentIdentify.role,
    teacherRoleLabel: teacherIdentify.roleLabel ?? teacherIdentify.role,
  };
}

async function runUiJourney(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await openWelcomeAndRoleSelection(page, MOBILE_WEB_URL);
    await verifySchoolCodeUi(page, fixtures.schoolCode, fixtures.schoolName, results, "Connexion");
    await openLoginForm(page, results, "Connexion");

    await assertLoginButtonDisabled(page, true, results, "Connexion — Bouton désactivé sans identifiant");
    await assertInputTouchTarget(page, LOGIN_TEST_IDS.identifierInput, results, "Connexion — Champ identifiant tactile");
    await assertInputTouchTarget(page, LOGIN_TEST_IDS.loginButton, results, "Connexion — Bouton tactile");

    // ── Variante parent / élève ───────────────────────────────────────────
    const parentRole = await fillIdentifierAndWaitRole(page, fixtures.parentPhone, "parent");
    pushUiResult(
      results,
      "Parent — Rôle détecté",
      "parent",
      parentRole.trim(),
      /parent|élève/i.test(parentRole),
    );
    await assertInputMode(page, LOGIN_TEST_IDS.identifierInput, "numeric", results, "Parent — Clavier téléphone");
    await page.locator(testIdSelector(LOGIN_TEST_IDS.passwordInput)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
    await assertInputMode(page, LOGIN_TEST_IDS.passwordInput, "numeric", results, "Parent — Clavier PIN numérique");
    await assertLoginButtonDisabled(page, true, results, "Parent — Bouton désactivé sans PIN");
    await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, PARENT_PIN);
    await assertLoginButtonDisabled(page, false, results, "Parent — Bouton activé avec PIN");

    await submitLogin(page);
    const passwordChanged = await completePasswordChangeIfNeeded(page);
    pushUiResult(
      results,
      "Parent — Pas bloqué sur mot de passe temporaire",
      "accès direct",
      passwordChanged ? "changement demandé" : "accès direct",
      !passwordChanged,
    );
    await waitForParentDashboard(page);
    const parentDashVisible = await page.locator(testIdSelector("home-parent-dashboard")).isVisible();
    pushUiResult(
      results,
      "Parent — Tableau de bord affiché",
      "Suivi scolaire",
      parentDashVisible ? "Suivi scolaire" : "absent",
      parentDashVisible,
    );

    await logoutFromMenu(page);

    // ── Variante enseignant ───────────────────────────────────────────────
    await page.locator(testIdSelector(WELCOME_TEST_IDS.loginButton)).click();
    await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.screen), { timeout: LOGIN_MAX_MS });
    await verifySchoolCodeUi(page, fixtures.schoolCode, fixtures.schoolName, results, "Enseignant");
    await openLoginForm(page, results, "Enseignant");

    const teacherRole = await fillIdentifierAndWaitRole(page, fixtures.teacherIdentifier, "enseignant");
    pushUiResult(
      results,
      "Enseignant — Rôle détecté",
      "enseignant",
      teacherRole.trim(),
      /enseignant|teacher/i.test(teacherRole),
    );
    await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, TEACHER_PIN);
    await assertLoginButtonDisabled(page, false, results, "Enseignant — Bouton activé");
    await submitLogin(page);
    await completePasswordChangeIfNeeded(page);
    await waitForTeacherDashboard(page);
    const teacherDashVisible = await page.locator(testIdSelector("home-teacher-dashboard")).isVisible();
    pushUiResult(
      results,
      "Enseignant — Tableau de bord affiché",
      "Espace enseignant",
      teacherDashVisible ? "Espace enseignant" : "absent",
      teacherDashVisible,
    );

    // Erreur compréhensible (identifiant invalide)
    await logoutFromMenu(page);
    await page.locator(testIdSelector(WELCOME_TEST_IDS.loginButton)).click();
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolCodeInput)).fill(fixtures.schoolCode);
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.verifyButton)).click();
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.openLoginButton)).click();
    await page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput)).fill("000000INVALID");
    await page.waitForTimeout(700);
    await page.locator(testIdSelector(LOGIN_TEST_IDS.passwordInput)).fill("0000").catch(() => null);
    const invalidRole = await page.locator(testIdSelector(LOGIN_TEST_IDS.roleBadge)).innerText();
    pushUiResult(
      results,
      "Erreur — Identifiant inconnu bloqué",
      "En attente ou bouton désactivé",
      invalidRole.trim() || "En attente",
      /attente/i.test(invalidRole),
    );
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
    fixtures = await setupLoginFixtures();
    pushUiResult(results, "2. Données test préparées", fixtures.schoolCode, fixtures.parentPhone, true);
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
  console.log("E2E 0017 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0017 : Parcours connexion mobile (UI/UX) ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  if (fixtures) {
    console.log(`Établissement   : ${fixtures.schoolCode} (${fixtures.schoolName})`);
    console.log(`Parent          : ${fixtures.parentPhone} / PIN ${PARENT_PIN}`);
    console.log(`Enseignant      : ${fixtures.teacherIdentifier} / PIN ${TEACHER_PIN}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
