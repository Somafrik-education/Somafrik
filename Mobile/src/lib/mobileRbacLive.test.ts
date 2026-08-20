import assert from "node:assert/strict";
import {
  SUPER_ADMIN_ALLOWED_FEATURES,
  canReadRoute,
  canReadView,
  hasSecurityPermission,
  resolveEffectivePermissions,
} from "../domain/security/permissions";

const superAdmin = {
  role: "super_admin",
  permissions: ["ALL_PRIVILEGES"],
  user: {
    id: "sa-1",
    permissions: ["ALL_PRIVILEGES"],
  },
};

assert.equal(SUPER_ADMIN_ALLOWED_FEATURES.has("Utilisateurs"), true);
assert.equal(SUPER_ADMIN_ALLOWED_FEATURES.has("Classes"), false);
assert.equal(hasSecurityPermission(superAdmin, "Utilisateurs", "READ"), true);
assert.equal(hasSecurityPermission(superAdmin, "Établissements", "UPDATE"), true);
assert.equal(hasSecurityPermission(superAdmin, "Classes", "READ"), false);
assert.equal(hasSecurityPermission(superAdmin, "Élèves", "UPDATE"), false);
assert.equal(hasSecurityPermission(superAdmin, "Planning de cours", "READ"), false);
assert.equal(canReadView(superAdmin, "Permissions"), true);
assert.equal(canReadRoute(superAdmin, "SchoolManagement"), true);
assert.equal(canReadRoute(superAdmin, "Classes"), false);
assert.equal(canReadRoute(superAdmin, "Students"), false);
assert.equal(canReadRoute(superAdmin, "Timetable"), false);
assert.equal(canReadRoute(superAdmin, "Audit"), false, "alias Utilisateurs ne doit pas ouvrir Audit");
assert.equal(canReadRoute(superAdmin, "Support"), false, "alias Messages ne doit pas ouvrir Support");

const liveSchoolAdmin = resolveEffectivePermissions(
  "Admin School",
  ["Classes:READ", "Élèves:READ"],
  { "Admin School": ["Classes:CRUD", "Élèves:CRUD"] },
);
assert.deepEqual(
  liveSchoolAdmin,
  ["Classes:READ", "Élèves:READ"],
  "un tableau live doit rester autoritaire et ne pas être fusionné avec les defaults/matrices locales",
);

console.log("mobileRbacLive.test.ts OK");
