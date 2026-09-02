import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { getRoleDrawerCatalog } from "../navigation/roleDrawerPreferences";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function liveSession(permissions: string[], schoolCode = "SCH-C4-A") {
  return attachCanonicalRoleIdentity({
    role: "parent_student",
    permissions,
    user: {
      id: "c4-user",
      name: "C4",
      schoolCode,
      role: "Parent",
      roleKeys: ["PARENT"],
      permissions,
    },
  });
}

assert.equal(canReadRoute(liveSession(["Notifications:READ"]), "InternalNotifications"), true);
assert.equal(canReadView(liveSession(["Notifications:READ"]), "InternalNotifications"), true);
assert.equal(canReadRoute(liveSession(["Messages:READ"]), "InternalNotifications"), false);
assert.equal(canReadView(liveSession(["Announcements:READ"]), "InternalNotifications"), false);
assert.equal(canReadView(liveSession(["Notifications:READ"]), "PlatformNotifications"), false);

const schoolAdminCatalog = getRoleDrawerCatalog("school_admin");
assert.ok(
  schoolAdminCatalog.some((item) => item.route === "InternalNotifications"),
  "C4 drawer Admin School expose InternalNotifications",
);
assert.equal(
  schoolAdminCatalog.some((item) => item.route === "PlatformNotifications"),
  false,
  "C4 drawer établissement ne fusionne pas les notifications plateforme",
);

const readSrc = fs.readFileSync(path.join(ROOT, "src/lib/internalNotificationsRead.ts"), "utf8");
assert.doesNotMatch(readSrc, /AsyncStorage|localStorage/);
assert.match(readSrc, /getInternalNotificationsUnreadCount/);

const apiSrc = fs.readFileSync(path.join(ROOT, "src/services/internalNotificationsApi.ts"), "utf8");
assert.match(apiSrc, /internal-notifications\/unread-count/);
assert.match(apiSrc, /idempotencyKey/);
assert.doesNotMatch(apiSrc, /AsyncStorage/);

const screenSrc = fs.readFileSync(path.join(ROOT, "src/screens/InternalNotificationsScreen.tsx"), "utf8");
assert.doesNotMatch(screenSrc, /AsyncStorage|localStorage/);
assert.match(screenSrc, /markInternalNotificationRead/);
assert.match(screenSrc, /archiveInternalNotification/);

const headerSrc = fs.readFileSync(path.join(ROOT, "src/components/MobileAppHeader.tsx"), "utf8");
assert.match(headerSrc, /InternalNotifications/);
assert.match(headerSrc, /useInternalNotificationsUnreadCount/);

const navSrc = fs.readFileSync(path.join(ROOT, "src/navigation/AppNavigator.tsx"), "utf8");
assert.match(navSrc, /InternalNotifications/);

const placeholders = fs.readFileSync(
  path.join(ROOT, "../web/src/pages/parametres/SettingsPlaceholders.tsx"),
  "utf8",
);
assert.match(placeholders, /ComingSoonState/);

console.log("OK Mobile internalNotificationsC4.test.ts");
