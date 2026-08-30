import assert from "node:assert/strict";
import { shouldShowMobileHelp } from "./helpAvailability";

const schoolSession = {
  role: "school_admin",
  permissions: ["Paramètres Établissement:READ", "Classes:READ"],
  user: { role: "Admin School", mustChangePassword: false },
};

assert.equal(
  shouldShowMobileHelp({ session: null, permissionsBootstrap: "ready", routeName: "Home" }),
  false,
  "avant login → HELP absent",
);

assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "loading", routeName: "Home" }),
  false,
  "PermissionsBootstrap loading → HELP absent",
);

assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "error", routeName: "Home" }),
  false,
);

assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready", routeName: "Welcome" }),
  false,
);
assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready", routeName: "Login" }),
  false,
);
assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready", routeName: "Support" }),
  false,
);
assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready", routeName: "Permissions" }),
  false,
);

assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready", routeName: "Home" }),
  true,
  "après session valide → HELP sur écran autorisé",
);

assert.equal(
  shouldShowMobileHelp({ session: schoolSession, permissionsBootstrap: "ready_offline", routeName: "Classes" }),
  true,
  "hors ligne authentifié → HELP disponible",
);

assert.equal(
  shouldShowMobileHelp({
    session: { ...schoolSession, user: { ...schoolSession.user, mustChangePassword: true } },
    permissionsBootstrap: "ready",
    routeName: "Home",
  }),
  false,
);

console.log("helpAvailability.test.ts OK");
