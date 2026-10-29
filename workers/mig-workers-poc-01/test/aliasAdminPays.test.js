import assert from "node:assert/strict";
import test from "node:test";
import backend from "../src/backendBridge.cjs";

const { RbacService } = backend;
const route = "GET /api/students";

function principal(role) {
  return {
    sub: "poc-dette",
    role,
    schoolCode: "POC-WORKERS-01",
    identifier: "poc-dette",
  };
}

test("dette observée — country_admin et Admin Pays divergent", () => {
  const rbac = new RbacService();
  assert.equal(rbac.canAccess(principal("country_admin"), route), true);
  assert.equal(rbac.canAccess(principal("Admin Pays"), route), false);
});
