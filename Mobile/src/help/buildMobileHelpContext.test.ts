import assert from "node:assert/strict";
import test from "node:test";
import { createHelpContext, HELP_PLATFORM, HELP_ROLE, HELP_SCREEN, isHelpAvailable } from "../../../packages/help-catalog/src/index.js";
import { buildMobileHelpContext } from "./buildMobileHelpContext.ts";

test("buildMobileHelpContext maps attendance route without secrets", () => {
  const context = buildMobileHelpContext({
    routeName: "TeacherAttendance",
    role: "Enseignant",
    permissions: ["Présences:READ", "Présences:UPDATE"],
  });
  assert.deepEqual(Object.keys(context).sort(), ["module", "permissions", "platform", "role", "screen"]);
  assert.equal(context.platform, HELP_PLATFORM.MOBILE);
  assert.equal(context.role, HELP_ROLE.TEACHER);
  assert.equal(context.screen, HELP_SCREEN.ATTENDANCE);
  assert.equal(isHelpAvailable(context), true);
});

test("hides help on Support and Login", () => {
  assert.equal(
    isHelpAvailable(buildMobileHelpContext({ routeName: "Support", role: "Enseignant", permissions: ["Messages:READ"] })),
    false,
  );
  assert.equal(
    isHelpAvailable(buildMobileHelpContext({ routeName: "Login", role: "Enseignant", permissions: [] })),
    false,
  );
});

test("parent home stays parent-scoped", () => {
  const context = buildMobileHelpContext({ routeName: "Home", role: "Parent", permissions: [] });
  assert.equal(context.screen, HELP_SCREEN.PARENT_HOME);
});

test("rejects secrets in raw catalog context", () => {
  assert.throws(
    () =>
      createHelpContext({
        platform: "mobile",
        routeName: "Home",
        role: "Parent",
        jwt: "secret",
      }),
    /jwt/,
  );
});
