"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { THREATS, THREAT_IDS } = require("./threats");
const { GATES } = require("./contract");

test("quatorze menaces Demo sont figées et reliées à un gate", () => {
  assert.equal(THREATS.length, 14);
  assert.equal(THREAT_IDS.length, 14);
  assert.equal(new Set(THREAT_IDS).size, 14);
  for (const threat of THREATS) {
    assert.ok(threat.id, threat.title);
    assert.ok(threat.mitigation);
    assert.ok(GATES.includes(threat.gate), `${threat.id} → ${threat.gate}`);
  }
});

test("P0 CORS et seed legacy sont des menaces bloquantes", () => {
  const cors = THREATS.find((threat) => threat.id === "T2_DEMO_ON_PROD_CORS");
  const seed = THREATS.find((threat) => threat.id === "T3_LEGACY_SEED_REUSED");
  const jwt = THREATS.find((threat) => threat.id === "T1_JWT_IN_URL");
  const preprod = THREATS.find((threat) => threat.id === "T14_PREPROD_AS_DEMO");
  assert.ok(cors);
  assert.ok(seed);
  assert.ok(jwt);
  assert.ok(preprod);
  assert.match(cors.mitigation, /APP_ENV=demo/);
  assert.match(seed.mitigation, /demo:reset/);
  assert.match(jwt.mitigation, /code/);
  assert.match(preprod.mitigation, /autonome/i);
});
