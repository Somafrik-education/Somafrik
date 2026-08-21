import assert from "node:assert/strict";
import {
  MOBILE_ROLE_PERMISSION_MUTATION_ENABLED,
  SAFE_ADMIN_CRUD_ENTITIES,
  canRunGenericAdminCrud,
  canonicalRouteForAdminEntity,
} from "./mobileMutationSafety";

assert.deepEqual([...SAFE_ADMIN_CRUD_ENTITIES].sort(), ["assignments", "courses"]);

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

assert.equal(canRunGenericAdminCrud("courses"), true);
assert.equal(canRunGenericAdminCrud("assignments"), true);
assert.equal(canonicalRouteForAdminEntity("users"), "Users");
assert.equal(canonicalRouteForAdminEntity("classes"), "Classes");
assert.equal(canonicalRouteForAdminEntity("announcements"), "Announcements");
assert.equal(canonicalRouteForAdminEntity("countries"), null);
assert.equal(canonicalRouteForAdminEntity("subscriptions"), null);
assert.equal(MOBILE_ROLE_PERMISSION_MUTATION_ENABLED, false);

console.log("mobileMutationSafety.test.ts OK");
