#!/usr/bin/env node
"use strict";

/**
 * MONO-L0 — vérifie que le catalogue de production se charge sans route.
 *
 *   node scripts/mono-l0-module-load.js
 *
 * N'ouvre aucun port et ne contacte aucune base. L'inventaire HTTP des 371
 * routes reste celui de scripts/mono-t1-route-inventory.js --check.
 */

const { MODULE_CATALOG } = require("../backend/modules/catalog");
const { composeModules } = require("../backend/modules/composeModules");

const EXPECTED_ORDER = [
  "finance",
  "students",
  "users",
  "attendance",
  "notes",
  "planning",
  "communications",
  "administration",
  "platform",
];

const app = new Proxy(
  {},
  {
    get(_target, prop) {
      return () => {
        throw new Error(`Enregistrement inattendu sur l'application : ${String(prop)}.`);
      };
    },
  },
);

const report = composeModules(app, MODULE_CATALOG);
const order = report.order.join(",");
const expected = EXPECTED_ORDER.join(",");
if (order !== expected || report.routeCount !== 0) {
  console.error(`✖ Catalogue MONO-L0 inattendu : ordre « ${order} », ${report.routeCount} route(s).`);
  process.exit(1);
}

console.log(`✔ Catalogue MONO-L0 chargé (${report.order.length} modules inline, 0 route ajoutée).`);
console.log(`  ordre : ${report.order.join(" → ")}`);
