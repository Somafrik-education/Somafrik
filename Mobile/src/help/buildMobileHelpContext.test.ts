import assert from "node:assert/strict";
import { createHelpContext } from "@somafrik/help-catalog";
import { buildMobileHelpContext, liveHelpPermissions, liveHelpRole } from "./buildMobileHelpContext";

const context = buildMobileHelpContext({
  routeName: "Classes",
  role: "school_admin",
  permissions: ["Classes:READ", "Paramètres Établissement:READ"],
});

assert.deepEqual(Object.keys(context).sort(), ["module", "permissions", "platform", "role", "screen"]);
assert.equal(context.platform, "mobile");
assert.equal(context.role, "SCHOOL_ADMIN");
assert.equal(context.screen, "classes");
assert.deepEqual([...context.permissions], ["Classes:READ", "Paramètres Établissement:READ"]);
assert.equal(JSON.stringify(context).includes("jwt"), false);
assert.equal(JSON.stringify(context).includes("accessToken"), false);

assert.throws(
  () =>
    createHelpContext({
      platform: "mobile",
      routeName: "Classes",
      role: "Enseignant",
      jwt: "secret",
    } as never),
  /jwt/i,
);

const session = {
  role: "teacher",
  permissions: ["Notes:READ"],
  user: { role: "Enseignant", permissions: ["Notes:CREATE"], mustChangePassword: false },
};
assert.equal(liveHelpRole(session), "teacher");
assert.deepEqual(liveHelpPermissions(session), ["Notes:READ"]);
assert.deepEqual(liveHelpPermissions({ user: { permissions: ["Élèves:READ"] } }), ["Élèves:READ"]);

console.log("buildMobileHelpContext.test.ts OK");
