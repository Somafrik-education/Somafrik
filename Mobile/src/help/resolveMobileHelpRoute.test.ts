import assert from "node:assert/strict";
import { catalogRouteName, getLeafRouteName, isPublicOrBootstrapRoute } from "./resolveMobileHelpRoute";

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

console.log("resolveMobileHelpRoute.test.ts OK");
