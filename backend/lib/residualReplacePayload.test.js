"use strict";

const assert = require("node:assert/strict");
const { assertResidualReplacePayload } = require("./residualReplacePayload");

function expect400(fn) {
  try {
    fn();
    assert.fail("BusinessError attendue");
  } catch (error) {
    assert.equal(error.statusCode, 400);
  }
}

assert.deepEqual(assertResidualReplacePayload({ exams: [] }, "exams"), []);
assert.deepEqual(
  assertResidualReplacePayload({ exams: [{ id: "EX-1", title: "Test" }] }, "exams"),
  [{ id: "EX-1", title: "Test" }],
);

expect400(() => assertResidualReplacePayload({}, "exams"));
expect400(() => assertResidualReplacePayload({ exams: null }, "exams"));
expect400(() => assertResidualReplacePayload({ exams: [{}] }, "exams"));
expect400(() => assertResidualReplacePayload({ exams: [null] }, "exams"));
expect400(() => assertResidualReplacePayload(null, "bulletins"));

console.log("residualReplacePayload.test.js: OK");
