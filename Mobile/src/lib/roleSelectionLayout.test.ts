/**
 * Garde-fou layout — connexion établissement responsive.
 *   npx tsx Mobile/src/lib/roleSelectionLayout.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROLE_SELECTION_COPY, ROLE_SELECTION_TEST_IDS } from "./loginScreenSpec";
import {
  ROLE_SELECTION_NAV_TITLE,
  ROLE_SELECTION_NAV_TITLE_MAX_PX,
  ROLE_SELECTION_TITLE_MAX_PHONE_PX,
  ROLE_SELECTION_TITLE_MIN_PHONE_PX,
  ROLE_SELECTION_VIEWPORTS,
  formatRoleSelectionApiStatus,
  getRoleSelectionLayout,
  measureRoleSelectionScreen,
  roleSelectionFitsNominalViewports,
} from "./roleSelectionLayout";

const ROOT = path.join(__dirname, "..", "..", "..");
const screen = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"), "utf8");
const navigator = fs.readFileSync(path.join(ROOT, "Mobile/src/navigation/AppNavigator.tsx"), "utf8");

const copy = {
  title: ROLE_SELECTION_COPY.title,
  description: ROLE_SELECTION_COPY.description,
};

assert.equal(ROLE_SELECTION_NAV_TITLE, "Connexion établissement");
assert.ok(ROLE_SELECTION_NAV_TITLE.length < "Se connecter à l'établissement".length);
assert.match(ROLE_SELECTION_COPY.description, /code fourni par votre établissement/);
assert.doesNotMatch(ROLE_SELECTION_COPY.description, /espaces élève, parent, enseignant et direction/);

assert.equal(formatRoleSelectionApiStatus("https://somafrik-api-preprod.onrender.com/api"), "API : https://somafrik-api-preprod.onrender.com/api");

for (const viewport of ROLE_SELECTION_VIEWPORTS) {
  for (const fontScale of [1, 1.2]) {
    const layout = getRoleSelectionLayout(viewport.width, viewport.height, fontScale);
    assert.ok(
      layout.title >= ROLE_SELECTION_TITLE_MIN_PHONE_PX,
      `${viewport.name} title trop petit: ${layout.title}`,
    );
    assert.ok(
      layout.title <= ROLE_SELECTION_TITLE_MAX_PHONE_PX,
      `${viewport.name} title excessif: ${layout.title}`,
    );
    assert.ok(layout.title < 45, `${viewport.name}: ancienne taille hero ~45–55 interdite`);
    assert.ok(layout.brandTitle <= 22, `${viewport.name}: marque trop grande (${layout.brandTitle})`);
    assert.ok(layout.brandLogo <= 44, `${viewport.name}: logo trop grand (${layout.brandLogo})`);
    assert.ok(layout.eyebrow <= 16);
    assert.ok(layout.description <= 18);
    assert.ok(layout.code >= 20 && layout.code <= 28);
    assert.ok(layout.button >= 16 && layout.button <= 20);
    assert.ok(layout.buttonMinHeight >= 48);
    assert.ok(layout.screenPaddingTop <= 12);
    assert.equal(layout.screenPaddingHorizontal > 0 && layout.screenPaddingHorizontal <= 20, true);

    const before = measureRoleSelectionScreen(viewport, { schoolResolved: false, fontScale, ...copy });
    const after = measureRoleSelectionScreen(viewport, { schoolResolved: true, fontScale, ...copy });
    assert.equal(before.schoolCardInFlow, true);
    assert.equal(after.schoolCardInFlow, true);
    assert.equal(before.navTitlePx, ROLE_SELECTION_NAV_TITLE_MAX_PX);
    assert.ok(before.titlePx <= ROLE_SELECTION_TITLE_MAX_PHONE_PX);

    if (viewport.height >= 800 && fontScale === 1) {
      assert.equal(
        before.fitsWithoutScroll,
        true,
        `${viewport.name} avant validation doit tenir sans scroll (content=${before.estimatedContentHeight} avail=${before.availableHeight})`,
      );
      assert.equal(
        after.fitsWithoutScroll,
        true,
        `${viewport.name} après validation doit tenir sans scroll (content=${after.estimatedContentHeight} avail=${after.availableHeight})`,
      );
    }

    if (viewport.name === "360x640" && fontScale === 1) {
      assert.ok(
        after.estimatedContentHeight <= after.availableHeight + 24,
        `360x640 après validation trop haut: ${after.estimatedContentHeight} / ${after.availableHeight}`,
      );
    }
  }
}

assert.equal(roleSelectionFitsNominalViewports(1, copy), true);
assert.equal(roleSelectionFitsNominalViewports(1.2, copy), true, "fontScale 1.2: viewports nominaux");

const tiny = measureRoleSelectionScreen(
  { width: 320, height: 568 },
  { schoolResolved: true, fontScale: 1.2, ...copy },
);
assert.ok(tiny.layout.tight);
assert.ok(tiny.estimatedContentHeight > 0);

assert.match(screen, /useWindowDimensions/);
assert.match(screen, /getRoleSelectionLayout/);
assert.match(screen, /formatRoleSelectionApiStatus/);
assert.match(screen, /KeyboardAvoidingView/);
assert.match(screen, /keyboardShouldPersistTaps="handled"/);
assert.match(screen, /flexGrow:\s*1/);
assert.doesNotMatch(screen, /allowFontScaling=\{false\}/);
assert.doesNotMatch(screen, /paddingTop:\s*54/);
assert.doesNotMatch(screen, /fontSize:\s*3[02]/);
assert.doesNotMatch(screen, /width:\s*72/);
assert.doesNotMatch(screen, /width:\s*[4-9]\d{2}/);
assert.match(screen, /getSchoolByCode/);
assert.match(screen, /ROLE_SELECTION_COPY\.verifyButton/);
assert.match(screen, /ROLE_SELECTION_COPY\.openLoginButton/);
assert.match(screen, /testID=\{ROLE_SELECTION_TEST_IDS\.schoolCard\}/);
assert.match(screen, /testID=\{ROLE_SELECTION_TEST_IDS\.statusMessage\}/);
assert.equal(ROLE_SELECTION_TEST_IDS.verifyButton, "role-verify-button");
assert.equal(ROLE_SELECTION_TEST_IDS.openLoginButton, "role-open-login-button");

const formStart = screen.indexOf("styles.formPanel");
const schoolCard = screen.indexOf("ROLE_SELECTION_TEST_IDS.schoolCard");
const formPanelCloseHint = screen.indexOf("styles.helpBox");
assert.ok(formStart > 0 && schoolCard > formStart, "carte établissement doit suivre le panneau formulaire");
assert.ok(schoolCard < formPanelCloseHint, "carte validée doit rester dans le flux avant le bloc d'aide");
assert.ok(
  screen.indexOf("ROLE_SELECTION_TEST_IDS.verifyButton") < schoolCard,
  "CTA Vérifier le code avant le résultat validé",
);

assert.match(navigator, /ROLE_SELECTION_NAV_TITLE/);
assert.doesNotMatch(navigator, /title:\s*"Se connecter à l'établissement"/);
assert.match(navigator, /headerTitleStyle:\s*\{\s*fontSize:\s*18/);

assert.match(screen, /scrollTo/);
assert.match(screen, /flexDirection:\s*"column"/);

console.log("OK roleSelectionLayout: typo bornée, flux validé in-viewport, pas de largeur fixe dangereuse");
