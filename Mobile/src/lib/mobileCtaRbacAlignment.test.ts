import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import {
  canAccessBackofficeMessagesComposer,
  canAccessPlatformNotifications,
  canArchiveAnnouncement,
} from "./mobileCtaRbacAlignment";
import { MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, canRunGenericAdminCrud } from "./mobileMutationSafety";

function liveSession(input: {
  sessionRole?: string;
  roleLabel?: string;
  roleKeys?: string[];
  permissions: string[];
  schoolCode?: string;
}) {
  return attachCanonicalRoleIdentity({
    role: input.sessionRole,
    permissions: input.permissions,
    user: {
      id: "user-l9b",
      name: "L9b CTA",
      schoolCode: input.schoolCode ?? "CD-IN-26-001",
      role: input.roleLabel,
      roleKeys: input.roleKeys,
      permissions: input.permissions,
    },
  });
}

const teacherReadOnly = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Messages:READ"],
});
assert.equal(
  canAccessBackofficeMessagesComposer(teacherReadOnly),
  false,
  "TEACHER sans Messages:CREATE => aucun composer",
);

const teacherCreate = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Messages:READ", "Messages:CREATE"],
});
assert.equal(
  canAccessBackofficeMessagesComposer(teacherCreate),
  true,
  "TEACHER avec Messages:CREATE => composer si API autorise",
);

const parentReadOnly = liveSession({
  sessionRole: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Messages:READ"],
});
assert.equal(
  canAccessBackofficeMessagesComposer(parentReadOnly),
  false,
  "PARENT sans Messages:CREATE => aucun composer",
);

const parentCreate = liveSession({
  sessionRole: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Messages:CREATE"],
});
assert.equal(canAccessBackofficeMessagesComposer(parentCreate), true);

const staffCreate = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Messages:CREATE"],
});
assert.equal(
  canAccessBackofficeMessagesComposer(staffCreate),
  true,
  "staff avec Messages:CREATE => composer",
);

const staffReadOnly = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Messages:READ"],
});
assert.equal(canAccessBackofficeMessagesComposer(staffReadOnly), false);

const gererMessages = liveSession({
  sessionRole: "secretary",
  roleLabel: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Gérer messages"],
});
assert.equal(canAccessBackofficeMessagesComposer(gererMessages), true);

assert.equal(
  canArchiveAnnouncement(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Notifications:UPDATE"],
    }),
  ),
  true,
  "archive visible si Notifications:UPDATE (contrat API)",
);

assert.equal(
  canArchiveAnnouncement(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Notifications:DELETE"],
    }),
  ),
  false,
  "mauvaise permission DELETE => action absente",
);

assert.equal(
  canArchiveAnnouncement(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Notifications:READ"],
    }),
  ),
  false,
);

assert.equal(
  canArchiveAnnouncement(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Gérer notifications"],
    }),
  ),
  true,
);

const schoolNotificationsRead = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Notifications:READ"],
});
assert.equal(canAccessPlatformNotifications(schoolNotificationsRead), false);
assert.equal(canReadView(schoolNotificationsRead, "PlatformNotifications"), false);
assert.equal(canReadRoute(schoolNotificationsRead, "PlatformNotifications"), false);
assert.equal(canReadView(schoolNotificationsRead, "Announcements"), true);

const countryNotificationsRead = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["Notifications:READ"],
  schoolCode: "*",
});
assert.equal(
  canAccessPlatformNotifications(countryNotificationsRead),
  false,
  "Notifications:READ établissement/pays n'ouvre pas la plateforme",
);
assert.equal(canReadView(countryNotificationsRead, "PlatformNotifications"), false);

const countryPrivileges = liveSession({
  sessionRole: "country_admin",
  roleLabel: "Admin Pays",
  roleKeys: ["COUNTRY_ADMIN"],
  permissions: ["COUNTRY_PRIVILEGES"],
  schoolCode: "*",
});
assert.equal(canAccessPlatformNotifications(countryPrivileges), true);
assert.equal(canReadView(countryPrivileges, "PlatformNotifications"), true);
assert.equal(canReadRoute(countryPrivileges, "PlatformNotifications"), true);
assert.equal(canAccessBackofficeMessagesComposer(countryPrivileges), true);
assert.equal(canArchiveAnnouncement(countryPrivileges), true);

const superAdmin = liveSession({
  sessionRole: "super_admin",
  roleLabel: "Super Administrateur Somafrik",
  roleKeys: ["SUPER_ADMIN"],
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
});
assert.equal(canAccessPlatformNotifications(superAdmin), true);
assert.equal(canReadView(superAdmin, "PlatformNotifications"), true);
assert.equal(canAccessBackofficeMessagesComposer(superAdmin), true);
assert.equal(canArchiveAnnouncement(superAdmin), true);

assert.equal(MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, false);
assert.equal(canRunGenericAdminCrud("courses"), false);
assert.equal(canRunGenericAdminCrud("assignments"), false);
assert.equal(canRunGenericAdminCrud("payments"), false);

console.log("mobileCtaRbacAlignment.test.ts OK");
