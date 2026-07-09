/**
 * E2E 0018 : Messages d'erreur et feedback utilisateur (mobile)
 *
 * Scénarios :
 *   - Code établissement invalide → message clair près du formulaire
 *   - Identifiants invalides (PIN incorrect) → message clair, reste sur l'écran, champs conservés
 *
 * Prérequis : backend + mobile web (voir verify:e2e-0017)
 *
 *   SOMAFRIK_MOBILE_WEB_URL=http://127.0.0.1:19006 npm run verify:e2e-0018
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
  resolveSchoolContext,
  base,
} = require("./e2e-api-helpers");
const { prepareContactForSave, assertContactRequiredFields, validateContactDuplicate } = require("./e2e-contacts-rules");
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
  fillIdentifierAndWaitRole,
  fillSecretInput,
  submitLogin,
  testIdSelector,
  LOGIN_TEST_IDS,
  ROLE_SELECTION_TEST_IDS,
  ERROR_TEST_IDS,
  ERROR_MESSAGES,
  assertInlineError,
  assertFieldEditable,
  IDENTIFY_DEBOUNCE_MS,
  LOGIN_MAX_MS,
} = require("./e2e-mobile-ui-helpers");

const MOBILE_WEB_URL = (process.env.SOMAFRIK_MOBILE_WEB_URL || "http://127.0.0.1:19006").replace(/\/$/, "");
const PARENT_PIN = "1234";
const WRONG_PIN = "9999";

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
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function setupParentAccount() {
  const stamp = Date.now();
  const parentPhone = `+243 820 ${String(stamp).slice(-6)}`;
  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const { schoolCode, schoolName, adminToken } = await resolveSchoolContext(superToken);
  let state = await getState(adminToken);

  const parentContactFlow = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "ErrUI",
      firstName: `Parent${stamp}`,
      contactType: "Parent",
      phone: parentPhone,
      email: `err-ui-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(parentContactFlow.ok, parentContactFlow.error);

  const childContact = saveContactOnly(
    state,
    {
      id: newId("CONTACT"),
      lastName: "Eleve",
      firstName: "Err",
      contactType: "Élève",
      phone: `+243 810 ${String(stamp).slice(-6)}`,
      email: `eleve-err-${stamp}@somafrik.app`,
      status: "Actif",
    },
    schoolCode,
  );
  assert.ok(childContact.ok, childContact.error);
  const link = linkContactToOperationalRecord(childContact.contact, state, schoolCode);
  const student = link.students.find((row) => normalize(row.contactId) === normalize(childContact.contact.id));
  const parentUser = createParentUser(parentContactFlow.contact, schoolCode, parentPhone, PARENT_PIN);

  await putStatePatch(adminToken, {
    contacts: [parentContactFlow.contact, childContact.contact, ...(state.contacts ?? [])],
    users: [parentUser, ...(state.users ?? [])],
    students: [
      {
        ...student,
        className: "6ème A",
        schoolCode,
        parentPhone,
        schoolStatus: "Inscrit",
      },
      ...(state.students ?? []),
    ],
  });

  return { schoolCode, schoolName, parentPhone };
}

async function runUiErrorTests(fixtures, results) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });

  try {
    let dialogSeen = false;
    page.on("dialog", () => {
      dialogSeen = true;
    });

    // ── Code établissement invalide ─────────────────────────────────────────
    await openWelcomeAndRoleSelection(page, MOBILE_WEB_URL);
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolCodeInput)).fill("CODE-INVALIDE-XYZ");
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.verifyButton)).click();
    await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.errorBanner), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });

    await assertInlineError(
      page,
      ERROR_TEST_IDS.roleSelectionErrorBanner,
      ERROR_MESSAGES.invalidSchoolCode.replace(".", ""),
      results,
      "Code établissement — Message d'erreur affiché",
    );
    pushUiResult(
      results,
      "Code établissement — Pas de popup bloquante",
      "aucune alerte",
      dialogSeen ? "alerte native" : "aucune alerte",
      !dialogSeen,
    );
    await assertFieldEditable(
      page,
      ROLE_SELECTION_TEST_IDS.schoolCodeInput,
      results,
      "Code établissement — Champ modifiable",
    );
    pushUiResult(
      results,
      "Code établissement — Reste sur l'écran",
      "role-selection-screen",
      (await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.screen)).isVisible()) ? "visible" : "absent",
      await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.screen)).isVisible(),
    );

    const errorBox = await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.errorBanner)).boundingBox();
    const verifyBox = await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.verifyButton)).boundingBox();
    const errorNearForm =
      errorBox && verifyBox ? errorBox.y >= verifyBox.y - 200 && errorBox.y <= verifyBox.y + 260 : false;
    pushUiResult(
      results,
      "Code établissement — Message près du formulaire",
      "proche",
      errorNearForm ? "proche" : "éloigné",
      errorNearForm,
    );

    // ── PIN incorrect ───────────────────────────────────────────────────────
    dialogSeen = false;
    await verifySchoolCodeUi(page, fixtures.schoolCode, fixtures.schoolName, results, "Login");
    await openLoginForm(page, results, "Login");
    await fillIdentifierAndWaitRole(page, fixtures.parentPhone);
    await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, WRONG_PIN);
    await submitLogin(page);
    await page.waitForSelector(testIdSelector(ERROR_TEST_IDS.loginErrorBanner), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });

    await assertInlineError(
      page,
      ERROR_TEST_IDS.loginErrorBanner,
      ERROR_MESSAGES.invalidPin.replace(".", ""),
      results,
      "Connexion — Message PIN incorrect",
    );
    pushUiResult(
      results,
      "Connexion — Pas de popup bloquante",
      "aucune alerte",
      dialogSeen ? "alerte native" : "aucune alerte",
      !dialogSeen,
    );
    pushUiResult(
      results,
      "Connexion — Reste sur l'écran login",
      "login-screen",
      (await page.locator(testIdSelector(LOGIN_TEST_IDS.screen)).isVisible()) ? "visible" : "absent",
      await page.locator(testIdSelector(LOGIN_TEST_IDS.screen)).isVisible(),
    );

    const identifierValue = await page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput)).inputValue();
    pushUiResult(
      results,
      "Connexion — Identifiant conservé",
      fixtures.parentPhone,
      identifierValue,
      identifierValue.includes(String(fixtures.parentPhone).replace(/\s+/g, " ").trim().slice(-6)),
    );
    await assertFieldEditable(page, LOGIN_TEST_IDS.identifierInput, results, "Connexion — Identifiant modifiable");
    await assertFieldEditable(page, LOGIN_TEST_IDS.passwordInput, results, "Connexion — PIN modifiable");

    const loginErrorText = await page.locator(testIdSelector(ERROR_TEST_IDS.loginErrorBanner)).innerText();
    pushUiResult(
      results,
      "Connexion — Pas de message technique",
      "simple",
      /api|jwt|5000|fetch|backend/i.test(loginErrorText) ? "technique" : "simple",
      !/api|jwt|5000|fetch|backend/i.test(loginErrorText),
    );

    // Correction du PIN → l'erreur disparaît
    await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, "1");
    await page.waitForTimeout(300);
    pushUiResult(
      results,
      "Connexion — Erreur effaçée à la saisie",
      "masquée",
      (await page.locator(testIdSelector(ERROR_TEST_IDS.loginErrorBanner)).isVisible()) ? "visible" : "masquée",
      !(await page.locator(testIdSelector(ERROR_TEST_IDS.loginErrorBanner)).isVisible()),
    );

    // Identifiant inconnu → message inline (pas de crash)
    await page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput)).fill("");
    await page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput)).fill("000000INVALID-ID");
    await page.waitForTimeout(IDENTIFY_DEBOUNCE_MS + 200);
    await assertInlineError(
      page,
      ERROR_TEST_IDS.loginErrorBanner,
      ERROR_MESSAGES.invalidIdentifier.replace(".", ""),
      results,
      "Connexion — Identifiant invalide",
    );
    pushUiResult(
      results,
      "Connexion — Pas de crash (écran actif)",
      "login-screen",
      (await page.locator(testIdSelector(LOGIN_TEST_IDS.screen)).isVisible()) ? "visible" : "absent",
      await page.locator(testIdSelector(LOGIN_TEST_IDS.screen)).isVisible(),
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const results = [];
  const apiOk = await probe(`${base.replace(/\/api$/, "")}/api/health`);
  const mobileOk = await probe(MOBILE_WEB_URL);
  pushUiResult(results, "0. Backend API accessible", base, apiOk ? "OK" : "indisponible", apiOk);
  pushUiResult(results, "1. Mobile web accessible", MOBILE_WEB_URL, mobileOk ? "OK" : "indisponible", mobileOk);
  if (!apiOk || !mobileOk) {
    printReport(results, null);
    process.exit(1);
  }

  let fixtures;
  try {
    fixtures = await setupParentAccount();
    pushUiResult(results, "2. Compte parent test préparé", fixtures.schoolCode, fixtures.parentPhone, true);
  } catch (error) {
    pushUiResult(results, "2. Compte parent test préparé", "OK", error.message, false);
    printReport(results, null);
    process.exit(1);
  }

  await runUiErrorTests(fixtures, results);
  printReport(results, fixtures);

  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("E2E 0018 : OK");
}

function printReport(results, fixtures) {
  console.log("\n=== E2E 0018 : Erreurs UI mobile (feedback utilisateur) ===");
  console.log(`URL mobile web : ${MOBILE_WEB_URL}`);
  if (fixtures) {
    console.log(`Établissement   : ${fixtures.schoolCode}`);
    console.log(`Parent test     : ${fixtures.parentPhone} / PIN ${PARENT_PIN}\n`);
  }
  console.table(results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
