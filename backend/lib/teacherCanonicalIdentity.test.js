"use strict";

const assert = require("assert");
const { buildUserIndex, resolveCanonicalIdentity } = require("./teacherCanonicalIdentity");

const users = [
  { id: "UUID-D", userCode: "UUID-C" },
  { id: "UUID-C", userCode: "UUID-B" },
  { id: "UUID-B", userCode: "UUID-A" },
  { id: "UUID-A", userCode: "ENS-0001" },
];
const index = buildUserIndex(users);
for (const user of users) assert.strictEqual(resolveCanonicalIdentity(user, index), "ENS-0001");
assert.strictEqual(resolveCanonicalIdentity("ENS-0001", index), "ENS-0001");

assert.throws(
  () => resolveCanonicalIdentity("MISSING", index),
  (error) => error.code === "CANONICAL_IDENTITY_UNRESOLVED",
);
assert.throws(
  () => resolveCanonicalIdentity("A", [{ id: "A", userCode: "B" }, { id: "B", userCode: "A" }]),
  (error) => error.code === "CANONICAL_IDENTITY_CYCLE",
);
assert.throws(
  () => resolveCanonicalIdentity("A", [{ id: "A", userCode: "ENS-0001" }, { id: "a", userCode: "ENS-0002" }]),
  (error) => error.code === "CANONICAL_IDENTITY_AMBIGUOUS",
);

console.log("teacherCanonicalIdentity.test.js : OK");
