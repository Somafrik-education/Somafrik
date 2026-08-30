import assert from "node:assert/strict";
import {
  catalogRouteName,
  getLeafRouteName,
  getRootRouteName,
  isPublicOrBootstrapRoute,
  readHelpNavigationSnapshot,
} from "./resolveMobileHelpRoute";

assert.equal(catalogRouteName("Accueil"), "Home");
assert.equal(catalogRouteName("Enseignants"), "Teachers");
assert.equal(catalogRouteName("Utilisateurs"), "Users");
assert.equal(catalogRouteName("Classes"), "Classes");
assert.equal(catalogRouteName(null), null);

assert.equal(isPublicOrBootstrapRoute("Welcome"), true);
assert.equal(isPublicOrBootstrapRoute("Login"), true);
assert.equal(isPublicOrBootstrapRoute("RoleSelection"), true);
assert.equal(isPublicOrBootstrapRoute("Support"), true);
assert.equal(isPublicOrBootstrapRoute("Permissions"), true);
assert.equal(isPublicOrBootstrapRoute("PermissionsBootstrap"), true);
assert.equal(isPublicOrBootstrapRoute("ConfigurationError"), true);
assert.equal(isPublicOrBootstrapRoute("Home"), false);
assert.equal(isPublicOrBootstrapRoute("Classes"), false);

const nested = {
  index: 0,
  routes: [
    {
      name: "Home",
      state: {
        index: 0,
        routes: [{ name: "Accueil" }],
      },
    },
  ],
};
assert.equal(getLeafRouteName(nested), "Accueil");

const stackClasses = {
  index: 1,
  routes: [{ name: "Home" }, { name: "Classes" }],
};
assert.equal(getLeafRouteName(stackClasses), "Classes");
assert.equal(getRootRouteName(nested), "Home");
assert.equal(getRootRouteName(stackClasses), "Classes");
assert.equal(getRootRouteName(null), null);
assert.deepEqual(readHelpNavigationSnapshot(nested), { routeName: "Accueil", rootName: "Home" });
assert.deepEqual(readHelpNavigationSnapshot(stackClasses), { routeName: "Classes", rootName: "Classes" });
assert.deepEqual(readHelpNavigationSnapshot(null), { routeName: null, rootName: null });

console.log("resolveMobileHelpRoute.test.ts OK");
