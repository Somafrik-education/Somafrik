const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldSeedDemoData,
  isProductionEnvironment,
  assertProductionSecurityConfiguration,
} = require("../lib/demoSeedPolicy");

describe("demoSeedPolicy", () => {
  it("active le seed en développement local", () => {
    assert.equal(
      shouldSeedDemoData({
        NODE_ENV: "development",
        SOMAFRIK_SKIP_DEMO_SEED: "false",
      }),
      true,
    );
  });

  it("désactive le seed quand SOMAFRIK_SKIP_DEMO_SEED=true", () => {
    assert.equal(
      shouldSeedDemoData({
        NODE_ENV: "development",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
      }),
      false,
    );
  });

  it("n'active jamais le seed en production", () => {
    assert.equal(
      shouldSeedDemoData({
        NODE_ENV: "production",
        SOMAFRIK_SKIP_DEMO_SEED: "false",
      }),
      false,
    );
    assert.equal(isProductionEnvironment({ NODE_ENV: "production" }), true);
  });

  it("exige SOMAFRIK_SKIP_DEMO_SEED=true en production", () => {
    assert.throws(
      () =>
        assertProductionSecurityConfiguration({
          NODE_ENV: "production",
          SOMAFRIK_SKIP_DEMO_SEED: "false",
        }),
      /SOMAFRIK_SKIP_DEMO_SEED=true/,
    );
  });
});
