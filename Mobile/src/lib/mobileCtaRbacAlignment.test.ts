import assert from "node:assert/strict";
import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { canReadRoute, canReadView } from "../domain/security/permissions";
import {
  buildStaffSchoolToParentMessagePayload,
  canAccessBackofficeMessagesComposer,
  canAccessCanonicalMessageRecipients,
  canAccessMessagesRoute,
  canAccessPlatformNotifications,
  canArchiveAnnouncement,
  canReadBackofficeMessagesList,
  canShowStaffMessagesComposer,
  resolveCanonicalStaffRecipients,
  resolveMessagesRouteAccess,
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
assert.equal(canAccessBackofficeMessagesComposer(staffCreate), true, "staff CREATE => composer API");
assert.equal(canShowStaffMessagesComposer(staffCreate), true, "CREATE-only utilise GET messages/recipients");
assert.equal(canAccessCanonicalMessageRecipients(staffCreate), false);
assert.equal(canReadBackofficeMessagesList(staffCreate), false, "CREATE ne devient pas READ");
assert.equal(canAccessMessagesRoute(staffCreate), true, "staff CREATE sans READ => route atteignable");
assert.deepEqual(resolveMessagesRouteAccess(staffCreate), {
  canAccessRoute: true,
  canReadList: false,
  canCompose: true,
});

const staffReadOnly = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Messages:READ"],
});
assert.equal(canAccessBackofficeMessagesComposer(staffReadOnly), false, "staff READ sans CREATE => aucun composer");
assert.equal(canReadBackofficeMessagesList(staffReadOnly), true);
assert.equal(canAccessMessagesRoute(staffReadOnly), true, "staff READ sans CREATE => route atteignable");
assert.deepEqual(resolveMessagesRouteAccess(staffReadOnly), {
  canAccessRoute: true,
  canReadList: true,
  canCompose: false,
});

const staffNone = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Élèves:READ"],
});
assert.equal(canAccessMessagesRoute(staffNone), false, "staff sans READ ni CREATE => route absente");
assert.deepEqual(resolveMessagesRouteAccess(staffNone), {
  canAccessRoute: false,
  canReadList: false,
  canCompose: false,
});

const teacherReadCreate = liveSession({
  sessionRole: "teacher",
  roleLabel: "Enseignant",
  roleKeys: ["TEACHER"],
  permissions: ["Messages:READ", "Messages:CREATE"],
});
assert.deepEqual(resolveMessagesRouteAccess(teacherReadCreate), {
  canAccessRoute: true,
  canReadList: true,
  canCompose: true,
});
assert.equal(canAccessMessagesRoute(teacherReadOnly), true);
assert.equal(canAccessBackofficeMessagesComposer(teacherReadOnly), false);

const parentReadCreate = liveSession({
  sessionRole: "parent_student",
  roleLabel: "Parent",
  roleKeys: ["PARENT"],
  permissions: ["Messages:READ", "Messages:CREATE"],
});
assert.deepEqual(resolveMessagesRouteAccess(parentReadCreate), {
  canAccessRoute: true,
  canReadList: true,
  canCompose: true,
});

const canonicalRecipients = resolveCanonicalStaffRecipients({
  schoolCode: "CD-IN-26-001",
  contacts: [
    {
      id: "ct-cd",
      userId: "user-parent-cd",
      schoolCode: "CD-IN-26-001",
      status: "Actif",
      firstName: "Parent",
      lastName: "CD",
    },
    {
      id: "ct-orphan",
      userId: "",
      schoolCode: "CD-IN-26-001",
      status: "Actif",
    },
    {
      id: "ct-bi",
      userId: "user-parent-bi",
      schoolCode: "BI-2026-0001",
      status: "Actif",
    },
  ],
  relations: [
    {
      id: "rel-cd",
      fromContactId: "ct-cd",
      toStudentId: "stu-2",
      toStudentName: "Marie",
      fromContactName: "Parent CD",
      schoolCode: "CD-IN-26-001",
      status: "Actif",
    },
    {
      id: "rel-orphan",
      fromContactId: "ct-orphan",
      toStudentId: "stu-1",
      toStudentName: "Jean",
      schoolCode: "CD-IN-26-001",
      status: "Actif",
    },
    {
      id: "rel-bi",
      fromContactId: "ct-bi",
      toStudentId: "stu-bi",
      schoolCode: "BI-2026-0001",
      status: "Actif",
    },
    {
      id: "rel-mismatch",
      fromContactId: "ct-cd",
      toStudentId: "stu-x",
      schoolCode: "BI-2026-0001",
      status: "Actif",
    },
  ],
});
assert.deepEqual(
  canonicalRecipients.map((row) => row.key),
  ["rel-cd"],
  "uniquement le parent canonique du même établissement",
);

const missingRecipient = buildStaffSchoolToParentMessagePayload({
  selectedRecipientKey: "",
  recipients: canonicalRecipients,
  schoolCode: "CD-IN-26-001",
  theme: "Absence",
  message: "Bonjour",
  priority: "Moyenne",
});
assert.equal(missingRecipient.ok, false, "staff CREATE sans destinataire => aucun POST");
if (!missingRecipient.ok) assert.equal(missingRecipient.code, "missing_recipient");

const explicit = buildStaffSchoolToParentMessagePayload({
  selectedRecipientKey: "rel-cd",
  recipients: canonicalRecipients,
  schoolCode: "CD-IN-26-001",
  theme: "Absence",
  message: "Convocation",
  attachmentIds: ["att-pdf"],
  priority: "Haute",
});
assert.equal(explicit.ok, true);
if (explicit.ok) {
  assert.equal(explicit.payload.studentId, "stu-2");
  assert.deepEqual(explicit.payload.participantUserIds, ["user-parent-cd"]);
  assert.equal(explicit.payload.direction, "École vers parent");
  assert.equal(explicit.payload.message, "Convocation");
  assert.deepEqual(explicit.payload.attachmentIds, ["att-pdf"]);
  assert.equal(explicit.payload.attachmentUrl, undefined);
  assert.equal(explicit.payload.parentPhone, undefined);
}

const unknownRecipient = buildStaffSchoolToParentMessagePayload({
  selectedRecipientKey: "rel-missing",
  recipients: canonicalRecipients,
  schoolCode: "CD-IN-26-001",
  theme: "Absence",
  message: "Bonjour",
  priority: "Moyenne",
});
assert.equal(unknownRecipient.ok, false);
if (!unknownRecipient.ok) assert.equal(unknownRecipient.code, "unknown_recipient");

const noCanonicalParent = buildStaffSchoolToParentMessagePayload({
  selectedRecipientKey: "rel-orphan",
  recipients: [
    {
      key: "rel-orphan",
      studentId: "stu-1",
      studentName: "Jean",
      parentUserId: "",
      parentName: "Orphan",
      schoolCode: "CD-IN-26-001",
    },
  ],
  schoolCode: "CD-IN-26-001",
  theme: "Absence",
  message: "Bonjour",
  priority: "Moyenne",
});
assert.equal(noCanonicalParent.ok, false, "destinataire sans compte canonique => aucun POST");
if (!noCanonicalParent.ok) assert.equal(noCanonicalParent.code, "no_canonical_parent");

const crossTenant = buildStaffSchoolToParentMessagePayload({
  selectedRecipientKey: "rel-bi",
  recipients: [
    {
      key: "rel-bi",
      studentId: "stu-bi",
      studentName: "Eric",
      parentUserId: "user-parent-bi",
      parentName: "Parent BI",
      schoolCode: "BI-2026-0001",
    },
  ],
  schoolCode: "CD-IN-26-001",
  theme: "Absence",
  message: "Bonjour",
  priority: "Moyenne",
});
assert.equal(crossTenant.ok, false, "aucun cross-tenant");
if (!crossTenant.ok) assert.equal(crossTenant.code, "cross_tenant");

const gererMessages = liveSession({
  sessionRole: "secretary",
  roleLabel: "Secrétaire",
  roleKeys: ["SECRETARY"],
  permissions: ["Gérer messages"],
});
assert.equal(canAccessBackofficeMessagesComposer(gererMessages), true);
assert.equal(canReadBackofficeMessagesList(gererMessages), true, "Gérer messages => liste OK");
assert.equal(canShowStaffMessagesComposer(gererMessages), true);

assert.equal(
  canReadBackofficeMessagesList(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Messages:R"],
    }),
  ),
  false,
  "Messages:R => liste refusée",
);
assert.equal(
  canReadBackofficeMessagesList(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Messages:CRUD"],
    }),
  ),
  false,
  "Messages:CRUD => liste refusée si le backend ne l'accepte pas",
);
assert.equal(canReadBackofficeMessagesList(staffReadOnly), true, "Messages:READ => liste OK");

const staffCreateWithRecipients = liveSession({
  sessionRole: "principal",
  roleLabel: "Directeur",
  roleKeys: ["PRINCIPAL"],
  permissions: ["Messages:CREATE", "Relations:READ", "Contacts:READ"],
});
assert.equal(canShowStaffMessagesComposer(staffCreateWithRecipients), true);

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
assert.equal(canShowStaffMessagesComposer(countryPrivileges), true);
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
assert.equal(canShowStaffMessagesComposer(superAdmin), true);
assert.equal(canArchiveAnnouncement(superAdmin), true);

assert.equal(
  canAccessBackofficeMessagesComposer(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Messages:CRUD"],
    }),
  ),
  false,
  "Messages:CRUD n'est pas un alias CREATE backend",
);
assert.equal(
  canShowStaffMessagesComposer(
    liveSession({
      sessionRole: "principal",
      roleLabel: "Directeur",
      roleKeys: ["PRINCIPAL"],
      permissions: ["Messages:CREATE", "Gérer utilisateurs"],
    }),
  ),
  true,
  "Messages:CREATE suffit pour le composer staff ; destinataires = GET /messages/recipients",
);

assert.equal(MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, false);
assert.equal(canRunGenericAdminCrud("courses"), false);
assert.equal(canRunGenericAdminCrud("assignments"), false);
assert.equal(canRunGenericAdminCrud("payments"), false);

console.log("mobileCtaRbacAlignment.test.ts OK");
