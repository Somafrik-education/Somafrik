import assert from "node:assert/strict";
import {
  boxesOverlap,
  computeHelpTriggerLayout,
  HELP_STICKY_CTA_RESERVE_DP,
  HELP_TRIGGER_SIZE_DP,
  helpSheetUsesFullscreen,
  helpTriggerBox,
} from "./helpOverlayPolicy";

assert.equal(HELP_TRIGGER_SIZE_DP >= 44, true);

const withTabs = computeHelpTriggerLayout({
  hasTabBar: true,
  tabBarOccupiedHeight: 60,
  safeBottom: 24,
  keyboardVisible: false,
  businessModalOpen: false,
  helpOpen: false,
});
assert.equal(withTabs.visible, true);
assert.equal(withTabs.bottom, 60 + HELP_STICKY_CTA_RESERVE_DP);
assert.equal(withTabs.size, 44);

const keyboard = computeHelpTriggerLayout({ ...withTabs, hasTabBar: true, tabBarOccupiedHeight: 60, safeBottom: 0, keyboardVisible: true, businessModalOpen: false, helpOpen: false });
assert.equal(keyboard.visible, false, "clavier ouvert → trigger masqué");

const modal = computeHelpTriggerLayout({
  hasTabBar: false,
  tabBarOccupiedHeight: 0,
  safeBottom: 16,
  keyboardVisible: false,
  businessModalOpen: true,
  helpOpen: false,
});
assert.equal(modal.visible, false, "modal métier → trigger masqué");

const open = computeHelpTriggerLayout({
  hasTabBar: true,
  tabBarOccupiedHeight: 60,
  safeBottom: 0,
  keyboardVisible: false,
  businessModalOpen: false,
  helpOpen: true,
});
assert.equal(open.visible, false);

assert.equal(helpSheetUsesFullscreen(360), true);
assert.equal(helpSheetUsesFullscreen(844), false);

const viewport = { width: 360, height: 800 };
const trigger = helpTriggerBox(withTabs, viewport);
const tabs = { x: 0, y: 800 - 60, width: 360, height: 60 };
const saveCta = { x: 16, y: 800 - 60 - 48, width: 328, height: 48 };
assert.equal(boxesOverlap(trigger, tabs), false, "trigger au-dessus des bottom tabs");
assert.equal(boxesOverlap(trigger, saveCta), false, "trigger au-dessus d’un CTA Enregistrer");

console.log("helpOverlayPolicy.test.ts OK");
