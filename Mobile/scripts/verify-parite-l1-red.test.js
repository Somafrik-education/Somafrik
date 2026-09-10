const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALLOWED_PATHS,
  L1_FAILED_EXPECTED,
  L1_PASSED_EXPECTED,
  L1_UX_FAILED_EXPECTED,
  L1_UX_PASSED_EXPECTED,
  evaluateProductionDiff,
  isForbiddenRuntime,
  sameIds,
} = require("./verify-parite-l1-red.js");

describe("baseline RED exacte", () => {
  it("accepte L1-01…L1-09 RED et L1-10 GREEN", () => {
    assert.equal(sameIds(L1_FAILED_EXPECTED, [
      "L1-01", "L1-02", "L1-03", "L1-04", "L1-05", "L1-06", "L1-07", "L1-08", "L1-09",
    ]), true);
    assert.equal(sameIds(L1_PASSED_EXPECTED, ["L1-10"]), true);
  });

  it("accepte L1-UX-01…L1-UX-10 RED et zéro GREEN", () => {
    assert.equal(sameIds(L1_UX_FAILED_EXPECTED, [
      "L1-UX-01", "L1-UX-02", "L1-UX-03", "L1-UX-04", "L1-UX-05",
      "L1-UX-06", "L1-UX-07", "L1-UX-08", "L1-UX-09", "L1-UX-10",
    ]), true);
    assert.equal(sameIds(L1_UX_PASSED_EXPECTED, []), true);
  });

  it("rejette un swap L1-08 GREEN / L1-10 RED", () => {
    const failed = L1_FAILED_EXPECTED.map((id) => (id === "L1-08" ? "L1-10" : id));
    const passed = ["L1-08"];
    assert.equal(sameIds(failed, L1_FAILED_EXPECTED), false);
    assert.equal(sameIds(passed, L1_PASSED_EXPECTED), false);
  });

  it("rejette 10 RED métier (L1-10 ne doit pas devenir rouge)", () => {
    const failed = [...L1_FAILED_EXPECTED, "L1-10"];
    assert.equal(sameIds(failed, L1_FAILED_EXPECTED), false);
    assert.equal(sameIds([], L1_PASSED_EXPECTED), false);
  });

  it("rejette un UX devenu vert", () => {
    const failed = L1_UX_FAILED_EXPECTED.filter((id) => id !== "L1-UX-01");
    assert.equal(sameIds(failed, L1_UX_FAILED_EXPECTED), false);
    assert.equal(sameIds(["L1-UX-01"], L1_UX_PASSED_EXPECTED), false);
  });
});

describe("productionUntouched calculé", () => {
  it("est vrai uniquement pour l'allowlist RED", () => {
    const diff = evaluateProductionDiff([...ALLOWED_PATHS]);
    assert.equal(diff.productionUntouched, true);
    assert.deepEqual(diff.unexpectedFiles, []);
    assert.deepEqual(diff.forbiddenHits, []);
  });

  it("échoue si HomeScreen / Payments / Navigator / api / UnpaidScreen apparaissent", () => {
    const files = [
      ...ALLOWED_PATHS,
      "Mobile/src/screens/HomeScreen.tsx",
      "Mobile/src/screens/PaymentsScreen.tsx",
      "Mobile/src/navigation/AppNavigator.tsx",
      "Mobile/src/services/api.ts",
      "Mobile/src/screens/UnpaidScreen.tsx",
    ];
    const diff = evaluateProductionDiff(files);
    assert.equal(diff.productionUntouched, false);
    assert.equal(diff.forbiddenHits.includes("Mobile/src/screens/HomeScreen.tsx"), true);
    assert.equal(diff.forbiddenHits.includes("Mobile/src/screens/UnpaidScreen.tsx"), true);
    assert.equal(isForbiddenRuntime("Mobile/src/screens/UnpaidScreen.tsx"), true);
  });

  it("échoue pour un fichier hors allowlist même non interdit nommément", () => {
    const diff = evaluateProductionDiff([...ALLOWED_PATHS, "Mobile/src/screens/SomethingElse.tsx"]);
    assert.equal(diff.productionUntouched, false);
    assert.deepEqual(diff.unexpectedFiles, ["Mobile/src/screens/SomethingElse.tsx"]);
  });
});
