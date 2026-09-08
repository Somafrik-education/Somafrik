import assert from "node:assert/strict";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { hasSchoolNotificationContext, resolveNotificationsInboxRoute } from "./notificationInboxRoute";

function session(role: string, permissions: string[], schoolCode = "") {
  return attachCanonicalRoleIdentity({
    role,
    permissions,
    user: {
      id: `${role}-user`,
      name: role,
      schoolCode,
      role,
      roleKeys: [role.toUpperCase()],
      permissions,
    },
    school: schoolCode ? { code: schoolCode, name: "École" } : undefined,
  });
}

const schoolUser = session("parent_student", ["Notifications:READ"], "CD-IN-26-001");
const superAdmin = session("super_admin", ["ALL_PRIVILEGES", "COUNTRY_PRIVILEGES"], "*");

assert.equal(canReadRoute(schoolUser, "InternalNotifications"), true);
assert.equal(canReadView(superAdmin, "PlatformNotifications"), true);
assert.equal(canReadRoute(superAdmin, "InternalNotifications"), true);

assert.equal(hasSchoolNotificationContext(schoolUser, ""), true, "session établissement = contexte école");
assert.equal(hasSchoolNotificationContext(superAdmin, "*"), false);
assert.equal(hasSchoolNotificationContext(superAdmin, ""), false);
assert.equal(hasSchoolNotificationContext(superAdmin, "CD-IN-26-001"), true);

assert.equal(
  resolveNotificationsInboxRoute(schoolUser, ""),
  "InternalNotifications",
  "utilisateur établissement → inbox C4",
);
assert.equal(
  resolveNotificationsInboxRoute(superAdmin, "CD-IN-26-001"),
  "InternalNotifications",
  "privilège plateforme + école active → C4, pas PlatformNotifications",
);
assert.equal(
  resolveNotificationsInboxRoute(superAdmin, "*"),
  "PlatformNotifications",
  "contexte plateforme → catalogue B",
);
assert.equal(
  resolveNotificationsInboxRoute(superAdmin, ""),
  "PlatformNotifications",
  "sans école active, Superadmin reste sur le catalogue plateforme",
);

const schoolWithoutC4 = session("parent_student", ["Messages:READ"], "CD-IN-26-001");
assert.equal(
  resolveNotificationsInboxRoute(schoolWithoutC4, "CD-IN-26-001"),
  null,
  "contexte école sans Notifications:READ → pas de fallback PlatformNotifications",
);

console.log("OK Mobile notificationInboxRoute.test.ts");
