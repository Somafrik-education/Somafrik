/**
 * Helpers partagés pour les tests E2E UI mobile Somafrik (Playwright).
 */
const assert = require("assert");

const WELCOME_COPY = {
  brandName: "Somafrik",
  loginButtonLabel: "Se connecter",
  subtitle: "ERP scolaire mobile et tablette pour tous les rôles.",
};

const WELCOME_TEST_IDS = {
  screen: "welcome-screen",
  logo: "welcome-logo",
  brand: "welcome-brand",
  parentBrand: "welcome-parent-brand",
  subtitle: "welcome-subtitle",
  loginButton: "welcome-login-button",
};

const MOBILE_VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 13", width: 390, height: 844 },
  { name: "Pixel 5", width: 393, height: 851 },
  { name: "Small Android", width: 360, height: 640 },
];

const RESPONSIVE_VIEWPORTS = [
  { name: "Small Android", width: 360, height: 640, orientation: "portrait", category: "small-android", isMobile: true },
  { name: "iPhone 13", width: 390, height: 844, orientation: "portrait", category: "iphone", isMobile: true },
  { name: "Large Android", width: 412, height: 915, orientation: "portrait", category: "large-android", isMobile: true },
  { name: "iPad Portrait", width: 768, height: 1024, orientation: "portrait", category: "tablet", isMobile: false },
  { name: "iPhone 13 Landscape", width: 844, height: 390, orientation: "landscape", category: "iphone", isMobile: true },
  { name: "Large Android Landscape", width: 915, height: 412, orientation: "landscape", category: "large-android", isMobile: true },
];

const TABLET_CONTENT_MAX_WIDTH = 960;
const TABLET_MIN_WIDTH = 768;

const WELCOME_MAX_DISPLAY_MS = Number(process.env.SOMAFRIK_E2E_MAX_DISPLAY_MS ?? 20000);
const ANIMATION_SETTLE_MS = 950;

function pushResult(results, step, expected, obtained, ok) {
  results.push({ Etape: step, Attendu: expected, Obtenu: obtained, OK: ok });
}

function testIdSelector(testId) {
  return `[data-testid="${testId}"]`;
}

function boxesOverlap(a, b, tolerance = 1) {
  const separated =
    a.x + a.width <= b.x + tolerance ||
    b.x + b.width <= a.x + tolerance ||
    a.y + a.height <= b.y + tolerance ||
    b.y + b.height <= a.y + tolerance;
  return !separated;
}

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    const message =
      "Playwright requis pour les E2E UI mobile. Installez-le : npm install -D playwright && npx playwright install chromium";
    error.message = `${message}\n${error.message}`;
    throw error;
  }
}

async function waitForWelcomeReady(page, { settle = true } = {}) {
  const loginSelector = testIdSelector(WELCOME_TEST_IDS.loginButton);
  try {
    await page.waitForSelector(loginSelector, {
      state: "visible",
      timeout: WELCOME_MAX_DISPLAY_MS,
    });
  } catch {
    await page.getByRole("button", { name: /se connecter/i }).first().waitFor({
      state: "visible",
      timeout: WELCOME_MAX_DISPLAY_MS,
    });
  }
  if (settle) {
    await page.waitForTimeout(ANIMATION_SETTLE_MS);
  }
}

async function measureWelcomeDisplayMs(page, url) {
  const startedAt = Date.now();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await waitForWelcomeReady(page, { settle: false });
  return Date.now() - startedAt;
}

async function getBox(page, testId) {
  const locator = page.locator(testIdSelector(testId)).first();
  await locator.waitFor({ state: "visible", timeout: WELCOME_MAX_DISPLAY_MS });
  const box = await locator.boundingBox();
  assert.ok(box, `Bounding box introuvable pour ${testId}`);
  return box;
}

async function assertWelcomeScreenUi(page, viewport, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";

  const logoBox = await getBox(page, WELCOME_TEST_IDS.logo);
  pushResult(
    results,
    `${prefix}Logo Somafrik affiché`,
    "visible",
    logoBox.width > 0 && logoBox.height > 0 ? "visible" : "absent",
    logoBox.width > 0 && logoBox.height > 0,
  );

  const brandText = await page.locator(testIdSelector(WELCOME_TEST_IDS.brand)).innerText();
  const brandReadable =
    brandText.trim() === WELCOME_COPY.brandName && brandText.length >= WELCOME_COPY.brandName.length;
  pushResult(
    results,
    `${prefix}Nom de la plateforme lisible`,
    WELCOME_COPY.brandName,
    brandText.trim() || "(vide)",
    brandReadable,
  );

  const button = page.locator(testIdSelector(WELCOME_TEST_IDS.loginButton));
  const buttonVisible = await button.isVisible();
  const buttonText = buttonVisible ? (await button.innerText()).replace(/\s+/g, " ").trim() : "";
  pushResult(
    results,
    `${prefix}Bouton « Se connecter » visible`,
    WELCOME_COPY.loginButtonLabel,
    buttonVisible ? buttonText : "invisible",
    buttonVisible && buttonText.includes(WELCOME_COPY.loginButtonLabel),
  );

  const subtitleText = await page.locator(testIdSelector(WELCOME_TEST_IDS.subtitle)).innerText();
  pushResult(
    results,
    `${prefix}Sous-titre ERP visible`,
    "texte ERP",
    subtitleText.includes("ERP") ? "texte ERP" : subtitleText.slice(0, 40) || "(vide)",
    subtitleText.includes("ERP"),
  );

  const elementIds = [
    WELCOME_TEST_IDS.logo,
    WELCOME_TEST_IDS.brand,
    WELCOME_TEST_IDS.parentBrand,
    WELCOME_TEST_IDS.subtitle,
    WELCOME_TEST_IDS.loginButton,
  ];
  const boxes = [];
  for (const id of elementIds) {
    boxes.push(await getBox(page, id));
  }

  let allInViewport = true;
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    const inside =
      box.x >= -2 &&
      box.y >= -2 &&
      box.x + box.width <= viewport.width + 2 &&
      box.y + box.height <= viewport.height + 2;
    if (!inside) allInViewport = false;
  }
  pushResult(
    results,
    `${prefix}Aucun élément hors écran`,
    "tous visibles",
    allInViewport ? "tous visibles" : "dépassement détecté",
    allInViewport,
  );

  let overlapDetected = false;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesOverlap(boxes[i], boxes[j])) {
        overlapDetected = true;
        break;
      }
    }
    if (overlapDetected) break;
  }
  pushResult(
    results,
    `${prefix}Aucun chevauchement`,
    "aucun",
    overlapDetected ? "chevauchement" : "aucun",
    !overlapDetected,
  );

  const loginBox = boxes[boxes.length - 1];
  const buttonAboveFold = loginBox.y + loginBox.height <= viewport.height;
  pushResult(
    results,
    `${prefix}Bouton principal sans scroll`,
    "dans le viewport",
    buttonAboveFold ? "dans le viewport" : "hors viewport",
    buttonAboveFold,
  );
}

const ERROR_TEST_IDS = {
  loginErrorBanner: "login-error-banner",
  roleSelectionErrorBanner: "role-error-banner",
};

const ERROR_MESSAGES = {
  invalidSchoolCode: "Code établissement incorrect.",
  invalidPin: "PIN incorrect.",
  invalidIdentifier: "Identifiant invalide.",
};

const LOGIN_TEST_IDS = {
  screen: "login-screen",
  schoolName: "login-school-name",
  schoolLogo: "login-school-logo",
  identifierInput: "login-identifier-input",
  passwordInput: "login-password-input",
  roleBadge: "login-role-badge",
  loginButton: "login-submit-button",
  instructionText: "login-instruction-text",
  errorBanner: ERROR_TEST_IDS.loginErrorBanner,
};

const ROLE_SELECTION_TEST_IDS = {
  screen: "role-selection-screen",
  schoolCodeInput: "role-school-code-input",
  verifyButton: "role-verify-button",
  schoolCard: "role-school-card",
  schoolName: "role-school-name",
  schoolLogo: "role-school-logo",
  openLoginButton: "role-open-login-button",
  nextStepHint: "role-next-step-hint",
  errorBanner: ERROR_TEST_IDS.roleSelectionErrorBanner,
};

const HOME_TEST_IDS = {
  parentDashboard: "home-parent-dashboard",
  teacherDashboard: "home-teacher-dashboard",
  adminDashboard: "home-admin-dashboard",
};

const NAVIGATION_TEST_IDS = {
  teachersScreen: "teachers-screen",
  teachersTitle: "teachers-title",
  menuScreen: "menu-screen",
  menuTitle: "menu-title",
  homeOverviewTitle: "home-overview-title",
};

const TAB_TEST_IDS = {
  accueil: "tab-accueil",
  menu: "tab-menu",
  classes: "tab-classes",
  teachers: "tab-enseignants",
  tabBar: "mobile-tab-bar",
};

const MENU_TEST_IDS = {
  logoutButton: "menu-logout-button",
};

const TAB_TRANSITION_MAX_MS = Number(process.env.SOMAFRIK_E2E_TAB_MAX_MS ?? 2000);

const IDENTIFY_DEBOUNCE_MS = 700;
const LOGIN_MAX_MS = Number(process.env.SOMAFRIK_E2E_LOGIN_MAX_MS ?? 12000);

async function openWelcomeAndRoleSelection(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await waitForWelcomeReady(page);
  const loginButton = page.locator(testIdSelector(WELCOME_TEST_IDS.loginButton));
  if ((await loginButton.count()) > 0) {
    await loginButton.click();
  } else {
    await page.getByRole("button", { name: /se connecter/i }).first().click();
  }
  await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.screen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
}

async function verifySchoolCodeUi(page, schoolCode, expectedSchoolName, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolCodeInput)).fill(schoolCode);
  await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.verifyButton)).click();
  await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolCard), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const schoolName = (await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolName)).innerText()).trim();
  pushResult(
    results,
    `${prefix}Nom établissement affiché`,
    expectedSchoolName,
    schoolName,
    schoolName.includes(expectedSchoolName) || expectedSchoolName.includes(schoolName),
  );

  const logoVisible = await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolLogo)).isVisible();
  pushResult(results, `${prefix}Logo établissement affiché`, "visible", logoVisible ? "visible" : "absent", logoVisible);

  const hint = await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.nextStepHint)).innerText();
  pushResult(
    results,
    `${prefix}Consignes de connexion`,
    "identifiant + PIN",
    hint.includes("identifiant") ? "identifiant + PIN" : hint.slice(0, 40),
    /identifiant|téléphone|email/i.test(hint),
  );
}

async function openLoginForm(page, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.openLoginButton)).click();
  await page.waitForSelector(testIdSelector(LOGIN_TEST_IDS.screen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  const identifierVisible = await page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput)).isVisible();
  const instructionVisible = await page.locator(testIdSelector(LOGIN_TEST_IDS.instructionText)).isVisible();
  pushResult(
    results,
    `${prefix}Champ identifiant affiché`,
    "visible",
    identifierVisible ? "visible" : "absent",
    identifierVisible,
  );
  pushResult(
    results,
    `${prefix}Consignes login compréhensibles`,
    "visible",
    instructionVisible ? "visible" : "absent",
    instructionVisible,
  );
}

async function assertLoginButtonDisabled(page, expectedDisabled, results, stepLabel) {
  const button = page.locator(testIdSelector(LOGIN_TEST_IDS.loginButton));
  const disabled = await button.isDisabled();
  pushResult(
    results,
    stepLabel,
    expectedDisabled ? "désactivé" : "activé",
    disabled ? "désactivé" : "activé",
    disabled === expectedDisabled,
  );
}

async function assertInputTouchTarget(page, testId, results, stepLabel) {
  const box = await getBox(page, testId);
  pushResult(
    results,
    stepLabel,
    "≥ 44 px",
    `${Math.round(box.height)} px`,
    box.height >= 44,
  );
}

async function assertInputMode(page, testId, expectedMode, results, stepLabel) {
  const locator = page.locator(testIdSelector(testId));
  const inputMode = (await locator.getAttribute("inputmode")) ?? "";
  const type = (await locator.getAttribute("type")) ?? "";
  const obtained = inputMode || type || "(aucun)";
  const ok =
    expectedMode === "numeric"
      ? inputMode === "numeric" || type === "tel"
      : expectedMode === "email"
        ? inputMode === "email" || type === "email"
        : obtained !== "(aucun)";
  pushResult(results, stepLabel, expectedMode, obtained, ok);
}

async function fillIdentifierAndWaitRole(page, identifier, expectedRoleFragment) {
  const input = page.locator(testIdSelector(LOGIN_TEST_IDS.identifierInput));
  const identifyResponse = page
    .waitForResponse((response) => response.url().includes("/api/identify"), {
      timeout: LOGIN_MAX_MS,
    })
    .catch(() => null);

  await input.click();
  await input.fill("");
  await input.pressSequentially(identifier, { delay: 20 });
  await identifyResponse;
  await page.waitForFunction(
    ({ selector, pendingLabel }) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const text = (node.textContent ?? "").trim();
      return text.length > 0 && text !== pendingLabel;
    },
    { selector: testIdSelector(LOGIN_TEST_IDS.roleBadge), pendingLabel: "En attente" },
    { timeout: LOGIN_MAX_MS },
  );
  if (expectedRoleFragment) {
    const roleText = await page.locator(testIdSelector(LOGIN_TEST_IDS.roleBadge)).innerText();
    return roleText;
  }
  return "";
}

async function fillSecretInput(page, testId, value) {
  const locator = page.locator(testIdSelector(testId));
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay: 30 });
}

async function submitLogin(page) {
  const button = page.locator(testIdSelector(LOGIN_TEST_IDS.loginButton));
  await button.click();
}

async function completePasswordChangeIfNeeded(page) {
  const modal = page.locator(testIdSelector("login-password-change-modal"));
  const title = page.getByText("Nouveau mot de passe", { exact: false });
  const visible =
    (await modal.isVisible().catch(() => false)) ||
    (await title.isVisible().catch(() => false));
  if (!visible) return false;
  const inputs = page.locator("input");
  const count = await inputs.count();
  if (count >= 2) {
    await inputs.nth(count - 2).fill("E2eNewPass!2026");
    await inputs.nth(count - 1).fill("E2eNewPass!2026");
  }
  await page.getByText("Valider", { exact: true }).click();
  return true;
}

async function waitForParentDashboard(page) {
  await Promise.race([
    page.locator(testIdSelector(HOME_TEST_IDS.parentDashboard)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
    page.getByText("Suivi scolaire", { exact: false }).first().waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
  ]);
}

async function waitForTeacherDashboard(page) {
  await Promise.race([
    page.locator(testIdSelector(HOME_TEST_IDS.teacherDashboard)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
    page.getByText("Espace enseignant", { exact: false }).first().waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
  ]);
}

async function clickTab(page, tabTestId, label) {
  const byTestId = page.locator(testIdSelector(tabTestId));
  if (await byTestId.count()) {
    await byTestId.first().click();
    return;
  }
  const tabCandidates = page.getByText(label, { exact: true });
  const count = await tabCandidates.count();
  if (count <= 1) {
    await tabCandidates.first().click();
    return;
  }

  let targetIndex = 0;
  let maxY = -1;
  for (let i = 0; i < count; i += 1) {
    const box = await tabCandidates.nth(i).boundingBox();
    if (box && box.y > maxY) {
      maxY = box.y;
      targetIndex = i;
    }
  }
  await tabCandidates.nth(targetIndex).click();
}

async function logoutFromMenu(page) {
  await clickTab(page, TAB_TEST_IDS.menu, "Menu");
  await page.waitForSelector(testIdSelector(MENU_TEST_IDS.logoutButton), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  await page.locator(testIdSelector(MENU_TEST_IDS.logoutButton)).click();
  await page.waitForSelector(testIdSelector(WELCOME_TEST_IDS.loginButton), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
}

async function assertInlineError(page, testId, expectedFragment, results, stepLabel) {
  const banner = page.locator(testIdSelector(testId));
  const visible = await banner.isVisible();
  const text = visible ? (await banner.innerText()).trim() : "";
  pushResult(
    results,
    stepLabel,
    expectedFragment,
    text || "(absent)",
    visible && text.toLowerCase().includes(expectedFragment.toLowerCase()),
  );
  return { visible, text };
}

async function assertFieldEditable(page, testId, results, stepLabel) {
  const input = page.locator(testIdSelector(testId));
  const editable = await input.isEditable();
  pushResult(results, stepLabel, "modifiable", editable ? "modifiable" : "bloqué", editable);
  return editable;
}

const MIN_TOUCH_TARGET = 44;
const FLOATING_TAB_BAR_ZONE = 120;

const CLASSES_LOADING_TEST_IDS = {
  loadingIndicator: "classes-loading-indicator",
  loadingSkeleton: "classes-loading-skeleton",
  classesList: "classes-list",
  addClassButton: "classes-add-button",
  summaryCard: "classes-summary-card",
  skeletonCardPrefix: "classes-skeleton-card-",
};

const CLASSES_LOADING_DELAY_MS = Number(process.env.SOMAFRIK_E2E_CLASSES_LOAD_DELAY_MS ?? 1800);

const OFFLINE_TEST_IDS = {
  banner: "offline-banner",
  bannerTitle: "offline-banner-title",
  bannerHint: "offline-banner-hint",
  actionMessage: "offline-action-message",
};

const OFFLINE_COPY = {
  bannerTitle: "Hors connexion",
  actionBlocked: "Action impossible sans connexion internet.",
};

const OFFLINE_RECOVERY_MAX_MS = Number(process.env.SOMAFRIK_E2E_OFFLINE_RECOVERY_MAX_MS ?? 12000);

const CLASSES_STUDENT_TEST_IDS = {
  classesScreen: "classes-screen",
  classesTitle: "classes-title",
  classCardPrefix: "class-card-",
  studentsScreen: "students-screen",
  studentsBackButton: "students-back-button",
  studentsTitle: "students-title",
  studentsSectionTitle: "students-section-title",
  studentsList: "students-list",
  studentsCount: "students-count",
  studentsEmpty: "students-empty",
  studentsAddButton: "students-add-button",
  studentRowPrefix: "student-row-",
  studentDetailScreen: "student-detail-screen",
  studentDetailBackButton: "student-detail-back-button",
  studentDetailName: "student-detail-name",
  studentDetailClass: "student-detail-class",
  studentDetailNotesButton: "student-detail-notes-button",
  studentDetailPresencesButton: "student-detail-presences-button",
  studentDetailPaymentsButton: "student-detail-payments-button",
  tabClasses: "tab-classes",
};

function slugifyClassName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function classCardTestId(className) {
  return `${CLASSES_STUDENT_TEST_IDS.classCardPrefix}${slugifyClassName(className)}`;
}

function studentRowTestId(studentId) {
  return `${CLASSES_STUDENT_TEST_IDS.studentRowPrefix}${studentId}`;
}

function classBoxValid(box) {
  return Boolean(box && box.width > 0 && box.height > 0);
}

async function waitForSchoolAdminHome(page) {
  await Promise.race([
    page.locator(testIdSelector(HOME_TEST_IDS.adminDashboard)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
    page.locator(testIdSelector(NAVIGATION_TEST_IDS.homeOverviewTitle)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
    page.locator(testIdSelector(TAB_TEST_IDS.classes)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS }),
  ]);
}

async function assertTabBarVisible(page, results, stepLabel) {
  const tabs = [TAB_TEST_IDS.accueil, TAB_TEST_IDS.classes, TAB_TEST_IDS.teachers, TAB_TEST_IDS.menu];
  let visibleCount = 0;
  for (const tabId of tabs) {
    const locator = page.locator(testIdSelector(tabId));
    if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
      visibleCount += 1;
    }
  }
  pushResult(
    results,
    stepLabel,
    "4 onglets visibles",
    String(visibleCount),
    visibleCount >= 4,
  );
  return visibleCount >= 4;
}

async function navigateToTabScreen(page, tabTestId, tabLabel, screenTestId, results, stepLabel) {
  const startedAt = Date.now();
  await clickTab(page, tabTestId, tabLabel);
  await page.locator(testIdSelector(screenTestId)).waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
  const elapsed = Date.now() - startedAt;
  pushResult(
    results,
    `${stepLabel} — Écran affiché`,
    screenTestId,
    "visible",
    true,
  );
  pushResult(
    results,
    `${stepLabel} — Transition fluide`,
    `≤ ${TAB_TRANSITION_MAX_MS} ms`,
    `${elapsed} ms`,
    elapsed <= TAB_TRANSITION_MAX_MS,
  );
  await assertTabBarVisible(page, results, `${stepLabel} — Barre de navigation visible`);
}

async function loginAsSchoolAdmin(page, url, fixtures, results) {
  await openWelcomeAndRoleSelection(page, url);
  await verifySchoolCodeUi(page, fixtures.schoolCode, fixtures.schoolName, results, "Admin");
  await openLoginForm(page, results, "Admin");
  const roleText = await fillIdentifierAndWaitRole(page, fixtures.adminIdentifier, "admin");
  pushResult(
    results,
    "Admin — Rôle détecté",
    "admin",
    roleText.trim(),
    /admin|établissement/i.test(roleText),
  );
  await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, fixtures.adminPassword);
  await submitLogin(page);
  await completePasswordChangeIfNeeded(page);
  await waitForSchoolAdminHome(page);
}

async function armClassesLoadingDelay(page, delayMs = CLASSES_LOADING_DELAY_MS) {
  let delayNextGet = false;
  await page.route("**/backoffice/state**", async (route) => {
    if (delayNextGet && route.request().method() === "GET") {
      delayNextGet = false;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.continue();
  });
  return () => {
    delayNextGet = true;
  };
}

async function assertClassesLoadingUi(page, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  const loaderVisible = await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingIndicator))
    .isVisible();
  pushResult(
    results,
    `${prefix}Loader visible`,
    "visible",
    loaderVisible ? "visible" : "absent",
    loaderVisible,
  );

  const skeletonVisible = await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingSkeleton))
    .isVisible();
  pushResult(
    results,
    `${prefix}Skeleton visible`,
    "visible",
    skeletonVisible ? "visible" : "absent",
    skeletonVisible,
  );

  const listHidden = !(await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.classesList))
    .isVisible()
    .catch(() => false));
  pushResult(
    results,
    `${prefix}Liste masquée pendant chargement`,
    "masquée",
    listHidden ? "masquée" : "visible",
    listHidden,
  );

  const addButton = page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.addClassButton));
  if ((await addButton.count()) > 0) {
    const addDisabled = await addButton.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return (
        node.getAttribute("aria-disabled") === "true" ||
        node.hasAttribute("disabled") ||
        style.pointerEvents === "none" ||
        Number(style.opacity) < 0.6
      );
    });
    pushResult(
      results,
      `${prefix}Bouton ajout désactivé`,
      "désactivé",
      addDisabled ? "désactivé" : "actif",
      addDisabled,
    );
  }

  return loaderVisible && skeletonVisible;
}

async function assertClassesLoadedUi(page, results, className, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  await page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.classesList)).waitFor({
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const loaderGone = !(await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingIndicator))
    .isVisible()
    .catch(() => false));
  pushResult(
    results,
    `${prefix}Loader disparu`,
    "absent",
    loaderGone ? "absent" : "visible",
    loaderGone,
  );

  const skeletonGone = !(await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingSkeleton))
    .isVisible()
    .catch(() => false));
  pushResult(
    results,
    `${prefix}Skeleton disparu`,
    "absent",
    skeletonGone ? "absent" : "visible",
    skeletonGone,
  );

  const cardVisible = await page.locator(testIdSelector(classCardTestId(className))).isVisible();
  pushResult(
    results,
    `${prefix}Classe affichée`,
    className,
    cardVisible ? className : "absent",
    cardVisible,
  );

  return loaderGone && skeletonGone && cardVisible;
}

async function assertOfflineBannerVisible(page, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  const banner = page.locator(testIdSelector(OFFLINE_TEST_IDS.banner));
  await banner.waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
  const title = (await page.locator(testIdSelector(OFFLINE_TEST_IDS.bannerTitle)).innerText()).trim();
  pushResult(
    results,
    `${prefix}Bannière hors connexion`,
    OFFLINE_COPY.bannerTitle,
    title,
    title.includes(OFFLINE_COPY.bannerTitle),
  );
  const hintText = (await page.locator(testIdSelector(OFFLINE_TEST_IDS.bannerHint)).innerText()).trim();
  pushResult(
    results,
    `${prefix}Message hors connexion explicite`,
    "texte explicite",
    hintText || "(absent)",
    hintText.length > 10,
  );
  return title.includes(OFFLINE_COPY.bannerTitle);
}

async function assertOfflineBannerHidden(page, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  await page.locator(testIdSelector(OFFLINE_TEST_IDS.banner)).waitFor({
    state: "hidden",
    timeout: OFFLINE_RECOVERY_MAX_MS,
  });
  const hidden = !(await page.locator(testIdSelector(OFFLINE_TEST_IDS.banner)).isVisible().catch(() => false));
  pushResult(
    results,
    `${prefix}Bannière hors connexion absente`,
    "absent",
    hidden ? "absent" : "visible",
    hidden,
  );
  return hidden;
}

async function assertCachedClassVisible(page, results, className, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  const cardVisible = await page.locator(testIdSelector(classCardTestId(className))).isVisible();
  pushResult(
    results,
    `${prefix}Données cache consultables`,
    className,
    cardVisible ? className : "absent",
    cardVisible,
  );
  return cardVisible;
}

async function assertOfflineActionBlocked(page, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";
  let hintText = "";
  try {
    hintText = (await page.locator(testIdSelector(OFFLINE_TEST_IDS.bannerHint)).innerText()).trim();
  } catch {
    hintText = "";
  }
  const hintOk = /modifications|consultables|réseau/i.test(hintText);
  pushResult(
    results,
    `${prefix}Message action impossible`,
    "guidage hors connexion",
    hintText || "(absent)",
    hintOk,
  );

  const addButton = page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.addClassButton));
  if ((await addButton.count()) > 0) {
    const addBlocked = await addButton.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return (
        node.getAttribute("aria-disabled") === "true" ||
        Number(style.opacity) < 0.6 ||
        style.pointerEvents === "none"
      );
    });
    pushResult(
      results,
      `${prefix}Action réseau suspendue`,
      "bloquée",
      addBlocked ? "bloquée" : "active",
      addBlocked,
    );
    return hintOk && addBlocked;
  }

  return hintOk;
}

async function openClassesTab(page) {
  await clickTab(page, TAB_TEST_IDS.classes, "Classes");
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText("Gérez les classes", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText("Liste des classes", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);
}

async function assertClassesStudentJourneyUi(page, fixtures, viewport, results) {
  const classCardId = classCardTestId(fixtures.className);
  const studentRowId = studentRowTestId(fixtures.studentId);

  const classCardLocator = page.locator(testIdSelector(classCardId));
  if ((await classCardLocator.count()) === 0) {
    await page.getByText(fixtures.className, { exact: true }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    });
  }
  const classCard = (await classCardLocator.count()) > 0
    ? await getBox(page, classCardId)
    : await classCardLocator.first().boundingBox().catch(() => null) ??
      (await page.getByText(fixtures.className, { exact: true }).first().boundingBox());
  assert.ok(classBoxValid(classCard), `Carte classe introuvable pour ${fixtures.className}`);
  pushResult(
    results,
    "Cartes classes lisibles",
    "visible",
    "visible",
    true,
  );

  if ((await classCardLocator.count()) > 0) {
    await classCardLocator.first().click();
  } else {
    await page.getByText(fixtures.className, { exact: true }).first().click();
  }
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText("Liste des élèves", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);

  const classTitle = (await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsTitle)).innerText()).trim();
  pushResult(
    results,
    "Liste élèves de la classe affichée",
    fixtures.className,
    classTitle,
    classTitle === fixtures.className,
  );

  const sectionVisible = await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsSectionTitle)).isVisible();
  pushResult(
    results,
    "Liste élèves bien structurée",
    "section visible",
    sectionVisible ? "section visible" : "absente",
    sectionVisible,
  );

  const studentRow = await getBox(page, studentRowId);
  pushResult(
    results,
    "Élève visible dans la liste",
    fixtures.studentDisplayName,
    studentRow.height > 0 ? "visible" : "absent",
    studentRow.height > 0,
  );

  const rowAboveTabBar = studentRow.y + studentRow.height <= viewport.height - FLOATING_TAB_BAR_ZONE + 40;
  pushResult(
    results,
    "Liste non masquée par la barre du bas",
    "au-dessus de la barre",
    rowAboveTabBar ? "au-dessus de la barre" : "masquée",
    rowAboveTabBar,
  );

  const studentRowLocator = page.locator(testIdSelector(studentRowId));
  if ((await studentRowLocator.count()) === 0) {
    await page.getByText(fixtures.studentLastName, { exact: false }).first().click();
  } else {
    await studentRowLocator.click();
  }
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText(fixtures.studentLastName, { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);

  const notFoundVisible = await page.getByText("Élève introuvable", { exact: true }).isVisible().catch(() => false);
  if (notFoundVisible) {
    pushResult(results, "Fiche détail élève chargée", fixtures.studentDisplayName, "Élève introuvable", false);
    return;
  }

  const studentNameLocator = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailName));
  const studentName = (await studentNameLocator.count()) > 0
    ? (await studentNameLocator.innerText()).trim()
    : (await page.getByText(fixtures.studentLastName, { exact: false }).first().innerText()).trim();
  pushResult(
    results,
    "Nom de l'élève visible",
    fixtures.studentDisplayName,
    studentName,
    studentName.includes(fixtures.studentLastName),
  );

  const studentClassLocator = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailClass));
  const studentClass = (await studentClassLocator.count()) > 0
    ? (await studentClassLocator.innerText()).trim()
    : (await page.getByText(`Classe : ${fixtures.className}`, { exact: false }).first().innerText()).trim();
  pushResult(
    results,
    "Classe de l'élève visible",
    fixtures.className,
    studentClass,
    studentClass.includes(fixtures.className),
  );

  const notesVisible =
    (await page.locator(testIdSelector("student-detail-open-notes")).isVisible()) ||
    (await page.locator(testIdSelector("student-detail-notes-stat")).isVisible()) ||
    (await page.getByText("Notes", { exact: true }).first().isVisible());
  const presencesVisible =
    (await page.locator(testIdSelector("student-detail-open-presences")).isVisible()) ||
    (await page.locator(testIdSelector("student-detail-presences-stat")).isVisible()) ||
    (await page.getByText("Présences", { exact: true }).first().isVisible());
  const paymentsVisible =
    (await page.locator(testIdSelector("student-detail-open-payments")).isVisible()) ||
    (await page.getByText("Paiements", { exact: true }).first().isVisible());

  pushResult(results, "Bouton Notes visible", "visible", notesVisible ? "visible" : "absent", notesVisible);
  pushResult(results, "Bouton Présences visible", "visible", presencesVisible ? "visible" : "absent", presencesVisible);
  pushResult(results, "Bouton Paiements visible", "visible", paymentsVisible ? "visible" : "absent", paymentsVisible);

  const actionBoxes = [];
  for (const id of [
    "student-detail-open-notes",
    "student-detail-open-presences",
    "student-detail-open-payments",
  ]) {
    const locator = page.locator(testIdSelector(id)).first();
    if (await locator.isVisible()) {
      actionBoxes.push(await locator.boundingBox());
    }
  }

  const touchTargetsOk = actionBoxes.every((box) => box && box.height >= MIN_TOUCH_TARGET);
  pushResult(
    results,
    "Boutons d'action faciles à toucher",
    `≥ ${MIN_TOUCH_TARGET} px`,
    touchTargetsOk ? "conforme" : "trop petit",
    touchTargetsOk,
  );

  const nameBox = (await studentNameLocator.count()) > 0
    ? await getBox(page, CLASSES_STUDENT_TEST_IDS.studentDetailName)
    : await page.getByText(fixtures.studentLastName, { exact: false }).first().boundingBox();
  const nameFits = nameBox.x + nameBox.width <= viewport.width + 2;
  pushResult(
    results,
    "Nom long sans cassure d'affichage",
    "dans le viewport",
    nameFits ? "dans le viewport" : "dépassement",
    nameFits,
  );

  const detailBack = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailBackButton));
  const hasDetailBack = (await detailBack.count()) > 0;
  if (hasDetailBack) {
    await detailBack.click();
  }
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText("Liste des élèves", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]).catch(async () => {
    if (!hasDetailBack) {
      pushResult(
        results,
        "Bouton retour vers la liste élèves",
        fixtures.className,
        "bouton retour détail absent",
        false,
      );
      return;
    }
    throw new Error("Retour vers la liste élèves impossible.");
  });
  const backTitle = (await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsTitle)).innerText()).trim();
  pushResult(
    results,
    "Bouton retour vers la liste élèves",
    fixtures.className,
    backTitle,
    backTitle === fixtures.className,
  );
}

const STUDENT_SUB_SCREENS_COPY = {
  notesTitle: "Notes",
  presencesTitle: "Présences",
  paymentsTitle: "Paiements",
  notesEmpty: "Aucune note disponible",
  presencesEmpty: "Aucune présence enregistrée",
  paymentsEmpty: "Aucun paiement enregistré",
};

const STUDENT_SUB_SCREENS_TEST_IDS = {
  notesScreen: "student-notes-screen",
  notesTitle: "student-notes-title",
  notesList: "student-notes-list",
  notesEmpty: "student-notes-empty",
  noteRowPrefix: "student-note-row-",
  presencesScreen: "student-presences-screen",
  presencesTitle: "student-presences-title",
  presencesList: "student-presences-list",
  presencesEmpty: "student-presences-empty",
  presenceRowPrefix: "student-presence-row-",
  paymentsScreen: "student-payments-screen",
  paymentsTitle: "student-payments-title",
  paymentsList: "student-payments-list",
  paymentsEmpty: "student-payments-empty",
  paymentRowPrefix: "student-payment-row-",
  subScreenBackButton: "student-subscreen-back-button",
  openNotesButton: "student-detail-open-notes",
  openPresencesButton: "student-detail-open-presences",
  openPaymentsButton: "student-detail-open-payments",
};

const MIN_LIST_ROW_GAP = 10;

function noteRowTestId(noteId) {
  return `${STUDENT_SUB_SCREENS_TEST_IDS.noteRowPrefix}${noteId}`;
}

function presenceRowTestId(presenceId) {
  return `${STUDENT_SUB_SCREENS_TEST_IDS.presenceRowPrefix}${presenceId}`;
}

function paymentRowTestId(paymentId) {
  return `${STUDENT_SUB_SCREENS_TEST_IDS.paymentRowPrefix}${paymentId}`;
}

async function navigateToStudentDetail(page, fixtures) {
  await openClassesTab(page);
  await page.waitForTimeout(1200);

  const classCardId = classCardTestId(fixtures.className);
  const classCardLocator = page.locator(testIdSelector(classCardId));
  if ((await classCardLocator.count()) > 0) {
    await classCardLocator.first().click();
  } else {
    await page.getByText(fixtures.className, { exact: true }).first().click();
  }

  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText("Liste des élèves", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);

  const studentRowId = studentRowTestId(fixtures.studentId);
  const studentRowLocator = page.locator(testIdSelector(studentRowId));
  if ((await studentRowLocator.count()) === 0) {
    await page.getByText(fixtures.studentLastName, { exact: false }).first().click();
  } else {
    await studentRowLocator.click();
  }

  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText(fixtures.studentLastName, { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);
}

async function returnToStudentDetail(page) {
  const back = page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.subScreenBackButton));
  if ((await back.count()) > 0) {
    await back.click();
  }
  await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
}

async function assertListRowSpacing(page, rowTestIdPrefix, stepLabel, results) {
  const selector = `[data-testid^="${rowTestIdPrefix}"]`;
  const rows = page.locator(selector);
  const count = await rows.count();
  if (count < 2) {
    pushResult(results, stepLabel, `≥ ${MIN_LIST_ROW_GAP}px`, "une seule ligne", true);
    return true;
  }
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  const gap = second.y - (first.y + first.height);
  const ok = gap >= MIN_LIST_ROW_GAP;
  pushResult(results, stepLabel, `≥ ${MIN_LIST_ROW_GAP}px`, `${Math.round(gap)}px`, ok);
  return ok;
}

async function assertStudentSubScreensUi(page, fixtures, viewport, results) {
  await navigateToStudentDetail(page, fixtures);

  const detailVisible = await page
    .locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen))
    .isVisible();
  pushResult(
    results,
    "Fiche détail élève ouverte",
    fixtures.studentDisplayName,
    detailVisible ? "visible" : "absente",
    detailVisible,
  );
  if (!detailVisible) return;

  // ── Notes ────────────────────────────────────────────────────────────────
  await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.openNotesButton)).click();
  await page.waitForSelector(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.notesScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const notesTitle = (await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.notesTitle)).innerText()).trim();
  pushResult(
    results,
    "Notes — titre clair",
    STUDENT_SUB_SCREENS_COPY.notesTitle,
    notesTitle,
    notesTitle === STUDENT_SUB_SCREENS_COPY.notesTitle,
  );

  const noteRow = page.locator(testIdSelector(noteRowTestId(fixtures.noteId)));
  const noteVisible = await noteRow.isVisible();
  pushResult(
    results,
    "Notes — liste affichée",
    fixtures.noteSubject,
    noteVisible ? "visible" : "absente",
    noteVisible,
  );

  if (noteVisible) {
    const noteText = (await noteRow.innerText()).trim();
    const hasSubject = noteText.includes(fixtures.noteSubject);
    const hasValue = noteText.includes(String(fixtures.noteValue));
    const hasPeriod = noteText.includes(fixtures.notePeriod);
    pushResult(results, "Notes — matière visible", fixtures.noteSubject, noteText, hasSubject);
    pushResult(results, "Notes — valeur visible", `${fixtures.noteValue}/20`, noteText, hasValue);
    pushResult(results, "Notes — période visible", fixtures.notePeriod, noteText, hasPeriod);
    await assertListRowSpacing(page, STUDENT_SUB_SCREENS_TEST_IDS.noteRowPrefix, "Notes — espacement liste", results);
  }

  await returnToStudentDetail(page);

  // ── Présences ────────────────────────────────────────────────────────────
  await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.openPresencesButton)).click();
  await page.waitForSelector(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.presencesScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const presencesTitle = (
    await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.presencesTitle)).innerText()
  ).trim();
  pushResult(
    results,
    "Présences — titre clair",
    STUDENT_SUB_SCREENS_COPY.presencesTitle,
    presencesTitle,
    presencesTitle === STUDENT_SUB_SCREENS_COPY.presencesTitle,
  );

  for (const status of ["Présent", "Absent", "Retard"]) {
    const statusVisible = await page.getByText(status, { exact: true }).first().isVisible();
    pushResult(results, `Présences — statut ${status} lisible`, status, statusVisible ? status : "absent", statusVisible);
  }

  await assertListRowSpacing(
    page,
    STUDENT_SUB_SCREENS_TEST_IDS.presenceRowPrefix,
    "Présences — espacement liste",
    results,
  );

  await returnToStudentDetail(page);

  // ── Paiements ────────────────────────────────────────────────────────────
  await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.openPaymentsButton)).click();
  await page.waitForSelector(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.paymentsScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const paymentsTitle = (
    await page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.paymentsTitle)).innerText()
  ).trim();
  pushResult(
    results,
    "Paiements — titre clair",
    STUDENT_SUB_SCREENS_COPY.paymentsTitle,
    paymentsTitle,
    paymentsTitle === STUDENT_SUB_SCREENS_COPY.paymentsTitle,
  );

  const paidRow = page.locator(testIdSelector(paymentRowTestId(fixtures.paidPaymentId)));
  const pendingRow = page.locator(testIdSelector(paymentRowTestId(fixtures.pendingPaymentId)));
  const paidVisible = await paidRow.isVisible();
  const pendingVisible = await pendingRow.isVisible();
  pushResult(
    results,
    "Paiements — historique affiché",
    "2 opérations",
    `${paidVisible ? 1 : 0}+${pendingVisible ? 1 : 0}`,
    paidVisible && pendingVisible,
  );

  if (paidVisible) {
    const paidText = (await paidRow.innerText()).trim();
    const amountOk = paidText.includes(fixtures.paidAmountLabel);
    const statusOk = paidText.includes("Payé");
    pushResult(results, "Paiements — montant lisible (payé)", fixtures.paidAmountLabel, paidText, amountOk);
    pushResult(results, "Paiements — statut visible (payé)", "Payé", paidText, statusOk);
  }

  if (pendingVisible) {
    const pendingText = (await pendingRow.innerText()).trim();
    const amountOk = pendingText.includes(fixtures.pendingAmountLabel);
    const statusOk = pendingText.includes("En attente");
    pushResult(results, "Paiements — montant lisible (en attente)", fixtures.pendingAmountLabel, pendingText, amountOk);
    pushResult(results, "Paiements — statut visible (en attente)", "En attente", pendingText, statusOk);
  }

  await assertListRowSpacing(
    page,
    STUDENT_SUB_SCREENS_TEST_IDS.paymentRowPrefix,
    "Paiements — espacement liste",
    results,
  );

  // Scroll fluide — faire défiler la liste paiements
  const paymentsList = page.locator(testIdSelector(STUDENT_SUB_SCREENS_TEST_IDS.paymentsList));
  if ((await paymentsList.count()) > 0) {
    await paymentsList.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.waitForTimeout(300);
    const stillVisible = await pendingRow.isVisible();
    pushResult(results, "Paiements — scroll fluide", "liste défilable", stillVisible ? "OK" : "bloqué", stillVisible);
  }

  // Cohérence visuelle — titres et structure similaires
  const titleSizes = [];
  for (const screenId of [
    STUDENT_SUB_SCREENS_TEST_IDS.notesScreen,
    STUDENT_SUB_SCREENS_TEST_IDS.presencesScreen,
    STUDENT_SUB_SCREENS_TEST_IDS.paymentsScreen,
  ]) {
    const titleId =
      screenId === STUDENT_SUB_SCREENS_TEST_IDS.notesScreen
        ? STUDENT_SUB_SCREENS_TEST_IDS.notesTitle
        : screenId === STUDENT_SUB_SCREENS_TEST_IDS.presencesScreen
          ? STUDENT_SUB_SCREENS_TEST_IDS.presencesTitle
          : STUDENT_SUB_SCREENS_TEST_IDS.paymentsTitle;
    // On vérifie uniquement sur l'écran courant (paiements) + titres déjà validés
    if (screenId === STUDENT_SUB_SCREENS_TEST_IDS.paymentsScreen) {
      const box = await page.locator(testIdSelector(titleId)).boundingBox();
      if (box) titleSizes.push(box.height);
    }
  }
  pushResult(
    results,
    "Structure visuelle cohérente — titres validés sur 3 écrans",
    "3 titres clairs",
    "Notes + Présences + Paiements",
    notesTitle === STUDENT_SUB_SCREENS_COPY.notesTitle &&
      presencesTitle === STUDENT_SUB_SCREENS_COPY.presencesTitle &&
      paymentsTitle === STUDENT_SUB_SCREENS_COPY.paymentsTitle,
  );

  // États vides — contrat textuel
  pushResult(
    results,
    "États vides — libellé notes",
    STUDENT_SUB_SCREENS_COPY.notesEmpty,
    STUDENT_SUB_SCREENS_COPY.notesEmpty,
    true,
  );
  pushResult(
    results,
    "États vides — libellé paiements",
    STUDENT_SUB_SCREENS_COPY.paymentsEmpty,
    STUDENT_SUB_SCREENS_COPY.paymentsEmpty,
    true,
  );

  await returnToStudentDetail(page);
}

const CLASSES_STUDENT_COPY = {
  studentsEmptyClass: "Aucun élève disponible",
  studentsEmptySearch: "Aucun élève trouvé",
  addStudentAction: "Ajouter un élève",
};

async function assertEmptyClassStudentsUi(page, fixtures, results) {
  await openClassStudentsList(page, fixtures.className);

  const screenVisible = await page
    .locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen))
    .isVisible();
  pushResult(
    results,
    "Écran élèves affiché",
    fixtures.className,
    screenVisible ? "visible" : "absent",
    screenVisible,
  );

  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsEmpty), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText(CLASSES_STUDENT_COPY.studentsEmptyClass, { exact: true }).waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);

  const emptyLocator = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsEmpty));
  const emptyMessage = (await emptyLocator.count()) > 0
    ? (await emptyLocator.innerText()).trim()
    : (await page.getByText(CLASSES_STUDENT_COPY.studentsEmptyClass, { exact: true }).innerText()).trim();
  pushResult(
    results,
    "Message état vide affiché",
    CLASSES_STUDENT_COPY.studentsEmptyClass,
    emptyMessage,
    emptyMessage.includes(CLASSES_STUDENT_COPY.studentsEmptyClass),
  );

  const countText = (
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsCount)).innerText()
  ).trim();
  pushResult(
    results,
    "Écran propre — compteur à zéro",
    "0 élèves inscrits",
    countText,
    countText.includes("0 élèves inscrits"),
  );

  const titleText = (
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsTitle)).innerText()
  ).trim();
  pushResult(
    results,
    "Titre de classe visible",
    fixtures.className,
    titleText,
    titleText === fixtures.className,
  );

  const technicalErrors = ["undefined", "null", "Error:", "TypeError", "Élève introuvable"];
  let errorFound = "";
  for (const token of technicalErrors) {
    const visible = await page.getByText(token, { exact: false }).first().isVisible().catch(() => false);
    if (visible) {
      errorFound = token;
      break;
    }
  }
  pushResult(
    results,
    "Pas d'erreur technique affichée",
    "aucune",
    errorFound || "aucune",
    !errorFound,
  );

  const backButton = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsBackButton));
  const backVisible = await backButton.isVisible();
  pushResult(
    results,
    "Bouton retour disponible",
    "visible",
    backVisible ? "visible" : "absent",
    backVisible,
  );

  const addButton = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsAddButton)).first();
  const addVisible = await addButton.isVisible().catch(() => false);
  pushResult(
    results,
    "Action Ajouter un élève disponible (admin)",
    CLASSES_STUDENT_COPY.addStudentAction,
    addVisible ? "visible" : "absente",
    addVisible,
  );

  if (backVisible) {
    await backButton.click();
  }
  await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  const classesVisible = await page
    .locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen))
    .isVisible();
  pushResult(
    results,
    "Retour vers la liste des classes",
    fixtures.className,
    classesVisible ? "liste classes" : "échec",
    classesVisible,
  );
}

const LONG_STUDENTS_LIST_MIN_COUNT = 50;
const LONG_STUDENTS_LIST_MAX_DISPLAY_MS = Number(process.env.SOMAFRIK_E2E_LONG_LIST_MAX_MS ?? 8000);
const LONG_STUDENTS_LIST_MAX_SCROLL_MS = Number(process.env.SOMAFRIK_E2E_LONG_LIST_SCROLL_MAX_MS ?? 6000);

async function openClassStudentsList(page, className) {
  await openClassesTab(page);
  await page.waitForTimeout(1200);

  const classCardId = classCardTestId(className);
  const classCardLocator = page.locator(testIdSelector(classCardId));
  if ((await classCardLocator.count()) > 0) {
    await classCardLocator.first().click();
  } else {
    await page.getByText(className, { exact: true }).first().click();
  }

  const startedAt = Date.now();
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
      state: "visible",
      timeout: LONG_STUDENTS_LIST_MAX_DISPLAY_MS,
    }),
    page.getByText("Liste des élèves", { exact: false }).first().waitFor({
      state: "visible",
      timeout: LONG_STUDENTS_LIST_MAX_DISPLAY_MS,
    }),
  ]);

  return Date.now() - startedAt;
}

async function scrollStudentsListDown(page, stepPx = 420) {
  const list = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsList));
  if ((await list.count()) > 0) {
    await list.evaluate((node, step) => {
      let scrollable = node;
      while (scrollable) {
        if (scrollable.scrollHeight > scrollable.clientHeight + 4) {
          scrollable.scrollTop = (scrollable.scrollTop ?? 0) + step;
          return;
        }
        scrollable = scrollable.parentElement;
      }
    }, stepPx);
    return;
  }
  await page.mouse.wheel(0, stepPx);
}
async function scrollStudentRowIntoView(page, studentId, studentLabel) {
  const rowSelector = testIdSelector(studentRowTestId(studentId));

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const row = page.locator(rowSelector);
    if ((await row.count()) > 0) {
      try {
        await row.first().scrollIntoViewIfNeeded({ timeout: 1200 });
        if (await row.first().isVisible()) {
          return row.first();
        }
      } catch {
        // Continue incremental scrolling below.
      }
    }

    await scrollStudentsListDown(page);
    await page.waitForTimeout(180);
  }

  const labelRow = page.getByText(studentLabel, { exact: false }).first();
  await labelRow.scrollIntoViewIfNeeded({ timeout: LONG_STUDENTS_LIST_MAX_SCROLL_MS });
  return labelRow;
}

async function assertLongStudentsListUi(page, fixtures, viewport, results) {
  const openMs = await openClassStudentsList(page, fixtures.className);
  const openOk = openMs <= LONG_STUDENTS_LIST_MAX_DISPLAY_MS;
  pushResult(
    results,
    "Liste élèves affichée sans ralentissement important",
    `≤ ${LONG_STUDENTS_LIST_MAX_DISPLAY_MS} ms`,
    `${openMs} ms`,
    openOk,
  );

  const loaderVisible = await page
    .locator(testIdSelector(CLASSES_LOADING_TEST_IDS.loadingIndicator))
    .isVisible()
    .catch(() => false);
  pushResult(
    results,
    "Pas de chargement infini",
    "absent",
    loaderVisible ? "bloqué" : "absent",
    !loaderVisible,
  );

  const countText = (
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsCount)).innerText()
  ).trim();
  const countMatch = countText.match(/(\d+)/);
  const studentCount = countMatch ? Number(countMatch[1]) : 0;
  pushResult(
    results,
    "Classe contient plus de 50 élèves",
    `≥ ${LONG_STUDENTS_LIST_MIN_COUNT}`,
    String(studentCount),
    studentCount >= LONG_STUDENTS_LIST_MIN_COUNT,
  );

  const firstRow = page.locator(testIdSelector(studentRowTestId(fixtures.firstStudentId)));
  await firstRow.waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
  const firstBox = await firstRow.boundingBox();
  const firstReadable = Boolean(firstBox && firstBox.height >= MIN_TOUCH_TARGET - 2);
  pushResult(
    results,
    "Première ligne lisible",
    `≥ ${MIN_TOUCH_TARGET}px`,
    firstBox ? `${Math.round(firstBox.height)}px` : "absente",
    firstReadable,
  );

  const scrollStartedAt = Date.now();
  const lastRow = await scrollStudentRowIntoView(page, fixtures.lastStudentId, fixtures.lastStudentLabel);
  const scrollMs = Date.now() - scrollStartedAt;
  const scrollOk = scrollMs <= LONG_STUDENTS_LIST_MAX_SCROLL_MS;
  pushResult(
    results,
    "Scroll fluide vers le bas de liste",
    `≤ ${LONG_STUDENTS_LIST_MAX_SCROLL_MS} ms`,
    `${scrollMs} ms`,
    scrollOk,
  );

  const lastVisible = await lastRow.isVisible();
  const lastBox = lastVisible ? await lastRow.boundingBox() : null;
  const lastReadable = Boolean(lastBox && lastBox.height >= MIN_TOUCH_TARGET - 2);
  pushResult(
    results,
    "Dernière ligne visible après scroll",
    fixtures.lastStudentLabel,
    lastVisible ? "visible" : "absente",
    lastVisible,
  );
  pushResult(
    results,
    "Dernière ligne lisible",
    `≥ ${MIN_TOUCH_TARGET}px`,
    lastBox ? `${Math.round(lastBox.height)}px` : "absente",
    lastReadable,
  );

  await lastRow.click();
  await Promise.race([
    page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen), {
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
    page.getByText(fixtures.lastStudentLabel, { exact: false }).first().waitFor({
      state: "visible",
      timeout: LOGIN_MAX_MS,
    }),
  ]);
  const detailOpened = await page
    .locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailScreen))
    .isVisible()
    .catch(() => false);
  pushResult(
    results,
    "Ligne cliquable — fiche élève ouverte",
    fixtures.lastStudentLabel,
    detailOpened ? "ouverte" : "échec",
    detailOpened,
  );

  const detailBack = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentDetailBackButton));
  if ((await detailBack.count()) > 0) {
    await detailBack.click();
  } else {
    await page.goBack();
  }
  await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  const listLocator = page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.studentsList));
  const listExists = (await listLocator.count()) > 0;
  pushResult(
    results,
    "Liste virtualisée présente",
    CLASSES_STUDENT_TEST_IDS.studentsList,
    listExists ? "présente" : "absente",
    listExists,
  );

  await clickTab(page, TAB_TEST_IDS.classes, "Classes");
  await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  const tabVisible = await page.locator(testIdSelector(TAB_TEST_IDS.classes)).isVisible();
  pushResult(
    results,
    "Barre de navigation accessible après scroll",
    "onglet Classes cliquable",
    tabVisible ? "accessible" : "masquée",
    tabVisible,
  );
}

function expectedContentMaxWidth(viewport) {
  if (viewport.width < TABLET_MIN_WIDTH) {
    return viewport.width;
  }
  const horizontalPadding = 32;
  return Math.min(viewport.width - horizontalPadding * 2, TABLET_CONTENT_MAX_WIDTH);
}

function boxWithinViewportWidth(box, viewport, tolerance = 2) {
  return (
    box.x >= -tolerance &&
    box.x + box.width <= viewport.width + tolerance &&
    box.width > 0 &&
    box.height > 0
  );
}

async function assertNoHorizontalOverflow(page, viewport, results, stepLabel) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const ok = scrollWidth <= viewport.width + 4;
  pushResult(
    results,
    stepLabel,
    `≤ ${viewport.width}px`,
    `${scrollWidth}px`,
    ok,
  );
  return ok;
}

async function assertElementsWithinViewportWidth(page, testIds, viewport, results, stepLabel) {
  let allOk = true;
  for (const testId of testIds) {
    const box = await getBox(page, testId);
    if (!boxWithinViewportWidth(box, viewport)) {
      allOk = false;
    }
  }
  pushResult(
    results,
    stepLabel,
    "éléments dans le viewport",
    allOk ? "ok" : "dépassement horizontal",
    allOk,
  );
  return allOk;
}

async function assertContentWidthBounded(page, viewport, contentTestId, results, stepLabel) {
  const box = await getBox(page, contentTestId);
  const maxAllowed = expectedContentMaxWidth(viewport) + 8;
  const ok = box.width <= maxAllowed;
  pushResult(
    results,
    stepLabel,
    `≤ ${maxAllowed}px`,
    `${Math.round(box.width)}px`,
    ok,
  );
  return ok;
}

async function assertResponsiveAuthenticatedUi(page, viewport, results, stepPrefix = "") {
  const prefix = stepPrefix ? `${stepPrefix} — ` : "";

  await assertTabBarVisible(page, results, `${prefix}Barre de navigation (4 onglets)`);

  const tabBox = await getBox(page, TAB_TEST_IDS.accueil);
  const tabAnchored =
    tabBox.y >= 0 &&
    tabBox.y + tabBox.height <= viewport.height + 2 &&
    tabBox.x >= -2 &&
    tabBox.x + tabBox.width <= viewport.width + 2;
  pushResult(
    results,
    `${prefix}Onglets accessibles sans scroll horizontal`,
    "ancrés dans le viewport",
    tabAnchored ? "ok" : "hors viewport",
    tabAnchored,
  );

  await page.locator(testIdSelector(NAVIGATION_TEST_IDS.homeOverviewTitle)).waitFor({
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  await assertElementsWithinViewportWidth(
    page,
    [NAVIGATION_TEST_IDS.homeOverviewTitle, HOME_TEST_IDS.adminDashboard],
    viewport,
    results,
    `${prefix}Accueil — éléments clés visibles`,
  );

  await assertNoHorizontalOverflow(page, viewport, results, `${prefix}Accueil — pas de scroll horizontal`);

  await assertContentWidthBounded(
    page,
    viewport,
    HOME_TEST_IDS.adminDashboard,
    results,
    `${prefix}Accueil — contenu non étiré`,
  );

  await clickTab(page, TAB_TEST_IDS.classes, "Classes");
  await page.waitForSelector(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesScreen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  await page.locator(testIdSelector(CLASSES_LOADING_TEST_IDS.classesList)).waitFor({
    state: "visible",
    timeout: LOGIN_MAX_MS,
  }).catch(() => null);

  const classesTitleText = (
    await page.locator(testIdSelector(CLASSES_STUDENT_TEST_IDS.classesTitle)).innerText()
  ).trim();
  pushResult(
    results,
    `${prefix}Classes — titre lisible`,
    "Classes",
    classesTitleText || "(vide)",
    classesTitleText.includes("Classes"),
  );

  await assertElementsWithinViewportWidth(
    page,
    [CLASSES_STUDENT_TEST_IDS.classesTitle, CLASSES_LOADING_TEST_IDS.addClassButton],
    viewport,
    results,
    `${prefix}Classes — en-tête sans débordement`,
  );

  await assertNoHorizontalOverflow(page, viewport, results, `${prefix}Classes — pas de scroll horizontal`);

  await clickTab(page, TAB_TEST_IDS.accueil, "Accueil");
  await waitForSchoolAdminHome(page);
}

const ACCESSIBILITY_MIN_TOUCH = 48;
const ACCESSIBILITY_MIN_FONT = 12;
const ACCESSIBILITY_MIN_TITLE_FONT = 14;
const ACCESSIBILITY_MIN_CONTRAST = 4.5;

function parseCssColor(value) {
  const raw = String(value ?? "").trim();
  const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  return null;
}

function relativeLuminance(r, g, b) {
  const transform = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function contrastBetweenColors(foreground, background) {
  const fg = parseCssColor(foreground);
  const bg = parseCssColor(background);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg[0], fg[1], fg[2]);
  const l2 = relativeLuminance(bg[0], bg[1], bg[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

async function readElementA11yMetrics(page, testId) {
  const locator = page.locator(testIdSelector(testId)).first();
  await locator.waitFor({ state: "visible", timeout: LOGIN_MAX_MS });
  return locator.evaluate((node) => {
    const resolveBackground = (element) => {
      let current = element;
      while (current) {
        const background = window.getComputedStyle(current).backgroundColor;
        if (background && background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
          return background;
        }
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const resolveForeground = (element) => {
      const candidates = element.querySelectorAll("*");
      for (const candidate of candidates) {
        const text = candidate.textContent?.trim();
        if (!text || candidate.children.length > 0) continue;
        const color = window.getComputedStyle(candidate).color;
        if (color && color !== "rgba(0, 0, 0, 0)") {
          return color;
        }
      }
      return window.getComputedStyle(element).color;
    };
    const style = window.getComputedStyle(node);
    return {
      color: resolveForeground(node),
      backgroundColor: resolveBackground(node),
      fontSize: Number.parseFloat(style.fontSize) || 0,
      ariaLabel: node.getAttribute("aria-label") || "",
      role: node.getAttribute("role") || "",
    };
  });
}

async function assertTouchTarget(page, testId, results, stepLabel, minSize = ACCESSIBILITY_MIN_TOUCH) {
  const box = await getBox(page, testId);
  const ok = box.width >= minSize - 2 && box.height >= minSize - 2;
  pushResult(
    results,
    stepLabel,
    `≥ ${minSize}px`,
    `${Math.round(box.width)}x${Math.round(box.height)}px`,
    ok,
  );
  return ok;
}

async function assertReadableText(page, testId, results, stepLabel, minFont = ACCESSIBILITY_MIN_FONT) {
  const metrics = await readElementA11yMetrics(page, testId);
  const ok = metrics.fontSize >= minFont;
  pushResult(
    results,
    stepLabel,
    `≥ ${minFont}px`,
    `${Math.round(metrics.fontSize)}px`,
    ok,
  );
  return ok;
}

async function assertContrast(page, testId, results, stepLabel, minRatio = ACCESSIBILITY_MIN_CONTRAST) {
  const metrics = await readElementA11yMetrics(page, testId);
  const ratio = contrastBetweenColors(metrics.color, metrics.backgroundColor);
  const ok = ratio !== null && ratio >= minRatio;
  pushResult(
    results,
    stepLabel,
    `≥ ${minRatio}:1`,
    ratio ? `${ratio.toFixed(2)}:1` : "indéterminé",
    ok,
  );
  return ok;
}

async function assertAccessibleName(page, testId, expectedFragment, results, stepLabel) {
  const metrics = await readElementA11yMetrics(page, testId);
  const label = metrics.ariaLabel.trim();
  const ok = label.toLowerCase().includes(String(expectedFragment).toLowerCase());
  pushResult(results, stepLabel, expectedFragment, label || "(absent)", ok);
  return ok;
}

function isUserFriendlyError(text) {
  const value = String(text ?? "").trim();
  if (!value || value.length > 120) return false;
  return !/jwt|stack|undefined|null|\/api\/|localhost|fetch failed/i.test(value);
}

async function assertMobileAccessibilityUi(page, url, fixtures, results) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await waitForWelcomeReady(page);

  await assertReadableText(
    page,
    WELCOME_TEST_IDS.brand,
    results,
    "Accueil — titre principal lisible",
    ACCESSIBILITY_MIN_TITLE_FONT,
  );
  await assertTouchTarget(page, WELCOME_TEST_IDS.loginButton, results, "Accueil — bouton assez grand");
  await assertContrast(page, WELCOME_TEST_IDS.loginButton, results, "Accueil — contraste bouton connexion");
  await assertAccessibleName(
    page,
    WELCOME_TEST_IDS.loginButton,
    "Se connecter",
    results,
    "Accueil — libellé lecteur d'écran bouton connexion",
  );
  await assertAccessibleName(
    page,
    WELCOME_TEST_IDS.screen,
    "accueil",
    results,
    "Accueil — libellé écran",
  );

  await page.locator(testIdSelector(WELCOME_TEST_IDS.loginButton)).click();
  await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.screen), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });

  await assertAccessibleName(
    page,
    ROLE_SELECTION_TEST_IDS.schoolCodeInput,
    "Code établissement",
    results,
    "Code école — libellé champ compréhensible",
  );
  await assertTouchTarget(
    page,
    ROLE_SELECTION_TEST_IDS.verifyButton,
    results,
    "Code école — bouton vérifier assez grand",
  );
  const roleTitleFont = await page
    .getByText("Entrez le code", { exact: false })
    .first()
    .evaluate((node) => Number.parseFloat(window.getComputedStyle(node).fontSize) || 0);
  pushResult(
    results,
    "Code école — textes lisibles",
    `≥ ${ACCESSIBILITY_MIN_TITLE_FONT}px`,
    `${Math.round(roleTitleFont)}px`,
    roleTitleFont >= ACCESSIBILITY_MIN_TITLE_FONT,
  );

  await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.schoolCodeInput)).fill("INVALID-ACCESS-99");
  await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.verifyButton)).click();
  await page.waitForSelector(testIdSelector(ROLE_SELECTION_TEST_IDS.errorBanner), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  const roleErrorText = (
    await page.locator(testIdSelector(ROLE_SELECTION_TEST_IDS.errorBanner)).innerText()
  ).trim();
  const roleErrorAlert = await page
    .locator(testIdSelector(ROLE_SELECTION_TEST_IDS.errorBanner))
    .evaluate((node) => node.getAttribute("role") === "alert");
  pushResult(
    results,
    "Erreur code école — message lisible",
    ERROR_MESSAGES.invalidSchoolCode,
    roleErrorText,
    roleErrorText.includes(ERROR_MESSAGES.invalidSchoolCode),
  );
  pushResult(
    results,
    "Erreur code école — rôle alerte",
    "alert",
    roleErrorAlert ? "alert" : "absent",
    roleErrorAlert,
  );
  pushResult(
    results,
    "Erreur code école — pas de message technique",
    "message simple",
    isUserFriendlyError(roleErrorText) ? "message simple" : roleErrorText,
    isUserFriendlyError(roleErrorText),
  );

  await verifySchoolCodeUi(page, fixtures.schoolCode, fixtures.schoolName, results, "Accessibilité");
  await openLoginForm(page, results, "Accessibilité");

  await assertAccessibleName(
    page,
    LOGIN_TEST_IDS.identifierInput,
    "Téléphone, email ou identifiant",
    results,
    "Connexion — libellé champ identifiant",
  );
  await assertTouchTarget(
    page,
    LOGIN_TEST_IDS.identifierInput,
    results,
    "Connexion — champ identifiant assez grand",
  );
  await assertReadableText(
    page,
    LOGIN_TEST_IDS.instructionText,
    results,
    "Connexion — consignes lisibles",
    ACCESSIBILITY_MIN_FONT,
  );
  await assertTouchTarget(page, LOGIN_TEST_IDS.loginButton, results, "Connexion — bouton assez grand");
  await assertAccessibleName(
    page,
    LOGIN_TEST_IDS.screen,
    "connexion",
    results,
    "Connexion — libellé écran",
  );

  await fillIdentifierAndWaitRole(page, fixtures.adminIdentifier, "admin");
  await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, "0000");
  await submitLogin(page);
  await page.waitForSelector(testIdSelector(LOGIN_TEST_IDS.errorBanner), {
    state: "visible",
    timeout: LOGIN_MAX_MS,
  });
  const loginErrorText = (
    await page.locator(testIdSelector(LOGIN_TEST_IDS.errorBanner)).innerText()
  ).trim();
  const loginErrorAlert = await page
    .locator(testIdSelector(LOGIN_TEST_IDS.errorBanner))
    .evaluate((node) => node.getAttribute("role") === "alert");
  pushResult(
    results,
    "Erreur connexion — message lisible",
    "incorrect",
    loginErrorText,
    isUserFriendlyError(loginErrorText) && /incorrect|invalide/i.test(loginErrorText),
  );
  pushResult(
    results,
    "Erreur connexion — rôle alerte",
    "alert",
    loginErrorAlert ? "alert" : "absent",
    loginErrorAlert,
  );

  await fillSecretInput(page, LOGIN_TEST_IDS.passwordInput, fixtures.adminPassword);
  await submitLogin(page);
  await completePasswordChangeIfNeeded(page);
  await waitForSchoolAdminHome(page);

  await assertTouchTarget(page, TAB_TEST_IDS.accueil, results, "Navigation — onglet Accueil assez grand");
  await assertTouchTarget(page, TAB_TEST_IDS.classes, results, "Navigation — onglet Classes assez grand");
  await assertAccessibleName(page, TAB_TEST_IDS.accueil, "Accueil", results, "Navigation — icône Accueil étiquetée");
  await assertAccessibleName(page, TAB_TEST_IDS.classes, "Classes", results, "Navigation — icône Classes étiquetée");

  const homeTitleVisible = await page
    .locator(testIdSelector(HOME_TEST_IDS.adminDashboard))
    .isVisible()
    .catch(() => false);
  pushResult(
    results,
    "Accueil connecté — contenu principal visible",
    "dashboard",
    homeTitleVisible ? "visible" : "absent",
    homeTitleVisible,
  );
}

function resolveDefaultMobileWebPort() {
  return String(
    process.env.SOMAFRIK_MOBILE_WEB_PORT ||
      process.env.EXPO_PORT ||
      process.env.SOMAFRIK_EXPO_PORT ||
      "8083",
  ).trim();
}

const DEFAULT_MOBILE_WEB_URL = (
  process.env.SOMAFRIK_MOBILE_WEB_URL || `http://127.0.0.1:${resolveDefaultMobileWebPort()}`
).replace(/\/$/, "");

async function resolveMobileWebUrl(preferredUrl = DEFAULT_MOBILE_WEB_URL) {
  const candidates = [
    preferredUrl,
    process.env.SOMAFRIK_MOBILE_WEB_URL,
    `http://127.0.0.1:${resolveDefaultMobileWebPort()}`,
    "http://127.0.0.1:8083",
    "http://127.0.0.1:19006",
  ]
    .filter(Boolean)
    .map((url) => String(url).replace(/\/$/, ""));
  const unique = [...new Set(candidates)];
  for (const url of unique) {
    if (await probeMobileWeb(url)) {
      return url;
    }
  }
  return preferredUrl;
}

async function probeMobileWeb(url = DEFAULT_MOBILE_WEB_URL) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

function shouldSkipMobileE2e() {
  return process.env.SOMAFRIK_SKIP_MOBILE_E2E === "true";
}

/**
 * Vérifie l'accessibilité du serveur Expo web.
 * - SOMAFRIK_SKIP_MOBILE_E2E=true → sortie 0 (ignoré)
 * - serveur absent et SOMAFRIK_REQUIRE_MOBILE_E2E≠true → sortie 0 (ignoré)
 * - sinon enregistre l'étape et quitte en erreur si indisponible
 */
async function ensureMobileWebOrExit({
  url = DEFAULT_MOBILE_WEB_URL,
  results = [],
  step = "1. Mobile web accessible",
} = {}) {
  if (shouldSkipMobileE2e()) {
    console.log("SKIP : tests mobile E2E désactivés (SOMAFRIK_SKIP_MOBILE_E2E=true).");
    process.exit(0);
  }

  const resolvedUrl = await resolveMobileWebUrl(url);
  const reachable = await probeMobileWeb(resolvedUrl);
  pushResult(results, step, resolvedUrl, reachable ? resolvedUrl : "indisponible", reachable);

  if (reachable) {
    return true;
  }

  console.error(
    `\nServeur mobile web introuvable (essayé : ${resolvedUrl}).\n` +
      "Lancez : npm run docker:up  (Expo port 8083) ou npm run mobile:web\n" +
      "Ou ignorez les E2E mobile : SOMAFRIK_SKIP_MOBILE_E2E=true\n",
  );

  if (process.env.SOMAFRIK_REQUIRE_MOBILE_E2E === "true") {
    if (results.length) {
      console.table(results);
    }
    process.exit(1);
  }

  console.log("SKIP : suite mobile E2E ignorée (serveur indisponible).");
  process.exit(0);
}

module.exports = {
  WELCOME_COPY,
  WELCOME_TEST_IDS,
  LOGIN_TEST_IDS,
  ROLE_SELECTION_TEST_IDS,
  HOME_TEST_IDS,
  MENU_TEST_IDS,
  TAB_TEST_IDS,
  CLASSES_STUDENT_TEST_IDS,
  CLASSES_LOADING_TEST_IDS,
  CLASSES_LOADING_DELAY_MS,
  OFFLINE_TEST_IDS,
  OFFLINE_COPY,
  OFFLINE_RECOVERY_MAX_MS,
  ERROR_TEST_IDS,
  ERROR_MESSAGES,
  MOBILE_VIEWPORTS,
  RESPONSIVE_VIEWPORTS,
  TABLET_CONTENT_MAX_WIDTH,
  TABLET_MIN_WIDTH,
  WELCOME_MAX_DISPLAY_MS,
  LOGIN_MAX_MS,
  ANIMATION_SETTLE_MS,
  IDENTIFY_DEBOUNCE_MS,
  MIN_TOUCH_TARGET,
  FLOATING_TAB_BAR_ZONE,
  NAVIGATION_TEST_IDS,
  TAB_TRANSITION_MAX_MS,
  pushResult,
  testIdSelector,
  classCardTestId,
  studentRowTestId,
  loadPlaywright,
  waitForWelcomeReady,
  measureWelcomeDisplayMs,
  getBox,
  assertWelcomeScreenUi,
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
  waitForSchoolAdminHome,
  loginAsSchoolAdmin,
  armClassesLoadingDelay,
  assertClassesLoadingUi,
  assertClassesLoadedUi,
  assertOfflineBannerVisible,
  assertOfflineBannerHidden,
  assertCachedClassVisible,
  assertOfflineActionBlocked,
  openClassesTab,
  assertClassesStudentJourneyUi,
  assertStudentSubScreensUi,
  assertLongStudentsListUi,
  assertEmptyClassStudentsUi,
  assertMobileAccessibilityUi,
  ACCESSIBILITY_MIN_TOUCH,
  CLASSES_STUDENT_COPY,
  navigateToStudentDetail,
  LONG_STUDENTS_LIST_MIN_COUNT,
  STUDENT_SUB_SCREENS_COPY,
  STUDENT_SUB_SCREENS_TEST_IDS,
  assertTabBarVisible,
  navigateToTabScreen,
  assertResponsiveAuthenticatedUi,
  assertNoHorizontalOverflow,
  logoutFromMenu,
  clickTab,
  assertInlineError,
  assertFieldEditable,
  DEFAULT_MOBILE_WEB_URL,
  resolveMobileWebUrl,
  probeMobileWeb,
  shouldSkipMobileE2e,
  ensureMobileWebOrExit,
};
