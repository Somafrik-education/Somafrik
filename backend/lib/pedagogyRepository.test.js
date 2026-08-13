"use strict";

const assert = require("node:assert/strict");
const {
  PEDAGOGY_STATE_KEYS,
  stripLegacyPedagogyStateWrite,
} = require("./legacyPedagogyStateWrite");

async function main() {
  const store = {
    tables: { courses: [], evaluations: [], notes: [], presences: [], auditLogs: [] },
    withTransaction(fn) {
      const tx = {
        recordPedagogyAudit: async (entry) => {
          store.tables.auditLogs.push(entry);
        },
      };
      return fn(tx);
    },
  };

  assert.equal(PEDAGOGY_STATE_KEYS.length, 5);
  const rejected = stripLegacyPedagogyStateWrite({ presences: [], courses: {} });
  assert.equal(rejected.rejectLegacyPedagogyWrite, true);
  assert.deepEqual(rejected.rejectedKeys, ["courses", "presences"]);

  console.log("pedagogyRepository.test.js: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
