"use strict";

/**
 * LOT 5 — parcours Pédagogie HTTP (mémoire) : routes canoniques exposées.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");

function main() {
  assert.match(server, /app\.post\("\/api\/courses"/);
  assert.match(server, /app\.post\("\/api\/course-schedules"/);
  assert.match(server, /app\.post\("\/api\/evaluations"/);
  assert.match(server, /app\.post\("\/api\/notes"/);
  assert.match(server, /app\.post\("\/api\/presences"/);
  assert.match(server, /overlayPedagogyProjection/);
  assert.match(server, /listPedagogyProjection/);
  console.log("OK http: routes pédagogie canoniques exposées");
}

main();
