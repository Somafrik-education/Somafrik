import assert from "node:assert/strict";
import {
  MOBILE_GENERIC_ADMIN_CRUD_IN_RC1,
  MOBILE_ROLE_PERMISSION_MUTATION_ENABLED,
  SAFE_ADMIN_CRUD_ENTITIES,
  canRunGenericAdminCrud,
  canonicalRouteForAdminEntity,
} from "./mobileMutationSafety";

assert.deepEqual([...SAFE_ADMIN_CRUD_ENTITIES].sort(), ["assignments", "courses"]);
assert.equal(MOBILE_GENERIC_ADMIN_CRUD_IN_RC1, false);

for (const entity of [
  "countries",
  "subscriptions",
  "users",
  "announcements",
  "messages",
  "payments",
  "paymentStatuses",
  "schools",
  "classes",
  "students",
  "teachers",
] as const) {
  assert.equal(canRunGenericAdminCrud(entity), false, `${entity}: AdminCrud générique doit être fail-closed`);
}

assert.equal(canRunGenericAdminCrud("courses"), false, "courses: hors RC1 Mobile, pas de capacité générique opérationnelle");
assert.equal(canRunGenericAdminCrud("assignments"), false, "assignments: hors RC1 Mobile, pas de capacité générique opérationnelle");
assert.equal(canonicalRouteForAdminEntity("users"), "Users");
assert.equal(canonicalRouteForAdminEntity("classes"), "Classes");
assert.equal(canonicalRouteForAdminEntity("announcements"), "Announcements");
assert.equal(canonicalRouteForAdminEntity("countries"), null);
assert.equal(canonicalRouteForAdminEntity("subscriptions"), null);
assert.equal(MOBILE_ROLE_PERMISSION_MUTATION_ENABLED, false);

console.log("mobileMutationSafety.test.ts OK");
