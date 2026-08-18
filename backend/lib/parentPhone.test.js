"use strict";

/**
 * Téléphone parent — validation internationale raisonnable.
 */

const assert = require("node:assert/strict");
const {
  isValidParentPhoneNumber,
  optionalParentPhone,
  PARENT_PHONE_INVALID_MESSAGE,
} = require("./parentPhone");

function main() {
  assert.equal(isValidParentPhoneNumber("+243 820 000 001"), true);
  assert.equal(isValidParentPhoneNumber("+33 6 12 34 56 78"), true);
  assert.equal(isValidParentPhoneNumber("0812345678"), true);
  assert.equal(isValidParentPhoneNumber("(243) 820-000-001"), true);
  assert.equal(optionalParentPhone(""), null);
  assert.equal(optionalParentPhone("   "), null);
  assert.equal(optionalParentPhone(null), null);
  assert.equal(optionalParentPhone(undefined), null);
  assert.equal(optionalParentPhone("+243 820 000 111"), "+243 820 000 111");

  assert.throws(
    () => optionalParentPhone("Baudouin OKITO"),
    (error) => error.statusCode === 400 && error.message === PARENT_PHONE_INVALID_MESSAGE,
  );
  assert.throws(
    () => optionalParentPhone("abc"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => optionalParentPhone("+2431"),
    (error) => error.statusCode === 400,
  );
  assert.equal(isValidParentPhoneNumber("Baudouin OKITO"), false);
  console.log("parentPhone.test.js: OK");
}

main();
