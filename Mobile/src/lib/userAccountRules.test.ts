/**
 *   npx tsx Mobile/src/lib/userAccountRules.test.ts
 */
import assert from "node:assert/strict";
import { validateAccountSecret, validatePasswordPolicy } from "./userAccountRules";

function run() {
  assert.match(String(validatePasswordPolicy("abcdef")), /8 caractères/);
  assert.match(String(validateAccountSecret("abcdef1")), /8 caractères/);
  assert.match(String(validateAccountSecret("password")), /chiffre/);
  assert.match(String(validateAccountSecret("12345678")), /lettre/);
  assert.equal(validateAccountSecret("Pass1234"), null);
  assert.equal(validateAccountSecret("482917"), null);
  assert.match(String(validateAccountSecret("123456")), /trop faible/);
  console.log("userAccountRules.test.ts OK");
}

run();
