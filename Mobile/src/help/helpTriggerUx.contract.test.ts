import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { helpTriggerLayout, helpTriggerMeetsTouchMinimum } from "./helpTriggerLayout";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const trigger = read("help/HelpTrigger.tsx");
const host = read("help/HelpHost.tsx");
const sheet = read("help/HelpSheet.tsx");
const context = read("help/HelpUiContext.tsx");
const preference = read("help/helpTriggerPreference.ts");
const navigator = read("navigation/AppNavigator.tsx");
const drawer = read("components/RoleNavigationDrawer.tsx");
const recette = read("../recette/HelpUxSmokeApp.tsx");
const app = fs.readFileSync(path.join(srcRoot, "..", "App.tsx"), "utf8");
const metro = fs.readFileSync(path.join(srcRoot, "..", "metro.config.js"), "utf8");

test("compact ? trigger is the only principal entry and stays accessible", () => {
  assert.match(trigger, /accessibilityRole="button"/);
  assert.match(trigger, /accessibilityLabel="Besoin d['']aide"/);
  assert.match(trigger, /testID="mobile-help-button"/);
  assert.match(trigger, />\s*\?\s*</);
  assert.doesNotMatch(trigger, /styles\.label/);
  assert.doesNotMatch(trigger, /Besoin d['’]aide \?/);
  assert.match(trigger, /onPress=\{onPress\}/);
  assert.match(host, /onPress=\{openHelp\}/);
  assert.match(host, /<HelpSheet /);
});

test("hiding the trigger is persisted locally without a new dependency", () => {
  assert.match(preference, /expo-secure-store/);
  assert.match(preference, /HELP_TRIGGER_VISIBLE_KEY/);
  assert.doesNotMatch(preference, /AsyncStorage|MMKV|localStorage/);
  assert.match(context, /writeHelpTriggerVisible\(false\)/);
  assert.match(context, /writeHelpTriggerVisible\(true\)/);
  assert.match(host, /triggerVisible && !keyboardVisible/);
  assert.match(host, /onHide=\{hideTrigger\}/);
});

test("menu can reopen help and restore the compact trigger", () => {
  assert.match(navigator, /<HelpUiProvider>/);
  assert.match(drawer, /testID="mobile-role-drawer-help"/);
  assert.match(drawer, /accessibilityLabel="Aide"/);
  assert.match(drawer, /Masquer le bouton d['']aide/);
  assert.match(drawer, /Afficher le bouton d['']aide/);
  assert.match(drawer, /testID="mobile-role-drawer-help-hide"/);
  assert.match(drawer, /testID="mobile-role-drawer-help-show"/);
  assert.match(drawer, /helpUi\.openHelp/);
  assert.match(drawer, /helpUi\.hideTrigger/);
  assert.match(drawer, /helpUi\.showTrigger/);
  assert.doesNotMatch(drawer, /HelpTrigger|HelpPanel|HelpSheet/);
  assert.doesNotMatch(drawer, /@somafrik\/help-catalog/);
});

test("help engine and sheet content stay the same workflow", () => {
  assert.match(sheet, /Besoin d['’]aide \?/);
  assert.match(sheet, /filterHelpArticles/);
  assert.match(sheet, /searchHelpArticles/);
  assert.match(sheet, /suggestHelpArticles/);
  assert.match(host, /isHelpAvailable/);
  assert.match(host, /isMobileHelpSessionReady/);
  assert.match(host, /buildMobileHelpContext/);
  assert.doesNotMatch(host, /permissionsBootstrap === ["']ready["']/);
});

test("production app stays free of the help UX recette harness", () => {
  assert.doesNotMatch(app, /HelpUxSmoke|helpUxSmoke|SOMAFRIK_HELP_UX_SMOKE_ENTRY|EXPO_PUBLIC_HELP/);
  assert.match(metro, /SOMAFRIK_HELP_UX_SMOKE_ENTRY === "1"/);
  assert.match(metro, /App\.helpUxSmoke\.tsx/);
  assert.match(recette, /<HelpHost \/>/);
  assert.match(recette, /<HelpUiProvider>/);
  assert.match(recette, /RoleNavigationDrawer/);
  assert.match(recette, /testID="mobile-header-menu"/);
});

test("360 px and 390 px keep the compact trigger on-screen above the tab bar", () => {
  assert.equal(helpTriggerMeetsTouchMinimum(), true);
  for (const width of [360, 390]) {
    const layout = helpTriggerLayout({ viewportWidth: width, insetsBottom: 20 });
    assert.equal(layout.visible, true, `${width} px : bouton visible`);
    assert.equal(layout.overlapsRightEdge, false, `${width} px : ne déborde pas`);
    assert.ok(layout.bottom >= 72, `${width} px : au-dessus de la tab bar`);
    assert.ok(layout.touch.width >= 44 && layout.touch.height >= 44);
  }
  assert.equal(helpTriggerLayout({ viewportWidth: 360, keyboardVisible: true }).visible, false);
});
