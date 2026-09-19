/**
 * Contrats LOT 6 — PARITY-034 / 026 / 055 / 068 Communication.
 *
 *   npx --yes tsx --test scripts/lot6-parity.test.ts
 *
 * Required.needs reste extensible (lot6 n'est pas figé comme dernier).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel: string) {
  return fs.existsSync(path.join(ROOT, rel));
}

test("PARITY-034 — Push : Mobile Expo + révocation logout ; pas de nouveau fournisseur Web", () => {
  const mobileLogout = read("Mobile/src/services/api.ts");
  const mobilePush = read("Mobile/src/services/pushNotifications.ts");
  const webSrc = [
    read("web/src/components/layout/Topbar.tsx"),
    read("web/src/App.tsx"),
    read("backend/server.js"),
  ].join("\n");
  assert.match(mobilePush, /export async function revokeCurrentPushDevice/);
  assert.match(mobileLogout, /revokeCurrentPushDevice/);
  assert.match(mobilePush, /\/mobile\/push-devices/);
  assert.doesNotMatch(webSrc, /PushManager|applicationServerKey|web-push|VAPID/i);
  assert.doesNotMatch(read("backend/server.js"), /web-push|vapid/i);
});

test("PARITY-026 — inbox C4 établissement : Notifications:READ, pas d'accès implicite Web", () => {
  const webPerms = read("web/src/lib/permissions.ts");
  const mobilePerms = read("Mobile/src/domain/security/permissions.ts");
  const topbar = read("web/src/components/layout/Topbar.tsx");
  const inbox = read("Mobile/src/lib/notificationInboxRoute.ts");
  assert.match(webPerms, /viewName === "notifications"/);
  assert.doesNotMatch(
    webPerms,
    /viewName === "notifications"[\s\S]{0,220}isEstablishmentCommunicationUser/,
    "Web ne doit plus ouvrir l'inbox via un rôle établissement implicite",
  );
  assert.match(topbar, /hasBackOfficePermission\(ctx, "Notifications", "READ"\)/);
  assert.match(mobilePerms, /InternalNotifications/);
  assert.match(inbox, /canReadRoute\(session, "InternalNotifications"\)/);
  assert.doesNotMatch(inbox, /PlatformNotifications/);
});

test("PARITY-055 — préférences /me/communication-preferences accessibles en live Web + Mobile", () => {
  const webPanel = read("web/src/components/account/CommunicationPreferencesPanel.tsx");
  const webTopbar = read("web/src/components/layout/Topbar.tsx");
  const mobileSheet = read("Mobile/src/components/CommunicationPreferencesSheet.tsx");
  const liveDrawer = read("Mobile/src/components/RoleNavigationDrawer.tsx");
  assert.match(webPanel, /getCommunicationPreferences/);
  assert.match(webPanel, /updateCommunicationPreferences/);
  assert.match(webTopbar, /CommunicationPreferencesPanel/);
  assert.match(mobileSheet, /IN_APP/);
  assert.match(mobileSheet, /PUSH/);
  assert.match(mobileSheet, /EMAIL/);
  assert.match(liveDrawer, /CommunicationPreferencesSheet/);
  assert.match(liveDrawer, /mobile-role-drawer-communication-preferences/);
  assert.doesNotMatch(read("Mobile/src/navigation/AppNavigator.tsx"), /MenuScreen/);
});

test("PARITY-068 — notifications plateforme Web-only volontaire ; Mobile ne réactive pas le legacy", () => {
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const lot1 = read("Mobile/src/lib/pariteLot1PlatformSettingsBoundary.test.ts");
  const webApp = read("web/src/App.tsx");
  const webPage = read("web/src/pages/PlatformNotificationsPage.tsx");
  assert.doesNotMatch(navigator, /name=["']PlatformNotifications["']/);
  assert.doesNotMatch(navigator, /PlatformNotificationsScreen/);
  assert.match(lot1, /PlatformNotifications/);
  assert.match(webApp, /\/notifications-plateforme/);
  assert.match(webPage, /isPlatformCommunicationUser/);
  assert.ok(exists("docs/audits/evidence/lot6-communication-red-green.md"));
  assert.match(read("docs/audits/evidence/lot6-communication-red-green.md"), /PARITY-068/);
  assert.match(read("docs/audits/evidence/lot6-communication-red-green.md"), /Web-only|WEB-ONLY|volontaire/i);
});

test("PARITY-034/026/055/068 — gate CI lot6 extensible avec LOT 0–5", () => {
  const pkg = read("package.json");
  const gates = read(".github/workflows/pr-gates.yml");
  const requiredJob = gates.slice(gates.indexOf("name: Required"));
  assert.match(pkg, /"test:lot6-parity"/);
  assert.match(pkg, /"test:lot5-parity"/);
  assert.match(gates, /name: LOT 6 parity/);
  assert.match(gates, /npm run test:lot6-parity/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot5[^\]]*\]/);
  assert.match(requiredJob, /needs:\s*\[[^\]]*lot6[^\]]*\]/);
  assert.match(requiredJob, /LOT6: \$\{\{ needs\.lot6\.result \}\}/);
  assert.match(requiredJob, /"\$LOT6"/);
});
