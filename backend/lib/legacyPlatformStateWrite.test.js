"use strict";

const assert = require("node:assert/strict");
const {
  PLATFORM_STATE_KEYS,
  LEGACY_PLATFORM_STATE_WRITE_CODE,
  stripLegacyPlatformStateWrite,
  listRejectedPlatformKeys,
} = require("./legacyPlatformStateWrite");

function expectReject(body) {
  const result = stripLegacyPlatformStateWrite(body);
  assert.equal(result.rejectLegacyPlatformWrite, true);
  assert.ok(result.rejectedKeys.length);
  return result;
}

assert.equal(PLATFORM_STATE_KEYS.length, 10);
assert.equal(LEGACY_PLATFORM_STATE_WRITE_CODE, "LEGACY_PLATFORM_STATE_WRITE_FORBIDDEN");

for (const key of PLATFORM_STATE_KEYS) {
  for (const value of [null, [], {}, "x"]) {
    const result = stripLegacyPlatformStateWrite({ [key]: value, users: [] });
    assert.equal(result.rejectLegacyPlatformWrite, true, `${key}=${JSON.stringify(value)}`);
    assert.deepEqual(result.rejectedKeys, [key]);
    assert.ok(!Object.prototype.hasOwnProperty.call(result.body, key));
    assert.ok(Object.prototype.hasOwnProperty.call(result.body, "users"));
  }
}

const mixed = stripLegacyPlatformStateWrite({ countries: [], notifications: [{ id: "1" }], contacts: [] });
assert.equal(mixed.rejectLegacyPlatformWrite, true);
assert.deepEqual(new Set(mixed.rejectedKeys), new Set(["countries", "notifications"]));
assert.deepEqual(mixed.body, { contacts: [] });

const clean = stripLegacyPlatformStateWrite({ contacts: [], users: [] });
assert.equal(clean.rejectLegacyPlatformWrite, false);
assert.deepEqual(listRejectedPlatformKeys({ rolePermissions: {} }), ["rolePermissions"]);

console.log("legacyPlatformStateWrite.test.js OK");
