"use strict";

const assert = require("node:assert/strict");
const {
  CLIENTS_STATE_KEYS,
  LEGACY_CLIENTS_STATE_WRITE_CODE,
  stripLegacyClientsStateWrite,
  listRejectedClientsKeys,
} = require("./legacyClientsStateWrite");

assert.deepEqual(listRejectedClientsKeys({ users: [] }), ["users"]);
assert.deepEqual(listRejectedClientsKeys({ contacts: [], announcements: [] }), ["contacts", "announcements"]);

const rejected = stripLegacyClientsStateWrite({ users: [], contacts: [{ id: "1" }], classes: [] });
assert.equal(rejected.rejectLegacyClientsWrite, true);
assert.deepEqual(rejected.rejectedKeys, ["users", "contacts"]);
assert.deepEqual(rejected.body, { classes: [] });

const clean = stripLegacyClientsStateWrite({ classes: [], students: [] });
assert.equal(clean.rejectLegacyClientsWrite, false);
assert.equal(LEGACY_CLIENTS_STATE_WRITE_CODE, "LEGACY_CLIENTS_STATE_WRITE_FORBIDDEN");
assert.equal(CLIENTS_STATE_KEYS.length, 5);

console.log("legacyClientsStateWrite.test.js OK");
